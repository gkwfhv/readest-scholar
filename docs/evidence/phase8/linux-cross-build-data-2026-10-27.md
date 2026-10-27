# Linux 不同构建包的数据保留与回滚演练（2026-10-27）

本次在服务器的独立 Docker 容器 `scholar-phase8-real-upgrade` 中使用合成 EPUB 和独立用户目录，不接触正式用户数据。两个 DEB 内含不同的 Readest Scholar 可执行文件，但包的 `Version` 都是 `0.12.16`。因此这是**不同构建间的原位替换与回滚**，尚不能代替正式跨语义版本的数据迁移验收。

| 阶段 | 来源 | 可执行文件 SHA-256 |
|---|---|---|
| 旧包 | Linux 候选 run `40339077779`，源码 `cf31dbf6e3d20f16f276465d4b6cf500deacd211` | `e3d8f3b734a71bcf80045a5b804b9d06267ecccd3b5143cb0116ec0e7c2d2fc6` |
| 新包 | [PR #74 Linux run 40510971667](https://github.com/gkwfhv/readest-scholar/actions/runs/40510971667)，PR 合并测试树 `b04bf32d2ed09074929106487301ee2615a95558` | `d3c6f8f436315ee37c73f3aed4579d8cf8d5dbdb8e9f02c531bf61598beb6641` |
| 回滚 | 重新安装旧包 | 恢复为 `e3d8f3b734a71bcf80045a5b804b9d06267ecccd3b5143cb0116ec0e7c2d2fc6` |

新包的 GitHub Actions artifact `12738278826` 与 PR head `916572d786fc5b78e2e63dbb69b56ff3b1d79d2f` 关联；`b04bf32d` 的父提交分别是当时的 `main` (`21e80a6a`) 与该 PR head。服务器直接下载归档，ZIP 完整性检查通过，内含 `SHA256SUMS` 校验通过。新 DEB 的 SHA-256 是 `f4ae84f5549b0873f97180ab15c4d89670185bd261398ae2a909273b7e060ca0`，包身份为 `readest-scholar 0.12.16 amd64`。

演练过程：

1. 在 Xvfb 下安装并启动旧包，通过原生文件选择器导入合成 `sample-table-transcript.epub`。
2. CDP 确认书库显示 `Transcript Table Sample`，点击后阅读页标题为同名，URL 含该书的 hash。
3. 结束应用进程，`dpkg -i` 安装新 DEB，保留 `/home/scholarqa`，重新启动；书库仍有该书，阅读页正常打开。
4. 再结束应用进程并安装旧 DEB；书库和阅读页仍能打开。
5. 三个阶段的 `library.json` SHA-256 均为 `4ef99f33628a8f28265edace857beaec2891320386dcdd89f42568e73164d04a`；导入的 EPUB SHA-256 均为 `eed7a7eb44aa206f645329c45dede9e969bc9828dfa274d387e3ab556cf1cd17`。

[PR #74 桌面候选 run 40510971783](https://github.com/gkwfhv/readest-scholar/actions/runs/40510971783) 的 Windows x64、macOS Arm/Intel 安装启动检查全部通过；上述 Linux run 的安装、启动、卸载与合成包版本切换检查也通过。

**尚未覆盖**：两个包的应用版本号相同，不能触发真实版本号迁移；没有测试签名包、Windows 自动更新的真实下载与安装、用户已有批注/同步数据的跨版本迁移。Phase 8 清单中的“实际不同版本及数据迁移”仍保持未完成，需发布候选版本号确定后重做。
