# Linux staging 验收记录

日期：2026-10-20。用途：用户提供的非生产 Linux x86_64 主机，仅使用合成测试数据。主机地址、SSH 用户及私有测试凭据不写入仓库。无测试域名，所有 Web/API/对象端口只绑定 `127.0.0.1`，通过 SSH 隧道验收。以下只记录实际执行结果；未写明通过的步骤仍未通过。

## 部署前核对

- 主机：Docker `29.7.2`、Compose `5.5.0`、Python `3.14.4`，仓库克隆到用户独立目录。
- `3130/8130/9130/9131` 在启动前未占用；`scholar-staging` 项目此前没有容器或数据卷。
- `prepare-env.py` 在主机生成私有 `.env`，文件权限 `0600`。Compose 的项目名、回环端口及七个 Linux amd64 固定摘要均通过配置解析；`.env` 未提交或传输。主机原有 12 个运行容器的 ID 排序指纹在本次启动及回滚前后均为 `fe2fd61934cf9a5e51e187971120cfb642075a7408f962a3caac689db52bd30b`。
- `c2e55592a` 的 [Scholar baseline](https://github.com/gkwfhv/readest-scholar/actions/runs/39370880403)、[上游 PR checks](https://github.com/gkwfhv/readest-scholar/actions/runs/39370880228) 和 [CodeQL](https://github.com/gkwfhv/readest-scholar/actions/runs/39370880213) 已成功；后续提交需看各自新运行。

## 镜像获取事实

- 主机 Docker daemon 直接拉取 Docker Hub 时代理返回 EOF；`ghcr.io` 在主机无法解析。没有更改 daemon 的全局镜像代理。
- 官方 `crane v0.22.1` Linux x86_64 包按 GitHub 发布资产 SHA256 `0ab7a1d6932a213aed964ce97666c3077fe691c8606413674a8b3e0b9ec4cda0` 验证，只安装在用户目录。代理返回的 Linux amd64 摘要与 Compose 中固定值匹配才导入。
- Kong、Pigsty MinIO/mc、PostgREST、GoTrue 共五个 Docker Hub 镜像已按固定摘要导入。PostgreSQL 代理拉取曾在 HTTP/2 层传输错误后失败；改为从本机 Docker 拉取 `linux/amd64` 平台，并确认镜像 ID 是锁定的 `sha256:caae3d066f437332d593011e3e7ecf78ab005ce9b89378efd53f97f0410563ad`。以 `docker image save --platform linux/amd64 | gzip -1` 导出后，经可续传 SSH 复制；完整归档大小 `675722174` 字节，主机端 SHA256 验证为 `ca6802c08c5576302da45368aee0667bc65c46769451cea0b7f31c1c4e679261`，gzip 校验与 `docker image load` 成功。
- 上游 Readest Web 镜像已在本机校验 Linux amd64 摘要后导出。经可续传的 SSH 档案传输，主机 SHA256 与本机相同：`8c3912136f4c5296f58039662f6790348884cb44df180c647a783e29ed3ba1b8`。主机 `docker image load` 后以 `sha256:56a28e655e9d7afe788b398354f01be8feee8f15c09058d08bd165de95a62a43` 解析该镜像。
- 首启脚本在 `docker compose config --images` 读出的七个完整固定摘要上逐个 `docker image inspect`，全部通过，然后以 `up -d --pull never` 启动。

## 启动与故障修复

- 首次启动发现主机克隆时的 `umask 077` 使跟踪的静态 bind mount 成为 `0600`。PostgreSQL 初始化日志显示 `100-schema.sql: Permission denied`，Kong 无法读取 `temp.yml`；Auth/REST 随后因数据库角色密码未完成初始化而失败。未把首次 Web/对象路由的 200 误记为整栈通过。
- 以同一 Compose 项目执行 `down`（无 `-v`），逐个核对 `scholar-staging_db-data`、`scholar-staging_db-config` 的项目标签均为 `scholar-staging` 且是在本次空数据测试首次创建后，只删除这两个初始化失败的卷。仅将仓库里的静态 Kong/SQL/迁移文件及其目录改成容器用户可读的权限，`docker/.env` 仍是 `0600`；第二次启动脚本退出码 `0`。为此新增 `check-bind-mounts.py` 预检，临时目录的正反例实测分别退出 `0/1`。
- 第二次启动初期 REST 路由短暂返回 503，随后 `check-readiness.py` 的 Web、Auth via Kong、REST + database via Kong、对象存储四路均为 200。六个持续服务处于 `running`，数据库、Kong、MinIO 健康。经仅绑定本机回环地址的 SSH 隧道，Web `/`、Auth `/auth/v1/health`、对象 `/minio/health/live` 分别返回 200；浏览器加载了 Readest 书库界面。浏览器已有本地书籍缓存，其显示内容不作为远端数据库证据。

## 备份与 Web 回滚

- `bash infra/staging/rehearse-web-rollback.sh` 实际退出码 `0`。它先确认四路就绪，再生成快照 `20261020T051232Z`：备份根目录与快照目录权限均为 `0700`，`postgres.sql` 为 `198895` 字节，`postgres-restorable.sql` 为 `199389` 字节，GraphQL 包装函数文件为 `494` 字节，三份文件权限均为 `0600`；对象副本有 18 个文件，`STATUS=complete`。该远端快照尚未独立恢复；Phase 0 已在本机另一套完整服务栈验证过同类备份的恢复后登录和阅读。
- 故障注入将 `client` 进程改为立即退出，就绪探针如预期失败；恢复原 Compose 后，四路全部重新返回 200，SSH 隧道的 Web/Auth/对象 HTTP 再次均为 200。
- 回滚前后三个卷的创建时间不变：`db-data` 与 `db-config` 为 `2026-10-20T05:10:55Z`，`minio-data` 为 `2026-10-20T05:09:00Z`。原有 12 个非 staging 容器的 ID 排序指纹与启动前一致。主机可用内存从启动前约 `5.4 GiB` 降至演练后约 `4.1 GiB`，其余业务未被本次 Compose 项目替换。

本次 Web 容器为锁定的**上游 Readest 基线镜像**，仅验证部署基础设施。它不代表 Scholar 的 Web 改动已在 Linux 镜像中验证；Pigsty MinIO 兼容镜像也不等同于官方 MinIO 镜像验收。
