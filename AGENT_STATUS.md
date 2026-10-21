# Agent 状态

更新时间：2026-10-21。

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

## 当前事实（2026-10-21，替代此前的状态快照）

- Phase 0 [验收记录](docs/evidence/phase0/acceptance-2026-10-20.md)已通过计划第 9 节的**单机合成基线**，主分支包含 [PR #16](https://github.com/gkwfhv/readest-scholar/pull/16)。Web、独立 macOS 测试客户端和自托管 Silo 后端均实测阅读及同步；原版官方 MinIO 镜像无法拉取，不把它记为通过。
- [PR #9](https://github.com/gkwfhv/readest-scholar/pull/9) 给 Turso L2 采用小于 0.1% 的相对误差与近邻顺序契约，实测最大相对误差约 0.0651%，不外推跨平台上界。Phase 0 最新 Node 24 全量测试为 13,768 通过、16 跳过、0 失败。
- [PR #10](https://github.com/gkwfhv/readest-scholar/pull/10)、[#13](https://github.com/gkwfhv/readest-scholar/pull/13)的 AI 入口、初始化、PDF 页码来源与来源持久化修复，以及 [PR #14](https://github.com/gkwfhv/readest-scholar/pull/14)的大脑图标和四入口侧栏布局均已合入。生产 Web 与独立 macOS 包在合成 PDF 上完成问答、点击来源、重开后来源恢复；固定模型回答不证明真实论文质量。
- Phase 1 已启动。[PR #17](https://github.com/gkwfhv/readest-scholar/pull/17)让 `main` 自动发布 GHCR 双架构镜像与逐平台 CycloneDX SBOM；[PR #18](https://github.com/gkwfhv/readest-scholar/pull/18)加入固定摘要的 staging Web 升级和失败回退脚本。两者最终提交的 Scholar baseline、上游 PR checks、CodeQL 均通过并合入。
- Linux staging 已切换到 Scholar `fe25bd8cf5b4b55bbfe20c9f85b09f77c516f097` 的 amd64 平台摘要 `sha256:141ac3b06f2df2240addeb94006a24c3e81631a2bc257c8d7850058ea38a4151`。升级前完整备份、四路健康、合成账户签名 PDF 上传/下载哈希、Web/桌面 PDF 阅读、Web 故障注入回退及新快照的第二套空项目冷恢复均通过；其余五个 staging 容器 ID 未变。详情见 [Phase 1 执行证据](docs/evidence/phase1/staging-web-rollout-2026-10-20.md)。主机 GHCR DNS 不可用，镜像经校验归档导入并按平台摘要固定。
- `main` 受保护并要求 Scholar 检查。工作树 `origin` 指向上游 Readest；向用户 fork 推送须显式使用 `git@github.com:gkwfhv/readest-scholar.git`。测试栈端口仅绑回环并通过 SSH 隧道访问，尚无测试域名；个人 SSH 私钥不进入 CI。
- 独立桌面测试包已做上游更新渠道隔离：测试 Bundle ID 禁用 Tauri 更新，JS 更新检查和上游日志请求被阻断，未签名 macOS 包的关于窗口不再出现更新入口。定向测试 56/56、Node 24 静态导出与 Tauri 打包通过；详见 [Phase 1 更新隔离证据](docs/evidence/phase1/scholar-test-updater-isolation-2026-10-20.md)。这不等于正式签名更新分发验收。
- 升级后 Web→后端→独立 macOS 测试包的新进度已在同一合成账户通过：Web 将两页 PDF 从第 2 页改到第 1 页，服务端记录更新，桌面端打开时出现“阅读进度已同步”并显示第 1 页，旧本地第 2 页没有覆盖它。桌面实际截图还核对了四个侧栏入口同一行、脑图标在边界内；见 [Web→桌面复验证据](docs/evidence/phase1/web-to-desktop-progress-2026-10-20.md)。
- 用户已批准正式名称 `Readest Scholar` 与 Bundle ID `io.github.gkwfhv.readestscholar`。独立未签名 macOS 包完成静态导出、Tauri 打包、本地 PDF 阅读、窗口/菜单/源码链接检查，且不调用上游更新；见[正式身份本地验证](docs/evidence/phase1/scholar-release-identity-2026-10-21.md)。[PR #24](https://github.com/gkwfhv/readest-scholar/pull/24) 已在最终提交的全部必需 CI 与评审记录通过后合并。该包不代表签名发布或更新分发验收。[PR #25](https://github.com/gkwfhv/readest-scholar/pull/25) 将正式身份包的应用链接改为 `readest-scholar://` 并保留旧链接解析，最终 CI 全绿后已合并；[独立书籍协议本地实测](docs/evidence/phase1/scholar-deeplink-identity-2026-10-21.md)中，系统唤起样例 PDF 成功。真实 OAuth/分享回调仍未验收。
- [Staging Web 合成 AI 交互](docs/evidence/phase1/staging-ai-smoke-2026-10-21.md)通过：Mac 浏览器经 SSH 隧道访问 Linux staging，连接 Mac 本地确定性模型夹具，完成样例 PDF 索引、问答、来源列表和重开后的会话恢复；移动侧栏四入口在同一行且脑图标位于边界内。来源点击跳转未在这次浏览器自动化中复验；真实模型质量和 Linux 主机模型运行不在此结论内。
- [PR #28](https://github.com/gkwfhv/readest-scholar/pull/28) 已把自托管分享、批注及设备链接约束到 Scholar 自身来源；Auth 白名单含两种应用 scheme。[PR #29](https://github.com/gkwfhv/readest-scholar/pull/29) 修复分享/批注落地页普通 Readest 文案并保留中文翻译，合并为 `460a97d84`。[PR #30](https://github.com/gkwfhv/readest-scholar/pull/30) 修复分享标题后缀与 OG 渲染错误，合并为 `3579888b7`；实际浏览器的手机和桌面布局、Scholar 页脚、独立应用协议、完整品牌标题及有效 PNG 均通过。[PR #31](https://github.com/gkwfhv/readest-scholar/pull/31) 修复容器无法从公开回环 S3 URL 读取 OG 封面，最终 CI 全绿后合并为 `41d980f25` 并按 amd64 平台摘要升级 staging；新 PNG 91,846 字节且实际显示合成 PDF 封面。两次升级都只替换 Web，四路健康与升级前完整备份通过，合成分享均撤销且返回 410。内部取图修复的 Node 24 全量为 13,808 通过、16 跳过，Web 与桌面静态构建通过；详情见 [实际分享往返](docs/evidence/phase1/scholar-selfhosted-links-2026-10-21.md)。根布局 `/library` 标题仍显示普通 Readest，构建时品牌标记待补齐。

## 下一动作

1. 测试环境秘密文件防误提交、独立桌面测试包更新隔离、双向阅读位置同步及 staging Web 合成 AI 交互已留证。继续验收正式环境的秘密与构建产物管理、真实模型服务、正式签名桌面更新分发。
2. 修复 Scholar Web 镜像根布局的构建时品牌元数据并复验 `/library`。外部 HTTPS 分享、真实 OAuth 提供方回跳及独立收件人导入仍需域名和相应测试配置；本地身份包尚未作为可发布产物。
3. Phase 1 签收后再按 [ROADMAP](ROADMAP.md)实施 Phase 2 文献管理。生产真实数据、外部 TLS、签名与正式发布仍需单独审批和验收。
