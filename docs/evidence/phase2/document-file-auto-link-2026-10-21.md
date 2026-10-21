# Phase 2：云端原文文件自动关联（2026-10-21）

现有上传接口先插入 `files` 行，随后传输对象；书籍元数据由独立同步接口写入 `books`。两条路径可能以任意顺序完成。031 迁移只对同账户、未删除、非副本、路径位于 `Readest/Books/<book_hash>/` 顶层且扩展名符合书籍格式的文件补建 `scholar_document_files` 的 `original` 关系。原有书籍哈希、文件 UUID、阅读与同步协议均不改变。

## 隔离数据库验证

- 在 029/030 之后、031 之前插入“先书后文件”与“先文件后书”的合成缺口。031 断言先按预期失败：`migration must backfill both file/book orders, not covers`。
- 应用 031 后，同一断言通过。`service_role` 的新文件后书和新书后文件均归入对应文献；`authenticated` 的软删除书恢复与较晚补齐书籍格式均最终关联；封面、格式不符、副本及错误路径不关联。
- 已显式标为 `version` 的文件关系未被回填改写；另一合成账户持有相同书哈希的文件无法借用本账户文献。函数保持调用者权限，复合外键和 RLS 继续生效。
- `bash docker/volumes/db/tests/run-scholar-document-identity.sh` 对临时无端口、无持久卷的 Supabase PostgreSQL 一次执行 029—031 迁移与断言。[PR #46](https://github.com/gkwfhv/readest-scholar/pull/46) 的 [Scholar baseline](https://github.com/gkwfhv/readest-scholar/actions/runs/39621492834)、[PR checks](https://github.com/gkwfhv/readest-scholar/actions/runs/39621493292) 和 [CodeQL](https://github.com/gkwfhv/readest-scholar/actions/runs/39621492761) 在评审提交 `4c9f7700f19a1f2d7fdb4f98566d30c74cdd2a92` 上均报告成功；合并提交为 `58b92217d645e2e0ad770e23c39b7c7cd6a10321`。

## 合成 staging 验证

- 在已授权的 Linux 回环 staging 栈升级前创建 `~/scholar-staging-backups/20261021T150253Z`，确认 `STATUS=complete`、迁移账本停在 030、四路健康均为 `OK`。该备份尚未在独立项目冷恢复。传入主机的 031 SQL 与评审源码相同，SHA-256 为 `334154441e3fbd1acdd4cb313739698e731af0d62a0280e2c0a6aa7191ed9fac`。应用 SQL 并记入迁移账本后，运行正式迁移器再次确认 031 会跳过；源码经校验的 Git bundle 快进到上述合并提交，工作区干净。
- 以现有合成账户在真实表结构上进行事务内探针：`service_role` 分别执行先文件后书、先书后文件，两个原文文件各关联到对应文献，封面没有被关联；`authenticated` 能看到本账户的两条书籍与文件映射。事务最后 `ROLLBACK`，原有书籍/文献/书籍关系/文件关系计数维持 `6/6/6/3`。第一次临时探针脚本漏填真实 `files.file_size` 必填字段，数据库按预期拒绝；补齐后通过。隔离数据库固定 fixture 同时覆盖跨账户、恢复和错误路径边界。
- 再用同一合成账户走运行中的 Web `POST /api/storage/upload` 签名 URL，上传仓库两页 PDF 到 Silo；由认证角色经 PostgREST 写入新 `books` 行。文献与原文文件关系分别变为一条，认证角色可读取；从 Web 下载接口取得签名 URL，再从 Silo 下载对象，SHA-256 与仓库 PDF 相等。此探针保留为一条合成书籍，验证后计数为 `7/7/7/4`，四路健康仍为 `OK`。首次只读探针错误地把 GET 请求头当作请求体传递，返回 401；修正后书籍与 Scholar 两表普通及过滤查询均为 200，不将其归因于服务端。

## 边界

文件关系在上传完成前就可能存在，因为 Web 上传接口先插入文件行、后传输对象；这次合成 PDF 的 SHA-256 往返只证明这一条对象完整。HTTP 验收使用 Web 上传接口和认证 PostgREST 书籍写入，尚未走 Web 导入按钮、原有 `/api/sync` 写入或桌面客户端的新书采用。第三方同步文件、未上传本地书、译文与补充材料仍须后续显式关联。200+ 文献规模、集合管理与跨账户 API 路径还需验收，Phase 2 未完成。
