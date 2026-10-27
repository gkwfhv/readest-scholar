# Phase 6 非生产自验收（2026-10-26）

状态：Phase 6 在非生产合成环境内自验收通过。真实模型金样本、服务器全量单测、Web 候选构建/健康检查和 GitHub CI 均通过；这不代表移动真机或正式发布验收通过。环境是服务器上的合成 staging、隔离 pdf2zh-next Worker 和本地 OpenAI 兼容模型，未开放新公网端口。

| 工程计划判据 | 当前证据 |
|---|---|
| 独立 Worker、任务队列与资源限额 | 只读文件系统、独立容器、CPU/内存/PID 与临时目录限额；租约续期、进度、超时和故障终止由 Worker 单测覆盖 |
| 原文与译文附件关联 | 两页 BERT 真实 PDF 的合成账号任务中，原文 SHA-256 保持 `bc7b8e0043ba8a5fd6301cacbd63b624dccd23098992623c795b568a8d2d46dc`；输出独立文件、同一文献关联、对象 SHA-256/大小/页数往返通过 |
| 翻译进度、失败恢复、取消与重试 | SQL v3 事务探针、Worker 18 项测试；队列中取消后重试且再次取消的 staging 实测：两项均为 `canceled`、译文 0 项，重试关系和第 2 页选项保留 |
| 术语配置 | CSV 列、语言、行数、大小及哈希校验的 Worker 回归通过；UI 可以上传术语表 |
| 英文双栏与公式/表格金样本 | 4B 模型的 BERT 双栏真实队列输出、源/译文哈希、2 页和高清视觉检查通过；Attention 第 2 页的表格、复杂度和位置编码公式、中文正文目视检查通过，见 [质量记录](translation-quality-2026-10-26.md) |

数据库迁移 051、052 在 staging 备份后应用，v2/v3 隔离 SQL 探针通过；匿名与认证角色不能直接执行 service-role 队列 RPC。Web 新增页级白底兼容开关并提示图内标签风险，桌面和电子墨水模式截图见 [质量记录](translation-quality-2026-10-26.md)。UI 截图中的文件状态与任务历史为合成响应，真实 API/Worker 另行验收。

最终服务端验证：Worker 18/18 项单测通过；API 8 项、UI 1 项及翻译控制 4 项定向测试通过；TypeScript/Biome `pnpm lint` 检查 2,945 个文件通过。完整 Vitest 在 `SELF_HOSTED=`、`NODE_ENV=test` 的非自托管测试环境下通过：1,248 个文件、14,154 项测试通过，原有 4 个文件 / 16 项跳过，0 失败。首轮运行沿用了构建容器的 `SELF_HOSTED=true`，旧付费门禁测试出现环境相关失败；另有一条翻译控制测试仍断言 v1 RPC，已更新为 v3。改正环境与断言后的最终全量运行退出码为 0。Web 候选最终生产镜像 `sha256:9f6e22f60ab3a58a53d181c7713cb1590f995ff9eff200cb95f4059ba3da61a6` 已在服务器构建，并在独立回环容器 `scholar-phase6-web-candidate` 返回 `/library?layout=research` HTTP 200；4B 本地模型 `/v1/models` HTTP 200、翻译 Worker 运行且重启 0。GitHub CI 在提交 `b2a26a16e204325db64b878bfb084215afb002fd` 上通过：[Scholar baseline](https://github.com/gkwfhv/readest-scholar/actions/runs/40273732974)、[PR checks](https://github.com/gkwfhv/readest-scholar/actions/runs/40273732998)、[CodeQL Advanced](https://github.com/gkwfhv/readest-scholar/actions/runs/40273732964)、[Nix dependency hashes](https://github.com/gkwfhv/readest-scholar/actions/runs/40273733247)。PR checks 包含 Web 与 Tauri 构建、两组 Web 测试（含浏览器测试）、Nix flake、Rust lint 和扩展测试。该提交之后的文档重排需由新提交 CI 再确认；Android E2E 属于 Phase 7，单独记录。
