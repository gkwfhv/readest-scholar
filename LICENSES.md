# 许可证审计（待人工复核，不能用于发布）

核对日期：2026-10-19。这是源码与包管理器声明标识核对；CI 另产出 SBOM。最终分发条件仍需人工法律复核。

## 已核对

| 组件 | 标识 | 证据 |
|---|---|---|
| Readest | GNU AGPL-3.0 | 锁定 SHA 的根 `LICENSE` 文本以 “GNU AFFERO GENERAL PUBLIC LICENSE Version 3” 开头 |
| PDFMathTranslate-next | AGPL-3.0 | GitHub License API 的 `spdx_id` 为 `AGPL-3.0`。README 同样指向 AGPL v3 |

两者都是网络服务 copyleft。若 Scholar 把它们作为对外提供的修改版服务，发布前必须提供对应源码，并由人工做法律复核。本阶段不发布二进制、镜像或应用商店包。

## 锁定依赖的机器清单

GitHub Actions 的 [首次源码清单作业](https://github.com/gkwfhv/readest-scholar/actions/runs/39246293900/job/118038919532) 已通过：使用锁文件安装依赖后，`pnpm licenses list --json --prod` 列出 946 个生产 npm 包、21 种许可证标签。按声明计，MIT 658、Apache-2.0 140、ISC 58、BSD-3-Clause 30、`MIT OR Apache-2.0` 20，其余 40。去掉 CI 机器路径的逐包快照见 [npm-license-inventory.json](docs/evidence/phase0/npm-license-inventory.json)，原始 ZIP 工件保留在该运行记录中，工件 SHA-256 为 `3642f673a7ae4a449e4f4cb26cc11077d89ad3cd385941bba929593ef96c7086`。

同一作业用固定版本 Syft 生成 CycloneDX 源码树 SBOM，校验日志显示 **6187 个组件**，原始工件 SHA-256 为 `1509e6daedc9fca0de8ff51cf463e2958d7e048f28f42121d1aac30eb3793b79`。这一数量涵盖源码树扫描结果，不等于运行时依赖数，也不能替代逐份许可证审计。原始本机 pnpm store 缺失索引的失败记录仍见 [licenses-production-error.json](docs/evidence/phase0/licenses-production-error.json)。

以下声明需要进一步核对上游许可证文本、实际打包范围和义务：

| 依赖 | 清单声明 | 待核事项 |
|---|---|---|
| `@img/sharp-libvips-linux-x64` | LGPL-3.0-or-later | Linux 构建的动态库分发方式与相应义务 |
| `jszip` | MIT OR GPL-3.0-or-later | 确认采用的许可证选项及其文本 |
| `khroma` | Unknown | [上游仓库](https://github.com/fabiospampinato/khroma) 标注 MIT 且含 `license` 文件；仍需比对锁定的 npm 包内容，不能仅依赖当前仓库分支 |
| `robust-predicates` | Unlicense | 确认最终分发时应保留的声明 |

子模块和容器依赖另包括 foliate-js、pdfjs / qcms、Tauri、simplecc-wasm、js-mdict、Supabase、MinIO、Kong、PostgREST。上述 npm 清单不覆盖它们的全部许可证文本。

## 发布阻断

在下列各项完成前，禁止把构建物称为可分发版本：

- 逐份核对异常 npm 标签、源码子模块和容器镜像许可证，并留存发布时的完整报告
- 列出容器镜像 digest 与基础镜像许可证
- 人工确认 AGPL 源码提供方式
- 确认没有把上游商标或 `readest.com` 域名当成 Scholar 的品牌

不依据网页摘要判断闭源分发权。
