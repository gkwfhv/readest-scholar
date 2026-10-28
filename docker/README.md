# 使用 Docker/Podman Compose 自托管

## 服务组成

| 服务 | 镜像 | 说明 |
| --- | --- | --- |
| **client** | `ghcr.io/gkwfhv/readest-scholar` | Readest Scholar Web 客户端 |
| **db** | `supabase/postgres` | 带 Supabase 扩展的 PostgreSQL 数据库 |
| **kong** | `kong:2.8.1` | 将请求路由到 Supabase 服务的 API 网关 |
| **auth** | `supabase/gotrue:v2.185.0` | 认证服务（邮箱、JWT） |
| **rest** | `postgrest/postgrest:v14.3` | PostgreSQL REST API |
| **minio** | 固定版本的 `pgsty/silo` | 兼容 S3 的对象存储 |
| **minio-setup** | 固定版本的 `pgsty/mc` | 创建 S3 存储桶的辅助容器 |

### 对外端口

| 端口 | 服务 |
| --- | --- |
| `3000` | Readest Scholar |
| `8000` | Kong API 网关 |
| `9000` | MinIO S3 API |
| `9001` | MinIO 控制台 |

---

## 使用 Docker/Podman Compose 运行

### 1. 创建 `.env`

```bash
cp docker/.env.example docker/.env
```

编辑 `docker/.env`：

