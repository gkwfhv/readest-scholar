# 上游基线

审计日期：2026-10-19。最初证据来自锁定提交上的 GitHub 原始文件；本轮已用本地 `git rev-parse HEAD` 与真实源码复核。

## Readest

- 仓库：<https://github.com/readest/readest>
- 分支：`main`
- 锁定 SHA：`2d37bbfc2e94725e1343ab2a825573545aa59f5f`
- 提交说明：`fix(kosync): send and read FB2 positions in crengine's FictionBook form (#6905)`
- 提交时间：`2026-10-18T18:31:33Z`
- 应用版本：`apps/readest-app/package.json` 为 `0.12.16`
- 同名标签 `v0.12.16` 指向 `3cc39ad7a558e6612e1a8135058fbd6f3c90b3e3`，不是当前 `main`

后续实现以 `main` 的锁定 SHA 为准，不以标签名推断提交。

## 包管理与主要依赖

根 `package.json` 声明 `packageManager: pnpm@11.1.1`。应用清单中核对到的版本：

| 组件 | 版本 |
|---|---|
| Next.js | `16.3.8` |
| React / React DOM | `19.2.8` |
| Tauri API / CLI | `2.11.1` / `2.11.4` |
| Vitest | `^4.1.11` |
| Playwright | `^1.60.0`（devDependency 另有 `playwright@^1.58.2`） |
| Supabase JS | `^2.76.1` |
| Vercel AI SDK `ai` | `^6.0.299` |
| `@ai-sdk/openai-compatible` | `^2.0.81` |
| TypeScript（应用） | `^7.0.2` |
| TypeScript（仓库根 devDependency） | `^5` |
| Biome | `^2.4.9` |

应用与仓库根的 TypeScript 主版本不一致。实施前要按 `pnpm-lock.yaml` 看实际解析结果，不能凭清单范围判断。

## 子模块

`.gitmodules` 在锁定 SHA 上包含：

- `packages/foliate-js` → `readest/foliate-js`
- `packages/tauri` → `readest/tauri`
- `packages/simplecc-wasm` → `readest/simplecc-wasm`
- `packages/qcms` → `mozilla/pdf.js.qcms`
- `packages/js-mdict` → `readest/js-mdict`
- `apps/readest-app/src-tauri/plugins/tauri-plugin-turso`
- `apps/readest-app/src-tauri/plugins/tauri-plugin-webview-upgrade`
- `apps/readest-app/.claude/skills/gstack`

Docker 文档要求构建前初始化 `packages/foliate-js` 与 `packages/simplecc-wasm`。

## 官方自托管镜像

`docker/README.md` 描述的服务：

| 服务 | 镜像 |
|---|---|
| client | `ghcr.io/readest/readest`（可用 tag：`latest`、`main`、版本号、`sha-<commit>`） |
| db | `supabase/postgres:15.8.1.085`（`compose.yaml` 的 `image`；README 只写了仓库名） |
| kong | `kong:2.8.1` |
| auth | `supabase/gotrue:v2.185.0` |
| rest | `postgrest/postgrest:v14.3` |
| minio / minio-setup | `quay.io/minio/minio`、`quay.io/minio/mc` |

文档写明默认暴露 `3000`、`8000`、`9000`、`9001`。本机尚未启动这套栈。

## pdf2zh Next

- 仓库：<https://github.com/PDFMathTranslate/PDFMathTranslate-next>
- `main` SHA：`3538a8195d8379fe3fb4a0117c88d15c5b7b5e89`（`2026-04-08T04:27:12Z`）
- 许可证：GitHub License API 返回 `AGPL-3.0`
- README 给出的用法是 Windows EXE、Docker、uv、WebUI、命令行，以及 Python API
- 尚未克隆，没有在本地运行 CLI

## 本机环境

命令于 2026-10-19 在本工作区执行：

| 检查 | 结果 |
|---|---|
| `git --version` | `2.54.0` |
| `node --version` | `v26.5.0` |
| `npm --version` | `11.17.0` |
| 全局 `pnpm` | 不存在 |
| 工作区本地 pnpm | `.tools/node_modules/.bin/pnpm` 为 `11.1.1` |
| 工作区本地 Node | `.tools/node_modules/node/bin/node` 为 `24.11.1`，与上游 CI 的 Node 主版本一致 |
| `rustc` | 本轮在工作区 `.tools/` 安装 `1.99.1`，并安装 rustfmt/Clippy；不更改全局 Rust 工具链 |
| `python3 --version` | `3.9.6` |
| `docker --version` | `29.6.1` |
| `docker info` | 本轮已启动 Docker daemon，版本 `29.6.1`；官方 MinIO/mc 镜像拉取返回 401 |
| 系统 | macOS `26.6.2`，`arm64` |
| Xcode | 仅 Command Line Tools |

Readest 源码、Web 所需依赖与 PDF vendor 已就绪；Tauri 静态前端构建通过，Rust/Tauri 调试编译进行中。官方 Compose 因对象存储镜像拉取失败未启动。完整命令与结果见 `docs/evidence/phase0/README.md`。
