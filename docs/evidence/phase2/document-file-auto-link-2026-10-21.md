# Phase 2：云端原文文件自动关联（2026-10-21）

现有上传接口先插入 `files` 行，随后传输对象；书籍元数据由独立同步接口写入 `books`。两条路径可能以任意顺序完成。031 迁移只对同账户、未删除、非副本、路径位于 `Readest/Books/<book_hash>/` 顶层且扩展名符合书籍格式的文件补建 `scholar_document_files` 的 `original` 关系。原有书籍哈希、文件 UUID、阅读与同步协议均不改变。

## 隔离数据库验证

- 在 029/030 之后、031 之前插入“先书后文件”与“先文件后书”的合成缺口。031 断言先按预期失败：`migration must backfill both file/book orders, not covers`。
- 应用 031 后，同一断言通过。`service_role` 的新文件后书和新书后文件均归入对应文献；`authenticated` 的软删除书恢复与较晚补齐书籍格式均最终关联；封面、格式不符、副本及错误路径不关联。
- 已显式标为 `version` 的文件关系未被回填改写；另一合成账户持有相同书哈希的文件无法借用本账户文献。函数保持调用者权限，复合外键和 RLS 继续生效。
- `bash docker/volumes/db/tests/run-scholar-document-identity.sh` 对临时无端口、无持久卷的 Supabase PostgreSQL 一次执行 029—031 迁移与断言。GitHub CI 与 staging 结果在对应运行完成后另行记录。

## 边界

文件关系表示数据库中的云端文件记录，并不证明签名 URL 上传的对象字节已抵达或通过 SHA-256 校验。第三方同步文件、未上传本地书、译文与补充材料仍须后续显式关联。还需实际 Web/桌面新书与文件往返、200+ 文献规模和集合管理验收，Phase 2 未完成。
