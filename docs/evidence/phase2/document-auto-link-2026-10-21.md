# Phase 2：新书籍自动获得文献身份

029 迁移给当时的存量活跃书籍回填文献 UUID，但之后通过现有同步写入的新书籍仍无文献关系。030 增加数据库触发器：新 `books` 行以及从软删除恢复的行，在同一事务中获得文献 UUID 和书籍关系；升级时补齐 029 到 030 之间的活跃书籍缺口。触发器不修改原书籍哈希、阅读进度、笔记、上传记录或同步 API。

## 行为验证

- 先在仅应用 029 的隔离 Supabase PostgreSQL 中插入一条新活跃书和一条软删除书，运行 030 断言，按预期失败：`migration gap backfill or tombstone exclusion failed`。
- 应用 030 后，同一断言通过：迁移缺口被补齐，软删除书仍无映射；以 `authenticated` 合成账户新插入活跃书立即获得文献关系，恢复旧软删除书后立即获得关系，新软删除书在恢复前无关系、恢复后有关系，重复映射数仍为 1。Readest 同步 API 使用的 `service_role` 无 JWT 用户声明插入另一账户书籍时也立即创建该账户的文献关系。测试用的书籍、文献与文件均在临时无端口、无持久卷的数据库容器内。
- `bash docker/volumes/db/tests/run-scholar-document-identity.sh` 一次执行 029/030 的合成数据、迁移和行为断言；Scholar baseline CI 对同一脚本使用固定 amd64 Supabase PostgreSQL 镜像。`bash -n`、`git diff --check` 和数据库引导 Vitest 可复跑。

## staging 验收

- PR #43 的最终提交 `a7d8d6b51cc8da0aff895314d3a00179f04d8b5e` 上，Scholar baseline、PR checks 与 CodeQL Advanced 全部通过；合并提交为 `7845282afc6dedb60f3ebf8a2f9618d4f9671136`。主机源码从 `3fd8f8cac0dfcb1ae8d1b4934c6122c088ebb628` 通过 SHA256 为 `97773d96417b407bb4935b355d36fd10334a65ec95c543f158a39b0577382ed5` 的 Git bundle 快进至合并提交，原工作区干净。
- 迁移前合成数据完整备份 `~/scholar-staging-backups/20261021T140103Z` 的 `STATUS=complete`，账本停在 029。运行 `docker exec scholar-staging-db /docker-entrypoint-initdb.d/zz-readest-migrations.sh` 只新增 030；触发器创建成功，029 之后的缺口回填为 0。本次备份尚未冷恢复。
- 在现有合成数据库分别设置 `service_role` 与带合成账户 JWT `sub` 的 `authenticated` 数据库角色。前者插入新书后立即产生一条文献映射；后者插入软删除书时无映射，恢复、再次软删除、再次恢复后始终恰好一条映射。两段写入各在事务末尾 `ROLLBACK`，没有留下探针书籍。迁移账本最新项为 030；验收后活跃书籍/文献/书籍关系/文件关系仍为 `6/6/6/3`，Web、Auth、REST/数据库、对象存储四路就绪均为 `OK`。

## 边界

- 该触发器只处理自托管云库的 `books` 行。本地尚未同步的书、仅在第三方文件同步提供方中的书，以及新上传文件的 `scholar_document_files` 关系仍需客户端/服务端下一步接线。
- staging 已验证数据库写入角色与触发器，但还没有走实际 Web 导入按钮或桌面同步的新书往返；不能据此称为跨 Web/桌面完整文献身份同步。200+ 文献规模与去重也未验收。
