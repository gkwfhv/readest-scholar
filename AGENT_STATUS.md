# Agent 状态

更新时间：2026-10-20。

## 已完成

- 阅读方案，并把第一步限定为 Phase 0 与可验证的 Phase 1 准备。
- 从 GitHub 锁定 Readest `main` 为 `2d37bbfc2e94725e1343ab2a825573545aa59f5f`。
- 阅读该提交上的 `AGENTS.md`、`docs/architecture.md`、`docs/code-layout.md`、`docs/testing.md`、`docker/README.md`。
- 核对服务目录、同步类别、基础表、AI RAG、许可证标识。
- 写出 `docs/audit/*`、`docs/adr/0001-foundation.md`、`LICENSES.md`、`VERSIONS.md`。
- 在工作区安装 pnpm `11.1.1` 与 Node `24.11.1` 到 `.tools/`，未做全局安装。
- 为本机验证新增仅绑定回环地址的 Compose 覆盖文件及随机测试凭据生成器；配置解析已验证。
- 补齐 `js-mdict` 和 `tauri-plugin-turso` 子模块，生成本地 PDF vendor 资源。
- 修正审计中对 AI CFI 引用、手绘坐标和 AI 会话存储的判断，并保存 Node 24 全量测试证据。
- 加固备份脚本的私有权限与完成标记，假 Docker 的成功/失败路径测试已通过。
- 用固定摘要的 Pigsty MinIO 兼容镜像运行官方 Compose 的本机测试覆盖：合成账户已登录，独立桌面端上传仓库 PDF，Web 端下载并打开同一本两页 PDF。
- 对合成数据生成真实数据库与对象备份；发现并修复原始 `pg_dump` 缺少 GraphQL 包装函数的问题，生成可恢复 SQL。在第二套完整独立服务栈中恢复 SQL/对象后，以合成账户登录、下载并阅读 PDF，页面显示阅读进度已同步。
- 按上游 `pnpm worktree:new` 流程建立 `feat/scholar-foundation` 工作树；将方案、审计、演练文档和基础设施脚本整理进同一源码树，修正脚本的仓库根路径。新增 Scholar CI 的备份逻辑、Compose 回环端口检查与源码依赖清单作业；本地脚本检查已通过。
- 将基础提交 `b556652` 推送至公开仓库 `gkwfhv/readest-scholar` 的 `main`，并同步到 `/Users/admin/github/readest-scholar`。GitHub Actions 已启用；Scholar baseline 的许可证清单与 SBOM 作业通过，基础设施作业暴露出 Linux `stat` 兼容问题并已在本地容器复现和修复。Scorecard 和 Nix build 已通过。上游 Vercel 部署因缺少目标凭据失败；上游 Docker 镜像发布在验收前已请求取消。本次移除上游自动发布、部署及高成本定时作业的触发器，保留手动运行入口。
- 创建并核验活跃的 `Protect main - Scholar CI` 规则：匹配默认分支 `main`，阻止删除和强推，要求 PR 与 `local-infrastructure`、`source-inventory` 两项 GitHub Actions 检查；单人仓库审批数为 0。CI 许可证工件含 946 个生产 npm 包、21 种标签；SBOM 校验输出 6187 个源码树组件。异常许可证声明和原始工件摘要已记入 `LICENSES.md`。
- 在本机自托管 Web 阅读器给合成 PDF 第 2 页添加书签，隔离 macOS 桌面客户端重新打开同书后显示该条；再在桌面端给第 1 页添加书签，`public.book_notes` 出现第 1/2 页两行未删除记录，Web 刷新后显示两条。双向截图与只读查询事实已记入 Phase 0 证据。
- 核对锁定安装包的许可证文件：`khroma@2.1.0` 包内为 MIT，`jszip@3.10.1` 明确可选 MIT，`robust-predicates@3.0.3` 附 Unlicense 文本；保留原始机器标签，发布清单仍需核对打包范围与 Linux libvips。
- PR #2 的 Scholar baseline 第 5 次运行已通过：Linux `local-infrastructure` 13 秒，`source-inventory` 1 分 3 秒；这验证了 `stat` 跨平台修复和远端源码清单作业。
- 给 Scholar baseline、上游 PR checks 与 CodeQL 三个工作流加入按工作流和 ref 分组的并发设置：新 PR 提交取消同组旧运行，主分支运行不在进行中取消。YAML 解析与 `git diff --check` 已通过；需由新一轮远端 Actions 验证配置实际生效。
- 本机合成 PDF 的桌面划线写入 `book_notes` 并在 Web 第 2 页显示黄色高亮；Web 为同一批注添加合成备注后，桌面笔记侧栏显示备注。两方向截图和数据库记录已写入 Phase 0 证据；离线、冲突及旋转锚点未测。
- PR [#2](https://github.com/gkwfhv/readest-scholar/pull/2) 的全部必需检查通过并已合并，`main` 为 `bbdbdee6a`；用户本地 `/Users/admin/github/readest-scholar` 已快进同步且干净。
- 阅读位置修复已在 [PR #3](https://github.com/gkwfhv/readest-scholar/pull/3) 合并到 `main`（`12a93c9c2`），14 项检查成功、1 项按条件跳过；用户本地 `/Users/admin/github/readest-scholar` 已快进且干净。新桌面构建又发现全新客户端下载后首次打开会将云端第 2 页覆盖为第 1 页；补充的 3 条回归测试先失败后通过，修复未初始化配置的时间戳与自动首屏保存。独立标识 `com.readest.scholar.progress-test` 的新 macOS 包重新构建后，从零下载合成 PDF 恢复云端第 2 页，采用较新的远端第 1 页回退，并保留较新的本地第 1 页；服务端最终恢复为第 2 页。
- 新增宿主机 `infra/compose/check-readiness.mjs` 就绪探针：Web、Kong/Auth、Kong/PostgREST/数据库、对象存储四个回环 HTTP 路由在合成测试栈均返回 200；错误 Web 端口注入导致退出码 1，未输出凭据。[PR #4](https://github.com/gkwfhv/readest-scholar/pull/4) 以 14 项成功检查、1 项按条件跳过合并到 `main`（`90ac8f96d`）；用户本地仓库已快进且干净。
- 隔离 npm 对照发现 Turso 原生包 `0.8.3` 在同一 macOS arm64/Node 24 上仍给出完全相同的三个 L2 偏差；单纯升级依赖不能解决此阻塞。
- [PR #5](https://github.com/gkwfhv/readest-scholar/pull/5) 已将 Turso `0.8.3` 对照与未解决的精度风险合并到 `main`（`a031e6369`）。
- [PR #6](https://github.com/gkwfhv/readest-scholar/pull/6) 实现隔离的 Linux x86_64 staging Compose、随机测试凭据、四路就绪探针、项目隔离备份、Web 故障回滚演练、固定摘要镜像导入与操作手册。最终 `ba26d18ec` 的 Scholar baseline、上游 PR checks 与 CodeQL 全部通过，PR 已合并至 `main`（`4d9e31e24`）。用户本地仓库和测试主机均已同步；主机切换后静态挂载预检与四路就绪通过。
- 非生产主机已核对为 Linux x86_64，Docker/Compose/Python 可用；测试端口未占用，SSH 通过用户给出的 FRP 地址与本地密钥访问。七个镜像均固定 Linux amd64 平台摘要并已在主机导入；Docker Hub 的五个镜像经固定摘要代理导入，PostgreSQL 的代理下载失败后改用本机已校验摘要的 amd64 镜像归档，Web 镜像亦经本机导出，两份档案都通过主机 SHA256 校验。首次启动因 `umask 077` 导致静态 bind mount 文件只有 `0600`、数据库初始化中断；只删除本次新建且标签确认的两个空数据测试数据库卷，修复静态文件读取权限后第二次启动退出码 `0`。四路就绪探针、SSH 隧道 Web 页面、合成数据备份和 Web 故障回滚均实测通过；三个 staging 卷创建时间未变，其他 12 个容器的 ID 指纹不变。详情见 `docs/evidence/staging/README.md`。主机只绑定回环端口，尚无测试域名。
- 在远端 staging 建立随机合成账户及仓库样例 PDF 对象后，再次备份并在另一个 Compose 项目、网络、空数据库和对象卷中独立恢复。恢复栈四路就绪、原账户登录与用户 ID 核对、PDF 对象 SHA256 比对均通过。恢复栈已停止、三个卷保留；原 staging 和原有 12 个容器未变。恢复步骤及证据见 `infra/staging/README.md` 与 `docs/evidence/staging/README.md`。

## 当前事实（2026-10-20 更新，替代此前的状态快照）

- Phase 0 [验收记录](docs/evidence/phase0/acceptance-2026-10-20.md)结论为**暂不通过**；阅读、基础同步、staging 备份/恢复已有实测，不把准备工作记为 Phase 1 完成。
- Turso 原生 L2 在本机 2400 组样本的最大相对误差约 0.0651%，8000 次近邻相邻比较未见顺序颠倒；这是实测而非跨平台上界。[PR #9](https://github.com/gkwfhv/readest-scholar/pull/9) 的 Node 24 全量 Vitest 为 13760 通过、16 跳过，TypeScript 和 Biome 通过。第一次 CI 的 Web 格式作业失败，已在提交 `291602bf6` 修正证据 JSON 格式；新一轮必需 CI 检查已通过。
- [PR #10](https://github.com/gkwfhv/readest-scholar/pull/10) 修复 `@assistant-ui/react@0.11.58` 初始化方法接收者丢失及空会话不显示输入框。合成 OpenAI 兼容服务的开发 Web 浏览器烟测完成 PDF 索引、问答、来源显示和刷新后的会话恢复；新回归测试先在旧代码失败，再与 AI store/chat 测试一起 33/33 通过。首次 CI 因 pnpm 补丁 hunk 格式失败，已在提交 `81885b74b` 改为仅补运行时文件并重触发。生产 Web AI 入口仍被锁定上游隐藏，旧 Web 来源无 CFI 且刷新后不保留来源。
- [PR #8](https://github.com/gkwfhv/readest-scholar/pull/8) 更新了 Phase 0 验收、资源空闲快照和 [ADR 0002](docs/adr/0002-object-storage-staging-exception.md)。官方 MinIO 镜像拉取返回 401，固定摘要兼容镜像仅用于受限测试；生产对象存储选型未定。
- Scholar `main` 已受保护并要求 `local-infrastructure`、`source-inventory`。当前工作树的 `origin` 指向官方 Readest；向用户仓库推送时必须显式使用 `git@github.com:gkwfhv/readest-scholar.git`。Linux staging 通过 SSH 隧道可用且端口仅绑回环，无测试域名；不得把个人 SSH 私钥放入 CI。

## 下一动作

1. 完成 PR #9 的评审与受保护合入，继续核对 PR #10 的必需 CI；在受保护主线合入后重跑全量测试及 Web/桌面关键路径。PR #10 仍为草稿，需完成项目规则要求的所有模式 UI 检查和独立评审后才能合入。
2. 用合成 PDF 完成生产 Web AI 入口、真实可点击 PDF 引用和桌面 Reedy 运行时验证；把检索正确性与固定回答 mock 的传输烟测分开。
3. 采集同一 staging 栈在打开 PDF 与同步期间的受控资源样本及独立桌面资源；审查对象存储正式候选的许可、SBOM、升级和回滚。
4. 按 Phase 0 完成判据复核并签收；只有通过后才正式进入 Phase 1。

## 阻塞

- PR #9/#10 与验收文档尚未合入 `main`；PR #9 的 CI 已通过，PR #10 的补丁安装与必需 Scholar 基线已通过，完整 CI 仍待核对。
- 原版官方 MinIO 镜像不可用；staging 例外不等于生产选型。
- 生产 Web AI 设置入口隐藏，旧 Web 来源无法点击定位 PDF，桌面 Reedy 和自托管 AI 未完成端到端复验。
- 活动负载与独立桌面资源数据未采集；离线并发及旧客户端混用仍是后续同步风险。
