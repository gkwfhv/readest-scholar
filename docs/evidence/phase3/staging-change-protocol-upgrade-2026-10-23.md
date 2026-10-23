# Phase 3：staging 变更协议升级与回退演练（2026-10-23）

**范围：仅服务器 SSH 隧道后的合成数据测试栈。** 无 GitHub/GHCR 推送、无公网端口开放。候选 Web 仅短暂运行，结束时原 Web 镜像已恢复；数据库保留兼容性的增量迁移 032/033。Phase 3 整体仍未验收。

## 迁移前保护与恢复验证

- 原 staging 四路健康均通过，迁移账本停在 `031_scholar_auto_file_link.sql`。原 Web 镜像 ID：`sha256:f5a0ddae78db6365b5dcce8138434292e548a75b8f71004dc138ad2b44c024cd`。
- 用现有指定 Compose 项目的备份脚本生成私有快照 `/home/gavin/scholar-staging-backups/20261022T161827Z`，`STATUS=complete`，约 79 MiB，含可恢复 SQL 和对象副本；未复制到本机或上传。
- 在 `scholar-staging-db` 内的独立临时数据库恢复该快照，恢复前后副本行数均为 5；先在临时库应用 032/033 成功，5 条均获得非空且账户内唯一的 `change_seq`。
- 真实 staging 的迁移脚本仅应用未入账的 032/033，退出码 0；账本到 `033_scholar_replica_changes_page.sql`，原 5 条副本仍为 5 条且序号唯一，四路健康仍通过。
- 从同一迁移前快照重新创建临时库，确认账本仍为 031、副本 5 条且不存在 `change_seq` 列。随后删除临时库。这证明 SQL 快照可恢复迁移前数据库状态；没有对真实 staging 执行数据库降级。

## 候选 Web 与回退

- Dockerfile 的完整离线构建在 `corepack` 下载 pnpm 步骤失败；改在服务器专用构建容器以 staging 公共 URL/匿名公钥和 `BUILD_STANDALONE=true` 生成 Next standalone，生产构建退出码 0。随后在服务器以 `docker build --pull=false --network=none` 封装本地镜像 `scholar-phase3-web:3857f542b`，ID `sha256:3c4f6a30fb6d17709d844052415e41161b88c2027981802b74d6d2c8674fc887`。镜像和源码均未上传。
- 独立回环端口 3135 的候选容器：`/library` 和 PDF worker 为 HTTP 200；未认证的新分页接口为 401；合成账户登录后按 `settings, after=0, limit=1` 得到 1 条账户匹配且文本序号的记录，下一页为空。
- 私有 Compose 覆盖文件经 JSON 比较证明仅 `client.image` 与原配置不同，全部端口仍绑定 `127.0.0.1`。只重建 staging 的 `client` 容器后，四路健康通过；新接口对匿名请求 401、合成账户 200。
- 撤销覆盖文件并仅重建 `client` 后，镜像 ID 精确恢复原值，四路健康通过。旧 `/api/sync/replicas?kind=settings` 在迁移后的数据库上对合成账户仍为 HTTP 200、1 条账户匹配记录。
- 独立烟测容器和临时恢复数据库已删除；保留私有备份、本地候选镜像及 032/033 的 staging 数据库状态供后续双设备验证。

## 未完成门槛

正式 staging Web 目前仍是旧镜像，新客户端尚未在双设备上完成断网、重复提交、崩溃恢复或冲突版本验收。迁移后的数据库回退需恢复备份，不能靠 Web 镜像回退自动撤销；本次只在临时库验证该路径。长期离线旧 HLC 提交仍受保护门槛阻挡。
