# Phase 8 macOS/Windows 候选包安装目录文件清单（2026-10-27）

scholar-desktop-candidates.yml 在每个平台生成并校验无签名调试安装包后，新增 CycloneDX 1.6 文件清单 candidate/PAYLOAD-FILES.cdx.json，与候选包一起上传。清单记录安装包 SHA-256、构建目标、扫描范围，以及安装目录内每个普通文件的 SHA-256；符号链接记录链接目标。文件名和条目顺序固定，相同输入产生相同 JSON。

- macOS Intel/Arm：只扫描从本次 DMG 复制到 runner 的 Readest Scholar.app 目录。已核对 Bundle ID、二进制架构，随后执行启动冒烟。DMG 的窗口背景、快捷方式等应用目录外内容不在文件清单内。
- Windows x64：NSIS 静默安装后，从卸载注册项定位实际安装目录，扫描目录内文件，随后执行启动及卸载冒烟。注册表、开始菜单快捷方式和安装目录外文件不在清单内。
- Linux DEB：由独立的 inventory-scholar-deb.py 记录 DEB 安装文件；本次脚本不改变 Linux 范围。

该清单是具体候选包的文件哈希目录，不能自动识别内嵌依赖、判定许可证义务、证明签名或替代漏洞扫描。正式发布仍需逐平台核查组件、许可证正文和第三方 NOTICE。当前 CI 工件保留期仅 7 天，不是长期发布存档。

服务器构建容器的合成目录测试覆盖普通文件、符号链接、重复运行字节一致性；生成 JSON 通过 CycloneDX 1.6 官方 schema 校验。实际 macOS/Windows 候选包的文件数量和成功运行记录以该 PR 的平台 CI 为准。
