# Phase 3：Linux 原生客户端正文上传验收

在服务器隔离 QA 容器中构建并运行 Readest Scholar Linux CEF debug 测试包。候选 Web API 是 `http://127.0.0.1:3145`，认证服务是 `http://127.0.0.1:8130`，对象存储是 `http://127.0.0.1:9130`；这三个端口只在容器回环接口提供代理。独立测试包通过 `NEXT_PUBLIC_API_BASE_URL` 指定 **origin**，不附加 `/api`；`getAPIBaseUrl()` 会自行添加该路径。构建还使用 staging 的 `NEXT_PUBLIC_SUPABASE_URL` 和公开 anon key。未配置公网入口。

首次原生测试构建误把 API 地址设成 `http://127.0.0.1:3145/api`，客户端请求落到 `/api/api/...`，候选服务返回 HTML 404，上传队列报 JSON 解析错误。改用纯 origin 后，认证和 API 请求恢复。另一个遗漏的认证构建参数曾让客户端进入登录页；补齐后沿用测试账户会话，无须更改账户数据。

合成账户已有 201 本文献元数据与旧版可变文件。原生客户端重新生成的封面与远端旧封面大小不同，存储预留接口按设计返回 409。Scholar 客户端现在对这一种封面大小冲突保留远端旧封面，继续上传 PDF 不可变版本；其他封面错误仍会中止。定向测试先失败再修复，5 项通过；封面请求失败后现会关闭已打开的文件句柄；TypeScript/Biome lint 通过。这个兼容处理不会同步新的封面内容，后续仍需单独设计封面版本更新。

重新构建后的未签名 Linux CEF debug 二进制 SHA-256：`42e2da4b703f314528766188d71552abf4711714b013dd97cadeb8f004a472f0`。通过真实客户端界面重试合成文献 Paper 139，传输队列显示 completed。数据库出现 1 个 `ready` 文件版本，大小 89,808 字节，SHA-256 `6dc23e74be2a533024b939ed7db9dba191e8664f5217f90e820b8beeec8acca4`，与 QA 容器本地 PDF 的长度与 SHA-256 完全一致。使用该客户端的合成账户会话调用指定版本下载 API，得到 200；签名对象下载也返回 200，89,808 字节，长度与 SHA-256 均与 API 清单一致。正式 staging Web 仍是旧镜像；没有向 GitHub 或 GHCR 推送。

文件句柄补丁与完整回归之后，服务器重新构建当前源码的未签名 CEF 测试包，SHA-256 为 `7fbef2352380447da38cb35bd54472357edba879c027e554deb800b33cdd68f7`；QA 容器重启后仍显示 201 本本地合成文献。前述真实上传和下载验收使用的二进制为 `42e2da4b703f314528766188d71552abf4711714b013dd97cadeb8f004a472f0`，两次构建之间只增加了异常路径关闭文件句柄的代码。

完整 Vitest 在服务器构建容器中以 `NODE_ENV=test`、清除 `SELF_HOSTED`、2 worker 运行，1,211 个文件通过、4 个跳过；13,979 项测试通过、16 项跳过，退出码 0。日志：`/home/gavin/.cache/scholar-native-target/scholar-cover-full-2worker.log`。本地版本基线也已按账户和该文献云路径持久保存。本项完成后仍需队列正文快照、账户切换恢复、冲突 UI、按需缓存/完整镜像以及双设备故障测试，Phase 3 尚未验收。
