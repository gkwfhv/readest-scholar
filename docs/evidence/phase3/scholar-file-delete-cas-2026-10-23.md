# Phase 3：Scholar 文件条件删除与冲突界面（阶段性证据）

日期：2026-10-23。环境：服务器 `/home/gavin/readest-scholar-dev`，`scholar-staging` 数据库与隔离候选 Web／Linux 客户端；未涉及生产。

## 实现范围

- `045_scholar_file_delete_cas.sql` 提供基于当前活动版本的条件软删除与稳定操作 ID 重放；文件版本、活动头及对象保留。
- Scholar 客户端删除任务在入队时固定账户、文件路径、版本基线及操作 ID；冲突不自动重试。冲突弹窗展示远端活动版本，允许保留云端文件或经用户重新确认后删除当前版本。
- 旧 `/api/storage/delete` 与 `/api/storage/purge` 在接触对象存储前拒绝 Scholar 主文件和版本对象；即使发布标志关闭，也会查询已有版本关联。
- 后续检查发现旧客户端的 `both` 删除仍会异步调用通用对象删除；现已在 Scholar 模式跳过该调用，直接 `cloud` 调用显式拒绝，统一由版本感知队列处理。

## 可复现验证

- SQL：`docker exec -i scholar-staging-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < infra/staging/test-scholar-file-delete-cas.sql` 成功，事务末尾 `ROLLBACK`。覆盖过期基线 409、跨账户拒绝、成功软删除、重复操作、版本与活动头保留。
- Web：服务器容器 `scholar-phase3-delete-candidate` 的合成 HTTP 探针结果为 `status=200 stale_delete=409 legacy_delete=409 delete=200 replay=200 tombstone=404 retained_version=1`；探针结束时清理记录。
- 单元：四个定向文件共 51 项通过；`pnpm lint` 完成，TypeScript 与 Biome 通过。Web 与 Linux Tauri debug 候选均在服务器构建成功。 追加的 `cloud-service.test.ts` 35 项通过，覆盖旧客户端路径不触碰 Scholar 对象；追加改动的 TypeScript／Biome 再次通过。
- 桌面：合成文献 142 从客户端删除后，队列任务完成；数据库显示主文件 `deleted_at` 已设置，版本仍保留。合成文献 140 在远端活动头变化后，客户端任务返回 `Scholar delete conflict; remote version retained`，队列显示 Resolve，弹窗布局完整且同时呈现两种处理操作；选择“Delete current cloud version”后，队列从 Failed 10 变为 Failed 9 / Completed 8，数据库查得软删除、两个版本保留。为检查冲突而临时插入的无对象版本随后已从 staging 移除，活动头恢复至原版本。

## 尚未签收的 Phase 3 判据

本证据只覆盖文件删除冲突这一路径。计划中的双设备并发编辑、断网／恢复、增量 cursor、服务崩溃注入、注释与笔记同步、缓存及完整镜像设置仍需分别验收；因此 Phase 3 仍进行中。
