# ADR 0003：Scholar 默认对象存储选择 Silo

- 状态：候选验证中
- 日期：2026-10-20
- 范围：Scholar 自托管 Compose；不改变 Readest 上游仓库

## 背景

锁定的 Readest 上游 Compose 使用 `quay.io/minio/minio` 和 `quay.io/minio/mc`。从空环境拉取返回 401；MinIO 官方说明社区版[改为源码分发](https://github.com/minio/minio#source-only-distribution)。原版镜像组合无法作为可复现的 Scholar 安装路径。Phase 0 曾在回环测试栈用历史 `pgsty/minio:RELEASE.2026-08-04T00-00-00Z` 完成账户、PDF 文件与同步及独立恢复；该历史镜像不能自动等同新发行版通过，见 [ADR 0002](0002-object-storage-staging-exception.md)。

## 选择

将 Scholar `docker/compose.yaml` 的 S3 服务改为维护中的 [Silo](https://github.com/pgsty/silo) `RELEASE.2026-10-18T00-00-00Z`，固定双架构 manifest list `sha256:2636fc4155d9a7e41ff58cdb65ddd13ba9304e67184e13c25bc5cb34016269d7`；桶初始化客户端固定 `pgsty/mc` 同日版本 `sha256:6ecdaec70bc5e8cf9d0e9a70c190f3beb1c83f11617ff4333f1fcd71ab1daf18`。Linux staging 和 macOS 本地覆盖文件另固定对应平台 manifest，以便导入时按平台比较内容摘要。服务、卷、环境变量和 S3 URL 保持原协议边界；以 `silo healthcheck ready` 作服务就绪检查。

Silo 继续使用 AGPL-3.0，包含原 MinIO 版权与 [NOTICE/CREDITS](https://github.com/pgsty/silo/blob/main/COMPLIANCE.md)。发布镜像、二次修改或网络提供服务时需按其许可材料履行对应义务；这里不将镜像作为本仓库的源码代码复制。发行方提供源码标签、SBOM、签名校验清单及构建证明；[2026-10-18 发行说明](https://github.com/pgsty/silo/releases/tag/RELEASE.2026-10-18T00-00-00Z)列出安全修复、升级条件和已验证范围。发行方测试不能替代 Scholar 的镜像扫描或应用验收。

## 升级与回退

1. 空数据安装直接用固定摘要的 Scholar Compose。四个发布端口应由部署环境限制为回环或受控网络；公网访问需要另行配置 TLS 和认证。
2. 旧 MinIO/`pgsty/minio` 数据卷先做完整的数据库、对象与 IAM 配置备份，并记录原镜像及源数据摘要。只在隔离卷副本上启动新 Silo，核对合成账户、旧对象 SHA256、新对象写读、Web/桌面书籍下载及同步，再安排正式停机迁移。
3. 这次发行说明明确“共享 IAM 后端的滚动降级不受支持”。出现问题时停止新进程，**从未升级的备份恢复到旧版本和独立卷**，核对对象哈希及账户；不在已升级卷上直接启动旧程序。单机验证不证明多节点滚动升级或跨站复制可用。
4. 任何新版本先在空卷和快照副本两轮验证，不使用浮动 `latest`，也不自动更新用户卷。数据库架构迁移另行演练。

## 验收门槛

本 ADR 在空栈启动、旧快照副本升级、对象哈希、独立冷恢复、合成账户登录与跨端同步、镜像摘要/许可证/SBOM 与安全扫描记录齐备后标为“接受”。目前只完成发行材料与镜像摘要核对，运行时结果及扫描尚待证据；不得将此候选配置标成已发布可用。
