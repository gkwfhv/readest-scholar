# Phase 3：不可变对象写入与流式校验基础

日期：2026-10-23。服务器本地代码和回环 MinIO 合成对象；未部署到 staging Web，未向 GitHub/GHCR 上传。

## 实现

`getUploadSignedUrl` 新增可选 create-only 模式，对 S3/R2 PUT 绑定 `If-None-Match: *`；默认调用保持原来的签名行为。新增 `getObjectDigest`，从 S3 SDK 或 R2 响应逐块计算 SHA-256 与字节数，不将整个文件读入内存。新协议完成上传时将使用它在数据库切换活动版本前验证实际对象。

[AWS S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)、[Cloudflare R2](https://developers.cloudflare.com/r2/api/s3/extensions/)及[MinIO](https://docs.min.io/aistor/developers/s3-api-compatibility/)均记录了条件 PUT 支持。新签名 URL 需要上传方发送 `If-None-Match: *`；旧上传方不受影响。

## 验证

- 先红后绿的 6 项测试覆盖 S3/R2 条件签名、旧签名兼容、S3/R2 分块摘要和缺失对象；TypeScript 与 Biome 通过。
- 服务器本地脚本 `scripts/test-scholar-create-only-object.ts` 对回环 MinIO 的唯一合成键使用同一个签名 URL 连续 PUT 两份等长内容：首次成功，第二次返回 HTTP 412；流式读回的 SHA-256 和长度匹配第一次内容。脚本在 finally 中删除测试对象。

## 未完成

新上传准备/完成 API、额度预留、浏览器 CORS、断线重试、客户端上传和下载切换及真实并发故障注入仍待完成。现有 `/api/storage/upload` 没有调用 create-only 模式，同键覆盖缺陷仍在；这项基础不能签收 Phase 3。
