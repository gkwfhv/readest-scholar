# 功能差距

判定只使用：已有、可扩展、需新增、不适用。证据不足的格子写明未核对，不升格成“已有”。

| 能力 | 判定 | 证据 | 下一步 |
|---|---|---|---|
| PDF/EPUB/MOBI/TXT 阅读 | 已有 | `packages/foliate-js`，PDF 走 pdfjs；`AGENTS.md` | 不重写阅读器 |
| 平台适配 | 已有 | `appService.ts` 与 web/native/node 三个实现 | Scholar UI 只通过 `AppService` 触达文件系统 |
| 自托管登录与书库 | 已有 | `docker/README.md`；`books` RLS；Supabase GoTrue | 官方 MinIO/mc 镜像当前拉取返回 401；本机已用固定摘要兼容镜像完成跨端 PDF 测试，仍需可复现的正式镜像来源。不换认证系统 |
| 书籍文件上云 | 已有 | `pages/api/storage/*`，`cloudService.ts`，`files` 表 | 译文做成新对象，不覆盖 `file_key` |
| 阅读进度同步 | 已有 | `book_configs`；replica 类别 `progress`；KOSync | 继续用现有类别 |
| 高亮/备注/书签数据 | 已有 | `book_notes` 含 `type`、`cfi`、`text`、`note`、`color`、`page`、`deleted_at`；本机 Web 第 2 页书签写入该表并在刷新后保留 | V1 高亮与备注复用该行；跨设备书签和高亮/备注仍需实测 |
| 跨设备增量同步 | 已有 | replica cursor、加密、类别开关 | 新实体优先加 replica 类别，不平行再做一套 op-log |
| 离线 Web | 已有 | `src/sw.ts` Serwist，架构文档第 3.4 节 | 实测仍未做 |
| 书库搜索 | 已有 | `librarySearchService.ts`、`librarySearchIndex.ts` | 检索字段以后加入 DOI/年份 |
| 标签 | 可扩展 | `books.tags text[]`。没有独立标签表，也没有同账户归一化唯一约束 | 先用数组；规范化表放到文献管理阶段 |
| 分组 / 书架 | 可扩展 | `books.group_id/group_name`。本地 `services/bookshelves/definitions.ts` 是带过滤规则的智能书架（recent、finished 等），`grouping.ts` 只解析分组方式，不是可嵌套的 Zotero 集合 | 层级集合仍要新增或另做映射；不要把 bookshelf 当成文件夹 |
| 作者/标题 | 已有 | `books.title`、`books.author` | 作者数组可放 `metadata`，不必先拆表 |
| 年份 / DOI | 可扩展 | `schema.sql` 无这两列；有 `metadata json` | 从 metadata 提升为可筛选字段，外部抓取默认关闭 |
| 文献 ID 与文件 ID 分离 | 需新增 | 主键是 `(user_id, book_hash)`，一份文件一个身份 | 增加稳定 document id，原文/译文挂到同一文献 |
| 文件去重 | 可扩展 | `bookService.ts` 使用文件的 `partialMD5` 做现有书籍身份与批量导入去重；它不是方案要求的全文件 SHA-256。元数据级“可能重复”提示不存在 | 保留现有导入行为；新增不可变派生文件时另算 SHA-256 |
| 科研笔记回跳 | 可扩展 | `book_notes.note` 与 `page`/`cfi` 在同一行；阅读器有 notebook 状态 | V1 用笔记字段。独立 Markdown 笔记等锚点模型稳定后再拆 |
| PDF 几何锚点 | 可扩展 | `handwriting/model.ts` 已将手绘点存为 0..1 页内坐标，InkStroke 有 page；文字高亮的标准 quadpoints 尚未证实 | 分别验证手绘与文字批注的缩放、旋转坐标 |
| 标准 PDF 批注导出 | 需新增 | 已读文档和 schema 都没有导出器。方案将其列为 P1 | 不放进第一阶段 |
| 手绘/箭头/矩形 | 可扩展 | `handwriting/model.ts` 已有 pen/marker、归一化点与压感，`book_notes.ink` 可同步；箭头和矩形未证实 | 手绘复用；其他图形 P1 再定 |
| 选中文本解释/翻译/摘要 | 已有 | `services/ai`、`services/translators`、OpenAI compatible SDK | 设置里接用户自己的 base URL，密钥不进公开运行时配置 |
| 当前书 RAG | 已有 | `ragService.ts` 与 `reedy/retrieval/BookRetriever.ts`；后者有模型 ID 校验、混合检索与索引清理入口 | 复用现有检索和删除能力 |
| 答案回到 PDF 页与框 | 可扩展 | `BookRetriever` 已返回 CFI；`AIAssistant.tsx` 已支持点击来源后 `goTo(cfi)`。尚无明确的 PDF 页码/bbox 契约及跨端精度证据 | 实测 PDF 引用页和框；只补缺失的定位与拒答逻辑 |
| AI 会话跨端同步 | 需新增 | `aiChatStore.ts` 的持久化委托给 `aiStore.ts`，后者把会话和消息保存在本地 IndexedDB `readest-ai`；云端 schema 没有会话表 | 先定义所有权、删除和同步策略，再新增服务端数据 |
| 多文献 RAG、OCR、知识图谱 | 不适用 | 方案列为 P1/P2 | 本阶段不建这些服务 |
| 全文保排版翻译 | 需新增 | Readest 翻译器是文本段落。pdf2zh 提供 CLI/WebUI/Python API/Docker，README 未提供任务队列 API | 独立 Worker 包一层任务状态机 |
| 术语表 | 需新增 | 有 `custom_translator`，没有 `GlossaryEntry` 表 | P1，或翻译阶段的最小表 |
| BibTeX/RIS、Zotero 双向同步 | 不适用 | 方案将导入导出放 P1，双向同步放 P2 | 不在本阶段承诺 |
| Web/桌面/移动安装包 | 已有 | `package.json` 脚本与 `release.yml` | 本机 Web 构建、无账户 PDF 阅读及独立标识的未签名 macOS `.app` 构建和阅读已验证；移动包未构建。没有签名凭据，不发布 |
| 自动化测试框架 | 已有 | `docs/testing.md`；本机 Node 24 全量单测 13752 通过、3 失败，浏览器 WASM 对照 54 通过 | 修复或解释 Turso 原生断言，再把 Scholar 新用例纳入 CI |
| Scholar 质量闸门、SBOM、备份演练 | 可扩展 | 上游 CI 不覆盖 Scholar 任务和恢复演练；新增 Scholar baseline，`main` 已设必需检查 | `infra/backup` 脚本逻辑测试、真实合成数据备份及第二套完整服务栈恢复后阅读已通过。首次远端许可证清单与 6187 组件 SBOM 作业通过；Linux 脚本兼容修复待第二次远端运行验证。加密、升级回滚和发布级 SBOM/许可证复核仍缺失 |

结论：不替换阅读器、账户、对象存储和 replica 同步。文献身份、PDF 页级引用、翻译任务是新增面。集合、标签、笔记在现有字段上扩展。
