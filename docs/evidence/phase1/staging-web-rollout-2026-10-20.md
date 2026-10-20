# Phase 1：Scholar Web 镜像首次 staging 升级（2026-10-20）

范围：用户授权的 `gavin@47.101.222.165:10027` 非生产 Linux 主机；`scholar-staging` 六服务 Compose 项目只在主机回环端口监听，本机通过 SSH 隧道访问。只使用既有合成账户和仓库两页 PDF，不使用真实用户数据、正式域名或签名密钥。

## 构件与 CI

- [PR #17](https://github.com/gkwfhv/readest-scholar/pull/17) 在最终提交 `e32d3de4359fb9c0faab714ecd19637414f44e1d` 的 Scholar baseline、PR checks、CodeQL 均通过，合并为 `fe25bd8cf5b4b55bbfe20c9f85b09f77c516f097`。
- [镜像发布运行 #39420990832](https://github.com/gkwfhv/readest-scholar/actions/runs/39420990832)的 Linux amd64、arm64、manifest 合并任务均成功；两个平台各有 CycloneDX 镜像 SBOM 工件。`main` 与 `sha-fe25bd8` 指向相同多架构摘要 `sha256:0df09a23eb7c8b18da9252d13ef1ec340e32f09257c49267a7b3e555120af931`。amd64 子摘要为 `sha256:141ac3b06f2df2240addeb94006a24c3e81631a2bc257c8d7850058ea38a4151`，arm64 为 `sha256:2aa89b34d02169472c46787d3cc35ded3088d287f7dc77ca1e40753af6434d06`。没有创建 `latest` 标签。
- [PR #18](https://github.com/gkwfhv/readest-scholar/pull/18)的最终提交 `cd7c6f32dfa1cc170b0322a800a75249f35ecb87` 同样通过三组检查并合并为 `21e520b2d1c18e72465b3b613c9e547cbddc482a`。部署脚本只接受本 fork 的完整仓库摘要，先检查项目和健康、备份，再仅更新 Web；失败时恢复前一镜像。

## 固定摘要转运

测试主机的 DNS 无法解析 `ghcr.io`，但通过临时指定公网 IP 的只读 HTTPS 探针可到达 registry。本机 Docker 拉取上述 amd64 平台摘要后，`docker image inspect` 报镜像 ID 与平台摘要一致。`docker image save --platform linux/amd64` 经 gzip 生成 **138,250,779 字节**归档；本机与主机的 SHA256 均为 `e6267df8b1bd13e9a1891552e6b6b60c5f343a9e1427e58e076a130066f21ea6`，主机 `gzip -t` 通过。归档通过 SSH/rsync 续传，未包含私有 `.env`。

主机 `docker image load` 报 `sha256:141ac3b06f2df2240addeb94006a24c3e81631a2bc257c8d7850058ea38a4151`。载入后按该 ID 贴 `ghcr.io/gkwfhv/readest:sha-fe25bd8` 标签；`docker image inspect ghcr.io/gkwfhv/readest@sha256:141ac3b06f2df2240addeb94006a24c3e81631a2bc257c8d7850058ea38a4151` 随后成功，`RepoDigests` 和 `.Id` 都指向这个平台摘要。临时回环代理下载路径速度低于续传归档，已停止，不作为验收输入。

为使该回退路径可复现，`export-images.sh` 新增严格的 Scholar Web 平台摘要覆盖参数。对已缓存的真实 amd64 镜像执行导出，先核对镜像 ID 等于平台摘要，再生成可通过 `gzip -t` 的 OCI 归档；归档 `index.json` 的第一个清单摘要同为 `sha256:141ac3b06f2df2240addeb94006a24c3e81631a2bc257c8d7850058ea38a4151`。错误的镜像引用在导出前被拒绝。

## 升级与实际烟测

主机干净 checkout 从 `05e9464a7c755bc872fd4a488f315855d18efb6b` 快进到 `21e520b2d1c18e72465b3b613c9e547cbddc482a`；更新前后四路健康均为 HTTP 200。运行：

```bash
SCHOLAR_STAGING_DEPLOY_CONFIRM=yes bash infra/staging/deploy-web.sh \
  ghcr.io/gkwfhv/readest@sha256:141ac3b06f2df2240addeb94006a24c3e81631a2bc257c8d7850058ea38a4151
```

脚本在切换前生成 `20261020T124539Z` 快照，`STATUS=complete`，`postgres-restorable.sql` 非空且对象目录存在；候选本地摘要被识别，未尝试 DNS 失败的远程拉取。只重建 `scholar-staging-client`，镜像 ID 为上述平台摘要，`org.opencontainers.image.revision` 为 `fe25bd8cf5b4b55bbfe20c9f85b09f77c516f097`，私有 `docker/.env` 仍为 `0600`。原五个非 Web 容器 ID 保持不变：auth `b389a8357cb3`、db `91ef7c962cd1`、kong `452374bb5638`、minio `5f198c232aa4`、rest `5436a7e57610`；Web 从 `995674ce3f25` 更换。Web、Auth、REST/DB、S3 四路健康均通过。

`SCHOLAR_ENV_FILE="$PWD/docker/.env" python3 infra/staging/verify-silo-web-storage.py` 在同一合成账户完成登录、Web 预签名 PDF 上传、文件列表与下载，并比对源文件和读回文件 SHA256，输出 `Restored Web Auth, signed PDF upload, listing, and SHA256 download: OK`。通过 SSH 隧道打开新 Web 镜像中的两页 PDF，实际显示 `1 / 2`，点击下一页后显示 `2 / 2` 与 `7. PAGE NUMBERING`。隔离标识的 macOS 测试客户端也重新打开同一 PDF，在第 2 页正常渲染；底部目录、笔记、书签、大脑聊天四入口同一行，脑图标完整位于侧栏内。桌面端该页位置在本次操作前已存在，**不能把这次打开记作升级后的跨端进度同步新证据**。

解锁后的独立客户端补查：点击底部大脑按钮，侧栏切换到 `Chat about Author…` 和“新对话”；聊天按钮高亮，四个入口仍同一行、未超出约 480 物理像素的侧栏边界。该测试客户端在 PDF 第 2 页、侧栏打开且已运行约 2 小时 31 分时，macOS `ps` 的单次采样为 CPU `0.0%`、RSS `56,976 KiB`。这是空闲瞬时值，不代表持续同步或模型生成时的峰值。

再用同一个已登录的独立客户端做**升级后的新进度写入**：从第 2/2 页点击上一页，辅助功能树显示第 1/2 页及 `TITLE OF THE PAPER`；测试主机的 `public.book_configs` 只读查询随后给出 `progress="[1,2]"`、`location=epubcfi(/6/2)`、`updated_at=2026-10-20 13:13:10.94 UTC`。点击下一页恢复第 2/2 页后，服务端记录变为 `progress="[2,2]"`、`location=epubcfi(/6/4)`、`updated_at=2026-10-20 13:14:00.276 UTC`。这证明这次独立桌面客户端的两次翻页实际写入了升级后的 staging 后端。操作期间对该客户端进程采集 18 个 `ps` 样点，观察到的最高 `%cpu` 为 **7.3**、最高 RSS 为 **72,704 KiB**（约 **71.0 MiB**）；这是一次短时采样，不是峰值上限。Web 此时未登录，因此没有把本次记录当作 Web→桌面的新同步证明。

## 故障回退与冷恢复

运行 `bash infra/staging/rehearse-web-rollback.sh` 创建另一个完整快照 `20261020T124851Z`，给 Web 注入立即退出进程；四路检查检测到 Web 故障。脚本按现有 Compose 配置重建 Web 后四路均恢复 200，最终 Web 镜像仍为 `sha256:141ac3b06f2df2240addeb94006a24c3e81631a2bc257c8d7850058ea38a4151`，上述五个非 Web 容器 ID 未变。它证明 Web 容器故障回退，不证明数据库破坏性迁移可自动撤销。

对升级前的新快照 `20261020T124539Z`，再建 `scholar-phase1-restore` 独立项目；创建前该项目没有容器或卷，`3140/8140/9140/9141` 四个端口空闲，主机可用内存约 4.7 GiB。`docker/.env.phase1` 从合成 staging 凭据创建且为 `0600`。Compose 配置预检核对了独立项目名、六个容器名、三个命名卷、回环端口和 Scholar Web 平台摘要；旧的 `scholar-restore-rehearsal` 容器与卷保留不动。

只创建新对象容器和空卷，把快照的对象目录复制进 `scholar-phase1-restore_minio-data`；只启动新 db，并确认基础 `public.books` schema 存在。另建空库 `scholar_staging_restored`，使用 `psql -v ON_ERROR_STOP=1` 导入 `postgres-restorable.sql`，无 SQL 错误。启动其余服务后，Web、Auth、REST/DB、S3 四路均返回 200；原合成账户登录及 user ID 相同，旧 PDF 对象 SHA256 与仓库源文件相同。恢复栈的新 Scholar Web 再次完成预签名 PDF 上传、列表和下载 SHA256。完成后停止独立容器、保留三个恢复卷；原 staging 四路仍为 200，非 Web 容器 ID 均未变化。

这些测试满足单机合成栈的空环境启动、升级、备份、回退及冷恢复路径，也新增了升级后桌面→后端的阅读进度写入证据。Web→桌面的新同步、Linux staging AI 模型交互、真实用户数据、外部 TLS 与正式安装包更新分发尚未验收，因此 Phase 1 还未整体完成。
