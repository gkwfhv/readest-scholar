# Phase 2：书库按 DOI 和出版年份查找

现有书库文本筛选 `createBookFilter` 可查标题、作者、分组、标签、主题和简介，但不会匹配 `BookMetadata.doi` 或 `published`。用户录入 DOI 后无法用书库搜索框找回该文献。本项只扩展现有客户端筛选的候选文本，不改变全文检索引擎、数据库或网络请求。

## 实现和验证

- `getBookValuesText` 纳入 `book.metadata.doi` 与 `book.metadata.published`；普通正则路径与无效正则时的字面子串回退都共用它。已删除书籍仍由现有筛选入口排除。
- 先新增 DOI、年份、无效正则输入的行为断言并运行：2 项失败。实现后运行 `pnpm test --run src/__tests__/app/library/library-utils-extended.test.ts src/__tests__/app/library/library-filter-calibre-columns.test.ts`：2 个文件、55 项通过。`pnpm exec tsc --noEmit` 与两处改动文件的 `pnpm exec biome check` 均通过。
- 使用 Node 24.11.1 与 `pnpm test --run --maxWorkers=4` 跑完整仓库单测：1,179 个文件通过、4 个跳过，13,824 项通过、16 项跳过，0 项失败。默认 Node 26 的无限制并行 pre-push 钩子曾产生大量其他测试失败并被中止；推送时使用已完成的 Node 24 全量检查作为门槛。完整日志留在测试机 `/private/tmp/scholar-phase2-fulltest-20261021.log`，不含凭据。
- 不做 DOI 格式验证、规范化、重复提示或远程 DOI 元数据抓取；同一 DOI 对应多文件的身份判断留给文献模型。未在 200+ 文献书库或移动设备上做本项实测。
