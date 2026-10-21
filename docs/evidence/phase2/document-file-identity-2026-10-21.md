# Phase 2：服务端文献与文件身份分离

## 范围

- `docker/volumes/db/migrations/029_scholar_document_file_identity.sql` 增加 `scholar_documents`、`scholar_document_books`、`scholar_document_files`，回填活跃书籍与能确认的正文文件。迁移在一个事务中执行，旧 `books.book_hash` 和 `files.id` 均不变。
- 三张表的 RLS、匿名角色撤权和同账户复合外键一并建立。`scholar-baseline.yml` 在 PR 和主分支运行独立 PostgreSQL 行为测试。
- 数据模型取舍见 [ADR 0002](../../adr/0002-scholar-document-file-identity.md)。

## 已运行验证

- 在本机 Docker 的临时 Supabase PostgreSQL 15.8.1.085 容器中执行 `bash docker/volumes/db/tests/run-029.sh`：退出码 0，容器退出即删除，没有映射端口或持久卷。它创建两名合成账户、三条书籍记录和五条文件记录，执行真实迁移后断言：仅两条活跃书籍及各自正文文件被回填；封面、已删除书籍、相同哈希但不同账户的文件没有被错误关联。
- 以两名合成账户分别设置 `authenticated` 角色和 JWT `sub` 后，三张表只返回本账户记录；跨账户文件关联因复合外键被拒，跨账户文献插入因 RLS 被拒；重复书籍映射因唯一键被拒；同一文献可关联第二版阅读条目及文件。匿名角色读取文献表被拒。断言脚本每项失败都会使 `psql -v ON_ERROR_STOP=1` 返回非零。
- `bash -n docker/volumes/db/tests/run-029.sh`、`git diff --check` 和现有 `pnpm test --run src/__tests__/docker/db-bootstrap-migrations.test.ts`（9 项通过）已运行。

## 尚未验收

- 测试主机的真实存量数据迁移、PostgREST 请求、客户端新导入自动关联、Web/桌面文献集合操作，以及 200+ 文献规模待后续步骤实测。此项仅证明服务端数据模型和隔离约束，不宣称 Phase 2 完成。
