# Phase 8 Rust 依赖审计（2026-10-26）

服务器隔离容器使用 `cargo-audit 0.22.2` 对根目录 `Cargo.lock` 的 1067 个依赖条目扫描。首次使用 RustSec 数据库提交 `21d909e4c8bd4e14c7aea58bf980c881a0053ab1`（数据库标记更新于 2026-10-24），发现 14 条漏洞命中。报告保存在服务器 `/home/gavin/readest-scholar-artifacts/phase8-cargo-audit-2026-10-26.json`，未包含密钥。

| 处理 | 依赖与结果 |
|---|---|
| 同系列补丁升级 | `quinn-proto` 0.11.17→0.11.18；`rustls-webpki` 0.103.15→0.103.16；`webpki-root-certs` 1.0.9→1.0.10；`webpki-roots` 1.0.9→1.0.10 |
| 复扫 | 在同一缓存数据库上执行 `cargo audit --no-fetch --file Cargo.lock --json`，漏洞命中从 14 降至 8；由于本次未刷新数据库，复扫只证明上述锁文件升级对同一公告集有效 |
| 编译 | `cargo check -p Readest --locked` 在服务器 Linux 构建容器通过 |

剩余 8 条命中来自四个依赖实例：

- `nix 0.19.1`：[RUSTSEC-2021-0119](https://rustsec.org/advisories/RUSTSEC-2021-0119.html)，路径为 `Readest → tauri-plugin-device-info → battery → nix`；需升级或替换插件，并核实受影响函数是否可达。
- `rsa 0.9.10`：[RUSTSEC-2023-0071](https://rustsec.org/advisories/RUSTSEC-2023-0071.html)，路径为 `Readest → localsend → rsa`；公告无修复版本，需评估 LocalSend 使用的密钥操作并给出隔离或替代方案。
- `zip 2.4.2`：[RUSTSEC-2026-0367](https://rustsec.org/advisories/RUSTSEC-2026-0367.html)、[0368](https://rustsec.org/advisories/RUSTSEC-2026-0368.html)、[0369](https://rustsec.org/advisories/RUSTSEC-2026-0369.html)，由 Readest 直接依赖；根目录声明为 `zip = "2"`。公告修复起点为 9.0.0，需要验证 EPUB、漫画、备份和 CEF 下载解包的兼容性。
- `zip 4.6.1`：同三条公告，由 `tauri-plugin-updater 2.11.0` 引入；需检查上游插件版本或在受控分支替换解包实现。

这些余项仍是 Phase 8 发布阻断项。不能仅凭 Linux `cargo check` 声称 macOS、Windows、Android 或 iOS 产物已验证；也不能把版本命中直接等同于当前代码路径可利用。
