# Phase 1：独立桌面测试包更新渠道隔离（2026-10-20）

范围：macOS 上未签名的 `Readest Silo Test.app`，Bundle ID 为 `com.readest.scholar.silo-test`。这是合成 staging 的测试客户端，不是正式 Scholar 安装包或自动更新渠道。

## 风险与修复

测试包沿用上游 Readest 的 Tauri 更新端点和公钥。仅替换 Bundle ID 仍可能显示上游更新入口，或者通过日志入口读取上游发布说明。现在以 `com.readest.scholar.` 前缀识别隔离测试包：Rust 的 `is_updater_disabled` 命令及 WebView 初始化标记均禁用其应用内更新；JS 更新检查和发布日志函数在发起网络请求前直接返回；关于窗口不显示更新或日志按钮。上游 `com.bilingify.readest` 的更新行为保留。

## 验证

- Rust 定向测试 `scholar_test_bundle_never_uses_upstream_updater` 通过，覆盖 macOS/Windows 形态、Linux AppImage 形态及上游 Bundle ID 对照；`cargo fmt -p Readest --check` 通过。代码改动前，新增调用点曾因签名不匹配无法编译；修复后定向测试通过。
- JS 新测试先在旧行为上失败：Scholar 测试包的关于窗口仍出现 `Changelog`，直接调用更新检查仍进入 Tauri `check()`，直接调用发布日志仍返回上游内容。修复后 `AboutWindow.test.tsx` 与 `updater.test.ts` 共 **56/56** 通过；Biome 对六个相关文件检查通过。
- Node 24、8 GiB heap 下的 Next.js Webpack 静态导出成功：25/25 静态页面、3/3 导出任务；TypeScript 通过。Tauri `--debug --bundles app --no-sign --ci` 生成未签名 macOS app 成功。构建仍会生成一个未签名的 `.app.tar.gz`，本次没有上传、签名或发布它。
- 重启最终测试包后，图书馆可打开已有两本合成书；“关于 Readest”仅显示版本、许可等信息，没有“检查更新”“更新日志”按钮。见 [实际客户端截图](scholar-test-updater-isolated-2026-10-20.jpg)。先前构建中的“更新日志”入口曾打开上游 `Readest 更新功能` 窗口；最终包已关闭该入口。

本次验证只证明隔离测试包不使用上游自动更新或发布日志。正式 Scholar 品牌、Bundle ID、签名证书、私有发布源、签名更新包与安装后升级/回退流程尚未确定和验收；不能据此宣称桌面更新分发完成。
