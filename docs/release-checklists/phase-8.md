# Phase 8 发布准备清单（更新于 2026-10-27）

状态：准备中；未创建预发布或稳定 Release。正式发布需要受保护审批。模拟器验收只覆盖限定范围，Android/iOS 没有真机证据，均保持 experimental。

## 已取得的证据

- Phase 0–6 的限定范围验收见 [路线图](../../ROADMAP.md)；Phase 4/5/6 的 PR #52/#53/#54 已合并到 main。
- Phase 7 Android：基线 [run 40325146120](https://github.com/gkwfhv/readest-scholar/actions/runs/40325146120) 和 Scholar 身份包 [run 40325199271](https://github.com/gkwfhv/readest-scholar/actions/runs/40325199271) 在 API 34 AOSP x86_64 模拟器上各完成 5 套件、18/18 阅读交互测试；后者冷启动书库、CDP 布局检查与截图均通过。证据与先前失败诊断在 [PR #57](https://github.com/gkwfhv/readest-scholar/pull/57)。
- Phase 7 iOS：[run 40323775458](https://github.com/gkwfhv/readest-scholar/actions/runs/40323775458) 完成无签名模拟器构建、编译产物品牌元数据核对、安装、启动和非空白书库首屏截图。证据在 [PR #59](https://github.com/gkwfhv/readest-scholar/pull/59)。
- `scholar-baseline.yml` 生成生产 npm 许可证清单与源码 CycloneDX SBOM；`docker-image.yml` 为现有 GHCR 镜像生成双架构 SBOM；CodeQL 独立检查。
- 主线已限制上游 `release.yml`、`nightly.yml` 和 `upload-to-r2.yml` 只在 `readest/readest` 仓库运行，避免 Scholar fork 执行上游分发流程。 `docker-image.yml` 在 Scholar 仓库后续构建使用 `ghcr.io/gkwfhv/readest-scholar`，上游仓库仍使用 `readest`；PR #60 已合并，但尚未创建 Scholar Release。
- [生产 npm 依赖审计](../evidence/phase8/production-dependency-audit-2026-10-26.md)在服务器容器更新依赖后为 0 条公告，并增加 PR/主线只读 CI；Rust、容器镜像与第三方许可证仍待审查。
- [PR #61](https://github.com/gkwfhv/readest-scholar/pull/61) 已合并，其依赖更新将生产 npm 审计降至 0 条，RustSec 命中从 14 条降至 5 条；剩余条目与调用路径见 [Rust 依赖审计](../evidence/phase8/rust-dependency-audit-2026-10-26.md)。尚未作正式风险接受。
- [桌面候选包工件检查](../evidence/phase8/desktop-candidates-2026-10-26.md)完成 macOS arm64 DMG、Windows x64 NSIS、Linux amd64 DEB 的无签名调试构建与哈希/品牌元数据检查；[Linux 最终 CI](https://github.com/gkwfhv/readest-scholar/actions/runs/40356196886) 还完成 DEB 安装、Xvfb 启动与 Scholar D-Bus 身份检查。macOS/Windows 的无签名候选安装启动已在 [PR #62 的最终 CI](https://github.com/gkwfhv/readest-scholar/actions/runs/40455618697) 通过，Windows 静默卸载也通过；PR #62 已合并。见 [桌面安装冒烟证据](../evidence/phase8/desktop-install-smoke-2026-10-27.md)。
- [PR #64 候选包完整性证据](../evidence/phase8/candidate-integrity-2026-10-27.md)：macOS、Windows、Linux 三端安装前的 SHA-256 清单校验通过，Linux 卸载及可执行文件移除通过；最终平台 CI 均成功，PR #64 已合并。

## 发布前待完成

- [x] Phase 4–7 代码与证据已按依赖顺序合入受保护主线，最终 PR 提交的必需检查通过。Phase 7 的 Android [最终证据 run 40327652442](https://github.com/gkwfhv/readest-scholar/actions/runs/40327652442) 与 iOS [最终证据 run 40328733437](https://github.com/gkwfhv/readest-scholar/actions/runs/40328733437) 已通过。
- [ ] 清点正式品牌、应用图标、Bundle ID、URL scheme、更新源、分享扩展、小组件及容器镜像名称；复核 Readest 商标、AGPL 和第三方许可证。
- [ ] 在最终源码与每个平台候选产物上归档 SBOM、许可证和漏洞扫描结果；处理或经人工审批接受剩余 RustSec 项。
- [ ] 为 Scholar 建立受保护的正式发布工作流，不复用上游签名、Discord、R2 或自动更新目标；独立的短期候选包 CI 已建立，尚非正式 Release。
- [ ] 用正式签名证书构建和验证 macOS、Windows、Linux、Android、iOS 产物；各平台完成安装、启动、升级、卸载和回滚。无真机证据的平台只能列为 experimental。
- [ ] 每个候选产物记录提交 SHA、构建运行、SHA-256、签名校验及下载地址；完成用户验收后再申请发布审批。
- [ ] 预发布页提供源码、许可证、校验值、部署/升级/回滚指南；发布后监测下载、启动和服务健康。

当前 CI 模拟器 ZIP 仅为测试工件，不能作为正式移动端安装包发行。
