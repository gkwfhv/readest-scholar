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

## PR 与 staging 验收

- [PR #32](https://github.com/gkwfhv/readest-scholar/pull/32) 的最终提交 `ba2aeefa4bc880dd4d812a982d10358d02e15c95` 经 Scholar baseline、PR checks、CodeQL 和精确 SHA 评审通过，合并为 `671cde6f22ec0ebb34b41454b099d45878cff428`。[GHCR 发布运行](https://github.com/gkwfhv/readest-scholar/actions/runs/39564175095)的 amd64、arm64 构建、SBOM 和多架构合并均成功。amd64 平台摘要为 `sha256:96edded005aed6da23caa76f13e7ee1ec4419f2f841ebe2a1bad9870b5e2cdee`。
- 直接检查已发布 amd64 镜像内的预生成 `/library` HTML 和 `/scholar-manifest.json`：标题、描述、清单名均为 Scholar，根 `og:url` 没有指向上游。staging 主机源码通过 SHA256 `1bdb7901ce9a1a1507008d5f8516076d3e7e87651df68e61597e536190c6ba5a` 的增量 Git bundle 快进到合并提交且工作树干净。
- 镜像归档两端 SHA256 为 `ee3082b673d98667cf7202e1cbdaed69c7e00af029afba781fae6eeda04a78b6`，gzip 校验通过。主机导入后向 GHCR 核对固定摘要、镜像 ID 和 `amd64` 架构一致。`deploy-web.sh` 在升级前创建 `20261021T075734Z` 完整备份（尚未冷恢复）；四路健康前后通过。仅 Web 容器由 `77372a7ee3c7` 更新为 `35a4c0c6ddef`，其余五个服务容器 ID 未变。
- 实际 staging `/library` 返回 200，HTML 标题、描述、`og:title`、`twitter:title` 和清单链接正确，未出现上游根社交 URL 或图片；`/scholar-manifest.json` 返回 200，名称为 `Readest Scholar`。合成账户创建的临时分享页、元数据及 OG PNG 均返回 200；PNG 91,846 字节，分享页标题和 OG URL 指向 Scholar 本站。分享已撤销（204），公开元数据为 410，临时令牌文件已删除。

## 限制

- 测试主机没有公共域名。本次只验收 SSH 回环环境的品牌元数据；外部 HTTPS 社交预览、真实 OAuth 回调和独立收件人打开分享仍需域名。
- 新备份的状态为 complete，但此次没有再做第二套空项目冷恢复；此前 Phase 1 的冷恢复演练另有记录。
