# Phase 2：新书籍自动获得文献身份

029 迁移给当时的存量活跃书籍回填文献 UUID，但之后通过现有同步写入的新书籍仍无文献关系。030 增加数据库触发器：新 `books` 行以及从软删除恢复的行，在同一事务中获得文献 UUID 和书籍关系；升级时补齐 029 到 030 之间的活跃书籍缺口。触发器不修改原书籍哈希、阅读进度、笔记、上传记录或同步 API。

## 行为验证

- 先在仅应用 029 的隔离 Supabase PostgreSQL 中插入一条新活跃书和一条软删除书，运行 030 断言，按预期失败：`migration gap backfill or tombstone exclusion failed`。
- 应用 030 后，同一断言通过：迁移缺口被补齐，软删除书仍无映射；以 `authenticated` 合成账户新插入活跃书立即获得文献关系，恢复旧软删除书后立即获得关系，新软删除书在恢复前无关系、恢复后有关系，重复映射数仍为 1。Readest 同步 API 使用的 `service_role` 无 JWT 用户声明插入另一账户书籍时也立即创建该账户的文献关系。测试用的书籍、文献与文件均在临时无端口、无持久卷的数据库容器内。
- `bash docker/volumes/db/tests/run-scholar-document-identity.sh` 一次执行 029/030 的合成数据、迁移和行为断言；Scholar baseline CI 对同一脚本使用固定 amd64 Supabase PostgreSQL 镜像。`bash -n`、`git diff --check` 和数据库引导 Vitest 可复跑。

## 边界

- 该触发器只处理自托管云库的 `books` 行。本地尚未同步的书、仅在第三方文件同步提供方中的书，以及新上传文件的 `scholar_document_files` 关系仍需客户端/服务端下一步接线。
- 本项尚未在 staging 的真实合成账户上验收；不会把该本地测试称为跨 Web/桌面完整文献身份同步。200+ 文献规模与去重也未验收。
