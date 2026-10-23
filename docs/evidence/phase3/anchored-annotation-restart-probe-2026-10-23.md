# Phase 3：带锚点批注的候选 Web 重启探针

日期：2026-10-23。使用服务器上的 `scholar-phase3-note-candidate`（只绑定 `127.0.0.1:3137`）、合成账户和隔离 staging 数据库。没有公网端口、真实文献或 GitHub 上传。

`infra/staging/test-book-note-api.py` 增加真实批注结构字段：CFI、页码、起止 XPointer、选中文本、样式、颜色与笔记。写入后逐项读取核对，冲突历史也核对锚点字段，避免只检验笔记文本而漏掉定位信息。

使用服务器私有 `phase2-scale-auth.json` 和 `qa-runtime.env` 执行 `--test-restore --restart-candidate`。初次写入后重启仅候选 Web 容器；恢复后重发完全相同的批注请求，确认没有生成虚假冲突历史。之后验证过期删除、重复请求、较新删除、同时间戳编辑、复活及旧版恢复；过期恢复请求返回 409。输出：

```text
note restore RPC passed: archived version restored; stale CAS rejected
note API fault probe passed: anchored annotation/retry/stale/delete/tie/revive and four archived versions; candidate_restart=True
```

第一次运行在重启瞬间收到 TCP reset，暴露出探针健康轮询未捕获连接复位；修复轮询后同一场景通过。探针的 `finally` 清理合成记录；额外查询确认该前缀的当前笔记与冲突历史均为 `0/0`。

此项证明服务端在候选 Web 进程重启后的幂等重放及批注锚点字段保留。它不代表两个真实应用实例的并发操作、底层数据库事务中断或阅读器内高亮视觉定位已验收。
