# Readest Scholar 路线图

状态日期：2026-10-20。**Phase 0 已按单机合成基线验收；Phase 1 进行中。** [验收记录](docs/evidence/phase0/acceptance-2026-10-20.md)覆盖 Web、独立 macOS 客户端、自托管对象存储与同步、生产构建 AI 来源、Turso 数值契约、资源采样及 Node 24 全量测试（13,768 通过、16 跳过）。[PR #17](https://github.com/gkwfhv/readest-scholar/pull/17)发布双架构 GHCR 固定提交镜像和 CycloneDX SBOM，[PR #18](https://github.com/gkwfhv/readest-scholar/pull/18)加入摘要固定的 staging Web 升级与回退。Linux 测试主机已完成 Scholar 镜像升级、健康检查、故障回退及第二套空项目的备份冷恢复；升级后独立桌面端的新翻页也已写入服务端，见 [执行证据](docs/evidence/phase1/staging-web-rollout-2026-10-20.md)。测试环境的秘密文件防误提交门槛已建立，独立桌面测试包已[隔离上游更新渠道](docs/evidence/phase1/scholar-test-updater-isolation-2026-10-20.md)；Web→桌面的新同步、正式签名更新分发及 staging AI 交互仍待验收。本状态不代表正式发布。

| 阶段 | 状态 | 依赖 | 完成判据 |
|---|---|---|---|
| 0 审计与可复现基线 | 已通过限定范围验收 | [验收记录](docs/evidence/phase0/acceptance-2026-10-20.md) | 单机合成数据、Web/独立 macOS/Silo 阅读同步及生产 AI 来源验证通过；跨平台、真实模型质量不在此结论内 |
| 1 工程底座 | 进行中 | Phase 0 签收 | 镜像/SBOM 发布、staging 摘要升级、健康、备份、冷恢复、回退及桌面→后端新进度写入已实测；测试环境秘密文件受 CI 保护，独立桌面包已隔离上游更新；Web→桌面复测和正式签名更新分发待完成 |
| 2 文献管理 | 未开始 | ADR 0001，bookshelves 源码核对 | 集合、标签、DOI 跨端同步且账户隔离 |
| 3 同步与离线 | 未开始 | 不新做第二套协议 | 断网、重复提交、冲突都不丢数据 |
| 4 PDF 笔记 | 未开始 | 客户端坐标结构核对 | 缩放/旋转样本不漂移 |
| 5 AI 引用 | 未开始 | 现有 `ragService` | 页码可点，无证据拒答 |
| 6 pdf2zh Worker | 未开始 | 独立任务表 | 译文不覆盖原文，失败可取消可重试 |
| 7 跨平台 | 未开始 | Rust、签名凭据、真机 | 没有真机证据就标 experimental |
| 8 发布 | 未开始 | 人工授权 | 本文件不授权发布 |

Phase 4、5、6 只在协议和文件身份确定后并行。移动构建不能留到最后才第一次跑。
