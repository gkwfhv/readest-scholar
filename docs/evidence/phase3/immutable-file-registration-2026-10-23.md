# Phase 3：Scholar 正文文件原子登记

迁移 044 的 `register_scholar_file_v1` 在现有账户预留锁下为已同步书籍登记文件 ID。首次登记创建零字节 `files` 行并由现有触发器连接到 Scholar 文献；重试返回相同文件 ID 与当前活动版本。格式、书籍归属、已删除文件和服务角色权限在数据库内检查。登记不签发可覆盖旧对象的上传 URL，随后只能走准备、条件 PUT、校验和 CAS 完成协议。

旧下载 API 在零字节登记行尚无活动版本时不签名不存在的旧对象；完成后同一旧 key 指向已验证的版本对象。隔离数据库测试先在函数缺失时失败，之后覆盖幂等、文献链接、格式拒绝、角色隔离并回滚；API 的 4 项测试、旧下载的 9 项相关测试、TypeScript/Biome、Next standalone 构建通过。

正式 staging 数据库应用迁移前保留仅服务器可读的 `phase3-register-pre044-20261022T211808Z.dump`。服务器回环候选 `scholar-phase3-web:register-local`（镜像 ID `sha256:5f9605291ded610fb3adefe2be50b6355d96229f8aa4199f41f75ab75616ea55`，端口 `127.0.0.1:3144`）的合成账户真实 HTTP 验证：登记文件大小 0、旧下载 404、不可变版本完成、重试身份稳定且返回活动头、旧下载取回准确字节、版本字节计入配额。合成对象和数据库行已清理。正式 staging Web 镜像未切换；未向 GitHub/GHCR 上传。

后续客户端已接入登记及入队版本基线，见[书籍版本传输证据](scholar-book-client-version-flow-2026-10-23.md)。持久正文快照与跨端故障验收仍未完成。
