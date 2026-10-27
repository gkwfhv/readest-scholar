# Phase 8 RustSec 漂移门槛（2026-10-27）

Scholar production dependency audit 新增独立 RustSec job：每次 PR 和主线推送均以固定的 cargo-audit 0.22.2 扫描根 Cargo.lock 并归档 JSON。检查器只允许下表中精确的「公告 ID＋包名＋版本」命中；已知命中减少可以通过，新增、版本变化、重复或报告不完整将失败。

| 仍未解决的命中 | 依赖路径与静态复核 |
|---|---|
| [RUSTSEC-2021-0119](https://rustsec.org/advisories/RUSTSEC-2021-0119.html)，nix 0.19.1 | tauri-plugin-device-info → battery → nix；公告针对 getgrouplist，既有静态检查未发现调用。 |
| [RUSTSEC-2023-0071](https://rustsec.org/advisories/RUSTSEC-2023-0071.html)，rsa 0.9.10 | localsend → rsa；公告仍无已修复版本。既有静态检查只见证书生成与 RSA-PSS 验签。 |


先前的服务器缓存公告库识别五条命中。PR 首轮 [CI run 40506047082](https://github.com/gkwfhv/readest-scholar/actions/runs/40506047082) 获取更新的公告库后识别了四条 zstd 系列新增命中，漂移门槛按预期失败。

为清除这四条，补丁将原版 `tantivy-sstable` 0.7.0 以保留 MIT 许可的方式放入 `packages/tantivy-sstable`，仅将其压缩依赖提高至 zstd 0.14.3。根锁文件现在选择 zstd-safe 8.2.0、zstd-sys 2.1.2。服务器容器中完成了根应用 `cargo check --locked`、该 crate 的 38 个单元测试、2 个原有集成测试和 1 个文档测试。另有迁移测试使用原版 zstd 0.13.3 生成的压缩索引文件，由新版 reader 读取全部抽样键；反向探针也验证旧 reader 能读取新版 writer 的文件。GitHub CI 新增同一迁移测试，并将用实时公告库重新扫描根锁文件。

Windows 更新器依赖的 zip 4.6.1 命中 [RUSTSEC-2026-0367](https://rustsec.org/advisories/RUSTSEC-2026-0367.html)、[0368](https://rustsec.org/advisories/RUSTSEC-2026-0368.html) 和 [0369](https://rustsec.org/advisories/RUSTSEC-2026-0369.html)，三条公告均在 zip 9.0.0 修复。补丁保留 Tauri updater 2.11.0 的上游代码与双许可证，仅将 Windows zip 依赖升为 9；根锁文件移除 zip 4.6.1，并在服务器容器中通过 `cargo check -p Readest --locked`。Windows 候选包编译和安装启动仍需在 GitHub Windows runner 验证。

这两条仍是**未解决的发布阻断项**。绿色的漂移检查仅说明没有超出精确基线的新命中，不能代替风险处置。完整的先前调用范围分析见[原始审计](rust-dependency-audit-2026-10-26.md)。
