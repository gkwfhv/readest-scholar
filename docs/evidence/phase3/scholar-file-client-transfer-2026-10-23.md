# Phase 3：客户端文件版本传输基础

范围：服务器本地分支，尚未接入书库界面或后台文件同步。无 GitHub/GHCR 推送。

`webUpload` 可附加服务端签名要求的 `If-None-Match: *` 头；普通上传的调用形式未变。`uploadScholarFileVersion` 接受调用方提供的 `opId` 和预期活动版本，分块计算文件 SHA-256，依次调用预留、只创建 PUT 与服务端校验完成。若 PUT 响应丢失或重试收到 412，仍尝试完成接口，由服务端验证实际对象字节；校验通过才返回成功或保留冲突版本。失败由调用方以同一操作 ID 重试。

头部传递和操作重试测试先失败再通过，14 条定向测试通过；TypeScript/Biome 与服务器 Web 构建通过。调用方尚未把 `opId` 和源文件引用写入持久离线队列，无法声称断电恢复；大文件 multipart/断点续传和 Tauri 原生传输仍未实现。

后续在服务器本地补齐原生上传传输：桌面端现在将同一 `If-None-Match: *` 条件头传给现有 Tauri 流式 `upload_file` 命令，Web 仍用 XMLHttpRequest。先写的原生分支回归在改动前失败；改动后 5/5 通过，TypeScript/Biome 通过。该 helper 尚未接入书籍传输队列，未把此项误记为完整桌面同步验收。
