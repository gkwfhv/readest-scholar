# 自托管同步与恢复演练

日期：2026-10-19。上游 Readest SHA：`2d37bbfc2e94725e1343ab2a825573545aa59f5f`。仅使用仓库 `sample-paper.pdf` 和本机合成账户；没有接入生产数据。官方 MinIO/mc 镜像拉取返回 401，实际运行使用 `infra/compose/silo-local-test.yaml` 固定摘要的 Pigsty 兼容镜像。以下结果不能代表原版对象镜像已通过。

## 第一套本机测试栈

- Compose 文件：`readest/docker/compose.yaml`、`infra/compose/localhost.yaml`、`infra/compose/silo-local-test.yaml`。
- `docker compose ps`：`client/auth/db/kong/rest/minio` 六个服务运行，`db/kong/minio` 健康；宿主机仅绑定 `127.0.0.1:3000/8000/9000/9001`。
- 隔离标识 `com.readest.scholar.phase0` 的桌面应用登录合成账户，导入仓库测试 PDF，执行“上传书籍”；数据库 `auth.users/public.books/public.files` 数量为 `1/1/2`，该书 `uploaded_at` 非空。
- Web `http://127.0.0.1:3000/library` 同账户显示该书，下载后打开 `/reader/008e936204282cfdef42acdd3e527740`；可访问性树读到 PDF 正文和两页阅读器。`public.book_configs` 有 1 行；Web 端后续到达第 2/2 页。

## 备份缺陷与修正

- 第一次真实备份的原始 `postgres.sql` 导入空数据库时，`psql -v ON_ERROR_STOP=1` 在 `GRANT ALL ON FUNCTION graphql_public.graphql(...)` 报 `function ... does not exist`。数据行已导入，但恢复未完成，不能计为通过。
- `infra/backup/backup-compose.sh` 现保存该扩展生成函数的定义，并将其插入原始转储首次授权前，生成 `postgres-restorable.sql`；`STATUS=complete` 只在数据库转储、函数提取、SQL 组装和对象复制全部成功后写入。
- 最终快照 `backup-test/20261019T110219Z` 的 `postgres-restorable.sql` 一次导入新建空库 `scholar_phase0_restore3`，退出码 0；恢复库账户/书籍/文件 `1/1/2`，事件触发器 8 个，GraphQL 包装函数存在。该库只用于中途诊断。
- 备份脚本的拒绝未确认运行、私有权限、对象复制失败不写完成标记的假 Docker 测试再次通过。

## 第二套完整恢复栈

- 复制最终快照的 `minio-data/` 到独立目录，作为 `SCHOLAR_RESTORE_MINIO_DATA`；Compose 叠加 `infra/compose/restore-rehearsal.yaml`，项目名 `scholar-restore-rehearsal`，使用独立容器、数据库卷、对象目录与回环端口 `3100/8100/9100/9101`。
- 仅启动第二套 `db`，新建 `scholar_phase0_restored` 空库，`docker exec -i scholar-restore-db psql -X -q -v ON_ERROR_STOP=1 -U supabase_admin -d scholar_phase0_restored < backup-test/20261019T110219Z/postgres-restorable.sql` 退出 0；再启动其余服务。
- `curl` 对第二套 Web `/library`、Auth `/auth/v1/health`、MinIO `/minio/health/live` 均返回 200。
- 浏览器在 `127.0.0.1:3100` 使用原合成账户登录；书库显示备份 PDF，点击后从恢复对象存储下载并打开。阅读器显示第 2/2 页、PDF 正文和“阅读进度已同步”。这验证了数据库记录、对象字节、认证和客户端连接的组合恢复。
- 演练后 `docker compose ... stop` 停止第二套服务，保留卷和对象副本供复核；第一套本机测试栈保持运行。额外的无网络对象恢复容器也已停止。

仍未验证：原版官方 MinIO 镜像、完整单元测试通过、PDF 批注与 AI 端到端、升级回滚和受保护远端 CI。备份目录含合成账户哈希与对象数据，权限为 `0700`，不能公开提交。
