# Readest Scholar 路线图

状态日期：2026-10-21。**Phase 0 已按单机合成基线验收；Phase 1 已按非生产工程底座范围验收，Phase 2 进行中。** [验收记录](docs/evidence/phase0/acceptance-2026-10-20.md)覆盖 Web、独立 macOS 客户端、自托管对象存储与同步、生产构建 AI 来源、Turso 数值契约、资源采样及 Node 24 全量测试（13,768 通过、16 跳过）。[PR #17](https://github.com/gkwfhv/readest-scholar/pull/17)发布双架构 GHCR 固定提交镜像和 CycloneDX SBOM，[PR #18](https://github.com/gkwfhv/readest-scholar/pull/18)加入摘要固定的 staging Web 升级与回退。Linux 测试主机已完成 Scholar 镜像升级、健康检查、故障回退及第二套空项目的备份冷恢复；升级后独立桌面端的新翻页已写入服务端，[Web→桌面的新同步](docs/evidence/phase1/web-to-desktop-progress-2026-10-20.md)也已在同一合成账户验证。测试环境的秘密文件防误提交门槛已建立，独立桌面测试包已[隔离上游更新渠道](docs/evidence/phase1/scholar-test-updater-isolation-2026-10-20.md)。用户批准的正式名称与 Bundle ID 已通过[未签名 macOS 本地包](docs/evidence/phase1/scholar-release-identity-2026-10-21.md)验证；独立协议的[书籍唤起本地实测](docs/evidence/phase1/scholar-deeplink-identity-2026-10-21.md)已完成。[Staging Web 合成 AI 交互](docs/evidence/phase1/staging-ai-smoke-2026-10-21.md)已验证模型连接、索引、来源列表和会话恢复；[自托管分享实际往返](docs/evidence/phase1/scholar-selfhosted-links-2026-10-21.md)已验证创建、本站落地页、预览、对象下载跳转和撤销。真实模型质量、Linux 主机模型运行、外部 HTTPS 分享、OAuth 提供方回跳及正式签名更新分发仍待验收。本状态不代表正式发布。

[PR #32 的 staging 验收](docs/evidence/phase1/scholar-web-build-brand-2026-10-21.md)进一步确认双架构 GHCR 发布、构建时 Scholar 品牌标记、`/library` 标题与 Web 安装清单；固定 amd64 摘要升级后四路健康通过，只有 Web 容器变化，合成分享预览与撤销复验通过。[正式身份 macOS 包的 staging 双向进度](docs/evidence/phase1/formal-desktop-staging-sync-2026-10-21.md)已通过合成账户验收；签名更新分发仍待完成。

[PR #34 的 staging 验收](docs/evidence/phase1/scholar-account-brand-staging-2026-10-21.md)确认登录、账户及书库菜单使用 Scholar 身份并移除上游付费/下载入口；新版摘要部署、四路健康、备份及浏览器中的侧栏四按钮布局均通过。外部回调/分享、真实模型与正式签名更新分发留作后续功能及发布门槛。

[独立测试包的签名更新往返](docs/evidence/phase1/scholar-updater-loopback-smoke-2026-10-21.md)已在本机回环环境完成 `0.12.16 → 0.12.17` 检测、下载、验签、替换和重启；一次性密钥未进入仓库。正式 Scholar 包的 Apple 签名/公证、公开 HTTPS 更新源及跨机器安装仍待验收。

[Phase 1 验收记录](docs/evidence/phase1/acceptance-2026-10-21.md)依据计划第 9 节将空栈、升级、备份恢复、CI/SBOM、测试秘密、回环更新和普通阅读列为非生产工程底座通过项；公开服务、真实模型、正式签名分发仍不可发布，也不阻塞 Phase 2 的本地文献管理开发。

Phase 2 已从[手动 DOI 元数据](docs/evidence/phase2/doi-metadata-2026-10-21.md)开始：Scholar 书籍详情可编辑和显示 DOI，沿用现有元数据保存路径。[隔离 staging 的双向同步实测](docs/evidence/phase2/doi-staging-bidirectional-2026-10-21.md)已验证 Web ↔ 服务端 ↔ macOS 的一次 DOI 修改往返，以及现有 `books` 记录的双账户读取隔离；[书库文本检索](docs/evidence/phase2/doi-search-2026-10-21.md)新增 DOI 和出版年份。[文献/文件身份迁移](docs/evidence/phase2/document-file-identity-2026-10-21.md)已在隔离 PostgreSQL 与 staging 中验证回填、复合外键、双账户 RLS 和 PostgREST 可见性。[新书自动文献映射](docs/evidence/phase2/document-auto-link-2026-10-21.md)已通过本地数据库行为测试和 staging 写入角色验收；实际 Web/桌面新书往返、新上传文件关系与客户端文献操作仍未接线。集合、去重、200+ 文献规模和更广的隔离/冲突场景尚未完成。

| 阶段 | 状态 | 依赖 | 完成判据 |
|---|---|---|---|
| 0 审计与可复现基线 | 已通过限定范围验收 | [验收记录](docs/evidence/phase0/acceptance-2026-10-20.md) | 单机合成数据、Web/独立 macOS/Silo 阅读同步及生产 AI 来源验证通过；跨平台、真实模型质量不在此结论内 |
| 1 工程底座 | 已通过限定范围验收 | Phase 0 签收 | 镜像/SBOM 发布、staging 摘要升级、健康、备份、冷恢复、回退、桌面→后端新进度写入及 Web→桌面新位置采用已实测；测试环境秘密文件受 CI 保护，独立桌面包已隔离上游更新；正式身份未签名 macOS 包、独立书籍协议、staging Web 合成 AI 和回环分享路径通过烟测，外部 HTTPS 分享、真实 OAuth、真实模型及正式签名更新分发作为后续功能和发布门槛保留 |
| 2 文献管理 | 进行中，DOI 与身份表 staging 已实测，身份表待客户端接入 | ADR 0001、0002，bookshelves 源码核对 | 文献/文件 ID 分离，200+ 测试文献导入管理，集合和元数据跨 Web/桌面同步，无跨账户数据泄露 |
| 3 同步与离线 | 未开始 | 不新做第二套协议 | 断网、重复提交、冲突都不丢数据 |
| 4 PDF 笔记 | 未开始 | 客户端坐标结构核对 | 缩放/旋转样本不漂移 |
| 5 AI 引用 | 未开始 | 现有 `ragService` | 页码可点，无证据拒答 |
| 6 pdf2zh Worker | 未开始 | 独立任务表 | 译文不覆盖原文，失败可取消可重试 |
| 7 跨平台 | 未开始 | Rust、签名凭据、真机 | 没有真机证据就标 experimental |
| 8 发布 | 未开始 | 人工授权 | 本文件不授权发布 |

Phase 4、5、6 只在协议和文件身份确定后并行。移动构建不能留到最后才第一次跑。
