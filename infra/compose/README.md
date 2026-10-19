# 本机 Phase 0 自托管验证

这里是官方 `docker/compose.yaml` 的测试覆盖文件，不改变上游 Compose。四个宿主机端口都只绑定 `127.0.0.1`；数据库、认证和对象存储仍使用官方服务定义。不要将此配置直接当作公网部署配置。

首次运行前，在工作区根目录执行：

```bash
node infra/compose/prepare-local-env.mjs
docker compose --env-file docker/.env \
  -f docker/compose.yaml -f infra/compose/localhost.yaml config --quiet
docker compose --env-file docker/.env \
  -f docker/compose.yaml -f infra/compose/localhost.yaml up -d
```

准备脚本只在 `.env` 不存在时创建文件；使用随机测试口令和 JWT，并锁定本次审计的 Readest SHA 镜像标签。文件权限为 `0600`，已被根目录 `.gitignore` 忽略。不要提交它，也不要把生成的服务角色 JWT 发给浏览器或日志。

测试结束后使用相同的两个 `-f` 参数执行 `docker compose ... down`；不要加 `-v`，除非确定要删除测试数据。

## 当前验证结果

2026-10-19：`docker compose config --format json` 确认只有 `127.0.0.1:3000`、`:8000`、`:9000`、`:9001` 映射。官方 `quay.io/minio/mc:latest` 和固定版本 `quay.io/minio/minio:RELEASE.2025-09-06T17-38-46Z` 拉取均返回 registry `401 UNAUTHORIZED`；Docker Hub 的 `minio/minio:RELEASE.2025-04-22T22-12-26Z` 返回 `pull access denied`。[MinIO 官方仓库](https://github.com/minio/minio) 也已归档。原版对象存储镜像的 Compose 尚未启动成功。

## 空数据替代镜像诊断

[MinIO 官方说明](https://github.com/minio/minio/blob/master/README.md) 称社区版已经改为源码分发。为了仅在本机继续验证 Readest 的登录、文件和同步流程，`silo-local-test.yaml` 用 [Pigsty 维护的公开源码分支](https://github.com/pgsty/silo) 提供的 MinIO 兼容服务及 mc，保留官方 Compose 其余服务。两个 arm64 镜像均固定到实测的镜像摘要，端口仍由 `localhost.yaml` 限制在回环地址。替代镜像的测试结果必须单独标注，不能当作原样官方 MinIO 镜像通过。

```bash
docker compose --env-file docker/.env \
  -f docker/compose.yaml \
  -f infra/compose/localhost.yaml \
  -f infra/compose/silo-local-test.yaml config --quiet
docker compose --env-file docker/.env \
  -f docker/compose.yaml \
  -f infra/compose/localhost.yaml \
  -f infra/compose/silo-local-test.yaml up -d
```

以上覆盖文件只固定了当前 macOS arm64 的测试镜像摘要。其他架构应核验对应摘要后再使用。生产部署需要独立评估替代发行版的安全维护、升级兼容性和许可。

这套覆盖文件已在合成账户上完成桌面 PDF 上传、Web 端下载及打开阅读；六个持续服务处于运行状态，数据库、Kong 和 MinIO 健康。此结论只适用于替代镜像。Web UI 的自动化文件选择器无法设置动态创建的 `<input type=file>`；已用独立桌面客户端完成上传与跨端验证，不把该自动化限制记为 Web 上传通过。

## 就绪检查

栈启动后，从宿主机运行 `node infra/compose/check-readiness.mjs`。脚本默认探测回环地址上的 Web 首页、Kong 转发的 Auth 健康路由、使用公开 anon key 的 PostgREST 根路由，以及对象存储健康路由；四项都收到 HTTP 200 才退出 0。REST 路由会访问数据库，因此同时检验网关到数据库 API 的关键路径。脚本仅从 `docker/.env` 读取 `ANON_KEY`，不使用或打印 service-role key。

若 `.env` 位于另一检出目录，设置 `SCHOLAR_ENV_FILE=/绝对路径/docker/.env`。其他端口或受控 staging 可分别设置 `SCHOLAR_WEB_URL`、`SCHOLAR_API_URL`、`SCHOLAR_S3_URL` 为受信任的 HTTP(S) 起点。示例：

```bash
SCHOLAR_ENV_FILE=/绝对路径/docker/.env node infra/compose/check-readiness.mjs
```

在当前合成栈上四项均通过。将 Web 地址改为未监听的 `127.0.0.1:3999` 后，脚本为 Web 报连接拒绝并以退出码 1 结束，其他三项仍通过。该检查用于启动后的就绪判断；升级回滚、数据完整性与用户阅读场景仍需独立演练。

## 备份与隔离恢复

在本机合成数据栈上运行 `SCHOLAR_BACKUP_CONFIRM=yes SCHOLAR_COMPOSE_DIR="$(pwd)/docker" bash infra/backup/backup-compose.sh /绝对路径/备份目录`。备份目录权限为 `0700`，内部包含原始 `postgres.sql`、`graphql-wrapper.sql`、可直接导入空数据库的 `postgres-restorable.sql`、`minio-data/` 和完成标记。不要把其中的数据或凭据提交到公开仓库。

实际演练中，原始 `postgres.sql` 在 `graphql_public.graphql` 的授权处报错；原因是上游 `pg_dump` 记录授权却未输出扩展创建的包装函数。修正脚本后，`postgres-restorable.sql` 在新建空数据库中一次导入成功。

完整恢复演练使用 `restore-rehearsal.yaml` 作为最后一个 Compose 覆盖文件。先将备份的 `minio-data/` 复制到独立目录，并用 `SCHOLAR_RESTORE_MINIO_DATA=/该目录` 指定它；以下每条 Compose 命令都需要相同的三个 `-f` 参数和环境变量：

```bash
export SCHOLAR_RESTORE_MINIO_DATA=/备份对象副本的绝对路径
docker compose --env-file docker/.env \
  -f docker/compose.yaml -f infra/compose/silo-local-test.yaml \
  -f infra/compose/restore-rehearsal.yaml up -d db
docker exec scholar-restore-db createdb -U supabase_admin scholar_phase0_restored
docker exec -i scholar-restore-db psql -X -q -v ON_ERROR_STOP=1 \
  -U supabase_admin -d scholar_phase0_restored < /备份目录/postgres-restorable.sql
docker compose --env-file docker/.env \
  -f docker/compose.yaml -f infra/compose/silo-local-test.yaml \
  -f infra/compose/restore-rehearsal.yaml up -d
```

第二套栈使用独立容器和卷，宿主机只发布回环端口 `3100/8100/9100/9101`。实际恢复后三个 HTTP 健康请求返回 200，合成账户在 `127.0.0.1:3100` 登录成功，书库显示备份 PDF，从恢复对象存储下载后打开第 2/2 页，页面提示阅读进度已同步。恢复库账户/书籍/文件数量 `1/1/2`。这是本机合成数据的恢复演练；生产还需单独评估备份加密、保留期、升级兼容和镜像供应链。
