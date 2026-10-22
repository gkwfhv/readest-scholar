# Agent 状态

更新时间：2026-10-23。

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
- [PR #28](https://github.com/gkwfhv/readest-scholar/pull/28) 已把自托管分享、批注及设备链接约束到 Scholar 自身来源；Auth 白名单含两种应用 scheme。[PR #29](https://github.com/gkwfhv/readest-scholar/pull/29) 修复分享/批注落地页普通 Readest 文案并保留中文翻译，合并为 `460a97d84`。[PR #30](https://github.com/gkwfhv/readest-scholar/pull/30) 修复分享标题后缀与 OG 渲染错误，合并为 `3579888b7`；实际浏览器的手机和桌面布局、Scholar 页脚、独立应用协议、完整品牌标题及有效 PNG 均通过。[PR #31](https://github.com/gkwfhv/readest-scholar/pull/31) 修复容器无法从公开回环 S3 URL 读取 OG 封面，合并为 `41d980f25`；新 PNG 91,846 字节且实际显示合成 PDF 封面。[PR #32](https://github.com/gkwfhv/readest-scholar/pull/32) 修复 GHCR 镜像的构建时品牌标记、根社交元数据和 Web 安装清单，合并为 `671cde6f2`，按 amd64 固定摘要部署到 staging。`/library` 标题、描述、清单和分享页已在运行镜像上实测；仅 Web 容器替换，四路健康与升级前备份通过，合成分享撤销且返回 410。Node 24 全量为 13,810 通过、16 跳过，Web 与桌面静态构建通过；详情见 [实际分享往返](docs/evidence/phase1/scholar-selfhosted-links-2026-10-21.md)和[根品牌元数据验收](docs/evidence/phase1/scholar-web-build-brand-2026-10-21.md)。
- 正式身份 macOS 测试包连接 staging 后，采用较新的服务端 PDF 第 1/2 页进度，再从桌面跳至第 2/2 页并写回同一合成账户。辅助功能树、两张客户端截图和服务端只读记录均已核对；见[正式身份包双向进度验收](docs/evidence/phase1/formal-desktop-staging-sync-2026-10-21.md)。
- [PR #34](https://github.com/gkwfhv/readest-scholar/pull/34) 修复 Scholar 登录、同步和账户残留的 Readest 付费/下载入口，最终 CI 与评审通过并合并为 `dbbf7befb`。新 GHCR 双架构镜像、SBOM 发布成功；amd64 固定摘要已升级到 Linux staging，四路健康和备份通过，其他五个容器不变。SSH 隧道浏览器复核登录页、账户页、书库菜单、阅读器四按钮同排和大脑图标；见[部署与界面验收](docs/evidence/phase1/scholar-account-brand-staging-2026-10-21.md)。
- [独立 macOS 签名更新往返](docs/evidence/phase1/scholar-updater-loopback-smoke-2026-10-21.md)已用一次性密钥及回环清单实测：`0.12.16` 测试包检测、下载、验签并安装 `0.12.17`，进程重启且磁盘包版本改变。首次因测试公钥重复 Base64 编码失败，修正后成功；正式 Scholar 包仍禁用上游更新，真实签名/公证和公开 HTTPS 分发尚未验收。
- [Phase 1 限定范围验收](docs/evidence/phase1/acceptance-2026-10-21.md)以 `49eb1e55d` 为审查基线：计划第 9 节的非生产工程底座通过，允许启动 Phase 2。2026-10-21 测试主机官方探针四路均 `OK`，运行已验收的 PR #34 Web 摘要；PR #36 最终提交的 Scholar baseline、PR checks、CodeQL 均为 `success`。公开 HTTPS、真实模型、正式签名分发与生产秘密策略属于后续功能或发布门槛，不在本次通过范围。
- Phase 2 首项[手动 DOI 元数据](docs/evidence/phase2/doi-metadata-2026-10-21.md)已实现并完成本地 Node 24 单测、Scholar Web 构建与手机宽度的浅色/深色/墨水屏检查。DOI 沿用 `books.metadata` 保存；文献/文件 ID 分离、集合、跨 Web/桌面 DOI 同步与账户隔离尚未验收。
- 此后 Phase 2 的文献/文件 ID 分离、空集合持久化与 DOI 重复提示分别在 PR #47、#48、#49 合并。201 份合成 PDF 已通过隔离 staging 签名上传和 REST 写入；Web 与独立 macOS 测试包最终均能管理分组、读取 DOI/标签、下载并打开目标 PDF；第二账户的五张相关表均为 0 行，三次越权签名下载和一次越权写入被拒绝。完整界面及哈希证据见[规模核验](docs/evidence/phase2/scale-cross-device-2026-10-22.md)。这不是 201 文件的 UI 批量导入验收；三栏书库、加载性能、双向编辑与同步错误仍待处理，Phase 2 整体未通过。

- [三栏科研书库](docs/evidence/phase2/three-pane-library-2026-10-22.md)已完成宽屏浅色/深色/E-Ink 与手机回退检查；[201 路径批量下载修复](docs/evidence/phase2/cover-download-batching-2026-10-22.md)在服务器专用容器构建并以独立 Web 候选版验证：201/201 签名、3/3 SHA-256 往返、第二账户 0 链接。当前候选仅在服务器临时端口，未替换 staging；UI 200+ 批量导入、跨端双向编辑与加载性能仍待验收，Phase 2 整体未通过。

- [201 份 PDF 的真实浏览器导入与上传](docs/evidence/phase2/ui-bulk-import-2026-10-22.md)已在服务器独立 Web 候选版完成：201 本书/201 文献记录、传输队列 201 成功 0 失败、201/201 候选签名下载、3/3 SHA-256、第二账号三表 0 行。修复了 Scholar Web API 同源路径及同步上推 100 条 OR 查询导致的 URI 超长；40 项目标测试及 61 项同步 API 测试、TS、Biome 和服务器 Web 构建通过。203 本本地书库可见耗时三次 744/490/505 ms。候选仍与已验收 staging 分离；新版桌面三栏和 200+ 规模跨端双向编辑仍待验收，Phase 2 整体未通过。

- [服务器候选镜像升级/回退](docs/evidence/phase2/staging-image-upgrade-rollback-2026-10-22.md)已通过：本地固定镜像 `sha256:d37f14118facc629fabfcf93bd425cd9205b5e38f217d4615ae94c841c9a335a` 不经外部仓库打包；端口 3134 验证 201/201 签名、3/3 哈希、第二账号 0 链接；staging 备份后只替换 Web，四路健康与同样的文件核验通过，再回退至原镜像并确认四路健康。201 本 Web 账户还创建了含 Paper 101 的分组，三栏显示 DOI/标签且服务端行一致；见[浏览器导入证据](docs/evidence/phase2/ui-bulk-import-2026-10-22.md)。未推送 GitHub 或 GHCR。

- [201 本 Web ↔ 独立 macOS 测试包的集合与元数据双向往返](docs/evidence/phase2/cross-device-201-collections-2026-10-22.md)已实测：新本地身份登录后显示 201 本，Web 建分组与两标签到达桌面；桌面将 Paper 101 移入新分组、追加第三标签，服务端与 Web 均采用新值，旧客户端未抹除 DOI。第二合成账号仍为 0 签名链接。该桌面包早于三栏新布局，不能作为新版桌面视觉验收；Phase 2 仍未通过。

- [Phase 3 副本游标修复](docs/evidence/phase3/replica-apply-cursor-2026-10-22.md)在服务器以先红后绿的回归测试完成：本地应用失败时不再提前提交单类或批量增量游标，online 重试后才确认；目标 87/87、全量 13,849 通过，TypeScript/Biome 通过。Linux CEF 测试容器已在用户授权下接受本地网络许可并登录 staging，服务端集合可见；本地 201 PDF 跨端上传尚未证明。

- Phase 3 第二项[持久副本待发送队列](docs/evidence/phase3/durable-replica-outbox-2026-10-22.md)正在服务器本地分支 `feat/scholar-durable-replica-queue` 验证：非书架行在内存入队前写本地日志，失败保留，重启恢复；账户隔离、跨窗口旧确认、退避重试和凭据关闭后的发送过滤已覆盖。现有行 HLC 与清单/复活冲突顺序及增量游标耦合，超过 30 秒的行暂不发送，等待[ADR 0004](docs/adr/0004-replica-change-cursor.md)中的版本化协议。目标测试 120/120、TypeScript/Biome 和全量回归 13,868/13,868 已通过，Web 候选产物检查通过（构建期间 SSH 断线，原命令退出码未取得）；未推送 GitHub/GHCR，Phase 3 仍未通过。

- Phase 3 第三项[游标加载/保存竞态](docs/evidence/phase3/cursor-hydration-2026-10-22.md)在服务器分支 `fix/scholar-cursor-hydration` 以两条失败回归锁定并修复：迟到的初始设置不会倒退新游标，保存会合并另一窗口先写入的其他类型游标。相关 78/78、TypeScript/Biome 和格式检查通过；旧存储仍未按账户隔离且并发读改写未事务化，交给 ADR 0004 的新版游标协议。未推送 GitHub/GHCR。


- Phase 3 新增[服务端副本变更序号数据库基础](docs/evidence/phase3/replica-change-seq-schema-2026-10-22.md)与[分页 API](docs/evidence/phase3/replica-changes-api-2026-10-22.md)，仅在服务器本地提交。隔离 PostgreSQL 验证同 HLC 的 1,000/1,001 边界、旧 HLC 更新、账户隔离、回滚、并发提交、大整数文本及重复迁移；API 单测、Lint 和 Web 构建通过，最终全量 Vitest 13,875 通过、16 跳过。现有 staging 尚未迁移，客户端仍用旧 HLC 游标，Phase 3 未验收。

- Phase 3 [客户端变更游标接入](docs/evidence/phase3/replica-change-client-2026-10-23.md)已在服务器本地完成：启动先设置、按账户分类型分页、落盘后确认、账户切换和旧端点全量回退。全量 13,891 项通过、16 项跳过；最终边界补丁目标 41/41、Lint 和 Web 构建通过。该提交验收时 staging 尚未迁移或部署，长离线提交和冲突恢复未验收；未推送 GitHub/GHCR。

- Phase 3 [staging 变更协议升级与回退](docs/evidence/phase3/staging-change-protocol-upgrade-2026-10-23.md)已在服务器完成：私有合成快照与迁移前状态恢复、032/033 真正升级、候选 Web 和旧 Web 回退、匿名/合成账户接口实测均通过。该项完成时数据库为 033（后续已升级 035）、Web 已恢复原镜像；候选本地镜像保留。无 GitHub/GHCR 推送。

- Phase 3 [长离线字段重放与冲突历史基础](docs/evidence/phase3/offline-field-conflict-protocol-2026-10-23.md)已在服务器本地验证：原始字段时钟不重写，旧二进制与生命周期操作仍受保护；本地落败字段在清队列前保存，034 历史表在隔离恢复库验证双方版本、重复提交无新游标、账户隔离、旧 RPC 兼容和事务回滚。全量 Vitest 13,904 通过、16 跳过，Lint、格式检查和 Web 构建通过。该项完成时 staging 为 DB033/旧 Web（后续已升至 DB035），冲突界面、双端故障验收及其余 Phase 3 内容未完成；未推送 GitHub/GHCR。

- Phase 3 [staging 冲突历史升级与回退](docs/evidence/phase3/staging-conflict-archive-rollout-2026-10-23.md)通过受控合成烟测：迁移前服务器私有备份、隔离库恢复与 034/035 验证、直接历史伪造被拒、候选 Web 登录态重复推送及分页拉取、只换镜像的短暂部署与原镜像恢复均完成。staging DB035，正式 Web 保持原镜像，四路健康；未推送 GitHub/GHCR。Phase 3 仍需双端断网/崩溃和冲突恢复界面。

- Phase 3 [单字段冲突恢复与并发保护](docs/evidence/phase3/field-recovery-ui-2026-10-23.md)在服务器本地完成：迁移 036、恢复 RPC、按账户中文恢复区、敏感值遮罩、展开时快照与提交时 CAS。目标 5/5、TypeScript/Biome、Web standalone 构建通过；实际浏览器验证正常恢复和展开后的并发编辑拒绝。staging DB036，正式 Web 仍为原镜像，候选仅回环运行；全量测试日志待收尾。无 GitHub/GHCR 推送；Phase 3 尚需双设备故障与注释、二进制和缓存。

- Phase 3 [双逻辑设备元数据故障探针](docs/evidence/phase3/two-device-metadata-fault-probe-2026-10-23.md)在服务器候选 Web 上通过：离线旧字段重放、在线新值胜出、模拟响应丢失后的重复请求、候选 Web 重启、增量游标收敛和历史分支留存；独立临时副本与历史清理为 0。该脚本只模拟协议设备，真实桌面/Web 断网及数据库进程崩溃仍待验收。无 GitHub/GHCR 推送。

- Phase 3 [桌面离线书签自动重试](docs/evidence/phase3/offline-bookmark-retry-2026-10-23.md)在服务器本地完成：先用失败回归复现断线后未重试，再加入 15 秒/online 重试与上传失败不推进笔记拉取游标；目标用例、TypeScript/Biome、Tauri 静态构建及 Linux CEF debug 构建通过。真实测试容器中，保持客户端运行、断开并恢复候选 Web 回环代理后，第 2 页书签从本地配置上传到服务端；重启后的第 1 页离线书签也已重放。另以先红后绿用例覆盖旧请求成功覆盖新请求失败的竞态，最终 Linux 包已重建并读回两页书签；最终完整 Vitest 13,912 通过、16 跳过（1,196 文件通过、4 跳过），完整 Lint 通过。无 GitHub/GHCR 推送。

- Phase 3 [笔记冲突历史与原子比较](docs/evidence/phase3/book-note-conflict-history-2026-10-23.md)已在服务器完成隔离数据库、PostgREST、并发事务及候选 Web 真实 API 验证：过期删除不能覆盖新编辑，删除同时间戳优先，双方版本按账户保留，相同插入重试无副作用。staging 升级 037/038 前有私有完整备份并在隔离库恢复；原 Web 镜像未更换，候选仅绑定回环，合成行已清理。TypeScript/Lint、目标测试及正确环境的完整 Vitest 均通过（13,916 通过、16 跳过）；无 GitHub/GHCR 推送。Phase 3 尚未验收。

- Phase 3 [笔记版本恢复与并发保护](docs/evidence/phase3/book-note-recovery-2026-10-23.md)已在服务器本地完成：039/040 迁移、账户限制与 CAS 行锁、中文恢复区、真实 REST HTTP 409、浏览器旧版恢复和服务端归档复核。原 Web 保持不变，新候选仅绑定回环；全量 Vitest 13,918 通过、16 跳过，加载竞态修复后的目标 5/5、TypeScript/Biome、服务器 Web 生产构建和 staging 四路健康通过。合成测试行均已清理；未推送 GitHub/GHCR。Phase 3 仍需双真实设备并发、二进制冲突、按需缓存和完整镜像。

- Phase 3 [同键二进制覆盖复现](docs/evidence/phase3/binary-overwrite-repro-2026-10-23.md)：服务器合成对象两次等长签名 PUT 后，下载只得到第二份字节；对象与数据库记录均已清理。需实施不可变对象版本和活动指针 CAS，不能仅比较文件大小。此项未通过。

- Phase 3 [不可变文件版本数据库基础](docs/evidence/phase3/immutable-file-version-schema-2026-10-23.md)已在服务器隔离恢复库验证：准备幂等、对象键唯一、完成后行锁 CAS、落败版本留存、恢复 CAS 和账户/角色隔离。迁移 041 仅在隔离库，现有 API 仍可覆盖同名对象；继续实现实际上传/校验/下载协议和客户端，不能据此签收二进制冲突。

- Phase 3 [不可变对象条件写入与流式校验](docs/evidence/phase3/create-only-object-upload-2026-10-23.md)完成服务器本地合成 MinIO 200/412 重复 PUT 和流式 SHA-256/大小实测；6 项单测、TypeScript/Biome 通过。旧签名行为未变；新 API、额度预留、客户端和故障注入未完成，Phase 3 仍不可验收。

## 下一动作

1. [Phase 2 非生产合成数据验收](docs/evidence/phase2/acceptance-2026-10-22.md)已通过计划判据，开始 Phase 3 的可靠同步与离线开发。新版 Linux CEF 客户端已在用户授权下接受本地网络许可，合成账户登录、集合拉取及菜单同步状态通过；201 本地文件的跨端读写与故障注入仍列入 Phase 3/7 门槛。Phase 3 的服务端变更序号、分页 API 和客户端落盘后确认已在服务器本地通过回归；staging 数据库升级与 Web 候选回退已实测；单字段冲突恢复已在候选界面和数据库验证。笔记冲突恢复界面已验收；下一步是双真实设备并发、二进制冲突、双设备故障注入、按需缓存。
2. 外部 HTTPS 分享、真实 OAuth 提供方回跳及独立收件人导入仍需域名和相应测试配置；真实模型质量留给 Phase 5，正式身份包的签名更新分发留给 Phase 8。测试包不是可发布产物。
3. 生产真实数据、外部 TLS、签名与正式发布仍需单独审批和验收。

## 最新进展（2026-10-23，Phase 3）

服务器本地提交 `cad33382d` 加入不可变文件额度原子预留，`7ed712cd2` 加入可信上传准备/完成 API，并封住旧上传与删除接口对版本对象的直接操作。服务器容器中定向单测、TypeScript/Biome、Web 构建通过；隔离库和合成 staging 的 SQL 探针通过。候选 Web 的两版本签名 PUT、重复写入拒绝、SHA-256 完成、CAS 落败保留、账户恢复和 CORS 预检均完成真实合成往返，测试对象与行已清理。详见 [staging 证据](docs/evidence/phase3/immutable-file-upload-staging-2026-10-23.md)。正式 staging Web 仍为旧镜像，客户端和双设备故障验收待继续；未向 GitHub/GHCR 推送。
