# Linux staging（SSH 隧道）

此配置用于 Linux x86_64 非生产主机上的合成数据验收。它在官方 `docker/compose.yaml` 后追加 `infra/staging/compose.yaml`：Compose 项目、容器名和数据卷均为 `scholar-staging`，四个端口只绑定主机的 `127.0.0.1`。不要把此配置接入公网反向代理；当前没有测试域名或 TLS。主机上已有其他业务时，先确认 `3130/8130/9130/9131` 未占用。

当前 Web 容器仍是锁定 SHA 的**上游 Readest 基线镜像**。这个栈验证自托管部署、备份和回滚机制，不能据此宣称 Scholar 阅读位置修复已在 Linux 容器内验证。七个镜像均固定 Linux amd64 平台摘要；对象存储采用固定摘要的 Silo 维护发行版。既有旧镜像数据卷必须先在隔离栈完成升级与恢复演练，不能直接滚动降级。

## Scholar Web 镜像产出

仓库的 `Publish Docker image` 工作流在 `main` 的应用、依赖或 Dockerfile 变化后自动构建 Linux amd64/arm64 镜像，也可手动触发。自动路径只使用 GitHub 自带令牌写入本仓库所有者的 GHCR 包；手动触发才保留现有的可选 Docker Hub 发布入口。它发布 `main` 与 `sha-<提交前缀>` 标签，并为两个平台分别保存 CycloneDX 镜像 SBOM 工件；不生成可误认为稳定版本的 `latest` 标签。工作流不连接 staging 主机，也不读取主机私有 `docker/.env`。

部署时从本次工作流记录取完整提交和镜像摘要，在测试主机的已审核 checkout 中运行：

```bash
SCHOLAR_STAGING_DEPLOY_CONFIRM=yes bash infra/staging/deploy-web.sh \
  'ghcr.io/<仓库所有者>/readest@sha256:<完整摘要>'
```

脚本只接受固定摘要，先检查项目名、回环端口、当前镜像与四路健康，备份数据库和对象数据，拉取候选镜像后仅重建 `client`。候选未就绪时恢复上一镜像并重试健康检查；不会把数据库迁移当作 Web 回滚。成功后仍需通过 SSH 隧道做合成 PDF 阅读与跨端同步烟测，并在另一套空栈验证新快照恢复。若 GHCR 从主机不可达，使用下文的固定摘要导出与校验传输，不改用浮动标签。镜像生成和测试栈切换是两次独立动作；自动构建成功本身不代表 staging 已升级。

## 首次启动

在非生产主机克隆本仓库的已审核主分支，然后在仓库根目录执行：

```bash
python3 infra/staging/prepare-env.py
python3 infra/staging/check-bind-mounts.py
docker compose --env-file docker/.env \
  -f docker/compose.yaml -f infra/staging/compose.yaml \
  config --format json | python3 -c 'import json,sys; c=json.load(sys.stdin); assert c["name"] == "scholar-staging"; assert all(p["host_ip"] == "127.0.0.1" for s in c["services"].values() for p in s.get("ports", []))'
docker compose --env-file docker/.env \
  -f docker/compose.yaml -f infra/staging/compose.yaml up -d
```

Kong 和 PostgreSQL 初始化进程会以容器内的非宿主用户读取仓库中的静态 bind mount。若克隆时使用 `umask 077`，这些跟踪文件可能变成 `0600`，预检会报错，容器也会因无法读取 `kong.yml` 或初始化 SQL 而反复重启。只修正**静态**挂载文件的权限后重跑预检：

```bash
chmod 755 docker docker/volumes docker/volumes/api docker/volumes/db docker/volumes/db/init
find docker/volumes/db/migrations -type d -exec chmod 755 {} +
chmod 644 docker/volumes/api/kong.yml docker/volumes/db/roles.sql \
  docker/volumes/db/jwt.sql docker/volumes/db/init/schema.sql
find docker/volumes/db/migrations -type f -exec chmod 644 {} +
chmod 755 docker/volumes/db/apply-migrations.sh
python3 infra/staging/check-bind-mounts.py
```

私有 `docker/.env` 继续保持 `0600`；它不在上述命令的更改范围内。若权限错误已造成**首次、空数据**的 staging 数据库部分初始化，先用相同的两个 Compose 文件执行 `down`（不带 `-v`），核对 `scholar-staging_db-data` 与 `scholar-staging_db-config` 卷的项目标签且确认为本次一次性测试数据后，只删除这两个卷，再重新启动。已有用户数据时不得删除卷，应先备份并调查恢复办法。

