# Phase 3 集成 Web 候选构建与 staging 短暂升级回退

日期：2026-10-23。全部操作在 Linux 测试服务器，使用合成账户；未从本机上传代码或向 GitHub/GHCR 推送，未开放公网端口。源码为服务器分支 `feat/scholar-offline-metadata`，功能提交至 `cef7dcba3`；随后 `121006f1c` 仅补充验收说明。

## 构建与独立候选

服务器 `scholar-native-builder` 容器以 staging 回环 URL、Scholar Web 身份和 `BUILD_STANDALONE=true` 执行 `pnpm build-web`，退出码 0；Next 生产编译、TypeScript、页面数据与文件系统缓存步骤完成。构建日志位于 `/home/gavin/.cache/scholar-native-target/scholar-phase3-final-web-build.log`。私有构建环境位于服务器 0600 文件，不纳入 Git。

在服务器把 standalone、静态和公开资源封装为本地镜像 `scholar-phase3-web:final-candidate`，镜像 ID `sha256:3b1d265be2dbf0ce3e8f0bd59055b54389276f8d231f2023d0552da9e1c4ba2a`。独立回环端口 3148 上，书库与 PDF worker 为 200；匿名文件状态接口为 403；合成账户登录后，增量同步与 Paper 141 文件版本状态均为 200，返回预期字段。

## staging 短暂切换与恢复

升级前四路探针均 OK。私有快照 `/home/gavin/scholar-staging-backups/20261023T050608Z` 的 `STATUS=complete`，含可恢复 SQL 与对象副本；本次未做独立恢复，不能据此声称该快照已验收恢复。私有 Compose 覆盖文件与原配置逐字段比较，仅 `client.image` 不同，项目与所有回环绑定保持一致。

只重建 staging 的 Web 容器后，四路探针均 OK，实际容器镜像 ID 等于集成候选。经 staging 3130，合成账户的增量同步接口及文件版本状态接口均为 200。随后去掉覆盖文件并只重建 Web，实际镜像 ID 恢复为 `sha256:f5a0ddae78db6365b5dcce8138434292e548a75b8f71004dc138ad2b44c024cd`；四路探针再次 OK，其余五个 staging 容器 ID 指纹未变。执行脚本位于服务器私有目录 `/home/gavin/.readest-scholar-private/phase3-final-candidate/staging-smoke.sh`。

## 验收边界

这证明当前集成 Web 可构建、在真实合成 staging 上服务关键只读接口，并可按既有配置回退。它尚未覆盖新版候选上的双原生客户端文件正文并发、200+ 规模回归、移动端网络切换、完整镜像长时间运行，也没有把新镜像留在 staging。Phase 3 整体仍未签收。
