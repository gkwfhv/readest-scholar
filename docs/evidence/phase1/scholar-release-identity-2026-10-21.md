# Phase 1：Readest Scholar 正式身份本地验证（2026-10-21）

用户已明确批准产品名 **Readest Scholar** 和 Bundle ID `io.github.gkwfhv.readestscholar`。本记录只验收这个身份的未签名 macOS 本地包；独立的 `Readest Silo Test` 合成测试包继续使用自己的标识。

## 实现与防混用

- `apps/readest-app/src-tauri/scholar.release.json` 指定产品名、可执行文件名、Bundle ID 和独立的 `readest-scholar://` 注册方案；禁用上游更新端点及更新产物生成。
- `apps/readest-app/scripts/build-scholar-macos-smoke.mjs` 要求显式提供自托管 URL 和公开 anon key；拒绝缺失配置、非回环 HTTP 地址、Readest 与 Supabase 官方域名。它只执行未签名本地构建，不发布安装包。
- Rust 根据 Bundle ID 禁止调用上游 Tauri 更新通道；前端在主窗口和新阅读窗口均识别 Scholar 构建，隐藏更新及上游发布说明入口。系统窗口标题、页面标题、关于菜单和版本复制文本采用批准的名称。关于窗口的源码链接指向 Scholar fork，避免把上游服务条款、隐私政策和社区支持误作 Scholar 自有服务。

## 执行结果

- Node 24.19.0 静态导出成功：25/25 静态页面、3/3 导出页面。Tauri debug `--no-sign --bundles app` 编译和 `.app` 打包成功；没有生成待发布的更新包。Node 26.5.0 首次构建触及默认 4 GiB V8 堆上限，改用 Node 24 并给本地构建 6144 MiB 上限后成功。
- 定向 Vitest：6 个文件、159 项通过；`tsc --noEmit`、所改 TypeScript 的 Biome 检查、`rustfmt --check --edition 2021` 及 Rust 定向测试 `scholar_release_bundle_never_uses_upstream_updater`（1/1）通过。全量测试曾发现 `nav-window.test.ts` 的旧环境 mock 未提供新名称函数；补齐 mock 后该文件 5/5 通过，最终全量回归由 PR CI 复核。
- `Info.plist` 实测 `CFBundleIdentifier=io.github.gkwfhv.readestscholar`、`CFBundleName=Readest Scholar`、`CFBundleExecutable=readest-scholar`、唯一 URL scheme 为 `readest-scholar`。最终本机可执行文件 SHA-256 为 `888ebabd2e18e2d793f5d3789fcd929e76a99df6ec093631ed8432b069264914`。
- 启动后书库窗口标题和 WebView 页面标题均为 `Readest Scholar`；导入仓库合成 `sample-paper.pdf` 后，新阅读窗口创建时即显示 `Readest Scholar`，PDF 加载后为 `Readest Scholar - Author Guidelines for 8`。本地 PDF 在第 1/2 页可阅读。阅读器“关于 Readest Scholar”菜单及窗口名称一致；源码链接到 Scholar fork，未出现上游更新、发布说明、服务条款或隐私政策入口。见[阅读器截图](scholar-release-identity-reader-2026-10-21.jpg)和[关于窗口截图](scholar-release-identity-about-2026-10-21.jpg)。最后一轮窗口标题复验使用本地占位公开 key，只验收离线阅读；不将其视为 staging 登录或同步测试。

## 尚未验收

- 该包未签名、未公证，也没有正式更新源或分发许可；不能作为发布候选。正式签名及发布仍按工程计划走受保护环境和人工审批。
- 注册了独立 scheme，但当前部分 OAuth、分享与书籍链接仍生成或解析 `readest://`；必须在独立任务中改为兼容 Scholar scheme，再测试登录回调和跨窗口链接。此次仅实测本地 PDF 阅读，未把深度链接记为通过。
- Windows、Linux、Android、iOS 的正式身份包尚未构建和设备验收。独立测试包中的四个侧栏入口及大脑图标已在[Web→桌面同步复验](web-to-desktop-progress-2026-10-20.md)的真实截图核对；本次未登录的正式包只显示本地阅读可用的三个入口，不将其当作四入口布局验收。
