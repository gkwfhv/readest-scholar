# Phase 8 CEF 锁文件与安全审计（2026-10-28）

[PR #75 合并后的主线 Nix 构建](https://github.com/gkwfhv/readest-scholar/actions/runs/40626903426) 在离线解析时报告应用清单要求 `zip = "^9"`，而 `Cargo.cef.lock` 仍记录 `Readest → zip 2.4.2`。普通 `Cargo.lock` 已为 `zip 9.1.1`。Linux Nix 使用 CEF 锁文件，因此这是独立的构建失配。

在 Linux 开发服务器的隔离 Rust 容器中，以现有固定 Git 依赖缓存运行 `cargo update --offline --workspace` 更新 CEF 图，再定向提高 `wayland-scanner`、`h2`、`quinn-proto`、`rustls-webpki`、`webpki-root-certs` 和 `webpki-roots`。第二次相同的 workspace 解析显示 `Locking 0 packages`，锁文件未再改变。普通 `Cargo.lock` 保持原样。`cargo tree --locked --offline --target x86_64-unknown-linux-gnu -i zip@4.6.1` 输出 `nothing to print`。

| 锁文件 | 更新前静态 RustSec 命中 | 更新后静态 RustSec 命中 |
|---|---:|---:|
| `Cargo.lock` | 2 | 2 |
| `Cargo.cef.lock` | 16 | 5 |

CEF 剩余的两条为已记录的 `nix 0.19.1` 与 `rsa 0.9.10`。另三条 [ZIP 公告](https://rustsec.org/advisories/RUSTSEC-2026-0367.html) 都指向 CEF 分支 `tauri-plugin-updater 2.10.1 → zip 4.6.1`。该插件的 `zip` 依赖在上游清单中位于 `cfg(target_os = "windows")`，Linux CEF 目标图没有此节点；Windows 候选走普通锁文件并使用 `zip 9.1.1`。这项目标范围判断仍需安全复核，不构成风险接受。

CI 现对普通与 CEF 两份锁文件分别运行 RustSec 漂移门槛，并在 PR 中执行 Linux CEF `cargo tree --locked`，防止清单与锁文件再次失配。固定输出哈希和 Nix 全量构建以最终 CI 为准。正式发布仍受签名、残余安全审查和人工审批阻断。
