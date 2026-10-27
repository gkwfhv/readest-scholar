# Phase 8 RustSec 漂移门槛（2026-10-27）

Scholar production dependency audit 新增独立的 RustSec job：在每次 PR 和主线推送中，用固定的 cargo-audit 0.22.2 扫描根 Cargo.lock，归档完整 JSON；仅当发现超出下面精确「公告 ID＋包名＋版本」集合的命中时使 CI 失败。已知命中减少可以通过，新增、版本变化或重复条目会失败。脚本还会校验报告的结构与计数，避免扫描失败被当作零漏洞。

| 仍未处理的命中 | 依赖路径与判断 |
|---|---|
| [RUSTSEC-2021-0119](https://rustsec.org/advisories/RUSTSEC-2021-0119.html)，nix 0.19.1 | tauri-plugin-device-info → battery → nix；公告针对 getgrouplist，既有静态检查未发现该调用，仍需处理依赖或正式风险接受。 |
| [RUSTSEC-2023-0071](https://rustsec.org/advisories/RUSTSEC-2023-0071.html)，rsa 0.9.10 | localsend → rsa；公告截至当前仍无已修复版本。既有静态检查只见证书生成及 RSA-PSS 验签，仍需审核实际暴露面。 |
| [RUSTSEC-2026-0367](https://rustsec.org/advisories/RUSTSEC-2026-0367.html)、[0368](https://rustsec.org/advisories/RUSTSEC-2026-0368.html)、[0369](https://rustsec.org/advisories/RUSTSEC-2026-0369.html)，zip 4.6.1 | tauri-plugin-updater → zip；上游 Scholar 身份包的自动更新入口已禁用，但依赖仍在锁文件中，Windows 更新器路径尤其需单独处置。 |

这五条是 CI 的已知未解决基线，**不是漏洞豁免或发布风险接受**。绿色只代表没有新增锁文件命中；正式发布仍受这些 RustSec 项及平台产物验证阻断。完整调用范围分析见 [原始审计](rust-dependency-audit-2026-10-26.md)。

服务器构建容器使用当前主线 Cargo.lock 与缓存 RustSec 数据库复扫，得到上述 5 条；检查器接受真实 JSON，注入第六条合成公告后按预期失败。在线 CI 会获取当时最新数据库，因此其结论可能变化，变化时必须重新评估。
