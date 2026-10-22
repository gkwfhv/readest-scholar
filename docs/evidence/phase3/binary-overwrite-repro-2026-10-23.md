# Phase 3：同一文件键二进制覆盖复现

日期：2026-10-23。服务器本地回环候选 Web 和合成 staging 账户；未向 GitHub/GHCR 上传，也未使用生产文件。

## 复现

使用唯一的合成 `.bin` 键，通过现有 `/api/storage/upload` 请求两次相同长度的签名 PUT。两次请求都返回同一个逻辑对象键；先写入 `original-v1`，再写入等长的 `new-binary2`，最后经 `/api/storage/download` 签名 GET 读回第二份字节。初始内容无法通过该键恢复。测试对象和 `files` 行随后通过删除 API 清理。

代码原因：`apps/readest-app/src/pages/api/storage/upload.ts` 在 `files.file_key` 已存在时仍对原 `fileKey` 签发 PUT URL，且只沿用旧 `file_size`；`apps/readest-app/src/libs/storage.ts` 随后直接 PUT。相同大小的另一份内容不会被当前 API 识别。这个合成测试证明了**同键覆盖路径**，不能推断已有真实文件曾被覆盖。

## 修复方向

按工程计划第 5 节的不可变文件版本要求：每次新内容写到独立对象键，完成上传并校验 SHA-256 后，才以当前版本比较交换更新文献文件的活动指针；落败版本仍可读、可恢复。上传准备/完成应幂等，断网或崩溃后可重试；旧客户端逻辑键须有明确兼容窗口。实施前先写并发、重复请求、失败恢复和跨账户拒绝测试。仅按文件大小拒绝覆盖无法解决等长内容冲突。

此项尚未修复或验收，Phase 3 不能通过。
