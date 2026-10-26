# Phase 7 Android 模拟器验收记录（2026-10-26）

状态：上游身份 Android x86_64 调试包的模拟器阅读交互回归通过。此结论限于 Android API 34 模拟器，不代表 Readest Scholar 正式包、跨端同步或真机验收；后者仍按工程计划标为 experimental。

| 项目 | 环境与结果 |
|---|---|
| 构建与运行 | GitHub Actions `ubuntu-latest`，Android API 34 / Google APIs / x86_64 模拟器、KVM，调试 APK `com.bilingify.readest` |
| 首次成功 | [run 40277087713](https://github.com/gkwfhv/readest-scholar/actions/runs/40277087713)：5 套件、18/18 通过；但随后重复运行失败，故此时未验收 |
| 失败复现 | [run 40278828669](https://github.com/gkwfhv/readest-scholar/actions/runs/40278828669) 与后续诊断运行中，首个 `top-band-selection` 套件在打开测试 EPUB 后停留于 `/library?reload=...`；其余 16 项通过 |
| 根因 | Android VIEW Intent 已到达、排队并回放到 JS。带 `reload` 参数的第二次书库初始化与第一次并行处理同一文件，在 Turso 迁移表上发生 `UNIQUE constraint failed: __migrations.name (19)`；两次初始化交错还令书库路由的打开文件门控状态滞留 |
| 修复 | [`eacd501`](https://github.com/gkwfhv/readest-scholar/commit/eacd501800400c4f74acd41486f5d9a771a22ef9) 对书库初始化串行化，已卸载或离开书库的排队任务不再执行，文件保存完成后才允许下一次初始化；失败时保留 Intent/CDP 诊断。临时产品级跟踪已在 [`e19007e`](https://github.com/gkwfhv/readest-scholar/commit/e19007ef02399f94d5865bb54bf09c05de5f6a91) 移除 |
| 修复后复验 | [run 40288180613](https://github.com/gkwfhv/readest-scholar/actions/runs/40288180613)：5 套件、18/18 通过，0 跳过；[最终干净提交 run 40290109568](https://github.com/gkwfhv/readest-scholar/actions/runs/40290109568)：5 套件、18/18 通过，0 跳过，`top-band-selection` 32.8 秒，全程 139 秒 |
| 服务器静态检查 | Docker 构建容器内 Biome 与应用 TypeScript `--noEmit` 通过；未将服务器工作树中无关子模块状态纳入提交 |

已覆盖 EPUB 选区、系统选择菜单、页眉触控目标和双击标注入口。未覆盖 Android 真机、PDF、同步、离线、系统后台限制；这些能力保持 experimental，并在正式稳定发布前逐项补齐真实环境证据。
