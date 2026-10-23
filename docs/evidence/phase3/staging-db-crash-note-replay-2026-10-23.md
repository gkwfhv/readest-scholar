# Phase 3：合成 staging 数据库故障与批注重放

日期：2026-10-23。全部操作在 Linux 测试服务器进行，候选 Web 只绑定回环地址。使用合成账户、唯一临时文献哈希与临时批注。没有推送 GitHub 或 GHCR。

在故障注入前，infra/backup/backup-compose.sh 生成完整备份 /home/gavin/scholar-staging-backups/20261023T030540Z，STATUS=complete，包含数据库可恢复 SQL 与对象数据。数据库容器事前确认为 Compose 项目 scholar-staging 的 scholar-staging-db，重启策略 unless-stopped。

infra/staging/test-book-note-api.py --test-restore --restart-db 先写入带 CFI、XPointer、页码、颜色、选中文字和备注的批注，读取确认，然后暂时关闭该测试数据库容器的自动重启策略并发送 SIGKILL。数据库停止时相同批注请求失败。探针在 finally 中重新启动数据库并恢复 unless-stopped 策略，等待 PostgreSQL 与 PostgREST 可用后确认原批注仍在。随后重发同一请求，冲突版本数保持 0；原有过期删除、同时间戳、新编辑、恢复 CAS 测试继续通过。输出：

    database crash probe passed: committed note survived KILL; failed request retried once
    note restore RPC passed: archived version restored; stale CAS rejected
    note API fault probe passed: anchored annotation/retry/stale/delete/tie/revive and four archived versions; candidate_restart=False

探针退出时删除自己的当前批注与冲突历史。故障后容器状态为 running、健康状态 healthy、重启策略 unless-stopped。服务器上的四路就绪探针分别返回 OK Web、OK Auth via Kong、OK REST + database via Kong、OK Object storage；候选 Web 的 /library 返回 200。

同一服务器构建容器的完整 Vitest 使用标准测试环境（NODE_ENV=test、空 SELF_HOSTED）通过：1221 个测试文件、14035 个用例通过，16 个预期跳过，0 失败。先前将原生 QA 构建环境传给 Vitest 曾造成大量无关失败；代表性失败测试在标准环境已通过，本次完整回归证实无产品回归。

本次证明数据库进程停止后的已提交批注保留、请求失败与幂等重放。它不覆盖两台真实应用对同一批注的并发编辑，也不覆盖存储卷损坏或整机故障；后者仍需单独验收。
