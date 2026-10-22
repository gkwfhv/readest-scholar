# Phase 3：旧上传与不可变版本共用配额

范围：Linux 测试服务器本地 `feat/scholar-offline-metadata` 分支、隔离 SQL 数据库及回环候选 Web `127.0.0.1:3142`。没有向 GitHub 或 GHCR 上传。

迁移 043 在数据库账户锁内为旧 `/api/storage/upload` 预留文件行，统一计算未删除的 `files` 与待上传、已验证的 `scholar_file_versions` 字节。同一文件、同一大小的重试不重复占用；已有文件但大小不同返回冲突。`get_storage_usage_v1` 汇总同一批对象；API 的 `usage` 和新增 `versionCount`、`versionBytes` 使用实时数据。两个 RPC 仅授权 service role。旧自托管数据库缺少迁移时仍有兼容回退路径。

先写测试验证旧 API 不使用原子预留及统计遗漏版本字节；新旧上传单测 12/12、用量单测 1/1 通过。迁移及回滚式探针在隔离数据库通过，覆盖重试、拒绝超额、版本字节和权限；TypeScript、Biome、Next standalone 构建通过。

正式 staging 数据库应用 043 前保存了 `phase3-quota-pre043-20261022T210343Z.dump`（仅服务器本地）。正式 Web 镜像未更换。候选 `scholar-phase3-web:quota-local` 的本地镜像 ID 为 `sha256:dbd53f426bd188900aa580530d37f88686206f2af322d33c53c650ee27c7c5bb`。合成账户真实 HTTP 验证旧上传与旧下载、新版本上传与旧下载别名、统计同时计入两类字节、超过配额及 10 MiB grace 的旧上传获 403、活动版本后旧上传获 409。测试版本对象、书籍和文件行已清理；版本数及临时超额文件数回到 0。

这仅收窄 Phase 3 的配额缺口。客户端离线文件队列、界面冲突提示、分块续传、删除生命周期和双设备验证尚未完成；正式 staging Web 仍是原镜像。

后续输入边界补丁：旧上传接口在预留前拒绝负数、字符串或不安全整数大小，额度加宽限值也先做安全整数校验；先写的 3 个无效大小用例失败，修复后相关 15/15 与 TypeScript/Biome 通过。
