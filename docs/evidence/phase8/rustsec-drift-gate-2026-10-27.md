# Phase 8 RustSec 漂移门槛（2026-10-27）

Scholar production dependency audit 新增独立 RustSec job：每次 PR 和主线推送均以固定的 cargo-audit 0.22.2 扫描根 Cargo.lock 并归档 JSON。检查器只允许下表中精确的「公告 ID＋包名＋版本」命中；已知命中减少可以通过，新增、版本变化、重复或报告不完整将失败。

| 仍未解决的命中 | 依赖路径与静态复核 |
|---|---|
| [RUSTSEC-2021-0119](https://rustsec.org/advisories/RUSTSEC-2021-0119.html)，nix 0.19.1 | tauri-plugin-device-info → battery → nix；公告针对 getgrouplist，既有静态检查未发现调用。 |
| [RUSTSEC-2023-0071](https://rustsec.org/advisories/RUSTSEC-2023-0071.html)，rsa 0.9.10 | localsend → rsa；公告仍无已修复版本。既有静态检查只见证书生成与 RSA-PSS 验签。 |
| [RUSTSEC-2026-0367](https://rustsec.org/advisories/RUSTSEC-2026-0367.html)、[0368](https://rustsec.org/advisories/RUSTSEC-2026-0368.html)、[0369](https://rustsec.org/advisories/RUSTSEC-2026-0369.html)，zip 4.6.1 | tauri-plugin-updater → zip；Scholar 身份包禁用了上游自动更新入口，但 Windows 更新器路径及依赖仍需处置。 |
| [RUSTSEC-2026-0391](https://rustsec.org/advisories/RUSTSEC-2026-0391.html)，zstd 0.13.3 | Turso FTS → Tantivy SSTable → zstd；公告针对复用 raw stream context。当前 Tantivy SSTable 源码使用 zstd::bulk 的压缩与解压。 |
| [RUSTSEC-2026-0398](https://rustsec.org/advisories/RUSTSEC-2026-0398.html)、[0403](https://rustsec.org/advisories/RUSTSEC-2026-0403.html)，zstd-safe 7.3.0 | 同一依赖路径；分别针对 seekable 解压和失败的 legacy streaming 解压，当前 SSTable 源码未直接使用这些 API。 |
| [RUSTSEC-2026-0410](https://rustsec.org/advisories/RUSTSEC-2026-0410.html)，zstd-sys 2.1.0+zstd.1.5.7 | 同一依赖路径；公告仅影响 wasm32 分配器，当前桌面/移动 Tauri Rust 目标并非 wasm32。 |

前五条在服务器缓存 RustSec 数据库复扫中发现。PR 首轮 [CI run 40506047082](https://github.com/gkwfhv/readest-scholar/actions/runs/40506047082) 获取更新的公告库后识别了新增的四条 zstd 系列命中，门槛按预期失败。上表后四条是对实际锁文件和 Tantivy SSTable 源码的静态复核，不能证明所有路径均不可利用，也不构成发布风险接受。zstd 0.13 / zstd-safe 7 由 Tantivy SSTable 0.7 的版本要求引入；更新到公告修复的大版本需要单独的 Turso/Tantivy 兼容性与数据迁移验证。

这九条均是**未解决的发布阻断项**。绿色的漂移检查仅说明没有超出此精确基线的新命中。完整的先前调用范围分析见[原始审计](rust-dependency-audit-2026-10-26.md)。
