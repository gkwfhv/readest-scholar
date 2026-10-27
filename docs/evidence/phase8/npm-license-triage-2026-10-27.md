# Phase 8 生产 npm 许可证初筛（2026-10-27）

范围：从提交 `553291763947ae4e0436833447eb307f76ad0aa8` 的 [Scholar baseline run 40494196856](https://github.com/gkwfhv/readest-scholar/actions/runs/40494196856) 下载 `scholar-npm-licenses` 工件 `12729377296`，读取 `pnpm --filter @readest/readest-app licenses list --json --prod` 的结果。服务器保存的 JSON SHA-256 为 `527026e3f4d2634f79dcf480611d4e6ea5f153231df2696b9ab665b34aca329b`。该命令报告生产依赖图中在 CI Linux 环境安装的包，不能证明每个平台安装包实际包含这些包。

| 结果 | 数量与处理 |
|---|---|
| 报告记录 | 945 项，分为 21 个许可证表达式组 |
| `Unknown` | 仅 `khroma@2.1.0` 一项。其 [上游仓库](https://github.com/fabiospampinato/khroma) 声明 MIT；从 npm 发布的 [2.1.0 tarball](https://registry.npmjs.org/khroma/-/khroma-2.1.0.tgz) 实际读取到 `package/license` 的 MIT 文本，但 `package.json` 缺少 `license` 字段。该 tarball 的 SHA-512 与 `pnpm-lock.yaml` 的完整性值一致：`sha512-Ls993zuzfayK269Svk9hzpeGUKob/sIgZzyHYdjQoAdQetRKpOLj+k/QQQ/6Qi0Yz65mlROrfd+Ev+1+7dz9Kw==`。CI 只对这个精确版本和锁定哈希允许例外，其他 `Unknown` 将失败。 |
| 需人工复核 | `@img/sharp-libvips-linux-x64@1.3.4` 报 LGPL-3.0-or-later；[上游第三方公告](https://github.com/lovell/sharp-libvips/blob/main/THIRD-PARTY-NOTICES.md)列出多种捆绑库许可证。另有 `lightningcss` 及 Linux 二进制两项 MPL-2.0，`jszip@3.10.1` 为 MIT 或 GPL-3.0-or-later 双许可，[上游提供 MIT 选项](https://github.com/Stuk/jszip/blob/main/LICENSE.markdown)，`caniuse-lite` 报 CC-BY-4.0。 |

新增的 `check-scholar-npm-licenses.mjs` 是未知许可证漂移门槛，不是法律意见，也不自动决定第三方声明、源代码提供义务或特定产物的再分发条件。正式发布前仍需检查 macOS、Windows、Linux、移动端及容器各自实际包含的组件、许可证正文与 NOTICE，并由人工完成商标及许可证复核。
