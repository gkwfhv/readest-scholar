# Phase 8 Rust 依赖审计（2026-10-26）

服务器隔离容器使用 `cargo-audit 0.22.2` 对根目录 `Cargo.lock` 的 1067 个依赖条目扫描。首次使用 RustSec 数据库提交 `21d909e4c8bd4e14c7aea58bf980c881a0053ab1`（数据库标记更新于 2026-10-24），发现 14 条漏洞命中。报告保存在服务器 `/home/gavin/readest-scholar-artifacts/phase8-cargo-audit-2026-10-26.json`，未包含密钥。

| 处理 | 依赖与结果 |
|---|---|
| 同系列补丁升级 | `quinn-proto` 0.11.17→0.11.18；`rustls-webpki` 0.103.15→0.103.16；`webpki-root-certs` 1.0.9→1.0.10；`webpki-roots` 1.0.9→1.0.10 |
| 复扫 | 在同一缓存数据库上执行 `cargo audit --no-fetch --file Cargo.lock --json`，锁文件补丁升级后为 8 条；应用直接依赖 `zip` 2.4.2→9.1.1 后为 5 条。由于本次未刷新数据库，复扫只证明这些升级对同一公告集有效 |
| 编译与回归 | `cargo check -p Readest --locked --offline` 与 `cargo test -p Readest --lib --locked --offline` 在服务器 Linux 容器通过，后者 190/190；ZIP 9 的名称 API 改为显式处理无效名称 |

剩余 5 条命中来自三个依赖实例：

- `nix 0.19.1`：[RUSTSEC-2021-0119](https://rustsec.org/advisories/RUSTSEC-2021-0119.html)，路径为 `Readest → tauri-plugin-device-info → battery → nix`；需升级或替换插件，并核实受影响函数是否可达。
- `rsa 0.9.10`：[RUSTSEC-2023-0071](https://rustsec.org/advisories/RUSTSEC-2023-0071.html)，路径为 `Readest → localsend → rsa`；公告无修复版本，需评估 LocalSend 使用的密钥操作并给出隔离或替代方案。
- 应用直接依赖的 `zip` 已从 2.4.2 升至 9.1.1，移除对应 3 条命中。EPUB、漫画、备份及浏览器归档测试包含在 190 项 Rust 单测中；这些 Linux 单测不能代替各平台安装验证。
- `zip 4.6.1`：同三条公告，由 `tauri-plugin-updater 2.11.0` 引入；需检查上游插件版本或在受控分支替换解包实现。

调用范围复核：`nix` 的受影响函数为 `getgrouplist`，`battery` 源码没有该调用，而且其 `nix` 依赖仅声明在 BSD 目标；`localsend` 当前使用 RSA 生成证书及验证 RSA-PSS 签名，没有发现公告针对的私钥解密调用；Windows 更新器会调用 `ZipArchive::extract()`，下载流程在安装前校验签名，但公开的 `install(bytes)` 入口本身不做此校验。Scholar 身份包的上游自动更新入口已禁用。上述静态检查降低已知 Scholar 使用路径的风险，不能替代 Windows 产物验证、更新器上游修复或正式风险接受。

这些余项仍是 Phase 8 发布阻断项。不能仅凭 Linux `cargo check` 声称 macOS、Windows、Android 或 iOS 产物已验证；也不能把版本命中直接等同于当前代码路径可利用。
