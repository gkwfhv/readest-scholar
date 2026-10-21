# Scholar 自托管链接契约 — 2026-10-21

## 问题与范围

正式身份包已使用 `readest-scholar://`，但原有 HTTPS 批注和分享链接、分享 API 与预览图片仍指向 `web.readest.com`。自托管站点生成的分享令牌不会存在于上游服务，这些链接会打开错误站点。本改动让自托管实例按配置的 Web 地址生成和识别批注、分享及设备绑定链接，并让落地页的 Android 回退地址留在该站点；普通 Readest 的既有上游地址保持原样。

## 测试先行与本地验证

- 改动前四个定向用例失败：批注生成仍为 `web.readest.com`、分享生成仍为 `web.readest.com`、设备绑定解析拒绝自托管域名、分享列表 API 返回上游地址。加入 staging Web 运行时 Scholar 标记后，另一个用例先失败，显示原代码仍选择 `readest://`。
- 修复后，批注、分享、设备绑定、服务端创建/列表/预览元数据、运行时标记和桌面静态导出目标均有定向测试；错误站点和 HTTP 降级链接不被当成 Scholar 站点链接。TypeScript、Biome 与 staging Compose 配置解析通过，Compose 解析结果为 `scholar-staging`、`SCHOLAR_RELEASE=true`，公开端口仍全部绑定回环。
- 首次 Node 24 全量测试为 13,784 通过、9 失败、16 跳过。9 个失败都来自 Readwise 测试完整模拟 `environment` 模块但遗漏新增函数；改为保留真实导出、仅覆盖平台判定后，该文件的 14 项和桌面地址选择的 1 项定向测试通过。重放到最新主分支后的完整套件为 **1,171 个文件、13,793 通过、16 跳过、0 失败**（`vitest run --maxWorkers=4`）。
- Web 生产构建第一次因本机默认 Node 堆上限耗尽而终止；使用 `NODE_OPTIONS=--max-old-space-size=8192` 重跑成功，生成 56 个静态页面。构建保留原有两条 WASM 资源不预缓存警告。
- 同一显式自托管目标下，`build-scholar-macos-smoke.mjs` 完成静态导出与未签名 macOS Tauri `.app` 打包。包标识为 `io.github.gkwfhv.readestscholar`，唯一注册的 URL scheme 为 `readest-scholar`，二进制 SHA-256 为 `1a0c8b009f3a65cff257e026f1e53394a5fbda2ed445abe8e8ce122141812d6d`。这验证编译产物，不等于真实 OAuth/分享往返或正式签名更新。
- 最终提交的远端 CI 与实际页面验收结果在完成后补记。

## 已有 staging 配置事实

在用户授权的非生产 Linux 主机上，既有 `docker/.env` 原有两个回环 HTTP 回调地址，缺少 `readest://auth-callback` 与 `readest-scholar://auth-callback`。先在仓库外的私有目录生成 `0600` 备份 `docker.env.before-scholar-callback.20261021T041219Z`，然后只追加这两个回调，原文件仍为 `0600`。仅重建 `scholar-staging-auth`；运行中的容器环境显示四个白名单项、两种应用回调都存在。Web、Auth、REST/数据库、对象存储的回环健康请求均返回 HTTP 200。主机没有 Node，使用 Python 发起了相同的四路健康请求；第一次尝试运行 Node 脚本得到 `node: command not found`，不记为通过。

## 尚未验收

- 代码尚未部署到 staging Web 镜像，`SCHOLAR_RELEASE` 运行时标记和新链接路径尚未做实际页面往返。
- 没有测试域名；回环链接只有 SSH 隧道本机可用。正式 HTTPS 分享/批注链接、真实 OAuth 提供方回跳及外部收件人打开分享均未验收。
- 正式签名安装包与更新分发仍是独立发布门槛。
