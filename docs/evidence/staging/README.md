# Linux staging 验收记录

日期：2026-10-20。用途：用户提供的非生产 Linux x86_64 主机，仅使用合成测试数据。主机地址、SSH 用户及私有测试凭据不写入仓库。无测试域名，所有 Web/API/对象端口只绑定 `127.0.0.1`，通过 SSH 隧道验收。以下是当前执行快照；未写明通过的步骤仍未通过。

## 部署前核对

- 主机：Docker `29.7.2`、Compose `5.5.0`、Python `3.14.4`，仓库克隆到用户独立目录。
- `3130/8130/9130/9131` 在启动前未占用；`scholar-staging` 项目此前没有容器或数据卷。
- `prepare-env.py` 在主机生成私有 `.env`，文件权限 `0600`。Compose 的项目名、回环端口及七个 Linux amd64 固定摘要均通过配置解析；`.env` 未提交或传输。
- `d2743fa39` 的 [Scholar baseline](https://github.com/gkwfhv/readest-scholar/actions/runs/39368774381)、[上游 PR checks](https://github.com/gkwfhv/readest-scholar/actions/runs/39368774318) 和 [CodeQL](https://github.com/gkwfhv/readest-scholar/actions/runs/39368774317) 已成功；后续提交需看各自新运行。

## 镜像获取事实

- 主机 Docker daemon 直接拉取 Docker Hub 时代理返回 EOF；`ghcr.io` 在主机无法解析。没有更改 daemon 的全局镜像代理。
- 官方 `crane v0.22.1` Linux x86_64 包按 GitHub 发布资产 SHA256 `0ab7a1d6932a213aed964ce97666c3077fe691c8606413674a8b3e0b9ec4cda0` 验证，只安装在用户目录。代理返回的 Linux amd64 摘要与 Compose 中固定值匹配才导入。
- Kong、Pigsty MinIO/mc、PostgREST、GoTrue 共五个 Docker Hub 镜像已按固定摘要导入；PostgreSQL 首次代理拉取在 HTTP/2 层传输错误后失败。当前使用层缓存及 HTTP/1 客户端设置重试；**数据库镜像尚未完成导入**。
- 上游 Readest Web 镜像已在本机校验 Linux amd64 摘要后导出。经可续传的 SSH 档案传输，主机 SHA256 与本机相同：`8c3912136f4c5296f58039662f6790348884cb44df180c647a783e29ed3ba1b8`。主机 `docker image load` 后以 `sha256:56a28e655e9d7afe788b398354f01be8feee8f15c09058d08bd165de95a62a43` 解析该镜像。

## 尚待验收

1. 完成 PostgreSQL 镜像导入，确认七个固定摘要都在主机可解析。
2. 以 `--pull never` 启动隔离栈，运行四路就绪探针；用 SSH 隧道检查 Web 页面。
3. 生成真实测试备份，运行 Web 故障注入与回滚，核对数据库和对象卷未被替换。
4. 记录实际退出码、服务状态、备份路径权限和已知局限，再决定是否合并 PR。

本次 Web 容器为锁定的**上游 Readest 基线镜像**，仅验证部署基础设施。它不代表 Scholar 的 Web 改动已在 Linux 镜像中验证；Pigsty MinIO 兼容镜像也不等同于官方 MinIO 镜像验收。
