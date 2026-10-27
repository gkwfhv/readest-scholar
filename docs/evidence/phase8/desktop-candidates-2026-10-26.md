# Phase 8 桌面候选包构建与工件检查（2026-10-26）

状态：三个平台的**无签名调试候选包**构建及只读工件检查通过；Linux 最新候选包已在 GitHub runner 完成 DEB 安装和无界面启动。macOS/Windows 尚未完成安装、启动；三个平台均未完成升级、卸载、签名或正式发布验收。工作流在 [PR #60](https://github.com/gkwfhv/readest-scholar/pull/60) 中，源分支提交为 `f1ed0a9299aab1aeed19681ad276f689b47d6663`。PR CI 实际检出的合并测试提交为 `cf31dbf6e3d20f16f276465d4b6cf500deacd211`，三份工件的 `BUILD.txt` 均记录此检出 SHA。

| 平台 | 构建与工件 | 安装包 SHA-256 | 独立核验 |
|---|---|---|---|
| macOS arm64 | [候选 CI](https://github.com/gkwfhv/readest-scholar/actions/runs/40339077906) / [DMG 工件](https://github.com/gkwfhv/readest-scholar/actions/runs/40339077906/artifacts/12659895371)：`Readest Scholar_0.12.16_aarch64.dmg` | `4de911ce50968b832b2ee3bdb18746541ff5f9b5d796c1c9e74ff6f7e9c4b9f9` | 服务器 `sha256sum -c` 通过；只读 `hdiutil verify` 有效，挂载后主 App 名称为 Readest Scholar、Bundle ID 为 `io.github.gkwfhv.readestscholar`，URL scheme 仅 `readest-scholar`，主二进制为 arm64 Mach-O |
| Windows x64 | [候选 CI](https://github.com/gkwfhv/readest-scholar/actions/runs/40339077906) / [NSIS 工件](https://github.com/gkwfhv/readest-scholar/actions/runs/40339077906/artifacts/12658439757)：`Readest Scholar_0.12.16_x64-setup.exe` | `ca49d6aa7adf2574b10d005ffea2ba52bc0c765336c4482807dd57697382c6dd` | 服务器 `sha256sum -c` 通过；`file` 识别为 Windows PE/NSIS 自解压安装器 |
| Linux amd64 | [候选 CI](https://github.com/gkwfhv/readest-scholar/actions/runs/40339077779) / [DEB 工件](https://github.com/gkwfhv/readest-scholar/actions/runs/40339077779/artifacts/12659895529)：`Readest Scholar_0.12.16_amd64.deb` | `ce197eb566b702adecc179e920c7a493bebd162128a2ad455de913874df2957c` | 服务器 `sha256sum -c` 通过；`dpkg-deb --field` 返回 `Package: readest-scholar`、`Version: 0.12.16`、`Architecture: amd64`，归档内有 `readest-scholar` 可执行文件和桌面入口 |

## 后续 Linux 安装与身份复验（北京时间 2026-10-27）

[最终 Linux CI run 40356196886](https://github.com/gkwfhv/readest-scholar/actions/runs/40356196886) 在源分支提交 `4877abf00cbdb20225616b7cd498c8916b054407` 上通过 DEB 构建、包身份及 SHA-256 校验、`dpkg -i` 安装、Xvfb 下的 8 秒存活检查和会话 D-Bus 名称检查。日志明确记录 `Setting up readest-scholar (0.12.16)` 与 `io.github.gkwfhv.readestscholar.SingleInstance`，并断言旧的 `com.bilingify.readest.SingleInstance` 不存在。对应 [Linux 工件](https://github.com/gkwfhv/readest-scholar/actions/runs/40356196886/artifacts/12666029716) 中 `Readest Scholar_0.12.16_amd64.deb` 的 CI SHA-256 为 `baaae6ffb7bf161569ba0d0c66421f8671e44c69ea8da158d1b37c93c05f18f7`。本次插件下载 400 MB 工件超过 120 秒限制，因此这个**最终包**的独立服务器二次哈希检查尚未完成；CI 自身的安装和校验均通过。

作为回归验证，服务器先在无网络隔离容器里安装旧版 DEB，使用相同的 Xvfb / D-Bus 查询，准确捕捉到旧名称 `com.bilingify.readest.SingleInstance`。最初 CI 安装发现 runner 缺少 DEB 声明的 `libxkbcommon-x11-0`；补齐运行库后最终作业通过。服务器构建工作树和推送均在 Linux 主机，macOS 本机仅执行了旧 DMG 的只读校验与挂载检查。[macOS/Windows 重新编译 run 40345391872](https://github.com/gkwfhv/readest-scholar/actions/runs/40345391872) 在 D-Bus 身份代码修复后两项通过，但尚未安装启动。

候选工件由只读权限的 GitHub Actions 上传，保留期为 7 天；它们是 CI 测试工件，不是 GitHub Release 的长期下载或已签名正式安装包。后续仍需完成 macOS/Windows 安装启动、各平台正式签名与公证、升级/卸载/回滚、每包 SBOM 和许可证/漏洞复核。移动平台没有真机证据，保持 experimental。
