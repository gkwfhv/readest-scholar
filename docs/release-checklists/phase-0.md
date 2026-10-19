# Phase 0 验收清单

- [x] 锁定上游 SHA，并区分同名 tag
- [x] 阅读 AGENTS、架构、代码布局、测试和 Docker 文档
- [x] 写出差距矩阵、数据流、风险和 ADR 0001
- [x] 本地 `git rev-parse` 与锁定 SHA 一致
- [x] 7 个源码子模块已初始化到锁定提交；仅 `gstack` Agent skill 子模块未初始化
- [x] Node 24 下 `pnpm test --run` 有退出码：1（13752 通过 / 3 个 Turso 精度断言失败 / 16 跳过）
- [x] `npm run lint` 退出 0，PDF 定向测试 77 项通过
- [x] Compose 配置确认四个发布端口都只绑定 `127.0.0.1`；以固定摘要的 Pigsty MinIO 兼容镜像启动空测试栈，核心服务健康
- [x] Node 24 Web 构建通过；浏览器从文件导入并打开仓库测试 PDF，截图已保存
- [x] Tauri 静态前端构建、`cargo fmt -p Readest --check`、Rust/Tauri 无签名调试编译和 `.app` 打包通过
- [x] 独立标识的 macOS 测试版导入并打开与 Web 相同的两页 PDF；此包未正式安装或签名
- [x] 以官方 Compose 加测试覆盖文件完成合成账户登录、桌面 PDF 上传、Web 下载与阅读；对象存储镜像是替代发行版
- [x] 同一合成 PDF 的 Web/桌面书签双向同步、桌面高亮到 Web、Web 备注到桌面已实测并存截图
- [x] 真实备份写入空目录；可恢复 SQL 一次性导入隔离空数据库，对象数据在无端口临时容器中读出 2 个文件
- [ ] 不替换官方 MinIO 镜像的原版 Compose 启动与同步验证
- [x] 从零启动第二套完整服务栈，恢复 SQL/对象后以合成账户登录、下载并阅读 PDF
- [x] 受保护 GitHub 仓库的 [Scholar baseline PR 运行](https://github.com/gkwfhv/readest-scholar/actions/runs/39248218266)两项作业通过；最新提交仍须各自通过必需检查

3 个失败的原生单测仍是阻断项。未勾选项完成前，Phase 0 不算通过，不进入文献管理实现。恢复后的阅读进度读取、基础高亮与备注跨端同步已验证；AI、进度双向更新、离线冲突及 PDF 几何锚点仍未完成端到端验证。