如果目标主机的 Docker daemon 不能访问 Docker Hub，但有可用的代理 registry，可在目标主机安装 [go-containerregistry `crane`](https://github.com/google/go-containerregistry/releases) 的 Linux amd64 发行包，并以 GitHub 发布资产的 SHA256 校验。下列脚本先核对代理返回的 Linux amd64 镜像摘要，再以 OCI 格式导入六个 Docker Hub 镜像；它不会更改 daemon 的全局代理设置：

```bash
CRANE_BIN="$HOME/.local/bin/crane" \
  bash infra/staging/import-dockerhub-from-mirror.sh
```

默认代理主机为 `hub.1panel.dev`，可用 `SCHOLAR_DOCKERHUB_MIRROR` 覆盖。只在镜像摘要与仓库锁定值完全一致时导入。已下载的层保存在用户目录 `~/.cache/scholar-staging-crane`；重试前按清单大小和 SHA256 移除中断留下的无效分片，失败时最多重试三次。重试时使用 [Go 支持的 HTTP/1 客户端设置](https://pkg.go.dev/net/http#hdr-HTTP_2) 避开镜像代理的 HTTP/2 stream 错误。可以用 `SCHOLAR_CRANE_CACHE` 指定其他目录。Web 镜像来自 GHCR；如果目标主机无法访问 GHCR，在一台能访问原始 registry 的受信机器上运行以下传输。`export-images.sh` 从 Compose 配置读取七个镜像，但此模式只拉取并导出 Web 镜像，先与固定平台摘要比对；它只把镜像归档写入标准输出，不传输 `.env`。

```bash
SCHOLAR_STAGING_EXPORT_WEB_ONLY=1 bash infra/staging/export-images.sh | gzip -1 | \
  ssh -p <SSH_PORT> <SSH_USER>@<SSH_HOST> 'gunzip | docker image load'
```

FRP/SSH 若在长传输中断开，可先把上述管道的 gzip 输出保存为本地档案，记录其 SHA256，再用 `rsync --partial --append -e 'ssh -p <SSH_PORT>'` 续传到主机。主机端用 `sha256sum` 比对**完整**档案与本地摘要，随后 `gunzip -c <档案> | docker image load`；不要加载未校验的分片。

如果 Docker Hub 和 GHCR 都无法从目标主机或代理访问，也可在受信机器传输全部七个镜像：

```bash
bash infra/staging/export-images.sh | gzip -1 | \
  ssh -p <SSH_PORT> <SSH_USER>@<SSH_HOST> 'gunzip | docker image load'
```

导入后用 `docker compose --env-file docker/.env -f docker/compose.yaml -f infra/staging/compose.yaml up -d --pull never` 启动，确保目标主机不会向失效的镜像代理请求其他内容。

`prepare-env.py` 仅在目标文件不存在时生成随机测试口令和 JWT，权限为 `0600`，不会覆盖现有配置；该文件受 `.gitignore` 排除。不要将它、数据库转储或对象副本提交到公开仓库。生产凭据、签名密钥和真实用户数据不属于此环境。

本机用以下命令建立三个转发口，保持 SSH 会话开启：

```bash
ssh -N -p <SSH_PORT> -L 3130:127.0.0.1:3130 \
  -L 8130:127.0.0.1:8130 -L 9130:127.0.0.1:9130 \
  <SSH_USER>@<SSH_HOST>
```

浏览器访问 `http://127.0.0.1:3130`。Web、API 和对象 URL 都按隧道端口生成；若本机这些端口已占用，应先调整 env、Compose 覆盖文件与隧道映射，并重新检查配置。测试端口无需在公网开放。

## 就绪、备份与回滚边界

在主机上运行 `python3 infra/staging/check-readiness.py`，分别检查 Web、认证、PostgREST/数据库和对象存储四个回环路由。它只读取公开 `ANON_KEY`，不会输出任何凭据；四项均 HTTP 200 才退出 0。

备份命令必须显式声明项目与覆盖文件，防止备错其他 Compose 栈：

```bash
SCHOLAR_BACKUP_CONFIRM=yes \
SCHOLAR_COMPOSE_DIR="$PWD/docker" \
SCHOLAR_COMPOSE_OVERLAY="$PWD/infra/staging/compose.yaml" \
SCHOLAR_COMPOSE_EXPECTED_PROJECT=scholar-staging \
SCHOLAR_ENV_FILE="$PWD/docker/.env" \
bash infra/backup/backup-compose.sh "$HOME/scholar-staging-backups"
```

备份包含明文数据库和对象副本，目录权限 `0700`。当前 `pg_dump` 与对象复制之间没有跨服务原子快照，因此只用于合成数据测试；真实数据要求加密、保留期、独立恢复和一致性设计。升级前记录当前镜像摘要和提交；若仅 Web 容器版本失败，恢复上一摘要并重建 `client`，然后做四路健康与阅读冒烟。数据库迁移不能靠容器回退自动撤销；破坏性迁移必须先在独立栈恢复备份验证兼容性。

`bash infra/staging/rehearse-web-rollback.sh` 会先备份并确认四路就绪，再只给 `client` 注入一个立即退出的进程，确认健康检查失败，然后按原配置重建 `client` 并重新确认四路就绪。脚本始终保留数据库和对象卷，遇到中途错误也会尝试恢复 Web。它仅证明 Web 容器故障回退；独立恢复、真实候选版本升级和数据库迁移仍需单独演练。

## 在独立项目中恢复合成快照

先确认快照的 `STATUS` 为 `complete`，并且恢复项目以前没有容器或卷。`prepare-restore-env.py` 仅复制 staging 的**合成测试凭据**，把四个回环端口改为 `3140/8140/9140/9141`，目标 `docker/.env.restore` 以 `0600` 创建且不会覆盖。恢复覆盖文件将项目、容器、网络和三个命名卷分离；不能把这套命令指向真实用户数据。

```bash
snapshot="$HOME/scholar-staging-backups/<SNAPSHOT_ID>"
test "$(cat "$snapshot/STATUS")" = complete
test -s "$snapshot/postgres-restorable.sql"
test -d "$snapshot/minio-data"
python3 infra/staging/prepare-restore-env.py
docker compose --env-file docker/.env.restore \
  -f docker/compose.yaml -f infra/staging/compose.yaml \
  -f infra/staging/restore-rehearsal.yaml config --format json | \
  SCHOLAR_COMPOSE_VARIANT=restore node infra/staging/check-config.mjs
```

先用 `docker ps -aq --filter label=com.docker.compose.project=scholar-restore-rehearsal` 与对应 `docker volume ls -q` 确认均为空，并核对四个端口未占用。随后只创建恢复项目的对象容器和卷，向尚未启动的空卷复制快照。下面的镜像是 staging 中已固定摘要、已导入的 Linux amd64 Silo 镜像：

```bash
compose=(docker compose --env-file docker/.env.restore \
  -f docker/compose.yaml -f infra/staging/compose.yaml \
  -f infra/staging/restore-rehearsal.yaml)
"${compose[@]}" create --pull never minio
test "$(docker volume inspect scholar-restore-rehearsal_minio-data \
  --format '{{index .Labels "com.docker.compose.project"}}')" = scholar-restore-rehearsal
docker run --rm \
  -v scholar-restore-rehearsal_minio-data:/data \
  -v "$snapshot/minio-data:/backup:ro" \
  --entrypoint /bin/sh \
  docker.io/pgsty/silo:RELEASE.2026-10-18T00-00-00Z-amd64@sha256:706e0d419d23bdab663486044165fb4de1ee6b82885a8637b2935216fb2286ec \
  -ec 'cp -a /backup/. /data/'
"${compose[@]}" up -d --pull never db
```

等 `db` 初始化完成后，在该**独立**数据库容器中新建空库并导入可恢复 SQL。绝不把转储导入原项目的 `postgres` 库：

```bash
docker exec scholar-restore-db pg_isready -U supabase_admin -d postgres
docker exec scholar-restore-db psql -X -At -U supabase_admin -d postgres \
  -c "SELECT to_regclass('public.books') IS NOT NULL"
# 上一行须为 t，才能继续。
docker exec scholar-restore-db psql -X -v ON_ERROR_STOP=1 \
  -U supabase_admin -d postgres \
  -c 'CREATE DATABASE scholar_staging_restored OWNER supabase_admin'
docker exec -i scholar-restore-db psql -X -q -v ON_ERROR_STOP=1 \
  -U supabase_admin -d scholar_staging_restored \
  < "$snapshot/postgres-restorable.sql"
"${compose[@]}" up -d --pull never
SCHOLAR_ENV_FILE="$PWD/docker/.env.restore" \
  python3 infra/staging/check-readiness.py
```

四路 HTTP 200 只说明服务已启动。若备份前已在原 staging 通过 Auth 注册合成账户、把仓库 `sample-paper.pdf` 上传到 `readest-files/scholar-restore-probe/sample-paper.pdf`，且将 `email`、`password`、`user_id` 保存在主机私有 `0600` 的 `~/scholar-staging-backups/restore-probe-auth.json`，则可运行 `python3 infra/staging/verify-restore-probe.py`。它登录恢复栈并比对用户 ID，再用已固定摘要的 `mc` 读取 PDF，比对源文件 SHA256，不输出凭据。MinIO 数据卷内的对象路径是目录，不能直接对 `minio-data/.../sample-paper.pdf` 执行 `sha256sum`。验证后执行 `"${compose[@]}" stop` 释放内存，保留恢复卷供复核；不运行 `down -v`。最后重新运行原项目的 `check-readiness.py` 并比较其他业务容器 ID。

停止服务使用相同的两个 `-f` 文件执行 `down`，不带 `-v`。删除 staging 卷或备份应单独检查其项目名与路径。
