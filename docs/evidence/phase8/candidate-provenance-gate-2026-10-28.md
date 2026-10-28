# Phase 8 无签名候选来源清单门槛（2026-10-28）

本变更为 Linux DEB、macOS Arm/Intel DMG 和 Windows NSIS 候选包在上传 GitHub Actions artifact 前生成 `PROVENANCE.json`。该清单将 Scholar 版本、构建提交、GitHub Actions run ID、runner/目标、安装包 SHA-256、安装后文件清单 SHA-256、生产 npm 许可证报告 SHA-256 与已清点文件数绑定在一起。状态固定为 `unsigned-debug-candidate`，`releaseReady=false`，不会创建 Release 或启用更新渠道。

## 服务器验证

- 在 Linux 服务器的隔离 Node 24 构建容器（`--network none`）中，对真实 `Readest Scholar_0.12.17_amd64.deb` 候选运行校验。来源为 [Linux 候选 run 40522094835](https://github.com/gkwfhv/readest-scholar/actions/runs/40522094835) 下载并保存在服务器的副本；安装包 SHA-256 为 `7d63414e3b5cee87184760899b3ef67fc27c5512c021d7d327e9ca043e0e9370`，`BUILD.txt` 提交为 `b66bd0ab9589d2aa9f577391f173c2afd5a480ff`。配合既有生产 npm 许可证报告通过校验，清点 22 个安装文件；生成的清单明确标记未签名。
- 四个目标平台的合成小型候选格式均生成相应 artifact 名与来源清单。同一真实安装包的三个独立负例被拒绝：篡改 `SHA256SUMS`、把文件清单中的安装包哈希换成另一个值、要求不同的构建提交。
- 当前锁文件下，既有许可证报告通过 `check-scholar-npm-licenses.mjs`：945 条生产 npm 记录，1 个固定哈希的 Unknown 例外。新 CI 会在各平台候选作业中重新生成报告并运行相同门槛。
- Windows 首轮 CI 在固定 `khroma@2.1.0` 例外的锁文件文本匹配处失败：Windows checkout 使用 CRLF 行尾。校验器先把 CRLF 规范为 LF 后再比对同一完整 integrity；服务器容器验证了 LF、CRLF 均通过，篡改 integrity 仍被拒绝。许可证清单及例外内容未更改。
- 三份更新的工作流 YAML 已解析，校验脚本通过 Node 24 语法检查，`git diff --check` 通过。真实四平台端到端结论以本 PR 的候选作业为准。

## 边界

`PAYLOAD-FILES.cdx.json` 是已安装文件及其哈希清单，不是完整的 Rust/系统依赖许可证审计。来源清单也不提供代码签名、公证、漏洞风险接受或独立下载地址。正式发布仍受 Phase 8 清单与人工审批阻断。
