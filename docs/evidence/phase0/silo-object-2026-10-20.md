# Silo 对象存储隔离迁移验证（2026-10-20）

目标：验证 Scholar 默认自托管对象存储能从已记录的历史 MinIO 镜像迁移，并能从未升级的备份回退。本次只使用合成账户、仓库内两页测试 PDF 和 staging 快照；首次试验在独立 Compose 项目与数据卷中完成。

## 固定构件

- Silo：`docker.io/pgsty/silo:RELEASE.2026-10-18T00-00-00Z`，多架构摘要 `sha256:2636fc4155d9a7e41ff58cdb65ddd13ba9304e67184e13c25bc5cb34016269d7`；Linux amd64 子摘要 `sha256:706e0d419d23bdab663486044165fb4de1ee6b82885a8637b2935216fb2286ec`。
- mc：同日 `pgsty/mc` 多架构摘要 `sha256:6ecdaec70bc5e8cf9d0e9a70c190f3beb1c83f11617ff4333f1fcd71ab1daf18`；amd64 子摘要 `sha256:335da4ff7b78b646de8aa3fecd6cbaab975afdfa25554089639e3f2ba9199166`。
- 发行方提供[源代码、SBOM、签名材料及升级说明](https://github.com/pgsty/silo/releases/tag/RELEASE.2026-10-18T00-00-00Z)。许可边界见 [ADR 0003](../../adr/0003-silo-object-storage.md)。

## 隔离测试结果

1. 先对运行中的六服务 staging 栈执行 `infra/staging/backup.sh`，形成状态为 `complete` 的数据库、对象数据和配置快照。原服务保留运行，四个回环健康端点保持 HTTP 200。
2. 把对象数据快照复制到新命名卷，在仅加入 Docker 内网、无宿主端口的独立 Silo 容器启动。`silo healthcheck ready` 通过。旧测试 PDF 的 SHA256 与原文件相同；新对象上传后读回哈希相同，测试对象随后删除。
3. 从未升级的旧数据卷启动历史 MinIO 镜像，原 PDF SHA256 仍相同，进程随后停止。这验证从独立旧备份恢复的路径；**未尝试在已升级卷上直接降级**。
4. 使用独立 `scholar-restore-rehearsal` 六服务 Compose 栈恢复原合成数据库，叠加隔离 Silo 卷。数据库、API、客户端和对象服务均健康；四个回环端点返回 200。原合成账户登录、用户 ID、旧 PDF 对象哈希检查通过。
5. 运行 `SCHOLAR_ROOT=/home/gavin/readest-scholar-staging python3 infra/staging/verify-silo-web-storage.py` 的远端临时副本：同一账户通过 Web API 获取预签名上传 URL，上传合成 PDF，Web 文件列表可见，取得预签名下载 URL，下载内容 SHA256 与源文件相同。输出为 `Restored Web Auth, signed PDF upload, listing, and SHA256 download: OK`。
6. 停止隔离恢复栈，保留隔离卷供复查；再次检查原 staging 四个健康端点仍为 HTTP 200。正式 staging 的运行容器尚未切换到 Silo。
7. 再用第三个独立项目 `scholar-fresh-silo`、新数据库卷和新对象卷启动全套六服务。配置预检确认新容器名、卷、固定 Silo/mc 摘要及仅绑定 `127.0.0.1:3150/8150/9150/9151`；启动前这些卷、容器和端口均不存在。四个就绪路由均为 200，合成账户注册成功，预签名 PDF 上传、列表与下载 SHA256 检查再次通过。停止这个测试栈并保留其卷后，原 staging 四路仍为 200。

镜像由 Docker Hub 标签与固定摘要拉取到本机，经 `docker image save --platform linux/amd64` 得到 54 MiB 的传输包，传输前后 SHA256 都为 `a16f174a1f0e2aa2e7e94701519d72db5f56d6166fcd7229fa3af687047c8277`。远端导入后的 `docker image inspect` 报告 amd64、镜像 ID `sha256:706e0d419d23bdab663486044165fb4de1ee6b82885a8637b2935216fb2286ec`；归档内镜像配置摘要为 `sha256:c676f34789e6598af571b590a782499df279d0d1cca41600752826634420d0bb`，发行修订标签为 `0cd388c666f8211f552604ae73448a066e9c25ce`。两处元数据的 ID 表示不同对象，不以两者相等作为校验条件。

## 安全扫描

使用固定的 Trivy 0.74.0 容器对上述 amd64 传输包执行 `trivy image --input /image.tar --severity HIGH,CRITICAL --format json`，从 `ghcr.io/aquasecurity/trivy-db:2` 获取当天漏洞库。报告 SHA256 为 `6a0a5b0c1648d7ec8a53168fe6cf0f87c215a5700608e57fdc61b6b2b4c2763a`，结果为 **0 CRITICAL、1 HIGH**：`CVE-2026-39414`，组件标为 `github.com/minio/minio`，扫描器无可识别的修复版本。不能把该扫描写成零漏洞。

该告警按原 MinIO 模块版本范围匹配；[Silo 自身的修复记录](https://silo.pgsty.com/blog/security/cve-2026-39414/)说明 2026-06-18 版本完成二轮修复，移除绕过 1 MiB 记录限制的 SIMD JSON 路径。GitHub 比较 API `pgsty/silo/compare/fd69c89...RELEASE.2026-10-18T00-00-00Z` 返回 `ahead`、`behind_by=0`，确认本次固定的发行标签在该完成修复提交之后。仓库因此记录此项为**有来源代码继承证据的扫描器误报**，而非静默忽略；后续升级须重新扫描，若安全公告或功能回归改变，撤销此判定。这个判断不替代对其他未发现漏洞的保证。

## 范围与剩余门槛

隔离演练证明旧对象读回、Web 文件路径、空卷首次启动和快照回退可行；尚需正式 staging 切换后桌面上传/Web 下载和反向同步。多节点滚动升级、真实账户数据与正式域名不在本次范围内。资源采样见[活跃负载基线](staging-resource-active-2026-10-20.md)。
