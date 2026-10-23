# Phase 3：Scholar 文件版本冲突处理（2026-10-23）

范围：服务器开发工作区、回环候选 Web、隔离 Linux CEF 桌面 QA 容器、合成 staging 账户。未开放公网端口，未使用真实用户文件。

## 实现

- GET /api/scholar/files/history 只返回当前账户拥有且仍有效的 Scholar 文件的已验证版本；支持按操作 ID 或版本 ID 精确查找旧版本，响应不包含对象存储密钥。
- POST /api/scholar/files/restore 调用带所有权检查及活动版本 compare-and-swap 的数据库函数，过期基线返回 409。
- 桌面传输队列对 Scholar 版本冲突显示 Resolve；对比云端和此次上传的时间、大小及 SHA-256 摘要。用户可保留云端或使用此次上传。两个选择均通过服务器 compare-and-swap，随后才更新本地基线并清理上传快照；冲突任务不会被“重试全部”盲目重放。
- 修复登录晚于传输管理器初始化时 Scholar 账户 ID 仍为 null 的问题；认证会话变化会同步更新队列所属账户。

## 验证

- API 探针：历史查询 200、按操作 ID 精确查询 200、过期恢复 409、有效恢复 200。
- 桌面 UI：Paper 142 的 89,808 字节 PDF 入队并暂停；服务端在客户端真实路径 Readest/Books/{hash}/Scholar Scale Paper 142.pdf 发布不同的 89,835 字节版本。恢复队列后出现“Scholar file conflict; local version retained”及 Resolve。弹窗同时显示不同 SHA-256 的云端和此次上传版本；点击“Use this upload”后队列完成数 5→6、失败数 10→9。
- 数据库当前活动版本 SHA-256 7c825acfb5eb94fa508bd13ca3e95c93e3deb96a5ab27da7e4f30915b1893770、大小 89,808 字节，与 QA 容器本地 PDF 的 SHA-256 和大小一致；scholar-uploads 待上传快照已清理。之前两次未出现冲突是私有测试脚本写错文件路径，并非客户端吞掉 409；脚本已改为上述真实路径。
- 最终源代码在服务器容器中定向 Vitest 4 文件、47 项通过；TypeScript 与 Biome lint 通过（2,885 文件）；Next 原生静态构建成功，Tauri Linux CEF 未签名 debug 构建成功，二进制 SHA-256 a38457a93cb6e7865a35d9a90980d03f2aa7fe75f14ef777926609e200fc1593。最终构建之前的真实 UI 试验覆盖“Use this upload”；最终修改的“Keep cloud version”原子路径由组件测试和既有数据库 CAS 测试覆盖。
- 本功能修改前的完整服务器 Vitest：1,215 文件通过、4 跳过；14,000 项通过、16 跳过。最终改动后按所涉模块重新运行了定向测试。

## Phase 3 后续

这项文件冲突处理已通过上述范围的验收。整个 Phase 3 仍须完成按需缓存/完整镜像、真实 Web 与桌面双端离线编辑及断网/崩溃恢复、笔记和批注的端到端故障注入、二进制删除冲突和封面版本兼容；不能据此签收整个阶段。
