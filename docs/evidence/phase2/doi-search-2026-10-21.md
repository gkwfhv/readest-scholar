# Phase 2：书库按 DOI 和出版年份查找

现有书库文本筛选 `createBookFilter` 可查标题、作者、分组、标签、主题和简介，但不会匹配 `BookMetadata.doi` 或 `published`。用户录入 DOI 后无法用书库搜索框找回该文献。本项只扩展现有客户端筛选的候选文本，不改变全文检索引擎、数据库或网络请求。

## 实现和验证

- `getBookValuesText` 纳入 `book.metadata.doi` 与 `book.metadata.published`；普通正则路径与无效正则时的字面子串回退都共用它。已删除书籍仍由现有筛选入口排除。
- 先新增 DOI、年份、无效正则输入的行为断言并运行：2 项失败。实现后运行 `pnpm test --run src/__tests__/app/library/library-utils-extended.test.ts src/__tests__/app/library/library-filter-calibre-columns.test.ts`：2 个文件、55 项通过。`pnpm exec tsc --noEmit` 与两处改动文件的 `pnpm exec biome check` 均通过。
- 使用 Node 24.11.1 与 `pnpm test --run --maxWorkers=4` 跑完整仓库单测：1,179 个文件通过、4 个跳过，13,824 项通过、16 项跳过，0 项失败。默认 Node 26 的无限制并行 pre-push 钩子曾产生大量其他测试失败并被中止；推送时使用已完成的 Node 24 全量检查作为门槛。完整日志留在测试机 `/private/tmp/scholar-phase2-fulltest-20261021.log`，不含凭据。
- 不做 DOI 格式验证、规范化、重复提示或远程 DOI 元数据抓取；同一 DOI 对应多文件的身份判断留给文献模型。未在 200+ 文献书库或移动设备上做本项实测。

## staging 实际界面验收

- 合并提交 `69ee5356561eb4a7a2c6b5faa4ed56372e76ea23` 的双架构 GitHub Actions 镜像发布通过；本机与测试主机均验证 amd64 镜像内容 ID 为 `sha256:f5a0ddae78db6365b5dcce8138434292e548a75b8f71004dc138ad2b44c024cd`。主机源码快进到该提交、镜像归档校验后，使用 `SCHOLAR_STAGING_DEPLOY_CONFIRM=yes bash infra/staging/deploy-web.sh ghcr.io/gkwfhv/readest@sha256:f5a0ddae78db6365b5dcce8138434292e548a75b8f71004dc138ad2b44c024cd` 更新隔离 Web。部署前备份 `~/scholar-staging-backups/20261021T125116Z` 的 `STATUS=complete`；该备份尚未冷恢复。部署前后 Web、Auth、REST/数据库与对象存储四路就绪均为 `OK`。
- 在该 Web 用先前的合成账户搜索 DOI 后缀 `readest-scholar-phase2-20261021-desktop`，四本本地可见书籍中只出现目标 PDF；打开详情确认 DOI 相同。[DOI 搜索截图](doi-search-staging-2026-10-21.png)。
- 将同一本合成测试 PDF 的出版日期手动设为 `2021`，详情显示 2021 年 1 月 1 日；搜索 `2021` 只出现目标 PDF，[年份搜索截图](doi-search-year-staging-2026-10-21.png)；搜索 `2022` 无结果。该日期仅为测试数据，不代表 PDF 的真实出版年。
- 本项证明单个合成账户书库的文本筛选行为；尚未测量 200+ 文献性能，也未测试结构化年份筛选、移动 UI 或各设备的年份并发编辑。
