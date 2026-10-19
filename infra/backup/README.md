# 备份

官方数据在 Compose 的 Postgres volume 和 MinIO volume。容器回滚不会自动回到旧 schema。本脚本只服务已经用官方 `docker/compose.yaml` 拉起的本机合成数据测试栈。

2026-10-19 已对固定摘要的替代 MinIO 测试栈运行真实备份，并在第二套完整隔离服务栈恢复后登录、下载与阅读。官方 MinIO 镜像本机拉取仍返回 401；见 [本机 Compose 验证](../compose/README.md) 与 [演练记录](../../docs/evidence/phase0/selfhost-restore-rehearsal.md)。

## 使用

在官方栈已经运行、并且 `docker/compose.yaml` 仍使用容器名 `supabase-db` 与 `readest-minio` 时：

```bash
SCHOLAR_BACKUP_CONFIRM=yes \
SCHOLAR_COMPOSE_DIR=/path/to/readest-scholar/docker \
  /path/to/infra/backup/backup-compose.sh /absolute/backup-directory
```

脚本拒绝缺少确认变量的调用。数据库导出走 `pg_dump -U supabase_admin`，与官方 README 的 `psql -U supabase_admin` 相同。对象数据用 `docker cp readest-minio:/data` 复制卷内容，不把 MinIO 口令放进命令行。恢复必须先在空数据库和对象目录演练，不能直接覆盖正在使用的 volume。

备份目录权限 `0700`，包含原始 `postgres.sql`、单独的 GraphQL 包装函数定义、`postgres-restorable.sql`、`minio-data/` 和 `STATUS`。上游 `pg_dump` 不输出扩展生成的 `graphql_public.graphql` 函数，却输出它的权限语句，因此原始 SQL 单独恢复会报错；请用 `postgres-restorable.sql`。脚本只有在数据库转储、函数提取、SQL 组装和对象复制都成功后才写完成标记。合成账户的密码哈希和对象字节仍属于需保护的数据，备份目录已被工作区 `.gitignore` 忽略。

当前脚本产生明文副本，且 Postgres dump 与对象复制之间没有跨服务原子快照。因此它只是 Phase 1 的本机测试机制，不满足方案中的加密定期备份、保留期和升级回滚要求，不能作为生产备份策略。

官方升级后的迁移命令以 `docker/README.md` 为准：`docker compose exec db /docker-entrypoint-initdb.d/zz-readest-migrations.sh`。Scholar 自己的迁移还没有文件。
