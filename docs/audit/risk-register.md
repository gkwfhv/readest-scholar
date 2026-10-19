# 风险台账

状态日期：2026-10-19。持续风险与已缓解项分开记录；实测命令和输出见 `docs/evidence/phase0/`。

| ID | 风险 | 等级 | 现状 | 阻断动作 |
|---|---|---|---|---|
| R1 | 平行同步协议覆盖上游 replica | 极高 | 上游已有 cursor、加密和 CRDT 合并函数 `004_crdt_merge_replica_fn.sql` | 见 ADR 0001。文献字段先映射到 books/replica，不新写 FastAPI 同步 |
| R2 | `book_hash` 把文献和文件绑死，译文覆盖原文 | 极高 | 主键是 `(user_id, book_hash)` | 译文使用新 hash/新 file_key。替换书籍必须是显式操作 |
| R3 | PDF 批注坐标在升级 pdfjs 后漂移 | 极高 | 手绘点已有归一化页内坐标；文字批注 quadpoints 未证实 | 分别验证手绘与文字批注的缩放、旋转视觉样本 |
| R4 | 离线笔记冲突被静默覆盖 | 极高 | replica 有合并函数，Scholar 笔记尚未接入 | 不在未读合并代码时承诺“不会丢数据” |
| R5 | 标签 `v0.12.16` 与 `main` SHA 不同 | 高 | 已记录两个 SHA | 构建和 Docker tag 使用完整 SHA，不用浮动 `latest` |
| R6 | AGPL 组合发布 | 高 | Readest 与 pdf2zh 均为 AGPL-3.0。依赖清单未扫描 | 发布前人工法律复核。本阶段不发布 |
| R7 | 模型把文献内容当指令，或伪造页码 | 高 | Reedy 已返回可点击 CFI 来源，但 PDF 页码/bbox 精度未验证 | PDF 引用要实测页码映射；没有证据就拒答 |
| R8 | 翻译任务无界消耗 CPU 和 API 费用 | 高 | pdf2zh 无稳定任务 API | Worker 自建状态机、并发上限、超时和取消 |
| R9 | 官方 Compose 把 8000/9000/9001 暴露在宿主机 | 高 | Docker daemon 已启动；本机 `localhost.yaml` 把四个映射端口全部绑定到 `127.0.0.1`，配置解析已验证 | 任何测试都加载覆盖文件；生产网络边界另评估 |
| R10 | 桌面端无法在隔离数据目录验证 | 已缓解 | 工作区 Rust `1.99.1` 构建了独立标识、未签名的 macOS `.app`，从文件导入、阅读并通过本机栈上传 PDF；Web 已下载并打开 | 不得把本地调试包当成正式签名包 |
| R11 | 官方 Compose 的 MinIO 镜像无法拉取 | 高 | `quay.io/minio/mc:latest` 与固定版本 `quay.io/minio/minio:RELEASE.2025-09-06T17-38-46Z` 都返回 registry 401；固定摘要的 Pigsty 镜像本机同步与隔离对象恢复通过 | 替代镜像验收单独标注；生产选型仍需供应链、兼容与恢复审查 |
| R12 | 本机原生 Turso 向量距离结果偏离断言 | 高 | Node 24 全量测试有 3 个 L2 精度断言失败；浏览器 WASM 同套件 54 项通过，Node 26 禁用实验性 Web Storage 后原生测试仍是相同 3 项失败 | 调查 macOS arm64 原生包，不放宽断言或跳过测试 |
| R13 | TypeScript 5 与 7 同时出现在清单 | 中 | 根 `^5`，应用 `^7.0.2` | 以锁文件为准跑官方 `pnpm lint` |
| R14 | 子模块未初始化导致 Web 构建失败 | 已缓解 | 7 个源码子模块均已检出到锁定提交；lint、Web 与桌面构建通过 | 后续克隆流程保持 `git submodule update --init` |
| R15 | 数据库迁移不可逆 | 极高 | 上游用 `readest_meta.migrations` 顺序应用 | Scholar 迁移用 expand → migrate → contract。未备份不迁移 |
| R16 | iOS/Android 签名 | 高 | 上游有发布脚本，依赖本地 env 文件 | 不申请、不使用签名凭据。未真机验证标为 experimental |
| R17 | 官方自托管对象存储上游停止维护 | 高 | [MinIO 官方仓库](https://github.com/minio/minio) 标为 2026-04-25 归档，并建议从源码构建；本机官方镜像拉取失败 | Phase 1 评估受维护的 S3 兼容实现或可复现源码构建，附兼容、恢复、安全与许可证证据；生产前固定 digest |
| R18 | Supabase SQL 转储缺失 GraphQL 包装函数 | 高 | 原始 `pg_dump` 在空数据库恢复时于 `graphql_public.graphql` 授权失败；备份脚本现额外保存函数定义并生成 `postgres-restorable.sql`，隔离空库一次性恢复通过 | 完整空栈恢复仍需单独演练，并把此包装函数纳入升级回归 |

当前可复现的上游失败：`src/__tests__/database/turso-node.test.ts` 中 3 个 L2 距离精度断言；完整输出见 `docs/evidence/phase0/unit-node24.txt`。其余 Phase 0 阻断在状态文档与验收清单中持续跟踪。
