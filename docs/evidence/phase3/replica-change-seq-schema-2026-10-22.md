# Phase 3：服务端副本变更序号的数据库基础（2026-10-22）

**状态：隔离数据库迁移及行为验收通过；API、客户端和 Phase 3 整体未通过。** 全部开发与验证在 Linux 测试服务器进行，未向 GitHub/GHCR 推送，也未把迁移应用到现有 staging 数据库。

## 行为与安全边界

新增迁移 `032_scholar_replica_change_seq.sql` 为每个账户的副本行回填并分配 `change_seq`。同账户写事务通过计数行锁串行化，锁在提交前不释放；回滚同时撤销计数增长。行内容 HLC 保持原样。计数表启用 RLS 并撤销普通客户端直接权限，触发器以限定搜索路径的 `SECURITY DEFINER` 身份分配序号。旧的 HLC 拉取接口没有在此项中切换。

## 先红后绿的证据

1. 在无宿主端口、无持久卷的独立 Supabase PostgreSQL 容器中，先运行 `SCHOLAR_REPLICA_SEQ_SKIP_MIGRATION=1 docker/volumes/db/tests/run-scholar-replica-change-seq.sh`：退出码 3，断言在 1,001 条相同内容 HLC 的记录上报告缺少 `change_seq` 列。
2. 应用迁移后同一脚本退出码 0。断言覆盖第 1,000/1,001 条分页边界、第二账户独立从 1 计数、旧内容 HLC 的字段更新仍获新序号、新插入及 ON CONFLICT 更新获新序号、普通认证角色无法直接读计数表、账户 RLS 过滤、事务回滚不消耗序号。
3. 两个独立数据库连接并发写同一账户：写者 A 持有未提交事务时，写者 B 不能提前完成或被拉取看到；A 提交后 B 的序号更大。脚本以数据库可见行和最终顺序做断言，退出码 0。
4. 用 `SCHOLAR_REPLICA_SEQ_REPEAT_MIGRATION=1` 在同一隔离数据库连跑迁移两遍：第二次回填 0 行，分页和更新断言仍通过，退出码 0。
5. 应用定向 `db-bootstrap-migrations` 与 `replica-kind-allowlist` 单测 10/10 通过；`bash -n` 与 Git 差异空白检查通过。

测试脚本均由 `trap` 删除本次隔离容器；没有改变原有 staging 数据库、对象存储或公网端口。

## 后续门槛

新 API 还需以十进制字符串返回序号并逐页拉取，客户端必须按账户保存并在本地持久应用后提交游标。当前测试只证明数据库变更顺序，不证明多设备长期离线收敛。直接物理 DELETE、旧客户端兼容、清单/复活冲突与运行时故障注入仍按 [ADR 0004](../../adr/0004-replica-change-cursor.md)处理。正式 staging 迁移前须备份并做升级/回退演练。
