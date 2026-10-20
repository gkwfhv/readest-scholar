# Readest Scholar 路线图

状态日期：2026-10-20。**Phase 0 暂不签收。** Web、macOS 桌面与自托管测试栈的 PDF 阅读、文件/书签/基础批注同步已有实测；Turso L2 误差已量化，[PR #9](https://github.com/gkwfhv/readest-scholar/pull/9) 已合入受保护主线，Node 24 全量测试 13760 通过、16 跳过，lint 与 CI 通过。开发 Web 的合成模型索引、问答、来源显示与会话恢复在 [PR #10](https://github.com/gkwfhv/readest-scholar/pull/10) 修复后通过，其最新提交 CI 已通过、仍为草稿；生产 Web AI 入口、可点击 PDF 引用和桌面 Reedy 仍待验证。官方 MinIO 镜像返回 401，[ADR 0002](docs/adr/0002-object-storage-staging-exception.md) 仅允许固定摘要兼容镜像用于受限 staging。Linux staging 的健康、备份和独立恢复演练已通过；活动负载资源基准尚缺。Phase 1 的这些准备项不构成正式阶段验收，后续产品模块暂不开始。

| 阶段 | 状态 | 依赖 | 完成判据 |
|---|---|---|---|
| 0 审计与可复现基线 | 进行中，暂不通过 | [验收记录](docs/evidence/phase0/acceptance-2026-10-20.md) | 主线 Turso 测试基线已闭环；生产 AI、原版对象存储及活动负载资源证据尚未闭环 |
| 1 工程底座 | 准备项已做，正式阶段未启动 | Phase 0 签收 | 本机与 Linux staging 的备份、恢复、就绪及 Web 故障回滚已演练；真实候选镜像升级、SBOM 发布包、受保护自动部署未验收 |
| 2 文献管理 | 未开始 | ADR 0001，bookshelves 源码核对 | 集合、标签、DOI 跨端同步且账户隔离 |
| 3 同步与离线 | 未开始 | 不新做第二套协议 | 断网、重复提交、冲突都不丢数据 |
| 4 PDF 笔记 | 未开始 | 客户端坐标结构核对 | 缩放/旋转样本不漂移 |
| 5 AI 引用 | 未开始 | 现有 `ragService` | 页码可点，无证据拒答 |
| 6 pdf2zh Worker | 未开始 | 独立任务表 | 译文不覆盖原文，失败可取消可重试 |
| 7 跨平台 | 未开始 | Rust、签名凭据、真机 | 没有真机证据就标 experimental |
| 8 发布 | 未开始 | 人工授权 | 本文件不授权发布 |

Phase 4、5、6 只在协议和文件身份确定后并行。移动构建不能留到最后才第一次跑。
