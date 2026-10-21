# Phase 1 工程底座验收（2026-10-21）

**结论：按工程计划第 9 节的非生产工程底座范围通过。** 审查基线为 Scholar `main` 的 `49eb1e55d04bf1bff3a8afc28492522dc21c4555`。这允许启动 Phase 2 文献管理，不代表正式安装包、公开服务或真实模型已可发布。PR #35 和 #36 在已部署的 PR #34 后只更改文档；staging 运行时仍对应 `dbbf7befb`。

| 计划项目 | 验收结果 | 可复核证据与边界 |
| --- | --- | --- |
| 品牌、包名与 Bundle ID | 通过 | 用户批准 `Readest Scholar` 与 `io.github.gkwfhv.readestscholar`；[正式身份本地包](scholar-release-identity-2026-10-21.md)及[独立书籍协议](scholar-deeplink-identity-2026-10-21.md)实测。包未做 Apple 代码签名。 |
| 环境、空栈启动与健康 | 通过（合成 staging） | [首次部署](../staging/README.md)和[镜像升级](staging-web-rollout-2026-10-20.md)记录六服务隔离栈。2026-10-21 再在用户授权的测试主机运行 `python3 infra/staging/check-readiness.py`：Web、Kong/Auth、Kong/REST+数据库、对象存储全部 `OK`；Web 镜像 ID 为 `sha256:b86caf24cf8b88329edd13010c809b58b1ef7dcc4f9ba7db0a39d5fb9e56d4aa`。裸请求 REST 返回 401 属于缺少认证头；正式探针携带测试栈公开 anon key 后通过。 |
| 升级、备份、回退与冷恢复 | 通过（合成数据） | [首次 Scholar 镜像升级与故障回退](staging-web-rollout-2026-10-20.md)及[独立空项目恢复](../staging/README.md)记录固定摘要升级、完整备份、故障注入、四路恢复、数据库/对象在第二栈恢复及 PDF 哈希核对。[最新版 Web 升级](scholar-account-brand-staging-2026-10-21.md)再次完成升级前备份和四路健康；它没有再次做冷恢复，不把旧演练冒充新快照恢复。数据库破坏性迁移仍需逐次单独演练。 |
| CI 质量闸门、产物与 SBOM | 通过 | `main` 受保护，Scholar baseline、PR checks、CodeQL 检查已配置。[PR #36 最终提交](https://github.com/gkwfhv/readest-scholar/pull/36) `7066f0b205da99571ca2d77fa12d231c5171cd84` 的三组 Actions 运行分别为 [Scholar baseline](https://github.com/gkwfhv/readest-scholar/actions/runs/39581912406)、[PR checks](https://github.com/gkwfhv/readest-scholar/actions/runs/39581912479)、[CodeQL](https://github.com/gkwfhv/readest-scholar/actions/runs/39581912532)，结论均为 `success`。[GHCR 运行](https://github.com/gkwfhv/readest-scholar/actions/runs/39570710278)发布 amd64/arm64 和逐平台 SBOM。合并提交本身未另列一组 Actions 运行。 |
| 测试秘密管理 | 通过（非生产范围） | 随机合成凭据保存在测试主机被 Git 忽略的 `0600` `.env`；CI 拒绝被跟踪的私有 Compose 环境文件。备份目录为 `0700`。真实生产秘密的托管、轮换和灾备不在本次验收。 |
| 自动更新分发测试 | 通过（独立回环测试包） | [一次性密钥的 macOS `0.12.16 → 0.12.17` 往返](scholar-updater-loopback-smoke-2026-10-21.md)实测检测、下载、验签、替换和重启，篡改归档被拒绝；私钥已删除。正式 Scholar 包仍禁用更新端点，Apple 签名/公证、公开 HTTPS 和跨机器安装未通过。 |
| 普通阅读与同步不回退 | 通过（已测路径） | [最新版 staging 界面及 PDF](scholar-account-brand-staging-2026-10-21.md)、[正式身份桌面包双向进度](formal-desktop-staging-sync-2026-10-21.md)、[Web→桌面进度](web-to-desktop-progress-2026-10-20.md)记录合成 PDF 阅读和同步；PR #34 的定向测试、Node 24 构建及最终提交三组 CI 通过。未把旧 Readest 品牌包的所有设备和书籍格式逐一做手工回归。 |

## 留到后续阶段的发布与功能门槛

- Phase 5：在真实论文集与真实模型上验证引用准确性、无依据拒答、账户隔离及模型密钥处理。当前确定性模型仅证明链路可运行。
- Phase 7：其他桌面/移动平台安装、UI、同步与资源验证。
- Phase 8 前的公开服务联调：配置可达 HTTPS 域名，实测分享收件人、OAuth 提供方回跳和应用唤起。当前测试主机只允许 SSH 隧道访问。
- Phase 8：正式 Scholar 包的 Apple 签名/公证、HTTPS 更新源、跨机器安装、更新失败恢复、发布审批及生产秘密策略。本次回环测试包不能替代这些证据。

Phase 2 的首个变更不得复用本次合成账户或修改既有生产数据；文献 ID、文件 ID 和元数据同步仍须单独设计、测试和验收。
