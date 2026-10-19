# ADR 0001：沿用 Readest 自托管栈

- 状态：已接受（Phase 0 设计决定）
- 日期：2026-10-19
- 锁定上游：Readest `2d37bbfc2e94725e1343ab2a825573545aa59f5f`

## 背景

Scholar 需要私有化账户、书库、阅读进度、批注、笔记、OpenAI 兼容侧边栏，以及保排版 PDF 翻译。方案要求先证明现有同步是否够用，禁止没有证据就用 FastAPI 换掉后端。

## 决定

1. 阅读器、`AppService`、Turso 本地库、Supabase 认证、Postgres RLS、MinIO/S3、replica 同步和现有 AI SDK 全部保留。
2. 不新增 FastAPI，也不把 `/api` 迁到另一门语言。Scholar 能表达的 HTTP 行为放在现有 Next.js 路由中；只有在现有路由无法安全表达时，才加 `/api/scholar/v1`。
3. pdf2zh Next 作为独立 Worker 进程/容器。任务状态由我们的 Postgres 行维护。上游只被当作 CLI 或 Python API，不假定它有队列。
4. 原文文件不可变。派生 PDF 是新的 `files` 对象，并记录来源文件。
5. 文献管理先映射到 `books.metadata`、`tags`、`group_*` 和 `book_notes`。只有文件身份和文献身份必须分离时才加表。
6. 同步新数据时优先增加 replica 类别。不在 V1 并行维护第二套 `SyncOperation` 日志。
7. 本阶段不改 foliate-js、pdfjs 集成和批注渲染。

## 否决

- 用 FastAPI 重写认证、存储和同步。客户端已经调用 Next.js 与 Supabase，替换会复制 RLS、预签名和 replica 加密。PDF 计算需要的是隔离进程，不是新的业务 API 门面。
- 把 pdf2zh WebUI 直接暴露给用户当翻译系统。它没有本方案要求的所有权、幂等、配额和“终态不可被旧消息覆盖”。
- 现在拆出 `packages/scholar-domain` 与多个微服务。复用边界还没在本地跑通，提前拆包只会制造第二套类型。

## 后果

- Scholar 代码必须能跟着 Readest `main` 小步合并。差异集中在迁移、少量路由和 Worker。
- 翻译容器与 Web 容器分开限制 CPU、内存、时间和网络。
- 若 replica 类别无法表达翻译任务，任务表只负责任务，不负责笔记同步。
- 发布物同时受 Readest 与 pdf2zh 的 AGPL-3.0 约束。

## 未决

- 层级集合如何落到现有 `group_id`。智能书架已经读过，它不是父子文件夹。
- PDF 批注几何落在 `book_notes.style`、`ink`，还是只存在于本地 Turso。
- AI 会话已经核实为 `aiChatStore.ts` → 本地 IndexedDB `aiStore.ts`。若 V1 要跨端同步会话，须设计新增服务端表及删除语义；不能把本地可删除误判成云端已删除。
