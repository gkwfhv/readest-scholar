# Phase 3 自验收：可靠同步与离线

日期：2026-10-23；服务器分支 `feat/scholar-offline-metadata`，候选源码至 `af3ae1ff2`。验收环境为 Linux 测试服务器、两个独立 CEF 桌面容器、合成 staging 账户与仅回环可访问的 Web/Auth/MinIO。Phase 3 计划完成判据：双设备并发编辑、断网/恢复/重复请求/服务崩溃后数据不丢失，具备自动化故障测试。

| 判据 | 结果 | 可复核证据 |
| --- | --- | --- |
| 元数据、笔记、批注增量同步与幂等 cursor | 通过 | [双设备元数据故障](two-device-metadata-fault-probe-2026-10-23.md)、[游标与乱序](replica-apply-cursor-2026-10-22.md)、[笔记恢复](book-note-recovery-2026-10-23.md) |
| 离线持久队列与重复提交 | 通过 | [持久 outbox](durable-replica-outbox-2026-10-22.md)、[上传快照](scholar-upload-snapshot-2026-10-23.md)、[文件操作 ID](file-version-queue-operation-2026-10-23.md) |
| 两台桌面同时编辑同一批注并恢复冲突版本 | 通过 | [双客户端批注与进程崩溃落盘](two-native-annotation-conflict-durability-2026-10-23.md) |
| 两台桌面不同 PDF 正文版本，离线后恢复、可见冲突 | 通过 | [双客户端文件冲突与认证](native-auth-and-two-client-file-conflict-2026-10-23.md)、[版本删除 CAS](scholar-file-delete-cas-2026-10-23.md) |
| 服务崩溃及重启不丢已确认数据，失败可重试 | 通过 | [数据库强制停止与幂等重放](staging-db-crash-note-replay-2026-10-23.md)、[客户端书签与候选 Web 重启](two-native-clients-bookmark-sync-2026-10-23.md) |
| 默认按需下载、按账户完整镜像、失败入队 | 通过（Linux 实机与自动化） | [文件缓存模式与设置页面](scholar-file-cache-mode-2026-10-23.md) |
| 最终候选构建、自动化测试、staging 升级回退 | 通过 | 本文下方构建记录、[集成候选第一次演练](integrated-candidate-staging-2026-10-23.md) |

## 最终候选与回归

服务器完整 Vitest 1,223 文件通过、4 跳过；14,038 项通过、16 跳过，0 失败。TypeScript、Biome、Web 与 Linux CEF 构建通过。修复版 CEF SHA-256：`e0958058b56861c71dbd1ec8f3b3ef8a184e7b0a402224f7f167b46d86240d9d`。

包含该修复的 Web 构建重新封装为本地 `scholar-phase3-web:final-candidate`，镜像 ID `sha256:8737592e0ddd1f77c0ff23b9bbda40d9166e56040c04ea10472e83db9544b05c`。独立回环 3148 的书库与 PDF worker 为 200，匿名文件状态为 403。预备备份完整后，仅重建 staging Web；四路健康检查和合成账户增量同步、文件状态端点全部通过，随后脚本恢复原 Web 镜像 `sha256:f5a0ddae78db6365b5dcce8138434292e548a75b8f71004dc138ad2b44c024cd`，其余五个容器 ID 不变，四路健康仍通过。最终 Web 构建日志位于服务器 `/home/gavin/.cache/scholar-native-target/scholar-phase3-auth-final-web-build.log`。

## 判定与限制

按计划的 Phase 3 完成判据，本阶段自验收通过，可开始 Phase 4。Linux CEF 多窗口重启后的会话稳定时间约 20 分钟，尚未覆盖一小时令牌自然到期；移动真机网络类型与后台执行、正在传输文件的即时取消、200+ 文件完整镜像长时运行留在 Phase 7 平台矩阵与长期稳定性回归。它们不作为已通过的证据。正式 staging 已回退到原镜像，没有签名发布或生产部署；未从本机上传代码。
