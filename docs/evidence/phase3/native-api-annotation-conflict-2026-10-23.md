# Phase 3：桌面离线批注与在线客户端冲突恢复

日期：2026-10-23。环境为 Linux 测试服务器上的独立 CEF QA-B、回环候选 Web、合成账户和合成 PDF Paper 141。没有本机开发或外部代码上传。

QA-B 在 PDF 第 2 页选择真实文本“Sub- subheadings, as in this p”，通过阅读器创建黄色锚定高亮并写入“B note before conflict”。服务端 book_notes 行 ID 为 ypsa71g，CFI 为 epubcfi(/6/4!/4/4,/6/1:0,/22/1:1)，页码 2，选中文本与备注均读取确认。

停止 QA-B 自己的候选 Web 代理后，UI 将同一条批注改为“B offline editB note before conflict”；本地 config.json 已写入该内容，服务端仍为原文。另一条使用同一合成账户认证的独立 API 客户端，经候选 Web 的 /api/sync 将同一批注改为“A online edit”，服务端更新于 03:37:32 UTC。恢复 QA-B 代理后，已打开的真实客户端显示在线版本；数据库冲突历史保留 B 的离线版本（source=incoming），也保留原服务端版本（source=previous）。没有静默覆盖离线内容。

QA-B 的“Account → Manage Sync → Recoverable note versions”显示 B 离线内容并标记“Older device version”。展开后点击“Restore this note”，界面显示“Note version restored on the server”。服务端当前内容成为 B 离线版本，原在线内容作为 previous 版本留在历史中。该操作沿用已有当前版本校验的恢复 RPC。此合成批注与历史暂留在测试账户中，便于后续重验，不涉及真实用户资料。

这项试验是一个真实桌面客户端与一个独立认证 API 客户端的同键并发；第二端尚未通过另一台应用的图形界面编辑。QA-A 菜单在数据库故障演练后的检查中显示 Sign In，而 QA-B 仍显示 Logged in；没有演练前的 A 登录状态截图，因此不能据此断定数据库故障导致登出。双图形客户端同一批注并发仍是 Phase 3 验收缺口。
