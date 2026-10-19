# 架构清单

对照锁定 SHA `2d37bbfc2e94725e1343ab2a825573545aa59f5f` 的官方文档和目录列表。路径均相对 Readest 仓库根。

## 仓库顶层

已由 GitHub Contents API 确认存在：`apps/`、`packages/`、`docker/`、`docs/`、`.github/workflows/`、`Dockerfile`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`Cargo.toml`、`Cargo.lock`。主应用在 `apps/readest-app`。上游自己的 `docs/` 与本 Scholar 审计目录不是同一棵树；Scholar 文档放在外层工作区，避免在克隆未完成时写入上游。

## 运行时

`apps/readest-app/docs/architecture.md` 与 `AGENTS.md` 一致；本轮又直接核对了对应源码：

- 同一套 Next.js 16 / React UI，目标为 Web、Tauri 桌面、Tauri Android/iOS。
- Web 生产部署是 Cloudflare Workers（OpenNext）。自托管是同一 Web 构建的 Docker 镜像，运行时配置来自 `src/app/runtime-config.js`。
- 平台差异收口在 `src/services/appService.ts`，实现为 `webAppService.ts`、`nativeAppService.ts`、`nodeAppService.ts`。
- 本地库是 Turso/libSQL：浏览器 WASM、Tauri 插件、Node 三套，共用 `src/services/database/migrate.ts`。
- 阅读引擎是子模块 `packages/foliate-js`。PDF 运行时资源来自 `pdfjs-dist`，由 `pnpm setup-pdfjs` 拷到 `public/vendor/pdfjs`。

## 已确认的服务目录

`apps/readest-app/src/services/` 顶层包含：`ai`、`annotation`、`appService.ts`、`audiobook`、`backupService.ts`、`bookService.ts`、`bookshelves`、`cloudService.ts`、`database`、`dictionaries`、`handwriting`、`ingestService.ts`、`librarySearchService.ts`、`metadata`、`nativeAppService.ts`、`nodeAppService.ts`、`opds`、`readwise`、`sync`、`translators`、`tts`、`webAppService.ts`。本地检出后已读 `services/bookshelves/definitions.ts` 与 `grouping.ts`：书架是规则过滤视图，分组来自 `LibraryGroupByType`。`handwriting` 仍未逐文件阅读。

## HTTP API

Pages Router（`src/pages/api`，由架构文档列出）：同步 `sync.ts`、`kosync.ts`、`sync/replicas.ts`、`sync/replica-keys.ts`；对象存储 `storage/*`；Send to Readest；DeepL 代理；账号删除。

App Router（Contents API 确认的目录）：`ai`、`apple`、`azure-translate`、`crosspoint`、`google`、`hardcover`、`metadata`、`notion`、`opds`、`share`、`stats`、`stripe`、`tts`、`yandex-translate`。没有 `scholar` 路由。

## 同步

三套并存，见架构文档第 6.1 节：

1. KOSync：`src/services/sync/KOSyncClient.ts`，兼容阅读进度。
2. Replica：本地口令加密后的增量副本。编排文件包括 `replicaSyncManager.ts`、`replicaPublish.ts`、`replicaPullAndApply.ts`、`replicaCursorStore.ts`、`replicaCryptoMiddleware.ts`。
3. 第三方文件同步：`src/services/sync/file`，适配 WebDAV、Google Drive、S3、OneDrive、iCloud。书架元数据在 `library.json`。

`src/types/settings.ts` 的 `SYNC_CATEGORIES` 为：`book`、`progress`、`note`、`dictionary`、`font`、`texture`、`opds_catalog`、`abs_server`、`custom_translator`、`custom_tts`、`settings`、`stats`、`credentials`。书籍、进度、笔记受 Readest Cloud 开关约束；凭据默认不同步。

## 云端表

`docker/volumes/db/init/schema.sql` 的基础表：

- `books`：主键 `(user_id, book_hash)`。列含 `title`、`author`、`tags text[]`、`group` / `group_id` / `group_name`、`metadata json`、`progress`、`deleted_at`、`synced_at`。RLS 按 `auth.uid()`。
- `book_configs`：阅读位置 `location`、`xpointer`、`progress`、视图设置。
- `book_notes`：`id`、`type`、`cfi`、`xpointer0/1`、`text`、`style`、`color`、`note`、`page`、`ink jsonb`、`deleted_at`。
- `files`：`file_key` 唯一，`book_hash`，`file_size`，软删除。

迁移目录有 `001` 到 `028`，含 replica、分享、阅读统计、书籍 `synced_at`、笔记 `ink`、自定义翻译器 replica。没有文献 DOI 列、层级集合表、翻译任务表。

## AI 与划词翻译

- `src/services/ai/ragService.ts` 与 `src/services/reedy/retrieval/BookRetriever.ts` 已有当前书检索；后者检查索引模型 ID，返回 passage 的起止 CFI、section、文本与排序分数。
- `src/app/reader/components/notebook/AIAssistant.tsx` 已将 Reedy 来源点击事件接到 `getView(bookKey)?.goTo(source.cfi)`。这证明已有可点击 CFI 来源入口，不证明 PDF 页码和框坐标总是准确。
- `src/store/aiChatStore.ts` 调用 `src/services/ai/storage/aiStore.ts` 保存会话；后者使用本地 IndexedDB `readest-ai`，没有服务端会话表或同步契约。Reedy 索引另有本地 Turso 表。
- 聊天与嵌入的 HTTP 入口在 `src/app/api/ai`。
- 划词翻译在 `src/services/translators`，DeepL/Azure/Yandex 有服务端代理。同步类别 `custom_translator` 已存在。
- 这不是保排版的整篇 PDF 翻译。

## 批注

服务端笔记行有页码和 `ink` JSON。`src/services/handwriting/model.ts` 的 InkPoint 已使用 0..1 页内归一化坐标，InkStroke 有页码及可选 CFI 文本锚点。`src/services/annotation/types.ts` 只定义导入提供者，不是 PDF quadpoints 模型。标准 PDF Annotation 导出、quadpoints 列均未在已读文件中出现。

## 上游 CI

`.github/workflows/` 已有 `pull-request.yml`、`nightly.yml`、`docker-image.yml`、`release.yml`、`android-e2e.yml`、`codeql.yml`、`scorecard.yml`。这些是上游工作流。本工作区没有自己的远端，也没有跑过其中任何一个。

## 测试入口

以 `apps/readest-app/docs/testing.md` 和 `package.json` 为准：

- `pnpm test`：Vitest + jsdom
- `pnpm test:browser`：Chromium
- `pnpm test:tauri` / `pnpm test:e2e`：需要已启动的 Tauri WebDriver
- `pnpm test:android`：需要 adb 设备
- `pnpm test:e2e:web`：Playwright
- `pnpm dev-web`、`pnpm build-web`：Web
- `pnpm tauri dev`：桌面，Linux 文档写明 CEF 需要 Rust `>= 1.95`

官方工作树命令是 `pnpm worktree:new`，不要直接 `git worktree add`。
