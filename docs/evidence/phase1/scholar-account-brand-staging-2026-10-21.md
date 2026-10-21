# Scholar 登录与账户入口 staging 验收

## 修复范围

[PR #34](https://github.com/gkwfhv/readest-scholar/pull/34) 将 Scholar 登录标题、同步说明和账户描述改为正式名称，隐藏仅适用于上游付费服务的套餐、账单、升级、下载和法律链接。普通 Readest 构建仍保留原有入口。阅读器侧栏沿用 [PR #14](https://github.com/gkwfhv/readest-scholar/pull/14) 的四按钮同排布局和大脑图标。

## 本机构建与质量闸门

- 定向 16 项测试、TypeScript、Biome lint 与格式检查通过。修复全量测试中一个新增 mock 缺失后，单项回归复跑通过；最终提交 `045ab29523a05600e76cc8179e82efcf59d79e1f` 的 Scholar baseline、PR checks、CodeQL 全部成功，并有精确提交评审记录，合并提交为 `dbbf7befba4452881696021cc7e3a99342536cc7`。
- Node 24 Scholar Web 生产构建在 `NODE_OPTIONS=--max-old-space-size=8192` 下通过。默认 4 GB 堆与全量测试并行时曾耗尽内存；单独重试成功。预生成的 `/auth` 与 `/user` 页面标题和描述均为 Scholar。
- Scholar 桌面静态导出与未签名 Tauri debug 打包通过。本机包为 `Readest Scholar.app`，Bundle ID 为 `io.github.gkwfhv.readestscholar`；账户页面没有上游付费套餐和法律入口。该结果不等于签名更新分发验收。

## 镜像发布与部署

- [GHCR 发布运行](https://github.com/gkwfhv/readest-scholar/actions/runs/39570710278)的 amd64、arm64、逐平台 SBOM 与多架构合并均成功。固定 amd64 平台摘要为 `sha256:b86caf24cf8b88329edd13010c809b58b1ef7dcc4f9ba7db0a39d5fb9e56d4aa`。本机离线运行已发布镜像，核对 Scholar 登录页、账户页和安装清单。
- 传输归档 SHA256 为 `2f26570bbaa7ef59938246183097d88fd501ea91616719812b66cf4bb550ebce`；本机与主机均核验。主机 `docker load` 后，直接从 GHCR 拉取并注册相同平台摘要。staging 源码以已验证的 Git bundle 快进到合并提交，工作树干净。
- `SCHOLAR_STAGING_DEPLOY_CONFIRM=yes bash infra/staging/deploy-web.sh ghcr.io/gkwfhv/readest@sha256:b86caf24cf8b88329edd13010c809b58b1ef7dcc4f9ba7db0a39d5fb9e56d4aa` 退出码为 0。自动备份 `/home/gavin/scholar-staging-backups/20261021T092219Z` 的 `STATUS` 为 `complete`；升级前后四路健康检查通过。Web 容器 `35a4c0c6ddef` → `10ab35996a45`，Auth、MinIO、DB、Kong、REST 的容器 ID 未变。随后主机 `/library` 再次返回 HTTP 200。此次新备份未执行第二套空项目冷恢复，先前演练另有证据。

## 真实界面复核

通过 SSH 回环隧道访问运行中的 staging，不使用本机开发服务器：

- `/auth` 辅助功能树出现 `Sign in to Readest Scholar` 和 `Sync with Readest Scholar`，且截图中中文登录标题显示正式名称；见 [登录页截图](scholar-account-auth-staging-2026-10-21.jpg)。
- `/user` 标题为 `Account & Sign In | Readest Scholar`，只显示同步、存储、分享链接、账户及危险区域操作；没有套餐比较、付费按钮或上游法律链接。账户截图含合成测试邮箱，因此没有放入公开仓库。
- `/library` 设置菜单显示已登录、主题、设置、高级设置、`关于 Readest Scholar`；未出现升级或下载入口。
- 样例 PDF 阅读器左侧栏的目录、笔记、书签、聊天四个按钮同一行，聊天的大脑图标位于侧栏边界内；见 [阅读器截图](scholar-reader-sidebar-staging-2026-10-21.jpg)。

## 范围与后续

本次确认的是非生产 staging 品牌与布局。主机仍无公开测试域名，外部 HTTPS 分享、真实 OAuth 回跳和独立收件人访问未验收。正式签名桌面自动更新分发、真实模型质量与 Linux 主机模型运行也未验收。测试包不能视为正式发布产物。
