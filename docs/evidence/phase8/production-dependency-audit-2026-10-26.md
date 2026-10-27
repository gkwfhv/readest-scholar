# Phase 8 生产 npm 依赖审计（2026-10-26）

环境：Linux 开发服务器的隔离容器，Node 24、pnpm 11.1.1，读取提交分支的 `pnpm-lock.yaml`，执行 `pnpm audit --prod --json`。原始 JSON 保存在服务器 `/home/gavin/readest-scholar-artifacts/`，未包含密钥。

| 阶段 | 结果 |
|---|---|
| 更新前 | 16 条公告：critical 3、high 6、moderate 4、low 3；生产依赖 909，另有 optional 206 |
| 直接依赖 | Next.js 16.3.8 → 16.4.1；DOMPurify 3.4.16 → 3.4.17；Zod 4.4.x → 4.6.6；OpenNext Cloudflare 1.19.9 → 1.20.2 |
| 传递依赖 | 通过 workspace override 将 body-parser 提至 2.4.0、undici 提至 7.30.1、fast-uri 提至 3.1.9，Serwist 引入的 Zod 也统一至 4.6.6 |
| 更新后 | 同命令退出 0，`advisories: 0`；critical/high/moderate/low 均为 0。该结果只覆盖 npm 生产依赖，不能代替 Rust、容器或安装包扫描 |
| 回归 | 冻结锁文件安装、Biome、应用 TypeScript `--noEmit` 和 Scholar Web 生产构建均在服务器容器通过；新增只读 GitHub Actions 审计工作流 |

更新前的关键公告包括 Next.js [图像优化 SVG RCE](https://github.com/advisories/GHSA-2464-fhr4-w9xw)、[use cache typed array RCE](https://github.com/advisories/GHSA-673q-mjm6-r5xr)，以及 DOMPurify [SAFE_FOR_TEMPLATES 绕过](https://github.com/advisories/GHSA-cg2g-xh64-v4q7)。风险以锁定版本匹配的公告为准；是否在当前部署配置中可利用尚未逐条确认，因此修复版本优先于风险豁免。

发布前还需在最终合并提交上重跑审计和 Web/客户端构建，并审查 Rust、容器镜像及第三方许可证。

GitHub 独立复验：[Scholar production dependency audit run 40298006556](https://github.com/gkwfhv/readest-scholar/actions/runs/40298006556) 在提交 `c06bcbc2a4df93329377fbc9468807a3342ae5d0` 通过，日志输出 `No known vulnerabilities found`。
