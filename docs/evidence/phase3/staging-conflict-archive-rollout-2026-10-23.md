# Phase 3：staging 冲突历史升级和 Web 回退（2026-10-23）

**范围：仅 SSH 隧道可达的合成数据 staging。Phase 3 整体仍未验收；没有向 GitHub/GHCR 推送，也没有开放公网端口。**

## 保护、升级和权限

- 升级前 staging 为迁移 033、5 条副本记录和原 Web 镜像 sha256:f5a0ddae78db6365b5dcce8138434292e548a75b8f71004dc138ad2b44c024cd。用指定 Compose 项目的备份脚本生成服务器私有快照 /home/gavin/scholar-staging-backups/20261022T165937Z，含可恢复 SQL 与 Silo 对象副本，STATUS=complete。
- 在独立临时数据库从该快照恢复，应用 034/035，再运行回滚事务的 infra/staging/test-replica-conflict-archive.sql：获胜、前一个服务端版本、迟到落败版本、重复提交不抬游标、账户隔离、旧 RPC 兼容和直接伪造历史被拒绝均通过；测试后历史表为 0，临时库已删除。
- 真实 staging 依次应用 034/035；账本当前为 035。035 撤销客户端角色对历史表的直接 INSERT，仅账户校验的新版合并函数和副本更新触发器可写。真实表当前 0 行，原 5 条副本仍在，四路健康检查为 200。

## 候选 Web 和回退

- 服务器构建容器用 staging 公共配置生成 Next standalone；本地 Docker 无网络封装候选 scholar-phase3-web:d16992270，镜像 ID sha256:763d871353737c96bfaa8aeacb2113689651fde9c991cc44f325da52e7cbebbd。
- 独立 127.0.0.1:3135 容器：/library 为 200、未认证副本 API 为 401；合成账户令牌访问旧 GET、新版 v2 重复推送和分页拉取均为 200，重复推送不改变变更序号。035 应用后重复了这组登录态烟测。
- Compose 配置比较确认临时覆盖只改变 client.image。将 staging Web 短暂切至候选后，页面和同一组登录态 API 通过；退出时自动重建原 client，镜像 ID 精确恢复到原值。独立烟测容器已停，Web/认证/Silo 健康均为 200。
- 数据库 034/035 保留兼容迁移，Web 回退不等于数据库降级；迁移前快照保留在服务器，隔离库已验证 SQL 可恢复。没有对真实 staging 进行破坏性数据库恢复。

## 尚未通过

两设备离线并发、笔记/批注冲突、生命周期及二进制操作、冲突恢复界面、崩溃注入和用户文件按需缓存尚未验收。原 Web 镜像仍在线，候选只做受控烟测；不能据此签收 Phase 3。
