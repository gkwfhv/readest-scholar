# ADR 0002：对象存储的 staging 例外

- 状态：已接受，仅适用于 Phase 0 测试；正式发布选型未定
- 日期：2026-10-20
- 关联：[Phase 0 验收](../evidence/phase0/acceptance-2026-10-20.md)、[本机 Compose 覆盖](../../infra/compose/silo-local-test.yaml)

## 背景

Readest 锁定的 Compose 引用 `quay.io/minio/minio` 与 `quay.io/minio/mc`。Phase 0 从空环境拉取原版镜像时返回 401，不能以“容器启动成功”证明原版组合可复现。MinIO 官方仓库已归档，并说明社区版改为源码分发。Pigsty 维护的 [Silo](https://github.com/pgsty/silo) 是 MinIO 的 S3 兼容分支，`pgsty/minio` 是其改名前的发布身份；本阶段使用的 `RELEASE.2026-08-04T00-00-00Z` 属于该历史发布线。镜像替换会改变供应链与升级路径。

## 决定

1. 允许在**空数据、回环端口、已授权 staging** 使用 `infra/compose/silo-local-test.yaml` 的固定摘要兼容镜像，验证账户、文件同步和备份恢复。该覆盖文件必须与 `localhost.yaml` 一起使用。
2. 在报告里把官方镜像 401 与兼容镜像验证分别记录；不得把后者记作原版 Compose 通过。正式自托管文档暂不把覆盖文件设为默认。
3. 生产选型前，比较可复现的官方源码构建、受维护的 Silo 发行线和其他 S3 兼容存储。候选必须完成许可复核、固定 digest/SBOM、漏洞检查、Readest 文件 API 兼容、已有数据升级、冷备恢复、回滚及跨端同步演练。
4. 当前测试镜像不自动升级到 Silo 新发行版。升级应在独立空数据栈先验证，再用快照副本验证数据格式与回退；不得在用户数据卷上直接试验。

## 验证及限制

- [本机 Phase 0 记录](../evidence/phase0/README.md)包含官方镜像失败、兼容镜像启动和同步；[隔离恢复演练](../evidence/phase0/selfhost-restore-rehearsal.md)证明测试快照能在第二套服务读取。Linux staging 也完成回环端口的容器启动与健康检查。
- 这些证据只覆盖 Readest 当前测试路径，不证明 S3 协议全面兼容或生产供应链安全。维护分支的后续版本与旧 `pgsty/minio` 镜像也不能混称为同一已验证产物。

## 后果

Phase 0 可以继续进行受限环境的同步与恢复验证，但原版官方镜像问题仍作为阻塞项记录。Phase 1 必须把生产对象存储、镜像来源和升级/回滚方案固定在另一份 ADR 后，才能把自托管发行物标为可发布。
