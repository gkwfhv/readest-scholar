# Scholar 独立测试包签名更新往返

日期：2026-10-21。范围仅为本机回环服务、一次性测试密钥、独立未签名 macOS debug 包；不涉及正式 Scholar 发布凭据或公开更新源。[Tauri 更新插件文档](https://v2.tauri.app/plugin/updater/)规定更新归档须有签名，静态清单含平台 URL 与签名。

## 隔离配置与产物

- 使用独立 Bundle ID `io.github.gkwfhv.readestscholar.updatesmoke`、名称 `Readest Scholar Update Smoke`，不覆盖已授权的正式身份 `io.github.gkwfhv.readestscholar`。临时配置与一次性 minisign 密钥只存于本机权限 `0700` 的临时目录；私钥文件为 `0600`，不进入 Git、GitHub 或 staging。
- 先构建版本 `0.12.17` 的 debug `.app.tar.gz`。`tauri build --debug --bundles app --no-sign --ci` 生成归档，但明确提示 updater signing 被 `--no-sign` 跳过；随后用 Tauri CLI `signer sign --private-key-path ... --password ''` 对该归档签名。归档 96,060,362 字节，SHA256 为 `b80b4f5d42cf0531f5252223708fb838231256bc4f583f951247f1ca4516477a`。
- 使用项目依赖的 `minisign_verify` 对归档、公钥和 `.sig` 做独立校验：原始字节通过；只改动第一个字节后校验拒绝。签名文件与公钥文件均是 Tauri CLI 输出的 Base64 minisign 文本。
- 独立回环 HTTP 服务 `127.0.0.1:49217` 提供 `latest.json` 和上述归档。清单为 `0.12.17`，平台键 `darwin-aarch64`，含归档 URL 和 `.sig` 原文；清单 GET 与归档 HEAD 都为 200，长度与本地归档一致。HTTP 仅用于临时回环测试，测试配置显式启用 `dangerousInsecureTransportProtocol`；正式配置不能沿用该设置。

## 旧版客户端实际升级

1. 以同一测试 Bundle ID 构建 `0.12.16` debug 客户端，更新端点只指向本机清单，公钥为这次的一次性公钥。其前端作为非 Scholar 更新测试编译，以便显示现有更新入口；正式 Scholar 前端仍关闭上游更新检查。
2. 客户端检测到 `0.12.17`，显示“下载并安装”。第一次下载完约 91 MiB 后失败；WebView 控制台明确报 `Invalid encoding in minisign data`。原因是临时配置把 CLI 已经 Base64 编码的 `.pub` 又编码一次。旧版磁盘版本保持 `0.12.16`，没有宣称第一次成功。
3. 将临时配置的 `pubkey` 改为 `.pub` 文件原文，仅重打旧版原生客户端。再次从“关于”手动检查更新并安装；下载进度到 100%，旧进程退出、新进程启动。安装位置的 `Info.plist` 显示同一测试 Bundle ID 与 `CFBundleShortVersionString=0.12.17`，新版窗口标题和关于页为 `Readest Scholar`。这证明此独立测试包完成了检测、下载、验签、替换及重启。

## 测试边界

- 更新包构建时只覆盖 Tauri 配置中的版本号；前端 `package.json` 仍是 `0.12.16`，因此升级后关于窗口的前端版本文本仍显示 `0.12.16`。磁盘包版本及新进程已是 `0.12.17`。正式构建必须同步更新单一版本来源，不能复用此测试覆盖方式。
- 这是未做 Apple 代码签名/公证的本机测试包。没有验证正式 Scholar Bundle ID 的签名安装、公开 HTTPS 更新源、跨机器分发、失败回滚或 Windows/Linux 更新。正式 `scholar.release.json` 的更新端点仍为空，应用内上游更新继续禁用；这次测试没有改变生产配置。
