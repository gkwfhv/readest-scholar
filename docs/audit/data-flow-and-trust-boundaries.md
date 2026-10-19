# 数据流与信任边界

这是锁定 SHA 上已经存在的边界，加上 Scholar 以后允许新增的唯一计算边界。本机替代对象镜像的跨端验证见 `docs/evidence/phase0/`；未验证的边界仍不能当作运行时结论。

## 现有数据流

```text
浏览器 / Tauri WebView
  -> AppService（web 或 native）
  -> 本地 Turso 副本、文件缓存
  -> HTTPS：Supabase Auth/REST、Next.js /api、S3 预签名 URL

Next.js 路由
  -> Postgres（RLS：auth.uid() = user_id）
  -> S3/MinIO（服务端密钥）
  -> 可选的外部模型、翻译、元数据、支付

PDF/EPUB 字节
  -> foliate-js / pdfjs（不可信输入）
  -> 批注与 AI 切块只作为数据，不作为指令
```

书籍正文、笔记和阅读位置有两条同步通道：Readest Cloud 的 replica/存储 API，以及用户自选的 WebDAV/S3/网盘文件同步。凭据类别默认关闭。

`/runtime-config.js` 把 Supabase URL、anon key、API 基址和配额发给浏览器。anon key 是公开角色密钥，服务端密钥、S3 secret、模型 key 不能进入这个对象。

## 信任边界

| 边界 | 可信内容 | 不可信内容 |
|---|---|---|
| 浏览器与 WebView | 用户操作、本地口令派生后的副本 | 书籍 HTML、PDF JavaScript、OPDS HTML |
| Tauri `allow_paths_in_scopes` | 对话框或持久授权已经给过的路径 | 前端自行拼接的任意本机路径。架构文档第 7 节写明这条门禁 |
| Next.js API | 已验证的用户 JWT、对象所有权 | 上传文件名、外部 URL、模型返回文本 |
| Postgres RLS | `auth.uid()` 与行上的 `user_id` | 客户端传来的 user id |
| 对象存储 | 服务端签发的预签名范围 | 猜中的 `file_key`。必须继续按用户隔离 |
| 外部模型 | 用户显式配置并同意送出的片段 | 文献正文里的“系统指令” |
| pdf2zh Worker（计划中） | 任务行、只读原文对象 | PDF 本体、压缩炸弹、外链、字体 |

## Scholar 追加时必须保持的约束

- 原文 PDF 只读。译文、OCR、导出文件是带 `source_file_id` 的新对象。
- 翻译进程不能拿到数据库口令、JWT secret 或其他用户的对象。
- 元数据抓取默认关闭，不能为了补 DOI 把整篇 PDF 发到外部服务。
- 检索到的文献文本只进入引用上下文，不进入工具调用白名单之外的动作。
- 新增表沿用 `user_id` 和 RLS。不把服务角色密钥交给浏览器。
- Compose 的数据库、MinIO 控制台和 Worker 不映射到公网。官方文档默认端口是宿主机可达的，落地时改为只绑定回环地址，或放在已审核的反代后面。

## 尚未验证

跨用户访问、预签名 URL 过期、replica 冲突合并、恶意 PDF，都还没有在本机复现。这些是后续测试，不是当前结论。
