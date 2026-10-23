# Phase 3：桌面认证刷新隔离与双设备文件冲突（2026-10-23）

范围：Linux 测试服务器 `/home/gavin/readest-scholar-dev`；独立 CEF 容器 QA-B、QA-C；合成 staging 账户；回环候选 Web/Auth/MinIO。没有从本机开发或向 GitHub/GHCR 推送。

## 认证刷新故障与修复

QA-B 独立登录后，服务端曾连续记录刷新成功，随后以 `refresh_token_already_used` 拒绝刷新，桌面菜单退回 Sign In。代码检查发现每个阅读窗口装载 `AuthProvider` 时都会强制 `refreshSession()`，查询用的 `createSupabaseClient(token)` 也共享持久会话及自动刷新。这让多个客户端实例争用同一轮换令牌。

新增先失败后通过的回归：查询客户端不能加载交互会话；Provider 装载不能强制轮换。现在查询客户端只使用显式 Bearer token，关闭会话持久化和自动刷新；Provider 由 Supabase SDK 的 `INITIAL_SESSION` 和受 SDK 锁保护的正常刷新管理。两台修复版 CEF 各自登录，B 打开 Paper 141 与 145 两个阅读窗口并重启进程后仍显示 Logged in；C 重启后也保持 Logged in。05:26–05:44 UTC 期间 Auth 日志没有新增 `refresh_token_already_used`；这覆盖窗口装载及进程重启，尚未等待一小时令牌自然到期。

服务器标准测试环境完整 Vitest：1,223 文件通过、4 跳过，14,038 项通过、16 跳过、0 失败；TypeScript 和 Biome 通过。带私有构建环境的 Web 与 Linux CEF 构建通过，CEF 二进制 SHA-256 为 `e0958058b56861c71dbd1ec8f3b3ef8a184e7b0a402224f7f167b46d86240d9d`。日志在服务器 `/home/gavin/.cache/scholar-native-target/scholar-phase3-auth-refresh-*.log`。

## 双桌面文件冲突

B、C 的 Paper 145 初始 PDF 同为 89,808 字节。分别附加不同的合成 PDF 注释后，两份大小同为 89,854 字节，但 SHA-256 分别为 B `acff1b1ab70f88e8d5db7d32d872ed2627d9aed68fbdb6173a911f74c9ac6aa9` 与 C `e0eb6d68323990c7189f5d64374294eb1b67a30e354a24106196391521b06e4e`。C 断开自己的候选代理，在桌面界面将文件加入上传队列，任务因离线失败并持久保存。B 在线上传 B 版并形成活动版本。C 恢复网络后在界面重试，任务提示 “Scholar file conflict; local version retained”；Resolve 对话框正确显示两端大小、时间与不同摘要。选择 “Use this upload” 后任务完成，数据库保留 B/C 两个已验证版本，C 版为活动版本，B 版可恢复；两端本地 PDF 不被悄然覆盖。

首次 B 上传失败源于隔离 QA 容器缺少 `127.0.0.1:9130` MinIO 回环代理，导致签名上传 URL 无法连接，服务端保留 pending 预留而未发布未验证字节。仅修复测试代理后从桌面 Transfer Queue 重试，原操作 ID 成功完成；C 随后触发真实版本冲突。这是 QA 连通性配置错误，不是客户端版本冲突协议错误。测试代理只绑定容器回环，没有新增公网端口。

## 验收边界

此证据覆盖两个独立桌面客户端的不同二进制版本、离线入队、网络恢复、冲突显式解决、版本保留、进程重启和多阅读窗口认证。Phase 3 还需最终集成候选重建、完整镜像与按需缓存策略核对，以及一小时自然令牌刷新；此前不签收 Phase 3。
