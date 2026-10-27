# Phase 8 剩余 RustSec 命中的可达范围（2026-10-27）

范围：以 PR #74 的锁文件和 Readest Scholar 支持的 Linux、macOS、Windows、Android、iOS 目标为准。服务器缓存公告库报告两条命中；正式结论还需以该 PR 的实时 RustSec CI 和各平台候选包为准。本记录是源码与目标配置复核，不是发布风险接受。

| 命中 | 依赖来源 | 已核对的调用范围 | 待决定事项 |
|---|---|---|---|
| [RUSTSEC-2021-0119](https://rustsec.org/advisories/RUSTSEC-2021-0119.html) `nix 0.19.1` | `tauri-plugin-device-info 1.0.1 → battery 0.7.8 → nix` | `battery 0.7.8` 仅在 `cfg(any(target_os = "dragonfly", target_os = "freebsd"))` 声明 `nix ~0.19`。device-info 仅为 Linux、macOS、Windows 声明 battery；服务器 `cargo tree --locked --offline --target x86_64-unknown-linux-gnu -i nix@0.19.1` 无节点。公告影响 `nix::unistd::getgrouplist`；上述目标的包不会编译这条 FreeBSD/DragonFly 依赖。 | 安全负责人可审核目标范围后决定是否将此锁文件命中列为不适用；如果以后支持 FreeBSD/DragonFly，必须先更换 battery/nix 依赖并复验。 |
| [RUSTSEC-2023-0071](https://rustsec.org/advisories/RUSTSEC-2023-0071.html) `rsa 0.9.10` | 唯一直接使用者是固定在 `1609ca7cd5689e10cc4703e7ce178513e5d95b11` 的 `readest/localsend` | 源码 `packages/core/src/crypto/cert.rs` 使用 RSA 私钥生成自签 TLS 证书；`crypto/token.rs` 仅以 RSA-PSS 公钥验签兼容旧式令牌。该版本 LocalSend 源码搜索未见 RSA 解密调用。公告涉及可由攻击者观察的私钥解密计时泄露，并明确没有修复版本。 | 需复核 LocalSend 的 TLS/令牌威胁模型与下游库路径，决定是否允许带此依赖发布、禁用相关功能或等待上游修复；不能仅因静态搜索无调用就宣称风险消除。 |

两条均继续受精确 RustSec 漂移门槛约束；新增、版本变化或报告不完整会使 CI 失败。签名凭据、真机、跨版本数据迁移及正式发布审批仍是独立门槛。
