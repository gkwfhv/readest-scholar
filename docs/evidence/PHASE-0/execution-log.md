# Phase 0 执行记录

本文件是首轮执行快照，当时的工具状态和“明确未运行”列表只描述首轮。后续 Node 24 测试、Web 构建/阅读、Compose 验证及 Rust 环境结果见 [当前证据](../phase0/README.md)。只记录实际运行过的命令。未运行的测试没有结果。

## 环境

```text
git version 2.54.0 (Apple Git-157)
node v26.5.0
npm 11.17.0
pnpm 最初不在 PATH
docker version 29.6.1
rustc 不存在
python3 3.9.6
macOS 26.6.2 arm64
docker info：守护进程未运行（沙箱外复测同样失败）
```

## 克隆

```text
git clone --progress https://github.com/readest/readest.git readest
```

命令退出码 0，耗时约 16 分钟。结束后在 `readest/` 执行：

```text
git rev-parse HEAD
2d37bbfc2e94725e1343ab2a825573545aa59f5f
git status -sb
## main...origin/main
```

与锁定 SHA 一致。`git submodule status` 最初 8 个子模块都未检出。随后只初始化了 Docker 文档点名的两个：

```text
git submodule update --init packages/foliate-js packages/simplecc-wasm
packages/foliate-js        6d74298546a59a5d64e531ccee1ba0809d967bf4
packages/simplecc-wasm     5e5b56f5b82394e7df07f9171ac70f4578b24a32
```

其余 6 个子模块仍未初始化。

## 依赖工具

```text
npm install pnpm@11.1.1 --prefix /Users/admin/personal/redest/.tools
.tools/node_modules/.bin/pnpm --version
# 11.1.1
```

没有把 pnpm 装到系统全局。

在 `readest/` 安装依赖。第一次退出码 1，`cytoscape-fcose` 下载超时。第二次：

```text
pnpm install --store-dir ../.tools/pnpm-store --fetch-timeout 300000 --network-concurrency 4
Done in 5m 15.3s using pnpm v11.1.1
exit 0
```

## 远程核对

通过 GitHub API / raw 读取锁定提交上的文档、`package.json`、`.gitmodules`、`schema.sql`、服务目录、`syncCategories`、`ragService.ts`、`annotation/types.ts`、workflow 列表，以及 pdf2zh 的 license 与 `main` 提交。这些不是本地工作树证明。

## 单元测试

上游 PR 工作流 `.github/workflows/pull-request.yml` 使用 Node 24。本机是 Node 26.5.0。

```text
cd apps/readest-app
CI=1 pnpm test --run
```

退出码 1。Vitest 4.1.11 汇总：

```text
Test Files  109 failed | 1053 passed | 4 skipped (1166)
Tests       749 failed | 12338 passed | 43 skipped (13130)
Errors      95 errors
Duration    215.32s
```

失败栈反复出现 `localStorage is not available because --localstorage-file was not provided`，以及 `Cannot read properties of undefined (reading 'setItem')`。这是本机 Node 26 与 jsdom 测试的差异，没有改测试，也没有把失败标成跳过。

## 明确未运行

- `pnpm lint`
- `pnpm test:browser`
- `pnpm build-web`
- `pnpm tauri dev` 或任何桌面包
- `docker compose up`
- 许可证扫描器、SBOM、备份恢复演练
