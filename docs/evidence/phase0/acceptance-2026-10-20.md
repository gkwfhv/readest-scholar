# Phase 0 验收记录（2026-10-20）

**结论：通过，限于计划第 9 节定义的可复现基线。** 审查对象为 Scholar main 提交 642a900af5456f38fdc69be01d8d99b3e7fad328，锁定上游提交 2d37bbfc2e94725e1343ab2a825573545aa59f5f。Web、macOS 桌面客户端与单机自托管后端都已在合成测试环境完成实际 PDF 阅读和同步；关键路径有操作、结果和边界记录。本结论允许开始 Phase 1 工程底座工作，不等于正式版本发布。

| 项目 | 结论 | 证据与范围 |
| --- | --- | --- |
| 源码、审计与工程产出 | 通过 | [上游基线](../../audit/upstream-baseline.md)、[差距矩阵](../../audit/feature-gap-matrix.md)、[信任边界](../../audit/data-flow-and-trust-boundaries.md)、[风险登记](../../audit/risk-register.md)、ADR、环境脚本与 CI 基线已建立。 |
| Web 与 macOS 构建、阅读 | 通过 | [执行证据](README.md)记录 Node 24 Web 生产构建、隔离标识的未签名 Tauri 包及两端打开同一仓库合成 PDF；[AI 生产烟测](ai-production-2026-10-20.md)另记录合并后 Web 构建 56/56 静态页及交互。正式签名和移动端不在本阶段。 |
| 自托管与跨端同步 | 通过（Scholar 单机默认路径） | [ADR 0003](../../adr/0003-silo-object-storage.md)将无法拉取的上游 MinIO 镜像替换为固定摘要的 Silo。[隔离迁移和新栈验收](silo-object-2026-10-20.md)记录空栈、旧快照副本迁移、冷恢复、对象 SHA256、合成账户及 staging 运行；桌面上传、Web 下载阅读与 Web→桌面阅读位置再次通过。[既有跨端证据](README.md)还覆盖双向书签、桌面高亮→Web 与 Web 备注→桌面。上游原版 MinIO 镜像组合仍无法拉取，不能称其通过。 |
| 阅读位置 | 通过（受控在线场景） | [执行证据](README.md)记录 Web 与新 macOS 客户端首次打开、较新远端回退及较旧远端不覆盖；Silo staging 再验 Web→桌面位置。旧客户端混用、断网并发和冲突恢复归入 Phase 3。 |
| 现有 AI 基线 | 通过（确定性合成模型） | [PR #10](https://github.com/gkwfhv/readest-scholar/pull/10)修复聊天初始化与空对话输入框；[PR #13](https://github.com/gkwfhv/readest-scholar/pull/13)开放生产 AI 设置、修复 PDF 页码定位、来源按消息保存、Reedy 首次索引及页界限。独立 macOS 生产包与生产 Web 均在合成 PDF 上完成问答、点击第 2 页来源及重开后来源恢复，详见[烟测记录](ai-production-2026-10-20.md)。固定回答只验证传输、检索调用和界面，不证明真实论文的回答质量；Linux staging 模型端点尚未单独交互烟测。 |
| 上游全量测试与 Turso | 通过 | [PR #9](https://github.com/gkwfhv/readest-scholar/pull/9)的 Node 24 全量单测为 **13,760 通过、16 跳过、0 失败**，lint 通过；L2 改用小于 0.1% 的相对误差与近邻顺序契约，见[验证记录](turso-l2-validation.md)。这不是跨平台误差上界。后续 AI、Silo 和 UI PR 的 Scholar、上游 PR 检查与 CodeQL 在各自最终提交上通过。 |
| 资源基准 | 通过（观测基线） | [空闲](staging-resource-idle-2026-10-20.md)与[活跃采样](staging-resource-active-2026-10-20.md)记录六容器读写、合成 PDF 打开翻页及桌面文件下载期间主进程 200 次 CPU/RSS 样点。服务端和桌面窗口未同步采样，桌面 WebKit 子进程未计入；不能外推并发容量或整机上限。Phase 0 没有预设性能阈值。 |
| 聊天图标与侧栏布局 | 通过（已测 macOS 尺寸与主题） | [PR #14](https://github.com/gkwfhv/readest-scholar/pull/14)将四个底部入口固定为同一行，并以大脑图标统一侧栏、笔记本、设置和命令入口。[完整窗口截图与测量](ai-sidebar-layout-2026-10-20.md)显示最窄侧栏中选中背景位于边界以内；深色主题也已目视复验。移动端安全区与 e-ink 实机仍需后续平台阶段验证。 |

## 验收边界与后续阶段

这份签收针对 Scholar 单机自托管和合成 PDF 基线。2026-10-20 的额外书签复验开始时，Web 测试页菜单显示“登录”，该新书签只保存在未登录浏览器本地；已清理临时书签，不能把这次观察算作跨端同步结果或故障。跨端书签、高亮和备注的通过依据是此前两端已登录时的服务端记录与截图。断网恢复、并发冲突、旧客户端兼容、PDF 旋转/缩放锚点、真实论文 AI 质量、移动端布局和正式发布签名分别由后续阶段验证。

Phase 1 可以继续：让 Scholar 自有镜像在 staging 按提交和摘要部署，完成升级/回滚、秘密与构建产物管理及自动更新分发测试。正式品牌、包名和 Bundle ID 依计划仍需单独明确授权；现有测试包标识不是发布身份。
