# Phase 2 文献管理验收（2026-10-22）

**结论：计划第 9 节 Phase 2 的非生产合成数据范围通过，允许开始 Phase 3。** 代码基线为服务器本地分支 `feat/scholar-three-pane` 的 `049e8cbaf`，加上本次仅含证据的提交。尚未推送 GitHub、GHCR，也未部署为公开服务。

| 计划要求 | 直接证据 | 判定 |
| --- | --- | --- |
| 文献 ID 与文件 ID 分离；迁移和 API 契约 | `029`、`030`、`031` 三段数据库迁移及触发器在隔离 Supabase PostgreSQL 中由 `docker/volumes/db/tests/run-scholar-document-identity.sh` 于本次重新运行，退出码 0；[映射与账户隔离](document-file-identity-2026-10-21.md)、[自动书籍关联](document-auto-link-2026-10-21.md)、[文件自动关联](document-file-auto-link-2026-10-21.md)。服务器 `scholar-native-builder` 中以 `NODE_ENV=test` 运行 5 个直接相关测试文件，28/28 通过，覆盖三栏数据/交互、元数据同步合并和 API 合并。 | 通过 |
| 集合、标签、DOI 与重复提示 | [DOI 跨端记录](doi-staging-bidirectional-2026-10-21.md)、[重复提示](duplicate-suggestion-2026-10-22.md)、[201 本集合与标签往返](cross-device-201-collections-2026-10-22.md)；新 Linux 原生客户端在 201 本三栏书库中本地保存合成 DOI，详情与右栏均更新，见[原生客户端记录](linux-native-client-2026-10-22.md)。BibTeX/RIS 在计划中明确允许延后。 | 通过 |
| 三栏科研书库和界面适配 | [Web 宽屏浅色/暗色/E-Ink 与手机回退](three-pane-library-2026-10-22.md)；[Linux CEF 原生三栏](linux-native-three-pane-201.jpg)显示 `All (201)`、论文列表与详情，201 份合成 PDF 可打开。 | 通过 |
| 200+ 文献的实际导入管理 | [Web 文件选择器一次选入 201 份 PDF](ui-bulk-import-2026-10-22.md)，云端传输 201 成功、0 失败；候选 API 201/201 签名下载，3/3 抽样 SHA-256 匹配；Linux CEF 原生客户端在隔离容器内导入同一批 201 份本地 PDF，1 GiB `/dev/shm` 配置下无崩溃。 | 通过 |
| 文件夹和元数据跨 Web/桌面同步 | 独立 macOS 测试客户端从空书库登录后加载 201 本；Web 创建的分组/两标签到达桌面，桌面移动 Paper 101 到新分组并增加第三标签后，服务端及 Web 显示新值，DOI 保留。见[双向往返](cross-device-201-collections-2026-10-22.md)。 | 通过 |
| 无跨账户数据泄露 | 第二合成账户的 `books`、`files`、`scholar_documents` 及两张关联表均为 0；其签名下载 0 URL，针对第一账户对象的 3 次越权签名请求和一次越权写入被拒绝。见[规模隔离核验](scale-cross-device-2026-10-22.md)与[界面导入后复核](ui-bulk-import-2026-10-22.md)。 | 在上述表和对象范围通过 |

## 验收边界与后续工作

- 用户明确授权后，隔离 Linux CEF 客户端接受了 http://tauri.localhost 的 Local Network Access 许可，使用既有 staging 合成账户登录成功。客户端菜单显示 Logged in 与 Synced a few seconds ago，服务端已有的 Phase2 UI Review 集合出现，本地 201 本 PDF 保持可见；见[Linux 登录截图](linux-native-login-201.jpg)。这证明该测试容器的认证和集合拉取可达；**尚未证明新版 Linux 客户端对 201 个本地文件的上传及双向编辑**。Phase 3 若使用此客户端作为双设备组合仍需单独的读写往返与故障注入；Linux 正式发布前还需 Phase 7 平台矩阵复验。
- Docker 默认 64 MiB `/dev/shm` 下导入约 53 份时 CEF compositor 触发 `SIGTRAP`；1 GiB QA 容器完成 201 份导入。详见[原生运行记录](linux-native-client-2026-10-22.md)。这定义测试环境要求，不推导用户设备的内存上界。
- 本次 5 个测试文件第一次在构建容器继承 `NODE_ENV=production` 时有 4 个 React `act` 运行时错误；以测试环境 `NODE_ENV=test` 重跑 28/28 通过。失败来自测试运行配置，未被计入功能通过。
- Phase 3 的并发编辑、断网恢复、幂等重试、增量 cursor 与冲突 UI 尚未验收；Phase 4–8 仍未完成。本验收不授权生产部署、正式签名、公开发布或 GitHub 推送。
