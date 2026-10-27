# Phase 8 无签名候选包校验与 Linux 卸载（2026-10-27）

状态：[PR #64](https://github.com/gkwfhv/readest-scholar/pull/64) 源提交 `04fc8fac93a4eab38ef441d8db3ee6f9b82980f9` 的限定范围 CI 全部通过；PR #64 已 squash 合并为 `ff9bcc589b924aca811d597b3e4d48215a7210fb`。工作流只生成短期调试工件，不创建 Release。

| 平台 | 最终运行及工件 | 新增断言 | 既有安装检查 | 结论 |
|---|---|---|---|---|
| macOS arm64 | [desktop run 40459763298](https://github.com/gkwfhv/readest-scholar/actions/runs/40459763298)，artifact `12714821372` | 安装前以 `SHA256SUMS` 校验 DMG | 挂载、Bundle ID、复制、8 秒启动存活 | 全部通过 |
| Windows x64 | [desktop run 40459763298](https://github.com/gkwfhv/readest-scholar/actions/runs/40459763298)，artifact `12714951570` | 安装前以 `SHA256SUMS` 校验 NSIS EXE | 静默安装、实际安装目录中的程序启动、静默卸载并检查 EXE 移除 | 全部通过 |
| Linux amd64 | [Linux run 40459763402](https://github.com/gkwfhv/readest-scholar/actions/runs/40459763402)，artifact `12714631272` | 安装前以 `SHA256SUMS` 校验 DEB；运行后 `dpkg --remove` 并检查 `/usr/bin/readest-scholar` 移除 | DEB 安装、Xvfb 启动、Scholar D-Bus 名称 | 全部通过 |

同一源提交的 Scholar baseline、PR checks、CodeQL 和生产 npm 依赖审计均成功。服务器对工作流 YAML 做了解析，并通过 `git diff --check`；平台运行结果以 GitHub Actions 为准。

校验步骤在同一 runner 生成 SHA-256 清单后、安装前执行，证明安装使用的本地候选文件与该清单一致。它**不证明**下载后的工件已独立复核，也不代替签名、长期保存或供应链证明。三份 artifact 的保留期为 7 天，不能作为正式下载页。此轮仍未验证升级、回滚、macOS/Windows 阅读交互、签名与公证、每包 SBOM/许可证、移动真机；Phase 8 尚未完成。
