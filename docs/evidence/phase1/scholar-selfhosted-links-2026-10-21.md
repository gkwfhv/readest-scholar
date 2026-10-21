# Scholar 自托管链接契约 — 2026-10-21

## 问题与范围

正式身份包已使用 `readest-scholar://`，但原有 HTTPS 批注和分享链接、分享 API 与预览图片仍指向 `web.readest.com`。自托管站点生成的分享令牌不会存在于上游服务，这些链接会打开错误站点。本改动让自托管实例按配置的 Web 地址生成和识别批注、分享及设备绑定链接，并让落地页的 Android 回退地址留在该站点；普通 Readest 的既有上游地址保持原样。

## 测试先行与本地验证

- 改动前四个定向用例失败：批注生成仍为 `web.readest.com`、分享生成仍为 `web.readest.com`、设备绑定解析拒绝自托管域名、分享列表 API 返回上游地址。加入 staging Web 运行时 Scholar 标记后，另一个用例先失败，显示原代码仍选择 `readest://`。
- 修复后，批注、分享、设备绑定、服务端创建/列表/预览元数据、运行时标记和桌面静态导出目标均有定向测试；错误站点和 HTTP 降级链接不被当成 Scholar 站点链接。最终审阅又发现服务端首屏未读取 `SCHOLAR_RELEASE`：新增用例先得到普通 Readest 标记，修复后服务端和浏览器均选择 `readest-scholar://`。TypeScript、Biome 与 staging Compose 配置解析通过，Compose 解析结果为 `scholar-staging`、`SCHOLAR_RELEASE=true`，公开端口仍全部绑定回环。
- 首次 Node 24 全量测试为 13,784 通过、9 失败、16 跳过。9 个失败都来自 Readwise 测试完整模拟 `environment` 模块但遗漏新增函数；改为保留真实导出、仅覆盖平台判定后，该文件的 14 项和桌面地址选择的 1 项定向测试通过。含服务端首屏回归用例的最新完整套件为 **1,171 个文件、13,794 通过、16 跳过、0 失败**（`vitest run --maxWorkers=4`）。
- 父提交的 Web 生产构建第一次因本机默认 Node 堆上限耗尽而终止；使用 `NODE_OPTIONS=--max-old-space-size=8192` 重跑成功，生成 56 个静态页面。构建保留原有两条 WASM 资源不预缓存警告。
- 在服务端首屏一行修复之前的父提交上，`build-scholar-macos-smoke.mjs` 使用显式自托管目标完成静态导出与未签名 macOS Tauri `.app` 打包。包标识为 `io.github.gkwfhv.readestscholar`，唯一注册的 URL scheme 为 `readest-scholar`，二进制 SHA-256 为 `1a0c8b009f3a65cff257e026f1e53394a5fbda2ed445abe8e8ce122141812d6d`。最新提交的重新构建将由 PR CI 验证；这仍不等于真实 OAuth/分享往返或正式签名更新。
- [PR #28](https://github.com/gkwfhv/readest-scholar/pull/28) 的最终提交通过必需 CI 与精确提交评审后合并为 `a00d83d35b374c7413ac1ceba10aae413abb34d6`。[镜像发布运行](https://github.com/gkwfhv/readest-scholar/actions/runs/39546671218)成功生成 amd64、arm64 和 SBOM；下述 staging 使用 amd64 平台摘要。

## 已有 staging 配置事实

在用户授权的非生产 Linux 主机上，既有 `docker/.env` 原有两个回环 HTTP 回调地址，缺少 `readest://auth-callback` 与 `readest-scholar://auth-callback`。先在仓库外的私有目录生成 `0600` 备份 `docker.env.before-scholar-callback.20261021T041219Z`，然后只追加这两个回调，原文件仍为 `0600`。仅重建 `scholar-staging-auth`；运行中的容器环境显示四个白名单项、两种应用回调都存在。Web、Auth、REST/数据库、对象存储的回环健康请求均返回 HTTP 200。主机没有 Node，使用 Python 发起了相同的四路健康请求；第一次尝试运行 Node 脚本得到 `node: command not found`，不记为通过。

## Staging 摘要升级与真实分享往返

- 发布镜像 `ghcr.io/gkwfhv/readest:sha-a00d83d` 的 Linux amd64 平台摘要为 `sha256:9e072bd00ea04b47ac0e026754dc1cc8163f44c773494776086d2ccd61288018`，arm64 为 `sha256:5eb91a5a52dd19685a84015d13e0286936fdd6db8a7142b6365e9fe9eaa70d1c`。测试主机 GHCR DNS 不稳定，本机拉取并核对 amd64 镜像 ID 后导出归档，通过 SSH/rsync 传输到主机私有目录；主机核对 SHA256 `1f13bc182647a74808e7f85a13e967b8301bdb5f7f49197c6df5e73c60345675` 与 gzip 完整性后导入。主机 `docker image inspect` 能以完整平台摘要解析出相同镜像 ID 和 `linux/amd64` 架构。
- 主机 checkout 快进至上述合并提交且干净；私有 `.env` 保持 `0600`。运行 `SCHOLAR_STAGING_DEPLOY_CONFIRM=yes bash infra/staging/deploy-web.sh ghcr.io/gkwfhv/readest@sha256:9e072bd00ea04b47ac0e026754dc1cc8163f44c773494776086d2ccd61288018` 成功。升级前快照 `20261021T051628Z` 为 `STATUS=complete`；脚本前后 Web、Auth、REST/数据库、S3 四路均为 HTTP 200。仅 Web 容器从 `1a2307e52699` 更换为 `0e370bd821db`，其余五个服务容器 ID 不变。`/runtime-config.js` 实际返回 `scholarRelease=true` 与 `selfHosted=true`，回调白名单同时含 `readest://auth-callback` 和 `readest-scholar://auth-callback`。本次新快照尚未独立恢复。
- 使用主机私有 `0600` 合成账户在内存中登录（HTTP 200、用户 ID 与基线相符），从 REST 文件列表选出已上传的仓库样例 PDF。`POST /api/share/create` 返回 HTTP 200、22 字符令牌和 `http://127.0.0.1:3130/s/` 本站链接。公开元数据与 `/s/{token}` 均为 200；落地页 OG URL 指向相同本站链接，不含 `web.readest.com/s/{token}`。`/api/share/{token}/og.png` 为 200、`image/png`；下载 API 为 302，目标是回环对象端口。随即撤销临时分享得到 204，再读公开元数据为 410 `revoked`。令牌、邮箱、密码均未输出或入库到证据文件。
- 这次页面烟测发现 HTML 的分享标题和图片署名仍写普通 Readest；同类问题也存在于批注落地页与共用页脚。本次后续修复以先失败的回归测试覆盖 Scholar 与普通 Readest 两种模式；补充中文用例先复现了新增英文键导致的回退，改为复用现有译文后，定向 9 项全通过。最终 Node 24 全量 Vitest 为 **1,174 个文件通过、4 跳过；13,802 项通过、16 跳过、0 失败**，TypeScript、Biome 与格式检查通过。文案补丁前的父提交使用 `next build --webpack` 完成 Web 生产构建及显式合成自托管配置下的 Scholar 桌面静态导出；最终提交的构建结果由 PR CI 复验。默认 Turbopack 构建因本工作树 `node_modules` 指向工作树外的共享依赖目录而失败；这是本机链接布局限制，生产 Docker 构建使用独立依赖树。修复代码合并和新镜像部署后的结果另行补记，不能把当前部署当作品牌文案通过。

## 尚未验收

- 没有测试域名；回环链接只有 SSH 隧道本机可用。正式 HTTPS 分享/批注链接、真实 OAuth 提供方回跳及外部收件人打开分享均未验收。虽然两种 scheme 已加入 Auth 白名单，尚无 OAuth 提供方可发起真实回跳。
- 新版品牌文案尚未进入 staging 镜像；分享导入到第二个独立账户和客户端落地页的交互尚未实测。
- 正式签名安装包与更新分发仍是独立发布门槛。
