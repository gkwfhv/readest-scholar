# Phase 3：文件版本基线状态查询

新 `GET /api/scholar/files/status?fileKey=...` 只接收当前账户 `Readest/Books/` 正文文件键，按认证账户查询 `files`、Scholar 文献文件映射和活动版本头；返回 `fileId` 与 `activeVersionId`（未版本化时为 `null`）。其他账户的键直接返回 404，未映射文件也返回 404。该接口为后续客户端在编辑/排队时记录 CAS 基线提供只读信息；它本身不会改变旧上传流程。

测试先在路由缺失时失败；新增后 4/4 通过，TypeScript/Biome 通过，服务器 Next standalone 构建通过。本地候选镜像 `scholar-phase3-web:status-local`，ID `sha256:26ad1dcd9b4b22fded7810b4014ea1b5ee9e1ff901594a0e208fb39a0438c024`，只绑定 `127.0.0.1:3143`。合成账户真实 HTTP 往返证实同一文件从空基线转到已验证活动版本；旧下载、配额与 409/403 同时通过。测试对象和数据库行已清理，staging 四路健康。正式 staging Web 未更换，未推送 GitHub/GHCR。

客户端尚未在编辑时持久保存此基线。若离线旧编辑在发送时才读取远端最新版本，会造成错误覆盖；下一步必须在排队/下载时记录本地已知版本，重试原 opId，并在 CAS 落败时保留本地内容和冲突状态。
