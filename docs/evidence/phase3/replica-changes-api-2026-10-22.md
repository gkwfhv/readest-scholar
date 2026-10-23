# Phase 3：副本变更分页 API（2026-10-22）

**状态：服务器本地的数据库与接口层定向及全量回归通过；客户端尚未切换，Phase 3 整体未通过。** 本项没有向 GitHub/GHCR 推送，也没有修改现有 staging 数据库。

## 协议

迁移 033 提供仅认证账户可调用的 `replica_changes_page(kind, after, limit)`。查询按 `(user_id, kind, change_seq)` 递增，调用者身份由 `auth.uid()` 和表 RLS 双重限定。数据库在生成 JSON 前把 bigint 序号转成十进制文本。新 GET `/api/sync/replica-changes` 限制单页 1–1,000 条，用多取一条判断 `hasMore`，返回 `changes[{seq,row}], nextCursor, hasMore`。已有 HLC 接口保持可用，客户端尚未消费此新端点。

## 已执行检查

- 隔离数据库的红测故意跳过迁移 033：缺少分页 RPC，退出码 3。
- 应用 032/033 后：第 1,000/1,001 条相同 HLC 跨页可见；旧内容 HLC 更新获得新的传输序号；账户 B 只能取得自身记录；匿名角色没有执行权限；`9007199254740993` 在 RPC 中仍是精确字符串。测试脚本退出码 0。
- 032 和 033 均重复迁移后，隔离数据库测试再次退出码 0。测试容器没有宿主端口或持久卷，结束后由脚本删除。
- API/协议及既有校验定向单测 29/29 通过；`pnpm lint` 通过；服务器 Web 构建通过且产物包含新路由。
- 全量单测：`docker exec -e NODE_ENV=test -e SELF_HOSTED= scholar-native-builder sh -lc "cd /workspace/apps/readest-app && pnpm test --run --maxWorkers=2"`，1,188 个文件、13,875 项通过，16 项跳过，退出码 0。容器默认 `NODE_ENV=production`、`SELF_HOSTED=true` 会改变 React 和付费入口测试的行为；先后两次非基准环境运行未通过，最终结果仅采用上述显式测试环境的完整运行。

## 尚未满足的 Phase 3 条件

客户端仍使用旧 HLC 拉取游标，尚无按账户持久的序号游标与逐页应用确认。正式 staging 迁移前还需备份、升级与回退演练；直接物理 DELETE、长离线冲突与双设备故障注入仍未验收。详见 [ADR 0004](../../adr/0004-replica-change-cursor.md)。
