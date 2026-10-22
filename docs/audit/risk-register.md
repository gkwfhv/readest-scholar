# 风险台账

状态日期：2026-10-20。持续风险与已缓解项分开记录；实测命令和输出见 `docs/evidence/phase0/`。

| ID | 风险 | 等级 | 现状 | 阻断动作 |
|---|---|---|---|---|
| R1 | 平行同步协议覆盖上游 replica | 极高 | 上游已有 cursor、加密和 CRDT 合并函数 `004_crdt_merge_replica_fn.sql` | 见 ADR 0001。文献字段先映射到 books/replica，不新写 FastAPI 同步 |
| R2 | `book_hash` 把文献和文件绑死，译文覆盖原文 | 极高 | 主键是 `(user_id, book_hash)` | 译文使用新 hash/新 file_key。替换书籍必须是显式操作 |
| R3 | PDF 批注坐标在升级 pdfjs 后漂移 | 极高 | 手绘点已有归一化页内坐标；文字批注 quadpoints 未证实 | 分别验证手绘与文字批注的缩放、旋转视觉样本 |
| R4 | 离线笔记冲突被静默覆盖 | 极高 | replica 有合并函数，Scholar 笔记尚未接入 | 不在未读合并代码时承诺“不会丢数据” |
| R5 | 标签 `v0.12.16` 与 `main` SHA 不同 | 高 | 已记录两个 SHA | 构建和 Docker tag 使用完整 SHA，不用浮动 `latest` |
| R6 | AGPL 组合发布 | 高 | Readest 与 pdf2zh 均为 AGPL-3.0；CI 已生成 946 个生产 npm 包清单和 6187 组件源码树 SBOM，但子模块、容器、实际分发范围未完整复核 | 发布前人工法律复核。本阶段不发布 |
| R7 | 模型把文献内容当指令，或伪造页码 | 高 | Reedy 已返回可点击 CFI 来源，但 PDF 页码/bbox 精度未验证 | PDF 引用要实测页码映射；没有证据就拒答 |
| R8 | 翻译任务无界消耗 CPU 和 API 费用 | 高 | pdf2zh 无稳定任务 API | Worker 自建状态机、并发上限、超时和取消 |
| R9 | 官方 Compose 把 8000/9000/9001 暴露在宿主机 | 高 | Docker daemon 已启动；本机 `localhost.yaml` 把四个映射端口全部绑定到 `127.0.0.1`，配置解析已验证 | 任何测试都加载覆盖文件；生产网络边界另评估 |
| R10 | 桌面端无法在隔离数据目录验证 | 已缓解 | 工作区 Rust `1.99.1` 构建了独立标识、未签名的 macOS `.app`，从文件导入、阅读并通过本机栈上传 PDF；Web 已下载并打开 | 不得把本地调试包当成正式签名包 |
| R11 | 官方 Compose 的 MinIO 镜像无法拉取 | 高 | `quay.io/minio/mc:latest` 与固定版本 `quay.io/minio/minio:RELEASE.2025-09-06T17-38-46Z` 都返回 registry 401；固定摘要的 Pigsty 镜像本机同步与隔离对象恢复通过 | 按 [ADR 0002](../adr/0002-object-storage-staging-exception.md) 仅作 staging 例外；生产选型仍需供应链、兼容与恢复审查 |
| R12 | 本机原生 Turso 向量距离使用近似算法 | 中 | 锁定的 macOS arm64 二进制调用 SimSIMD；2400 组固定种子样本最大相对偏差约 0.065%，共享 L2 测试现按小于 0.1% 的相对误差并核对近邻顺序，Node 24 全量单测 13760 通过、16 跳过 | 见 [专项实测](turso-l2-precision.md)；若产品改用 L2 排序或阈值，须在目标平台重测临界样本，不能将本机经验范围当作普适上界 |
| R13 | TypeScript 5 与 7 同时出现在清单 | 中 | 根 `^5`，应用 `^7.0.2` | 以锁文件为准跑官方 `pnpm lint` |
| R14 | 子模块未初始化导致 Web 构建失败 | 已缓解 | 7 个源码子模块均已检出到锁定提交；lint、Web 与桌面构建通过 | 后续克隆流程保持 `git submodule update --init` |
| R15 | 数据库迁移不可逆 | 极高 | 上游用 `readest_meta.migrations` 顺序应用 | Scholar 迁移用 expand → migrate → contract。未备份不迁移 |
| R16 | iOS/Android 签名 | 高 | 上游有发布脚本，依赖本地 env 文件 | 不申请、不使用签名凭据。未真机验证标为 experimental |
| R17 | 官方自托管对象存储上游停止维护 | 高 | [MinIO 官方仓库](https://github.com/minio/minio) 标为 2026-04-25 归档，并建议从源码构建；本机官方镜像拉取失败 | Phase 1 评估受维护的 S3 兼容实现或可复现源码构建，附兼容、恢复、安全与许可证证据；生产前固定 digest |
| R18 | Supabase SQL 转储缺失 GraphQL 包装函数 | 高 | 原始 `pg_dump` 在空数据库恢复时于 `graphql_public.graphql` 授权失败；备份脚本现额外保存函数定义并生成 `postgres-restorable.sql`，隔离空库及第二套完整服务栈恢复后登录阅读通过 | 把包装函数纳入升级回归；生产备份加密、保留期和异机恢复仍需验证 |
| R19 | 较早的本地阅读位置覆盖另一端的最新回退位置 | 高 | 修复前 Web 第 2→1 页的最新位置被旧桌面端回写成第 2 页；第一版新桌面端首次下载后又以自动第 1 页覆盖云端第 2 页 | 当前分支按同文件配置时间戳选择位置、给无本地位置的配置优先采用云端、避免自动首屏抬高本地时间戳；单测及新 Web/新桌面受控合成 PDF 测试通过。这仍不是显式阅读会话。Phase 3 需分离最后位置与最远进度，保留设备位置与冲突版本，并验证离线恢复和旧客户端混用 |
| R20 | Web AI 来源不能定位且生产入口隐藏 | 高 | [PR #10 的开发版合成模型烟测](https://github.com/gkwfhv/readest-scholar/blob/fix/assistant-ui-init/docs/evidence/phase0/ai-web-synthetic-2026-10-20.md)完成问答和来源显示；生产设置隐藏 AI，旧 Web 来源无 CFI，刷新后来源丢失。PR #10 只修复对话启动与空会话输入框 | 生产启用前完成密钥存储与权限审查、真实模型/检索验收、PDF 页码或 CFI 定位及会话来源持久化；桌面 Reedy 另行实测 |

| R21 | 副本增量拉取遗漏或旧离线操作静默覆盖 | 极高 | `updated_at_ts` 同时承担字段外冲突顺序与拉取游标；严格大于游标并限 1000 行，长离线行还会触发一分钟时钟偏差拒绝。当前新队列为安全起见保留超过 30 秒的非书架操作、不发送；旧游标存储未按账户隔离且存在异步加载竞态 | 按 [ADR 0004](../adr/0004-replica-change-cursor.md)实现事务化账户变更序号、分页与账户游标，分离清单/复活冲突时钟，双设备并发和崩溃注入通过前不签收 Phase 3 |

原有 3 个 L2 精度断言失败的日志保留在 `docs/evidence/phase0/unit-node24.txt`，修正测试契约后的复验结果见 `docs/evidence/phase0/turso-l2-validation.md`。其余 Phase 0 阻断在状态文档与验收清单中持续跟踪。
