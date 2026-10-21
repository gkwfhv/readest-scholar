# Phase 2：服务端文献与文件身份分离

## 范围

- `docker/volumes/db/migrations/029_scholar_document_file_identity.sql` 增加 `scholar_documents`、`scholar_document_books`、`scholar_document_files`，回填活跃书籍与能确认的正文文件。迁移在一个事务中执行，旧 `books.book_hash` 和 `files.id` 均不变。
- 三张表的 RLS、匿名角色撤权和同账户复合外键一并建立。`scholar-baseline.yml` 在 PR 和主分支运行独立 PostgreSQL 行为测试。
- 数据模型取舍见 [ADR 0002](../../adr/0002-scholar-document-file-identity.md)。

## 已运行验证

- 在本机 Docker 的临时 Supabase PostgreSQL 15.8.1.085 容器中执行 `bash docker/volumes/db/tests/run-029.sh`：退出码 0，容器退出即删除，没有映射端口或持久卷。它创建两名合成账户、三条书籍记录和五条文件记录，执行真实迁移后断言：仅两条活跃书籍及各自正文文件被回填；封面、已删除书籍、相同哈希但不同账户的文件没有被错误关联。
- 以两名合成账户分别设置 `authenticated` 角色和 JWT `sub` 后，三张表只返回本账户记录；跨账户文件关联因复合外键被拒，跨账户文献插入因 RLS 被拒；重复书籍映射因唯一键被拒；同一文献可关联第二版阅读条目及文件。匿名角色读取文献表被拒。断言脚本每项失败都会使 `psql -v ON_ERROR_STOP=1` 返回非零。
- `bash -n docker/volumes/db/tests/run-029.sh`、`git diff --check` 和现有 `pnpm test --run src/__tests__/docker/db-bootstrap-migrations.test.ts`（9 项通过）已运行。
- PR #41 的 Scholar baseline、PR checks 与 CodeQL Advanced 在提交 `0baa320cf5bff72ef23df816ad75b53eefa36677` 上全部通过；Scholar baseline 的“Exercise Scholar document identity migration and RLS”步骤在 GitHub amd64 runner 上通过。合并提交为 `3fd8f8cac0dfcb1ae8d1b4934c6122c088ebb628`。

## 隔离 staging 迁移与接口验收

- 测试主机的源码从 `69ee5356561eb4a7a2c6b5faa4ed56372e76ea23` 经 SHA256 为 `8fe5ba14d5149a5c372704015e7ef60fe3f1d68d7b53534dbd9a241b3f6d0eed` 的 Git bundle 快进到上述合并提交；工作区原先干净，数据库迁移目录绑定到该源码。迁移前完成合成数据备份 `~/scholar-staging-backups/20261021T133649Z`，`STATUS=complete`；此备份尚未冷恢复。
- 执行前迁移账本停在 028，活跃书籍 6 条，Web/Auth/REST+数据库/对象存储四路就绪均为 `OK`。运行 `docker exec scholar-staging-db /docker-entrypoint-initdb.d/zz-readest-migrations.sh` 仅新增 029：事务内生成 6 个文献 UUID、6 条书籍关系和 3 条可确认的正文文件关系。之后查询得到“活跃书籍/文献/书籍关系/文件关系/未映射活跃书籍/误关联封面/029 账本条数”=`6/6/6/3/0/0/1`；四路就绪仍全为 `OK`。
- 在真实合成数据库中，分别用两名已有合成账户的 JWT `sub` 设置 `authenticated` 数据库角色。事务内断言三张表均不返回别人的行；把其他账户文件挂到自己的文献被复合外键拒绝，代其他账户插入文献被 RLS 拒绝。`anon` 读取文献表被拒。测试事务全部 `ROLLBACK`，未保留测试写入。
- 通过主机回环 Kong/PostgREST，以现有合成账户登录后，`books`、`scholar_documents`、`scholar_document_books`、`scholar_document_files` 均返回 HTTP 200；该账户的活跃书籍与书籍关系均为 2，文献为 2，正文文件关系为 1，哈希集合一致。仅带公开 anon key 读取 `scholar_documents` 被拒。登录令牌、邮箱与密码未写入仓库或验收输出。

## 尚未验收

- 客户端新导入自动关联、Web/桌面文献集合操作、并发合并、200+ 文献规模及本次快照的冷恢复待后续步骤实测。测试主机仍运行前一版 Web 镜像；本项迁移未修改客户端运行代码。此项证明服务端数据模型、接口可见性和账户隔离，不宣称 Phase 2 完成。
