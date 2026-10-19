# 许可证审计（未完成，不能用于发布）

核对日期：2026-10-19。这是源码许可证标识核对，不是 SBOM，也不是法律意见。

## 已核对

| 组件 | 标识 | 证据 |
|---|---|---|
| Readest | GNU AGPL-3.0 | 锁定 SHA 的根 `LICENSE` 文本以 “GNU AFFERO GENERAL PUBLIC LICENSE Version 3” 开头 |
| PDFMathTranslate-next | AGPL-3.0 | GitHub License API 的 `spdx_id` 为 `AGPL-3.0`。README 同样指向 AGPL v3 |

两者都是网络服务 copyleft。若 Scholar 把它们作为对外提供的修改版服务，发布前必须提供对应源码，并由人工做法律复核。本阶段不发布二进制、镜像或应用商店包。

## 已知但未逐份读取的第三方

子模块和依赖至少包括 foliate-js、pdfjs / qcms、Tauri、simplecc-wasm、js-mdict、Supabase、MinIO、Kong、PostgREST、Vercel AI SDK。它们的许可证以各自 `LICENSE` 和锁文件为准。尝试运行 `pnpm licenses list --json --prod`，但 pnpm 因本机安装存储缺少 `@ai-sdk/openai-compatible@2.0.81` 的 package index 退出 1；[原始错误](docs/evidence/phase0/licenses-production-error.json)。因此没有生成完整第三方清单或 SBOM。

## 发布阻断

在下列各项完成前，禁止把构建物称为可分发版本：

- 对锁定 SHA 运行许可证扫描，并保存原始报告
- 列出容器镜像 digest 与基础镜像许可证
- 人工确认 AGPL 源码提供方式
- 确认没有把上游商标或 `readest.com` 域名当成 Scholar 的品牌

不依据网页摘要判断闭源分发权。
