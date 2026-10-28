# Phase 8 `qs` 公告回归（2026-10-28）

在 PR #75 的 GitHub 生产依赖审计中，`pnpm audit --prod --audit-level low` 报告 [GHSA-6pq8-jhm2-2vcw](https://github.com/ljharb/qs/security/advisories/GHSA-6pq8-jhm2-2vcw)：`qs` 的受影响范围包含 6.16.0，维护者在 6.16.1 修复。锁文件中的引入路径为 `@googleapis/androidpublisher → googleapis-common@8.0.1 → qs@6.16.0`。这份记录仅说明锁定依赖版本及公告匹配，不推断应用代码是否可触发该问题。

将 workspace override 最低版本提高至 `>=6.16.1`，把 `googleapis-common` 锁定引用改为 6.16.1，并删除锁文件中已无使用者的 6.16.0 条目。服务器隔离构建容器使用 pnpm 11.1.1 复验：

- `pnpm install --frozen-lockfile --lockfile-only --offline --ignore-scripts`：通过。
- `pnpm audit --prod --audit-level low`：退出 0，输出 `No known vulnerabilities found`。

最终 GitHub CI 结果以 PR #75 最新提交为准；这项修复不代替 RustSec 和安装包审计.

