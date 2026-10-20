# Phase 1：测试环境秘密文件边界（2026-10-20）

范围为单台 Linux 非生产主机和合成账户，不含生产密钥或正式签名材料。

## 实际检查

- `prepare-env.py` 使用 `os.O_EXCL` 与 `0600` 创建随机数据库密码、JWT secret、S3 密码及派生令牌；`prepare-restore-env.py` 对独立恢复栈同样以 `0600` 新建文件，不覆盖旧文件。主机实测 `docker/.env` 和 `docker/.env.phase1` 均为 `0600`。
- 主机 `~/scholar-staging-backups` 与升级前快照 `20261020T124539Z` 均为 `0700`；合成账户探针 `restore-probe-auth.json` 为 `0600`。本次只检查权限，没有读取或打印秘密值。
- 自动 GHCR 发布只使用仓库自带 `GITHUB_TOKEN`，staging 主机和个人 SSH 私钥没有放入 GitHub Actions。测试主机的服务端口仅绑定回环地址，经用户授权的 SSH 隧道访问。
- 新恢复文件 `docker/.env.phase1` 在主机上原本显示为未追踪文件。现在 `.gitignore` 覆盖 `docker/.env*`，保留已追踪公开模板 `docker/.env.example`；CI `local-infrastructure` 在生成环境前检查所有被追踪的 `docker/.env*` 文件，只允许该模板，并检查常用私有文件名仍被忽略。
- 本地正向检查输出 `No private Compose environment files are tracked`。另用独立临时 Git index 把**公开模板的 blob** 假装追踪为 `docker/.env.phase1`，检查器以退出码 1 列出该路径；临时 index 已删除，未写入真实秘密或实际 Git index。

该门槛防止测试环境文件被普通 `git add` 收录，并让强制收录在 PR CI 失败。它不提供生产密钥托管、加密备份、轮换或泄漏后吊销；这些需要正式环境和凭据管理方案后再验收。
