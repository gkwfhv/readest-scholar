# Phase 2 首项：手动 DOI 元数据

范围：在 Scholar 书籍详情中增加 DOI 输入和展示，不新增数据库列或外部元数据抓取。`BookMetadata.doi` 随现有 `books.metadata` 一起保存，沿用 `metadataUpdatedAt` 的元数据同步时钟；普通 Readest 构建不显示 Scholar DOI 控件。此项不是完整的文献身份、去重或跨端同步验收。

## 依据与设计

- [差距矩阵](../../audit/feature-gap-matrix.md)确认现有 `books` 以 `(user_id, book_hash)` 为身份、`metadata` 为 JSON；DOI 尚无独立字段。ADR 0001 要求先利用现有元数据与同步，只有文献身份必须与文件身份分离时才加表。
- 当前实现只允许用户手动输入 DOI 字符串，不自动联网查询，不把论文文件或正文发送给外部服务，也不把通用 `identifier` 当作 DOI 覆盖。
- 详情页 DOI 只在有值时显示，沿用元数据网格的响应式列与颜色类；长 DOI 使用换行，避免挤出详情弹窗。编辑页使用既有 `FormField`。来源选择时 DOI 加入“锁定全部”，避免后续自动来源覆盖手工值。

## 测试证据

- 改动前新增 3 个行为断言失败：详情页找不到 DOI、编辑页找不到 DOI 输入、“锁定全部”未锁定 DOI。改动后相关组件与元数据保存定向测试通过。
- 元数据保存测试检查 `metadata.doi` 和 `metadataUpdatedAt` 进入既有书库保存路径；没有新增同步协议、数据库迁移或第三方 API 调用。
- `BookDetailModal` 原测试仅 mock 了 `isWebAppPlatform`；新 UI 使用 `isScholarReleaseBundle` 后，全量测试暴露 mock 缺项。补齐 mock 后重新运行：Node 24、`--maxWorkers=4` 下 1,179 个测试文件通过、4 个跳过，13,822 项通过、16 项跳过，0 项失败。随后对共用表单的视觉修正重新运行相关测试，28 项通过；TypeScript、Biome lint 与改动文件格式检查通过。
- `NEXT_PUBLIC_SCHOLAR_RELEASE=true SCHOLAR_RELEASE=true pnpm build-web --webpack` 在本地成功。默认 Turbopack 在此工作树因 `node_modules` 符号链接位于工程根目录外而报错；这不代表 Scholar 代码编译失败，最终 PR 的 CI 仍需独立检查。

## 实际界面检查

- 在本地 Scholar Web 的约 513 px 宽度浏览器中打开现有测试书籍的元数据编辑页，确认 DOI 与 ISBN 在同一表单列中、长列表无横向溢出，锁定图标位于输入框内。只打开、取消编辑，未保存书籍数据。
- 深色主题检查发现共用 `FormField` 的浅灰底/灰字盖过主题色，已改用 `base` 主题色，同时修正锁定按钮的 RTL 方向和聚焦类。修复前后见[深色修复前](doi-editor-mobile-dark-before-2026-10-21.png)、[深色修复后](doi-editor-mobile-dark-after-2026-10-21.png)。
- [浅色主题](doi-editor-mobile-light-2026-10-21.png)与[墨水屏模式](doi-editor-mobile-eink-2026-10-21.png)也已目视检查；墨水屏输入框有清晰 1 px 边框。检查后浏览器恢复自动主题和关闭墨水屏模式。桌面宽度与原生客户端视觉尚未由本项证明。

## 未完成的 Phase 2 条件

文献 ID 与文件 ID 分离、集合/标签、批量导入、DOI 去重与查询、200+ 文献规模、Web/桌面实机双向元数据同步、跨账户隔离测试均未由本项证明。
