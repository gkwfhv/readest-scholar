# 版本锁定

审计日期：2026-10-19。应用版本号和 Git 标签不是同一个对象。

| 名称 | 值 | 证据 |
|---|---|---|
| `scholar_version` | `0.12.21` | `apps/readest-app/src-tauri/scholar.release.json` 的 Scholar 候选版本 |
| `scholar_app_version` | `0.12.21` | `apps/readest-app/package.json` 的 Scholar 前端版本 |
| `readest_ref` | `main` | GitHub `repos/readest/readest/commits/main` |
| `readest_sha` | `2d37bbfc2e94725e1343ab2a825573545aa59f5f` | 同上，提交时间 `2026-10-18T18:31:33Z` |
| `readest_app_version` | `0.12.16` | `apps/readest-app/package.json` 的 `version` |
| `readest_tag_v0.12.16` | `3cc39ad7a558e6612e1a8135058fbd6f3c90b3e3` | GitHub tags API。与上面的 `main` SHA 不同 |
| `pdf2zh_ref` | `main` | 尚未克隆到本地 |
| `pdf2zh_sha` | `3538a8195d8379fe3fb4a0117c88d15c5b7b5e89` | GitHub commits API，提交时间 `2026-04-08T04:27:12Z` |
| `schema_version` | 未分配 | 尚未新增 Scholar 迁移 |
| `sync_protocol_version` | 未分配 | 继续使用上游 replica / 文件同步，不另立协议号 |

本地 Scholar 工作树的上游基点已在 2026-10-19 核对为上述 `readest_sha`。后续每次同步上游或构建前仍应复核基点；不一致时先更新本文件和审计证据。
