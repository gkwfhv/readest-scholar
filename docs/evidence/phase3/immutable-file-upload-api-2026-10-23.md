# Phase 3：不可变文件上传 API 基础

范围：Linux 测试服务器本地分支；未部署到 staging Web，未向 GitHub/GHCR 推送。

新增 `/api/scholar/files/prepare`：从已验证会话识别账户与额度，调用数据库的原子预留函数，给待上传的唯一对象键签发 5 分钟只创建 PUT URL。重复且已完成的操作不再签发写入 URL。`/api/scholar/files/complete` 按账户与操作查找版本，从对象存储流式读取实际字节和 SHA-256，匹配后才调用服务端比较并交换函数；旧版本在比较失败时仍保留。旧 `/api/storage/upload` 不再给 Scholar 命名空间签发覆盖 URL，旧删除和批量删除接口拒绝版本对象键。

服务器专用构建容器验证：先运行失败用例确认旧接口确实签出覆盖 URL；修复后新 API 与旧上传定向测试通过；`pnpm lint` 通过；`pnpm build-web` 通过，产物列出了两个新 API 路由。SQL 配额和版本事务测试已在隔离数据库通过。API 的真实 staging 上传、浏览器 CORS、客户端切换和两设备故障注入尚未运行，Phase 3 不据此验收。
