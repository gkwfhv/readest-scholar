# Phase 3：Scholar 上传队列正文快照验收

**结论：本子项通过；Phase 3 整体尚未验收。** 全部源码、构建、测试、真实客户端和合成数据操作都在 Linux 测试服务器。候选 API、认证和 MinIO 仅经隔离 QA 容器的回环代理访问；正式 staging Web、GitHub 与 GHCR 未更新。

## 实现边界

- Scholar 书籍上传入队时记录账户、预期活动版本和稳定操作 ID，立即把正文复制到私有 Cache 的账户/操作 ID 路径。无快照时不启动网络传输；队列暂停也会完成复制。复制时检查源文件前后大小与可用的 mtime，并核对目标长度。Web IndexedDB `copyFile` 等待写事务提交后才返回。
- 上传与重试只读快照。客户端重启后复用原路径和操作 ID；已登记但丢失的快照会明确失败，要求重新入队。旧版无快照任务也不能复用旧操作 ID。错误冲突保留快照供处理；任务成功、手工清除、策略取消或账户不匹配时删除快照。传输面板不提供无法使用快照的“重试”操作。
- 普通 Readest 构建保留原上传路径；上述约束只在 Scholar 测试/正式构建启用。设计见 [ADR 0006](../../adr/0006-scholar-upload-snapshot.md)。

## 自动化验证

在服务器 `scholar-native-builder` 容器内：

- `pnpm lint`（TypeScript 与 Biome）：退出码 0，检查 2,880 个文件。
- `NODE_ENV=test`、清除 `SELF_HOSTED` 后以 2 worker 运行 Vitest：**1,213 个文件通过，4 个跳过；13,989 项测试通过，16 项跳过；退出码 0**。日志 `/home/gavin/.cache/scholar-native-target/scholar-snapshot-final-full-test.log`。
- 5 个相关文件的 46 项定向测试通过：Web 复制事务、源文件变更与短复制拒绝、队列暂停/重启/丢失快照/清理、正文从 Cache 读取及传输面板。
- 服务器 `pnpm build` 与未签名 Linux CEF `pnpm tauri build --debug --no-sign --no-bundle --config src-tauri/scholar.release.json` 均退出码 0。CEF 测试二进制 SHA-256 为 `0aeb5c0369eb2dd106ccdb2d11ba6e36d00180d118f4d12d3eafefbdc5e450f8`。Tauri 自动生成的 Turso 插件权限文件已恢复。

## 真实客户端故障验收

1. 隔离 Linux CEF 客户端使用合成账户登录；在传输面板暂停队列，经论文菜单将 **Scholar Scale Paper 138** 加入队列。Cache 快照 89,808 字节，SHA-256 `c1d289758e403c3d5a49692cac21860e8c767292fe7357043f0a5b90577081cd`。随后暂时把其原路径替换成另一篇合成 PDF，源文件 SHA-256 变为 `9cd4714a482760df4dde5839194d274247473ef92265eb45a9d024ea26df3ece`。恢复队列后界面显示 Uploaded；数据库的 ready 版本与 MinIO 中实际对象的 SHA-256 均为原快照的 `c1d289…7081cd`，操作 ID 与快照路径末段相同。源文件已从备份还原，Cache 快照已删除。
2. 再次暂停队列并加入 **Scholar Scale Paper 137**。快照 SHA-256 为 `9cd4714a482760df4dde5839194d274247473ef92265eb45a9d024ea26df3ece`，操作 ID 为 `7cbe0bc7-8c88-4980-9fe3-ed02918aec13`。重启 CEF 应用后传输面板仍显示该任务 Pending 且队列暂停；恢复后显示 Uploaded。数据库为同一操作 ID 记录一个 ready 版本，89,808 字节、SHA-256 `9cd471…f3ece`；Cache 快照已删除。

## 未覆盖范围

本次只验证合成 PDF 的稳定正文与重启恢复。大文件 multipart/断点续传、账户切换后的界面恢复、二进制冲突处理、按需缓存与完整镜像策略、两个真实设备并发及服务崩溃注入仍是 Phase 3 门槛。旧的失败历史行保留在 QA 客户端，未作为本项通过证据。
