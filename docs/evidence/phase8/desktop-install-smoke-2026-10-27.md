# Phase 8 桌面候选包安装启动冒烟（2026-10-27）

状态：PR #62 的最终提交 `0499f84db8d36e6f16c7acd26f8c49f15e446869` 已在 [GitHub Actions run 40455618697](https://github.com/gkwfhv/readest-scholar/actions/runs/40455618697) 通过；PR 尚待合并。工作流只构建无签名调试候选包，不创建 Release。

| 平台 | 产物与检查 | 结论 |
|---|---|---|
| macOS arm64 | DMG 挂载、读取 `CFBundleIdentifier=io.github.gkwfhv.readestscholar`、复制 App、直接启动并确认进程持续运行 8 秒 | 通过；最终工作流 artifact `12712996856` |
| Windows x64 | NSIS 静默安装、从卸载注册表读取实际安装目录、运行 `readest-scholar.exe` 8 秒、静默卸载并确认可执行文件移除 | 通过；最终工作流 artifact `12713245703` |
| Linux amd64 | DEB 安装、Xvfb 启动、Scholar D-Bus 名称断言 | 早前 [run 40356196886](https://github.com/gkwfhv/readest-scholar/actions/runs/40356196886) 通过 |

首轮 Windows 测试错误地假设 NSIS 会采用 `/D=` 指定的目录。安装命令返回 0，但脚本在假定目录未找到可执行文件。项目的 NSIS `installMode` 为 `both`；[Tauri 上游问题 #16006](https://github.com/tauri-apps/tauri/issues/16006) 记录了该模式的静默安装可能忽略 `/D=`。最终工作流改为检查系统实际注册的安装位置，验证安装、启动和卸载。

此次测试只证明短时进程存活及安装行为，没有完成 macOS/Windows 阅读交互、升级、回滚、正式签名、公证、分发或真机测试。候选包工件保留 7 天；每个平台包内的 `SHA256SUMS` 仍需在发布候选审查时与下载产物复核。
