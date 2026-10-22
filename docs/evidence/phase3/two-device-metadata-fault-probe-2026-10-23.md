# Phase 3：双逻辑设备元数据故障探针（2026-10-23）

**范围：合成账户、服务器回环候选 Web。此探针模拟两个协议客户端，并不替代两个真实桌面/Web 应用的端到端验收。**

## 可重复入口

`infra/staging/test-replica-two-device.py` 仅接受回环 Web URL、服务器私有 staging 环境文件与一个 `@example.invalid` 合成账户 ID 文件。它临时建立唯一的 `translation_prompt` 副本，运行后清除该副本与冲突历史，校验残留为零。脚本不包含凭据，不读取真实书籍或用户文件。

## 实际运行

在服务器开发工作区对独立候选 Web `scholar-phase3-web:reviewguard`（127.0.0.1:3135）运行三次，其中后两次启用 `--restart-candidate`：

1. 设备 A 写入初始元数据；设备 B 从游标 0 收到它。
2. A 持有一天前的离线编辑，B 先写较新值，服务端变更序号上升；B 从旧游标收到新值。
3. A 重放过期编辑，较新 B 值保留；把首次成功响应当作丢失，随后重启仅限候选的 Web 容器，再原样重试。变更序号和冲突历史条数均未增加。
4. A 从旧游标重新拉取并收敛到 B 值；历史表保留 A 的落败分支。
5. 探针的副本和历史清除后均为 0。

输出：`two_device_metadata=PASS; offline_replay=PASS; lost_response_retry=PASS; cursor_convergence=PASS; losing_branch_archived=PASS; cleanup=PASS`。原 staging Web 容器未重启；数据库为 036，候选 Web 重启后健康返回 200。无 GitHub/GHCR 上传。

## 仍需

真实桌面与 Web 的离线编辑、断网恢复、半途崩溃、笔记/批注及二进制/删除冲突仍需独立验收。数据库事务内崩溃也不能由这次 Web 进程重启证明。
