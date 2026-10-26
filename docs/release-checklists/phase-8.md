# Phase 8 发布准备清单（2026-10-26）

状态：准备中；未创建预发布或稳定 Release。稳定发布需要受保护审批，且不得把模拟器结果当作真机结果。

## 已有可复用证据

- Phase 0–6 的限定范围验收见 [路线图](../../ROADMAP.md)，Phase 4/5/6 仍在开放 PR #52/#53/#54。
- Phase 7 Android API 34 模拟器：基线 [run 40290109568](https://github.com/gkwfhv/readest-scholar/actions/runs/40290109568) 与 Scholar 身份包 [run 40290855604](https://github.com/gkwfhv/readest-scholar/actions/runs/40290855604) 均为 18/18 阅读交互测试通过；后续基线重跑出现一个准备钩子超时，仍在调查。
- Phase 7 iOS：Scholar 身份包 [run 40290699256](https://github.com/gkwfhv/readest-scholar/actions/runs/40290699256) 完成无签名模拟器构建、Bundle ID、安装、启动和非空白首屏门槛。
- `scholar-baseline.yml` 生成生产 npm 许可证清单与源码 CycloneDX SBOM；`docker-image.yml` 为 GHCR 双架构镜像生成 SBOM；CodeQL 独立检查。
- 本分支限制上游 `release.yml`、`nightly.yml` 和 `upload-to-r2.yml` 只在 `readest/readest` 仓库运行，以免 Scholar fork 的发布动作执行上游分发流程。

## 发布前待完成

- [ ] 将 Phase 4–7 的代码与证据合入受保护主线，并在最终提交运行必需检查。
- [ ] 清点正式品牌、图标、Bundle ID、URL Scheme、更新源、分享扩展、小组件、容器镜像名及所有安装包的元数据；复核 Readest 商标与第三方许可证。
- [ ] 归档最终源码、容器和安装包 SBOM，审查漏洞扫描发现并记录处理或风险接受。
- [ ] 用正式签名证书构建 macOS、Windows、Linux、Android 和 iOS 产物；每个平台做安装、启动、升级、卸载与回滚演练。没有真机证据的平台明确标 experimental，不能进入稳定版平台矩阵。
- [ ] 为每个候选产物记录提交 SHA、构建运行、SHA-256、签名验证结果和下载地址；人工验收候选，再申请受保护审批。
- [ ] 预发布页提供源码、许可证、校验值、部署/升级/回滚指南；发布后监测下载、启动和服务健康。

上游 `release.yml` 依赖 Readest 的签名、Discord 和 R2 环境，不能用来发布 Scholar。正式 Scholar 发布需要专用、受保护且经审查的工作流；当前模拟器 ZIP 仅是测试工件，不是安装包发行候选。
