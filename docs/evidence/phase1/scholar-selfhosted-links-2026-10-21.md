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

## PR #29 品牌镜像升级与界面复验

- [PR #29](https://github.com/gkwfhv/readest-scholar/pull/29) 的最终 `f021772b827154a22af5f33a83f1ca1288d11ed3` 经 Scholar baseline、完整 PR checks 与 CodeQL 通过，并在精确 SHA 评审后合并为 `460a97d84017823cb836352e48eb1d93ebafb99e`。[镜像发布](https://github.com/gkwfhv/readest-scholar/actions/runs/39551472818)完成双架构与 SBOM；amd64 平台摘要为 `sha256:b384ce4bce3708078fd6520c7a73a95663dea05fb29f269fdaf2e1b587118872`，arm64 为 `sha256:c6169f2a5ebf8ba20516d9659bb4c1425a27d1e4c6effcf0adbee4befccad6dc`。
- 主机源码由经 SHA256 `a402a6af5d8585109d6839d09c2ad45db54ba1843e678fe424fd07522e89a3df` 核对的增量 Git bundle 快进到该合并提交，工作树干净。Mac 拉取并核对 amd64 镜像 ID 与架构后生成 132 MiB gzip 归档，经 SSH/rsync 传到主机；两端归档 SHA256 为 `0b5105f94b0373ed02560791e407a6f7904ec0fede4b5f25f893cb9710302e16`，主机 gzip 校验和 `docker image load` 均通过。主机以完整平台摘要解析到相同镜像 ID。
- `deploy-web.sh` 在四路预检后创建 `20261021T055840Z` 完整备份（`STATUS=complete`，尚未冷恢复），仅重建 Web 为 `ed54ede8c981`，四路后检通过。Auth `1ea0af687aff`、数据库 `91ef7c962cd1`、Kong `452374bb5638`、MinIO `5f198c232aa4`、REST `5436a7e57610` 容器 ID 保持不变。私有 `.env` 仍为 `0600`，Web 运行时返回 `scholarRelease=true` 与 `selfHosted=true`。
- 重新生成一个仓库合成 PDF 的临时分享并经 SSH 隧道用 Chromium 实际打开。390px 手机和 1280px 桌面宽度下，标题、本站页脚、`readest-scholar://` 按钮及本站 OG URL 均出现；页面及按钮无横向溢出，浏览器没有页面脚本错误。[手机截图](scholar-share-mobile-2026-10-21.png)、[桌面截图](scholar-share-desktop-2026-10-21.png)。合成封面虽看起来纯白，但浏览器读到 612×792 自然尺寸、对象请求 HTTP 200；不把它误判成图片加载失败。
- 这次进一步发现两项未通过：浏览器标题为 `Synthetic Sample Paper · Shared via Readest Scholar | Readest`，根布局的构建时标题模板仍追加普通 Readest；OG 图片请求在新镜像上断开连接。容器未重启，脱敏日志显示服务端取合成封面的回环 S3 地址失败后回退文字卡片，而动态品牌文本触发图片渲染器“多个子节点需明确 display”错误。新增真实 `ImageResponse` PNG 流测试先复现该错误，修复文字节点后覆盖有封面、无封面与取封面失败的三种路径；分享页改用 Scholar 绝对标题以绕开根模板。这些修复还未部署，不能把当前镜像的标题和 OG 图片记为通过。
- 本次修复的 Node 24 全量 Vitest 为 **1,175 个文件通过、4 跳过；13,806 项通过、16 跳过、0 失败**；TypeScript、Biome lint/format、Webpack Web 生产构建及显式合成自托管配置下的 Scholar 桌面静态导出均通过。正式镜像还需 PR CI 与 staging 再部署核验。
- 临时分享已经撤销（204），公开元数据返回 410 `revoked`；本机和主机的临时令牌文件及 SSH 隧道已清理。分享令牌不写入仓库。

## PR #30 预览修复的 staging 实测

- [PR #30](https://github.com/gkwfhv/readest-scholar/pull/30) 的最终 `f9e0490ba5f2587dfac948a99a3cd503512c1c5e` 经 Scholar baseline、完整 PR checks、CodeQL 和精确 SHA 评审通过后合并为 `3579888b7009d1f6439f47f633baea332fab726f`。[GHCR 发布运行](https://github.com/gkwfhv/readest-scholar/actions/runs/39554768956)的 amd64、arm64 构建和合并任务均成功。amd64 平台摘要为 `sha256:dbfede82633c63e02d4320318677b8c029a2171a8848772a44d87cc1930e7b75`，arm64 为 `sha256:4b64580c48a2d2043e0eeda39ddc7c1dfc7a6657bd0e8ded4eeaa55a5f03e639`。
- 主机源码经 SHA256 `69716319556b621b4ab514eb134db3598bf86f1dfafe5831be6a68600ee7b9b0` 的增量 Git bundle 快进到该合并提交且干净。Mac 校验新 amd64 镜像 ID 和架构后导出归档，两端 SHA256 为 `453967b211fb0bb8eb8bfde51b049e95a1bdd817d9242c4857cbe89a7bcf7108`，gzip 校验和主机导入成功。主机随后可直接向 GHCR 拉取固定摘要以登记 RepoDigest，最终 `docker image inspect` 显示同一镜像 ID 与 `linux/amd64`。
- `deploy-web.sh` 在四路预检后创建 `20261021T063400Z` 完整备份（尚未冷恢复）；仅 Web 容器由 `ed54ede8c981` 更新为 `5aec91d81ceb`，Auth、MinIO、数据库、Kong、REST 容器 ID 均不变。四路后检通过，运行时 `scholarRelease=true`。
- 主机私有合成账户登录、分享创建、公开页面与元数据均通过；新 OG 接口返回 26,966 字节有效 PNG。通过 Web 和对象存储双 SSH 隧道，Chromium 在 390×844 和 1280×800 视口实际打开页面：浏览器标题恰为 `Synthetic Sample Paper · Shared via Readest Scholar`，应用按钮指向 `readest-scholar://`，页脚与 OG URL 均在本站，封面自然尺寸 612×792，两种视口都没有横向溢出或页面脚本错误。[手机截图](scholar-share-mobile-after-preview-fix-2026-10-21.png)、[桌面截图](scholar-share-desktop-after-preview-fix-2026-10-21.png)。只转发 Web 而未转发对象存储的第一次截图出现断图，补上 S3 隧道后复测通过；前一次不计为产品缺陷。
- 容器内的 OG 取图使用公开的 `127.0.0.1:9130` 签名 URL，而该回环地址从 Web 容器不可达，因此这次 PNG 实际采用文字回退卡片，没有封面。针对自托管 S3 的内部取图回归用例先失败后通过；R2 路径保留原有公开签名 URL。第一次全量命令直接调用 Vitest，绕过仓库的 `dotenv` 包装，触发大量环境缺失错误后已中止；按项目标准命令重跑，Node 24 套件为 **1,175 个文件通过、4 跳过；13,808 项通过、16 跳过、0 失败**。TypeScript、Biome、Webpack Web 生产构建和 Scholar 桌面静态导出通过。新内部取图代码尚未部署，需在下一镜像中验证带封面的实际 OG 图片。
- 合成分享已撤销（204），公开元数据为 410；令牌文件和 SSH 隧道已清理。主机新备份未做独立冷恢复。

## PR #31 OG 封面内部取图的 staging 实测

- [PR #31](https://github.com/gkwfhv/readest-scholar/pull/31) 的最终 `922ff40fe2d26a9b01aec00cb125c1fb51b09b94` 经 Scholar baseline、完整 PR checks、CodeQL 和精确 SHA 评审通过后合并为 `41d980f25dc2e8bdb816b9dc1393555e6954ff35`。[GHCR 发布运行](https://github.com/gkwfhv/readest-scholar/actions/runs/39559179072)完成双架构镜像与 SBOM；amd64 平台摘要为 `sha256:370e23c219bf94421b219fd8c164cb8abb8ce572501614e2fef84b67ad69040c`，arm64 为 `sha256:3d7c92c39b3c194c2d3dce5ead381bbcf2196d0887f41d645a4d9a9915e15d93`。
- 主机源码通过 SHA256 `8097961700d8f17761586bdd413632f8dea4e379a07b49e87311d86348074c63` 的增量 Git bundle 快进到合并提交且干净。主机直拉 GHCR 的最后一层持续无进展，改用本机已核对 `linux/amd64` 镜像 ID 的归档；两端归档 SHA256 为 `70e6ed481b26ef13790d119bca0923667bb1ea2f4ec32432d5ef193304b91ec0`，主机 gzip 校验和导入通过。层入库后，主机用 GHCR 固定摘要拉取 manifest 并确认镜像 ID 与架构相符。
- `deploy-web.sh` 创建 `20261021T072119Z` 完整升级前备份（尚未冷恢复），四路前后健康均通过；仅 Web 容器从 `5aec91d81ceb` 更新为 `77372a7ee3c7`，其余五个服务容器 ID 保持不变。主机源码及静态挂载检查通过。
- 私有合成账户创建临时分享后，公开页面、元数据和 OG 接口均为 200。新 OG PNG 为 **91,846 字节**，实际像素包含合成 PDF 首页缩略图、书名和 `Shared via Readest Scholar`，不再是上一个镜像的 26,966 字节文字回退卡片。[带封面的 OG 图片](scholar-share-og-cover-2026-10-21.png)。撤销分享得到 204，再查元数据为 410；主机临时令牌及 PNG 文件已清理，仓库仅保存不含令牌的合成图片。
- 这次进一步核对 `/library` 的 HTML，根布局标题仍是 `Readest — Where You Read, Digest and Get Insight`。原因是 GHCR 工作流只传入 Web 平台标记，没有把 Scholar 发布标记传入 Docker 构建。单独修复根布局的品牌元数据与构建参数；没有公共域名的镜像不应把上游站点写进 Scholar 的 `og:url`。

## 尚未验收

- 没有测试域名；回环链接只有 SSH 隧道本机可用。正式 HTTPS 分享/批注链接、真实 OAuth 提供方回跳及外部收件人打开分享均未验收。虽然两种 scheme 已加入 Auth 白名单，尚无 OAuth 提供方可发起真实回跳。
- 分享导入到第二个独立账户尚未实测。根布局首页的构建时品牌元数据仍需部署修复；外部站点的社交预览、分享与 OAuth 回跳需要公共域名后验收。
- 正式签名安装包与更新分发仍是独立发布门槛。
