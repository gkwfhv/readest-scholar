# Phase 0 验收记录（2026-10-20）

**结论：暂不通过。** 本次审查以 Scholar `main` 提交 `05e9464a7c755bc872fd4a488f315855d18efb6b`、上游锁定提交 `2d37bbfc2e94725e1343ab2a825573545aa59f5f` 及《Readest Scholar Agent Engineering Plan》第 9 节为准。完成判据要求 Web、桌面端和自托管后端实际阅读与同步，且所有关键路径有可复现证据；任务还明确要求验证现有 AI、跑上游测试、启动官方 Docker 自托管并生成资源基准。

| 项目 | 结论 | 证据及界限 |
| --- | --- | --- |
| 源码锁定、审计和工程产出 | 通过 | [上游基线](../../audit/upstream-baseline.md)、[差距矩阵](../../audit/feature-gap-matrix.md)、[信任边界](../../audit/data-flow-and-trust-boundaries.md)、[风险登记](../../audit/risk-register.md)、[ADR 0001](../../adr/0001-foundation.md)、CI 基线均已建立。 |
| Web 与 macOS 桌面构建、阅读 | 通过 | [执行证据](README.md)记录 Node 24 Web 生产构建、Tauri 调试 `.app` 构建，以及两端打开同一合成两页 PDF；不是正式签名安装包。 |
| 自托管和基础跨端同步 | 有条件通过 | 官方 Compose 叠加回环端口及固定摘要 Pigsty MinIO 兼容镜像后，合成账户完成桌面上传、Web 下载阅读、双向书签、桌面高亮到 Web、Web 备注到桌面；另有[独立栈恢复演练](selfhost-restore-rehearsal.md)。原版 MinIO/mc 镜像拉取返回 401，**原版官方镜像组合未通过**。 |
| 阅读位置 | 部分通过 | 新 Web 与新 macOS 客户端的首次打开、较新远端回退、较旧远端不覆盖等受控测试及截图见[执行证据](README.md)；旧客户端混用和真实离线并发冲突未验收。 |
| 现有 AI | 未通过 | 源码审计确认现有 AI/RAG 和可点击 CFI 来源入口，但没有在自托管测试 PDF 上完成 AI 问答、引用点击定位的运行时证据。2026-10-20 在当前代码上定向运行 `ai-store`、`chunker`、`ai-chat-store`、`ai-gateway-routes` 四个 Vitest 文件，**48/48 通过**；这只证明局部逻辑，不代替端到端验证。 |
| 上游全量测试 | 修复分支本机通过，主线待合入 | [PR #9](https://github.com/gkwfhv/readest-scholar/pull/9) 对锁定 Turso 原生包的 L2 误差作了实测，以小于 0.1% 的相对误差和近邻顺序检查修正共享测试契约；Node 24 全量 **13760 通过、16 跳过、0 失败**，见 PR 内[验证记录](https://github.com/gkwfhv/readest-scholar/blob/fix/turso-l2-contract/docs/evidence/phase0/turso-l2-validation.md)。`main` 仍保留历史上的 3 个失败，须待 PR 检查及合入后复验主线。 |
| 资源基准 | 部分通过 | [Linux staging 空闲快照](staging-resource-idle-2026-10-20.md)记录六个容器三次 CPU/内存/I/O 读数、机器规格和测试数据卷容量；尚无打开 PDF、上传/下载同步期间的受控采样及独立测试桌面客户端资源。 |

本次定向复验从 `apps/readest-app` 执行，直接使用工作区已安装的 Node 24 与 Vitest，以免重新安装依赖：

```sh
/Users/admin/personal/redest/.tools/node_modules/.bin/node node_modules/vitest/vitest.mjs run \
  src/__tests__/ai/ai-store.test.ts \
  src/__tests__/ai/chunker.test.ts \
  src/__tests__/store/ai-chat-store.test.ts \
  src/__tests__/app/api/ai-gateway-routes.test.ts

/Users/admin/personal/redest/.tools/node_modules/.bin/node node_modules/vitest/vitest.mjs run \
  src/__tests__/database/turso-node.test.ts
```

## 签收前需要闭环

1. [PR #9](https://github.com/gkwfhv/readest-scholar/pull/9) 的 Turso 修复已在本机全量验证；等待必需 CI 检查及合入，再对受保护 `main` 执行基线复验。相对误差是本机实测的测试契约，不能推广为所有平台的误差上界。
2. 让官方 Docker 镜像组合从空环境启动并完成同步复验；若官方 MinIO 镜像确实不可获得，先以 ADR 更新自托管对象存储选型与验收依据，再对固定镜像、许可、安全、备份恢复和跨端同步做完整验证。兼容镜像的既有成功记录不能自动等同于官方镜像通过。
3. 用合成 PDF 和测试用 OpenAI 兼容服务完成现有 AI 问答、来源点击与页面定位的 Web/桌面运行时验证，保存命令、模型响应和可检查的界面证据；不得把单测或代码审计当作实测。
4. 已采集同一 staging 栈的空闲资源快照；继续在打开合成 PDF、执行同步时采样各容器 CPU/内存/存储及独立测试桌面客户端资源，记录操作与时间窗口。Phase 0 只建立可重现基准，不预设未经测量的性能阈值。

离线并发、旧客户端混用和 PDF 缩放/旋转锚点仍有风险；深入的冲突语义与几何修复分别属于 Phase 3、Phase 4。在签收 Phase 0 前，至少应决定这些现有功能的最小烟测范围并在验收清单中写明，避免把“尚未验证”记成通过。Phase 1 已做的 staging 与恢复演练不改变本次 Phase 0 结论。
