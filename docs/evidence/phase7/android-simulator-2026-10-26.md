# Phase 7 Android 模拟器验收记录（2026-10-26）

状态：上游身份 Android 调试包的模拟器选区回归一次通过、一次失败，尚未稳定通过。此项只验证 Android 基线阅读交互，不代表 Readest Scholar 正式 Android 包、跨端同步或真机验收。

| 项目 | 环境与结果 |
|---|---|
| 构建环境 | GitHub Actions `ubuntu-latest`，Android API 34 / Google APIs / x86_64 模拟器，KVM，调试 APK `com.bilingify.readest` |
| 失败复现 | [旧提交两次运行](https://github.com/gkwfhv/readest-scholar/actions/runs/40274030379)均在首个 `top-band-selection` 套件的 `openFixtureBook` 等待读者页 30 秒时超时；其余 4 个套件合计 16 项通过，首套件 2 项跳过 |
| 修复 | `1fec0fa7c` 将新安装后的阅读页等待上限延长到 90 秒；超时输出 VIEW 启动结果和 CDP 页面 URL，便于区分启动延迟、意图分发和 WebView 异常 |
| 首次复验 | [Android E2E run 40277087713](https://github.com/gkwfhv/readest-scholar/actions/runs/40277087713) 成功：5 个套件、18/18 项通过，0 跳过；首套件 2 项用时 29.6 秒，全程 124.67 秒 |
| 服务器静态检查 | 针对修改文件的 Biome 检查、应用 TypeScript `--noEmit` 通过；原先因新工作树未复制 simplecc WASM dist 而出现的两条模块缺失错误，在按仓库工作树脚本复制 dist 后消失 |

重复运行：[Android E2E run 40278828669](https://github.com/gkwfhv/readest-scholar/actions/runs/40278828669) 仍在首个套件失败（其余 16 项通过、2 项跳过）：Android VIEW Intent 已发到包，90 秒后 CDP 页面仍为 `/library?reload=...`。这排除了单纯超时不足，下一轮会记录 NativeBridgePlugin 的意图队列与回放日志，定位冷启动丢失。验证范围包括 EPUB 选区、系统选择菜单、页眉触控目标和双击标注入口。尚未验证 Scholar 包身份、Android PDF/同步/离线、后台限制或真实设备；按工程计划这些平台能力继续标为 experimental。
