# Scholar Web 构建品牌元数据验收

## 故障与修复

- PR #31 的 staging Web 镜像中，`/library` 仍输出普通 Readest 的 HTML 标题。GHCR 工作流仅设置 Web 平台参数，没有在构建时传入 Scholar 发布标记；根布局元数据由生产构建预生成，容器运行时设置标记不能改变已生成的 HTML。
- Docker build 阶段和 GHCR 双架构构建传入 `NEXT_PUBLIC_SCHOLAR_RELEASE=true`。Scholar 根布局输出 `Readest Scholar` 标题、描述与作者来源；由于可复用自托管镜像没有固定公开域名，省略上游站点的根 `og:url`、预览图和 `twitter:url`。实际分享页继续依据请求来源生成自己的绝对预览链接。
- Scholar 构建使用独立的 `/scholar-manifest.json`，Web 安装名称为 `Readest Scholar`；普通构建继续使用原有 `/manifest.json` 和元数据。

## 本机验证

- 在修复前的 staging HTML 中复现普通 Readest 标题；在本机 Scholar 构建中复现原先的上游根 `og:url`。新增安装清单断言先失败（实际仍为 `/manifest.json`），修改后定向用例 2 项通过。
- 不带 Scholar 标记的 Web 生产构建通过，生成的 `/library` HTML 保留原有 Readest 标题、描述、`og:url` 和 `twitter:url`。
- 带 Scholar 标记的 Web 生产构建通过，生成的 `/library` HTML 为 `Readest Scholar` 标题及 Scholar 描述，引用 `/scholar-manifest.json`；`og:title` 与 `twitter:title` 均为 `Readest Scholar`，没有上游站点的 `og:url`、`og:image`、`twitter:url` 或 `twitter:image`。
- 使用合成回环服务地址的 Scholar 桌面 `pnpm build --webpack` 静态导出通过。
- Node 24 项目标准命令 `pnpm test --run --maxWorkers=4`：1,176 个测试文件通过、4 跳过，13,810 项通过、16 跳过、0 失败。TypeScript、Biome lint 与格式检查通过。

## 待完成

- PR 最终 CI、评审和合并；GHCR 镜像按 amd64 固定摘要部署后再核对 `/library`、安装清单和分享页。
