# Linux staging（SSH 隧道）

此配置用于 Linux x86_64 非生产主机上的合成数据验收。它在官方 `docker/compose.yaml` 后追加 `infra/staging/compose.yaml`：Compose 项目、容器名和数据卷均为 `scholar-staging`，四个端口只绑定主机的 `127.0.0.1`。不要把此配置接入公网反向代理；当前没有测试域名或 TLS。主机上已有其他业务时，先确认 `3130/8130/9130/9131` 未占用。

当前 Web 容器仍是锁定 SHA 的**上游 Readest 基线镜像**。这个栈验证自托管部署、备份和回滚机制，不能据此宣称 Scholar 阅读位置修复已在 Linux 容器内验证。七个镜像均固定 Linux amd64 平台摘要；对象存储使用 Pigsty MinIO 兼容发行版，官方镜像可用性和供应链审核仍未完成。

## 首次启动

在非生产主机克隆本仓库的已审核主分支，然后在仓库根目录执行：

```bash
python3 infra/staging/prepare-env.py
docker compose --env-file docker/.env \
  -f docker/compose.yaml -f infra/staging/compose.yaml \
  config --format json | python3 -c 'import json,sys; c=json.load(sys.stdin); assert c["name"] == "scholar-staging"; assert all(p["host_ip"] == "127.0.0.1" for s in c["services"].values() for p in s.get("ports", []))'
docker compose --env-file docker/.env \
  -f docker/compose.yaml -f infra/staging/compose.yaml up -d
```

如果目标主机不能访问容器仓库，在一台能访问原始 registry 的受信机器上运行以下传输。`export-images.sh` 从 Compose 配置读取七个镜像，逐一拉取 Linux amd64 版本并与固定平台摘要比对；校验不通过时不会导出镜像。它只把镜像归档写入标准输出，不传输 `.env`。

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

停止服务使用相同的两个 `-f` 文件执行 `down`，不带 `-v`。删除 staging 卷或备份应单独检查其项目名与路径。