- 将 `POSTGRES_PASSWORD` 和 `MINIO_ROOT_PASSWORD` 替换为高强度密码（至少 32 个字符）。
- 将 `JWT_SECRET` 替换为随机密钥（至少 32 个字符）。
- 使用 `JWT_SECRET` 生成 HS256 签名的 `ANON_KEY` 和 `SERVICE_ROLE_KEY` JWT（可使用 [jwt.io](https://jwt.io/) 或同类工具）：
  - `ANON_KEY` 载荷：`{"role": "anon"}`
  - `SERVICE_ROLE_KEY` 载荷：`{"role": "service_role"}`

Scholar 采用持续维护的 [Silo](https://github.com/pgsty/silo) 发行版，因为旧的
`quay.io/minio/*` 社区镜像已无法拉取。Silo 和客户端镜像均以多架构清单摘要固定在
`compose.yaml` 中。Silo 使用 AGPL-3.0 许可证；重新分发镜像或通过网络提供修改后的服务前，
请阅读其[合规说明](https://github.com/pgsty/silo/blob/main/COMPLIANCE.md)。

### 2. 启动服务栈（拉取预构建客户端镜像）

在 `docker/` 目录执行：

```bash
cd docker
docker compose up -d
```

此命令会拉取 `${READEST_IMAGE}`，默认值是已验证的
`ghcr.io/gkwfhv/readest-scholar` 多架构摘要，而不会在本地构建客户端。默认摘要同时记录在
`docker/.env.example`；发布新的 Scholar 镜像时，请同时更新两处。
`ghcr.io/gkwfhv/readest-scholar:main` 是用于尝试最新 Web 构建的浮动标签；固定摘要可让
Compose 部署保持可复现。

Web 客户端从运行时容器环境读取 `SUPABASE_PUBLIC_URL`、`SUPABASE_ANON_KEY`、
`API_BASE_URL`、`OBJECT_STORAGE_TYPE`、`SELF_HOSTED`、`STORAGE_FIXED_QUOTA` 和
`TRANSLATION_FIXED_QUOTA`，因此拉取的镜像可以使用自托管环境中的自定义值。

`SELF_HOSTED` 会为已登录和未登录用户启用全部高级功能，包括第三方云同步
（WebDAV、Google Drive、S3、OneDrive）、离线朗读下载和 Send to Readest。镜像默认将它设为
`true`，即使旧版 `compose.yaml` 没有该变量，拉取的镜像也会解锁。只有在运营销售套餐的
托管服务时，才应在 `docker/.env` 中设置 `SELF_HOSTED=false`。

如需使用 Docker Hub 镜像，请在 `docker/.env` 中设置 `READEST_IMAGE`，例如：

```env
READEST_IMAGE=docker.io/your-dockerhub-username/readest-scholar:latest
```

请将 `your-dockerhub-username` 替换为发布兼容镜像的 Docker Hub 命名空间。官方镜像应使用
本仓库 Docker Hub 发布密钥所配置的命名空间。

`.github/workflows/docker-image.yml` 当前发布的 Scholar 标签：

- `main`：默认分支的浮动镜像。
- `sha-<commit>`：由对应提交构建的镜像。

生产环境请使用已验证的 `@sha256:<manifest digest>` 固定版本。即使 `docker/.env` 不变，
`main` 标签仍可能向前移动。

### 在本地构建，而非拉取镜像

> **本地构建前提**：构建前必须初始化 `packages/foliate-js` 和
> `packages/simplecc-wasm` Git 子模块：
>
> ```bash
> git submodule update --init packages/foliate-js packages/simplecc-wasm
> ```
>
> GitHub Codespaces 会通过 `.devcontainer/devcontainer.json` 自动完成此步骤。

```bash
cd docker
docker compose -f compose.yaml -f compose.build.yaml up --build -d
```

### 3. 访问服务

- Readest Scholar：`http://localhost:3000`
- MinIO 控制台：`http://localhost:9001`（使用 `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` 登录）

### 升级已有部署

**对象存储迁移：** 对于已有 MinIO 或早期 `pgsty/minio` 数据卷，必须先备份数据，再将其恢复到
隔离的、使用新镜像的服务栈中，之后才能修改正在运行的服务。请验证账户登录、对象哈希、图书下载，
并能从未改动的快照回滚。Silo 当前版本不支持对共享 IAM 后端进行滚动降级；对于既有数据卷，
`docker compose pull && up -d` 不是安全的迁移方式。
[Scholar 决策记录](../docs/adr/0003-silo-object-storage.md)说明了已测试的边界和回滚流程。

已使用此固定 Silo 版本的部署，可以按以下步骤只升级客户端。拉取较新的客户端镜像不会触及数据库卷，
且首次启动钩子仅在数据库卷为空时执行。因此升级后请手动应用新增迁移：

```bash
cd docker
docker compose pull client
docker compose up -d --no-deps client
docker compose exec db /docker-entrypoint-initdb.d/zz-readest-migrations.sh
```

该脚本会将已应用内容记录在 `readest_meta.migrations`，并在下次跳过它们，因此每次升级后
重复执行也是安全的。如果之前曾手动修改数据库，脚本可能因 `already exists` 错误停止。请先将
该文件记为已应用，然后再次运行脚本：

```bash
docker compose exec db psql -U supabase_admin -c \
  "INSERT INTO readest_meta.migrations (name) VALUES ('002_add_book_shares.sql') ON CONFLICT DO NOTHING"
```

### 热重载（开发环境）

> **前提**：必须先初始化子模块（见上文）。

若要使用 Compose 服务栈进行开发，请使用 `compose.dev.yaml`。它会将构建目标设为
`development-stage`（Next.js 开发服务器），并挂载本地仓库以支持热重载：

```bash
cd docker
docker compose -f compose.yaml -f compose.dev.yaml up --build -d
```

第一个挂载会将本地仓库覆盖到容器中。其余匿名卷会遮蔽镜像中预构建的目录，因此容器会使用已安装的
依赖和供应商资源，而不是主机上的同名目录。

### 停止服务栈

```bash
cd docker
docker compose down
```

如需同时删除卷（数据库和对象存储数据）：

```bash
cd docker
docker compose down -v
```

---

## 数据库结构

| 路径 | 作用 |
| --- | --- |
| `volumes/db/init/schema.sql` | 基础结构（图书、`book_configs`、`book_notes`、文件） |
| `volumes/db/migrations/*.sql` | 此后的每项结构变更，按文件名顺序应用 |
| `volumes/db/apply-migrations.sh` | 应用迁移并记录到 `readest_meta.migrations` |

空数据库卷启动时，Supabase 镜像会按 glob 顺序执行 `/docker-entrypoint-initdb.d` 下的内容：
先运行它的 `migrate.sh`（Supabase 核心结构与 `init-scripts/100-schema.sql`，即
`schema.sql`），再运行 `zz-readest-migrations.sh`，后者即
`apply-migrations.sh`。它会匹配挂载的迁移目录，因此新增迁移文件时不需要修改 Compose 配置。

---

## 使用自定义域名提供服务

浏览器会直接访问下列三个服务，因此每项都需要一个能从 Docker 网络外解析的 URL：

| 变量 | 浏览器用途 |
| --- | --- |
| `SITE_URL` | Readest 客户端自身 |
| `SUPABASE_PUBLIC_URL` | Kong，路由 `/auth/v1/…` 与 `/rest/v1/…` |
| `S3_PUBLIC_ENDPOINT` | MinIO，通过路径风格的预签名 URL 访问 |

`SUPABASE_PUBLIC_URL` 和 `S3_PUBLIC_ENDPOINT` 默认值为
`http://${HOST_IP}:<port>`，适用于直接使用 IP 和端口的部署；可在 `docker/.env` 中覆盖。
将所有服务置于同一来源也意味着不会产生跨来源请求：

```env
HOST_IP=your-domain.com
SITE_URL=https://your-domain.com
API_EXTERNAL_URL=https://your-domain.com
ADDITIONAL_REDIRECT_URLS=https://your-domain.com/**
SUPABASE_PUBLIC_URL=https://your-domain.com
S3_PUBLIC_ENDPOINT=https://your-domain.com
```

`nginx.conf.example` 提供了在服务栈前终止 TLS 的可用起点。其中有两点容易遗漏：必须让
`Host` 请求头原样传递给 MinIO，否则预签名校验会失败；同时必须提高存储桶路径的请求体大小
限制，否则大型图书上传会被截断。

### 自定义域名上的中日韩字体

阅读器会从 Readest CDN 加载少量中日韩 Web 字体包。该 CDN 仅为 readest.com 来源发送
`Access-Control-Allow-Origin`，因此浏览器会在自托管域名上阻止这些字体。请将
`https://storage.readest.com/public/font/dist/<Family>/` 及其引用的 `.woff2` 文件镜像到
代理服务器提供的路径，再让客户端使用该位置：

```env
FONT_BASE_URL=https://your-domain.com/fonts
```

保留空的 `FONT_BASE_URL` 会继续使用默认 CDN。系统字体和 Google 字体不会受影响。

---

## 单独构建 Dockerfile

```bash
docker build \
  --target production-stage \
  --build-arg NEXT_PUBLIC_APP_PLATFORM=web \
  -t readest-client \
  .
```

运行构建好的镜像：

```bash
docker run -p 3000:3000 \
  -e SUPABASE_URL=http://host.docker.internal:8000 \
  -e SUPABASE_PUBLIC_URL=http://localhost:8000 \
  -e SUPABASE_ANON_KEY=<anon-key> \
  -e SUPABASE_ADMIN_KEY=<service-role-key> \
  -e API_BASE_URL=http://localhost:3000 \
  -e OBJECT_STORAGE_TYPE=s3 \
  -e S3_ENDPOINT=http://host.docker.internal:9000 \
  -e S3_PUBLIC_ENDPOINT=http://localhost:9000 \
  -e S3_REGION=us-east-1 \
  -e S3_BUCKET_NAME=readest-files \
  -e S3_ACCESS_KEY_ID=<minio-user> \
  -e S3_SECRET_ACCESS_KEY=<minio-password> \
  -e STORAGE_FIXED_QUOTA=1073741824 \
  -e TRANSLATION_FIXED_QUOTA=50000 \
  readest-client
```

在 Linux 上，部分 Docker 配置默认无法解析 `host.docker.internal`。遇到此情况时，请改用
主机 IP，或增加：`--add-host=host.docker.internal:host-gateway`。
