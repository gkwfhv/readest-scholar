# Phase 3：双桌面客户端同键批注冲突与远端落盘

日期：2026-10-23。全部开发、构建和验证在 Linux 测试服务器进行；QA-B 与 QA-C 是独立的 CEF 容器，使用合成账户与 Paper 141 PDF。候选 Web 和 Auth 仅经各自容器的回环代理访问。正式 staging Web 镜像未更换，没有推送 GitHub/GHCR。

## 远端批注持久化缺陷

旧客户端在线拉到远端批注后，阅读器可见，但每本书的 `config.json` 没有该批注。QA-C 在此状态下被 SIGKILL、断开自己的候选代理并离线重启，批注侧栏显示 “No Annotations”。这是实际数据丢失风险。

新增先失败后通过的 `useNotesSync-remote-durability.test.tsx`：收到新远端批注时立刻保存书籍配置，不提高本地阅读进度的 `updatedAt`。修复后用正确的测试环境重新在服务器容器构建静态 Web 和 Linux CEF debug 包；二者退出码均为 0，CEF 二进制 SHA-256 为 `955861a71ebbfc527ab1a3a4a30c2b4338e8cb15bd843789b2d946a1aa981c31`。修复版 QA-C 在线看到批注时，磁盘配置已包含同一 ID；SIGKILL、断网、重启后仍显示该批注。随后 QA-B 在修复版上再次拉取恢复版本，磁盘配置同步更新；断网、SIGKILL、重启后，阅读器仍显示恢复备注。

服务器标准环境完整 Vitest：1,222 个文件通过、14,036 项通过、16 项跳过、0 失败；TypeScript 与 Biome 通过。日志位于服务器构建目录 `/home/gavin/.cache/scholar-native-target/scholar-phase3-notes-durability-*.log`。

## 两个真实界面客户端冲突

QA-C 关闭自己的候选 Web 代理，在 PDF 阅读器将同一条黄色高亮批注 `ypsa71g` 的备注改为 `CB offline editB note before conflict`；本地配置改变，服务端仍为旧版。QA-B 用独立的图形登录会话在线将同一批注改为 `BB offline editB note before conflict`，其本地配置与服务端均为 BB 版。恢复 QA-C 代理后，C 的界面显示较新的 BB 版；数据库仍为 BB 版，C 的离线 CB 版以 `source=incoming` 进入 `book_note_conflict_versions`。两端没有共用刷新令牌。

QA-C 的 Account → Manage Sync → Recoverable note versions 显示 CB 版为 Older device version。点击 Restore this note 后，服务端当前备注为 CB 版，原 BB 版留在历史；QA-B 关闭再打开同一 PDF，笔记侧栏显示 CB 版。B 使用修复版进程重新打开 PDF 后，`config.json` 也变为 CB 版；断网、SIGKILL、离线重启再次打开，仍显示 CB 版。测试记录及其历史暂留合成账户，便于复验。

## 范围与下一步

这次覆盖同一 PDF 批注的双图形客户端离线/在线并发、较新版本收敛、落败版本恢复，以及远端批注在进程崩溃后的本地耐久性。它不等于 Phase 3 整体验收。不可变二进制版本的客户端持久离线快照、双设备故障与移动网络切换、按需缓存、完整镜像设置和最终候选仍待完成。

## 测试会话边界

QA-C 最初从 QA-B 合成数据目录克隆，连同旧刷新令牌一起复制。虽然 B 后续通过界面重新登录并取得独立会话，C 在恢复操作约九分钟后刷新时被 staging Auth 以 `refresh_token_already_used` 拒绝，菜单变为 Sign In。因此，C 恢复操作后的再次拉取不能作为已验证项；上述恢复后客户端收敛以 B 的独立会话、磁盘配置和离线重启为证据。今后的多端验收必须在每个 QA 容器分别登录，不复制认证存储。
