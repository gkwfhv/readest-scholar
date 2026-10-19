# Agent 状态

更新时间：2026-10-19。

## 已完成

- 阅读方案，并把第一步限定为 Phase 0 与可验证的 Phase 1 准备。
- 从 GitHub 锁定 Readest `main` 为 `2d37bbfc2e94725e1343ab2a825573545aa59f5f`。
- 阅读该提交上的 `AGENTS.md`、`docs/architecture.md`、`docs/code-layout.md`、`docs/testing.md`、`docker/README.md`。
- 核对服务目录、同步类别、基础表、AI RAG、许可证标识。
- 写出 `docs/audit/*`、`docs/adr/0001-foundation.md`、`LICENSES.md`、`VERSIONS.md`。
- 在工作区安装 pnpm `11.1.1` 与 Node `24.11.1` 到 `.tools/`，未做全局安装。
- 为本机验证新增仅绑定回环地址的 Compose 覆盖文件及随机测试凭据生成器；配置解析已验证。
- 补齐 `js-mdict` 和 `tauri-plugin-turso` 子模块，生成本地 PDF vendor 资源。
- 修正审计中对 AI CFI 引用、手绘坐标和 AI 会话存储的判断，并保存 Node 24 全量测试证据。
- 加固备份脚本的私有权限与完成标记，假 Docker 的成功/失败路径测试已通过。
- 用固定摘要的 Pigsty MinIO 兼容镜像运行官方 Compose 的本机测试覆盖：合成账户已登录，独立桌面端上传仓库 PDF，Web 端下载并打开同一本两页 PDF。
- 对合成数据生成真实数据库与对象备份；发现并修复原始 `pg_dump` 缺少 GraphQL 包装函数的问题，生成可恢复 SQL。在第二套完整独立服务栈中恢复 SQL/对象后，以合成账户登录、下载并阅读 PDF，页面显示阅读进度已同步。
- 按上游 `pnpm worktree:new` 流程建立 `feat/scholar-foundation` 工作树；将方案、审计、演练文档和基础设施脚本整理进同一源码树，修正脚本的仓库根路径。新增 Scholar CI 的备份逻辑、Compose 回环端口检查与源码依赖清单作业；本地脚本检查已通过，远端 CI 尚未运行。

## 当前事实

- 当前 Scholar 工作树的上游基点为 `2d37bbfc2e94725e1343ab2a825573545aa59f5f`，分支 `feat/scholar-foundation`。`origin` 仍指向官方 `readest/readest`；尚未向任何远端推送 Scholar 改动。
- 除仅供 Agent 使用的 `gstack` 外，7 个源码子模块均已初始化到锁定提交。
- 依赖安装第二次成功。
- Node 24 全量单测退出码 1：13752 通过、3 失败、16 跳过。失败均为 Turso Node 向量 L2 距离精度断言；浏览器 WASM 对照 54 项通过、1 跳过。Node 26 加禁用实验性 Web Storage 开关后的同一原生测试仍出现完全相同的 3 个失败。详见 `docs/evidence/phase0/`。首次 Node 26 全量运行中的大量 `localStorage` 错误属于不匹配的环境，不能用它替代 Node 24 基线。
- Node 24 与 Node 26 下 lint 均退出 0；代表性 PDF/样式测试 77 项通过。
- Rust `1.99.1`、rustfmt 和 Clippy 已装到工作区。Tauri 静态前端、Rust 调试编译及独立应用标识的未签名 `.app` 均构建通过。Docker daemon 已启动；官方 MinIO/mc 镜像拉取返回 401，固定摘要的替代镜像测试栈已启动并完成跨端文件验证。
- Node 24 Web 生产构建在沙箱外通过；本机 `start-web` 只绑定 `127.0.0.1`，无头 Chromium 从文件导入并打开仓库测试 PDF，显示第 1/2 页。截图在 `docs/evidence/phase0/`。
- 独立标识 `com.readest.scholar.phase0` 的 macOS 桌面测试版已从文件导入并打开同一份 PDF，界面显示第 1/2 页正文；随后登录本机测试账户并手动触发文件上传。数据库中合成账户/书籍/文件为 `1/1/2`，书籍 `uploaded_at` 非空；Web 端显示该书、下载后打开第 1/2 页正文。
- 第二套 `scholar-restore-rehearsal` 使用独立容器、数据库卷、对象副本和回环端口 `3100/8100/9100/9101`，从零启动后恢复、登录及阅读通过。恢复后的库包含 `1/1/2` 个合成账户/书籍/文件，PDF 从对象存储下载后显示第 2/2 页。
- 尚无 `gkwfhv/readest-scholar` Scholar 远端、受保护分支或签名凭据。GitHub 连接尚未建立。

## 下一动作

1. 调查 `@tursodatabase/database` macOS arm64 原生 L2 距离实现；Node 24/26 结果相同，浏览器 WASM 对照通过。保留真实数值，不放宽断言。
2. 比较官方 MinIO 的可用分发或可复现构建，不把替代镜像测试当成原版官方 Compose 通过；补充备份后的升级与回滚演练。
3. 在 GitHub 连接建立后创建私有 `gkwfhv/readest-scholar` 仓库并推送此分支，配置受保护的 `main` 与必需检查，运行 Scholar 和上游 CI。完成许可证/SBOM、AI/批注基线和关键路径证据。Phase 0 全项通过前，不开始文献管理或翻译 Worker。

## 阻塞

- Node 24 的 3 个 Turso 向量距离断言失败，原因待定位。
- 桌面与 Web 已完成合成 PDF 的文件同步实测；备份恢复后 Web 阅读器显示“阅读进度已同步”及第 2/2 页。进度双向更新、批注和离线冲突尚未端到端验收。
- 官方 MinIO/mc 镜像拉取 401，原版镜像的 Compose 验收仍阻塞。固定摘要替代镜像的本机测试已通过；官方 `compose.yaml` 默认广域发布端口，本工作区覆盖文件限制为回环地址。
- 没有 Scholar 受保护远端或已运行的 CI；当前 `.github/workflows/scholar-baseline.yml` 已实现本地基础设施与源码清单检查，但仅在本机验证了前者。自动部署需要 staging 目标与受保护环境，正式发布另需授权。
