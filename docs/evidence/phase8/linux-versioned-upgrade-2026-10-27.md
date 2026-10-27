# Linux 真实版本升级与回滚验收（2026-10-27）

范围：服务器上的隔离 Linux 容器，使用同一位合成用户的数据目录与不同版本的 Readest Scholar amd64 DEB。容器为 `scholar-phase8-versioned`，测试期间 `--network none`。这是无签名候选包验收，不是正式更新渠道测试。

## 候选包与完整性

| 项目 | 旧版 | 新版 |
|---|---|---|
| 包版本 | `readest-scholar 0.12.16` | `readest-scholar 0.12.17` |
| 构建 | [Linux run 40339077779](https://github.com/gkwfhv/readest-scholar/actions/runs/40339077779) | [Linux run 40522094835](https://github.com/gkwfhv/readest-scholar/actions/runs/40522094835)，PR #77 head `4327cee79b2e45fcc3e8eb1fbd98a421cf1cc022` |
| DEB SHA-256 | `ce197eb566b702adecc179e920c7a493bebd162128a2ad455de913874df2957c` | `7d63414e3b5cee87184760899b3ef67fc27c5512c021d7d327e9ca043e0e9370` |
| 实际可执行文件 SHA-256 | `e3d8f3b734a71bcf80045a5b804b9d06267ecccd3b5143cb0116ec0e7c2d2fc6` | `eff9b3a56f877a983c8edc52c2ca093fa050564c91e44ef18c0c2cef192a87ca` |

新候选 ZIP 的 GitHub artifact SHA-256 为 `3cd3c3d7cda0915c1f39a668384b60293464f539ec264dac7148f7f0cfd3d0e4`。服务器下载后验证了完整 ZIP、包内 `SHA256SUMS`、DEB 的 `Package/Version/Architecture`，均通过。包内 `BUILD.txt` 记录 PR merge tree `b66bd0ab9589d2aa9f577391f173c2afd5a480ff`。

## 实际用户数据步骤

1. 在旧版 `0.12.16` 中导入仓库合成 EPUB `sample-table-transcript.epub`，打开 `Transcript Table Sample` 并添加书签。书籍 ID 为 `8e332e8ba7a911b070910204b94030bf`，书签已写入 `config.json`。
2. 保留同一应用数据目录，关闭客户端，以 `dpkg -i` 安装新版。包管理器报告 `0.12.17`；原生应用的 `plugin:app|version` 也返回 `0.12.17`。书库仍显示一本书，进入阅读器后标题正确，书签按钮显示已添加。
3. 关闭新版，用旧 DEB 执行 `dpkg -i` 回滚。包管理器和原生应用均回到 `0.12.16`，书籍仍能打开，书签仍在。

升级前、升级后和回滚后的三个文件 SHA-256 均一致：

| 文件 | SHA-256 |
|---|---|
| `Books/library.json` | `4fd0a269d3c15ec1069608b629f1cd3798df98f7c9afc5b47624149aa92963b8` |
| `Books/8e332e8ba7a911b070910204b94030bf/config.json`（含书签） | `efba415051cbd0ba83357d3db1711e2d211bbbb9faae074acf5b2e51690f0770` |
| `Books/8e332e8ba7a911b070910204b94030bf/Transcript Table Sample.epub` | `eed7a7eb44aa206f645329c45dede9e969bc9828dfa274d387e3ab556cf1cd17` |

新版包还在原生运行时验证了更新隔离：调用 `install_nightly_update` 返回 `Readest Scholar update channel is not configured`；调用默认 `plugin:updater|check` 返回 `Updater does not have any endpoints set.`。这只证明该无签名候选包不会主动使用上游更新源，未验证未来 Scholar 签名更新渠道。

## 结论与边界

Linux amd64 的真实 `0.12.16 → 0.12.17 → 0.12.16` 包替换、合成 EPUB/书签保留与短时启动通过。该样本未触发数据库模式迁移，不能代表大规模书库、其他桌面平台、移动端或长期运行。候选包未签名；正式签名、漏洞与许可证复核、真机和独立发布审批仍按 Phase 8 清单处理。
