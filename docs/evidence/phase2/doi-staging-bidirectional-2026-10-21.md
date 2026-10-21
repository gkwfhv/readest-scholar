# Phase 2 DOI：staging 双向同步验收

- 日期：2026-10-21
- 测试环境：隔离 Linux staging，Web 经 SSH 隧道访问；macOS 未签名测试包使用独立 `io.github.gkwfhv.readestscholar` 身份和同一隧道。仅使用新建的合成测试账户与已有测试 PDF。
- 范围：验证 [手动 DOI 功能](doi-metadata-2026-10-21.md)在现有 `books.metadata` 路径上跨 Web、服务端和 macOS 客户端同步，以及该记录的跨账户读取隔离。未改生产环境。

## 部署与就绪

1. GitHub Actions 为合并提交 `5183c3284f0c0f34d56c55aa37e374c04da35bfe` 构建了 GHCR Web 镜像；`amd64` 镜像摘要为 `sha256:a2025ee6f93c86cbbe91f54f459d774f80005b9d144fefd85dee914930643f48`。在本地与测试主机上核对导入镜像 ID 均等于此摘要。
2. 测试主机无法直接连接 GitHub，因此传输已校验 SHA-256 的增量 Git bundle 与该摘要的 Docker 归档，快进主机源码至 `5183c32`。使用 `SCHOLAR_STAGING_DEPLOY_CONFIRM=yes bash infra/staging/deploy-web.sh ghcr.io/gkwfhv/readest@sha256:a2025ee6f93c86cbbe91f54f459d774f80005b9d144fefd85dee914930643f48` 更新 Web。
3. 部署脚本部署前生成完整备份，`STATUS=complete`，路径为 `~/scholar-staging-backups/20261021T114855Z`；此次备份未再做冷恢复演练，Phase 1 的恢复演练另有记录。部署后和本次验收末尾运行 `python3 infra/staging/check-readiness.py`，Web、Auth、REST/数据库、对象存储四项均为 `OK`；六个 compose 服务均处于 `running`，数据库、Kong、MinIO 为 `healthy`。

## 实测步骤和结果

1. 在 Web 登录全新合成账户，编辑已有测试 PDF 的 DOI 为 `10.1234/readest-scholar-phase2-20261021`。Web 详情显示该值；使用同账户令牌读取 PostgREST `books.metadata`，该 DOI 与非空 `metadata_updated_at` 同时存在。
2. 在本地编译的 macOS Scholar 测试包登录同一账户。书库出现两本已同步书籍；打开目标 PDF 的详情，DOI 显示与 Web 一致。曾短暂遇到书架空白，随后 UI 刷新后正常显示；尚未获得稳定复现步骤，不能据此认定是代码缺陷。[桌面截图](doi-desktop-staging-2026-10-21.png)。
3. 在桌面详情编辑 DOI，加上 `-desktop` 后缀并保存。桌面详情立即显示新值；返回书库后服务端 `books.metadata` 更新为同一值。Web 刷新书库并重开详情后显示新值。[Web 截图](doi-web-staging-2026-10-21.png)。既有同步并非实时推送到已打开的详情弹窗，验收时需刷新书库。
4. 通过 Auth 创建第二个独立合成账户，使用其令牌查询 `books` 列表与第一账户目标 `book_hash`：均返回 0 行；第一账户查询到 2 行，其中 1 行包含 DOI。这证明此记录的读取受当前 `books` RLS 隔离；写入越权、未来新表、批量数据的隔离仍需单独验收。

## 判定与边界

**该 DOI 功能的 Web ↔ 服务端 ↔ macOS 桌面双向元数据同步，以及一条现有 `books` 记录的跨账户读取隔离通过。** 本次只涉及 2 本测试书、1 次双向修改、2 个合成账户；没有覆盖 200+ 文献、并发冲突、断网重试、集合/标签、独立文献 ID 或各平台安装包。Phase 2 整体验收仍未通过。
