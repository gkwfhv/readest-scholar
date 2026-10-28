> **Readest Scholar 工程状态：Phase 0–7 已在限定范围内验收，Phase 8 正在进行发布准备。** 本仓库基于 [Readest 上游](https://github.com/readest/readest) 开发，尚无 Scholar 正式安装包或 [GitHub Release](https://github.com/gkwfhv/readest-scholar/releases)。Linux amd64/arm64 自托管 Web 镜像为 [ghcr.io/gkwfhv/readest-scholar:main](https://github.com/gkwfhv/readest-scholar/pkgs/container/readest-scholar)；完整 Docker 栈及固定摘要见[自托管说明](docker/README.md)。当前验收与下一步见 [ROADMAP.md](ROADMAP.md)，完整设计见[工程方案](Readest_Scholar_Agent_Engineering_Plan.md)。

<div align="center">
  <a href="https://readest.com?utm_source=github&utm_medium=referral&utm_campaign=readme" target="_blank">
    <img src="https://github.com/readest/readest/blob/main/apps/readest-app/src-tauri/icons/icon.png?raw=true" alt="Readest Scholar 标志" width="20%" />
  </a>
  <h1>Readest Scholar</h1>

[Readest](https://readest.com?utm_source=github&utm_medium=referral&utm_campaign=readme) 是一款开源电子书阅读器，提供沉浸、专注的深度阅读体验。它是 [Foliate](https://github.com/johnfactotum/foliate) 的现代化重写版本，采用 [Next.js 16](https://github.com/vercel/next.js) 和 [Tauri v2](https://github.com/tauri-apps/tauri)，可在 macOS、Windows、Linux、Android、iOS 和 Web 上运行。

[![网站](https://img.shields.io/badge/website-readest.com-orange)](https://readest.com)
[![Web 应用](https://img.shields.io/badge/read%20online-web.readest.com-orange)](https://web.readest.com)
[![AGPL 许可证](https://img.shields.io/badge/license-AGPL--3.0-teal)](LICENSE)
[![最近提交](https://img.shields.io/github/last-commit/readest/readest?color=blue)](https://github.com/readest/readest/commits/main)

</div>

<p align="center">
  <a href="#功能">功能</a> •
  <a href="#规划中的功能">规划中的功能</a> •
  <a href="#截图">截图</a> •
  <a href="#下载">下载</a> •
  <a href="#文档">文档</a> •
  <a href="#从源码构建">从源码构建</a> •
  <a href="#故障排除">故障排除</a> •
  <a href="#支持">支持</a> •
  <a href="#许可证">许可证</a>
</p>

<div align="center">
  <a href="https://readest.com" target="_blank">
    <img src="./data/screenshots/landing_all_platforms.png" alt="Readest 横幅" width="100%" />
  </a>
</div>

## 功能

| 功能 | 说明 |
| --- | --- |
| 多格式支持 | 支持 EPUB、PDF、MOBI、KF8（AZW3）、FB2、CBZ、TXT、HTML 和 Markdown。 |
| 阅读模式 | 在滚动和分页阅读之间切换，并自定义字体、布局、主题与颜色。 |
| 搜索与批注 | 在书内或书库中全文搜索；添加高亮、书签和笔记。 |
| 词典查询 | 使用内置词典，或在“设置 → 自定义词典”中导入 Yomitan ZIP/RDICT 等本地词典包。 |
| [并排阅读](https://readest.com/#parallel-read) | 在分屏中同时阅读两本书或两份文档。 |
| 书库与 OPDS | 整理电子书库，并通过 OPDS/Calibre 访问在线书库和目录。 |
| 网页剪藏 | 使用“来自网页浏览器”剪藏页面；“来自网络小说”可复用浏览器会话导入章节和图片。 |
| 翻译与朗读 | 支持 DeepL、Yandex、TTS、有声书，以及 EPUB 3 Media Overlays 伴读朗读。 |
| 跨平台同步 | 同步图书、阅读进度、笔记和书签；支持与 [Koreader](https://github.com/koreader/koreader) 同步。 |
| 无障碍与专注辅助 | 支持键盘导航、VoiceOver、TalkBack、NVDA、Orca、阅读标尺、逐段阅读和速读。 |

## 规划中的功能

<div align="right">🛠 开发中  |  🔄 已规划</div>

| 功能 | 说明 | 状态 |
| --- | --- | --- |
| AI 驱动的摘要 | 使用 AI 生成图书或章节摘要。 | 🛠 |
| 高级阅读统计 | 跟踪阅读时长、已读页数等数据。 | 🛠 |
| 手写批注 | 为兼容设备的手写笔批注提供支持。 | 🔄 |

欢迎关注持续改进与更新；贡献和建议都很受欢迎。

## 截图

![批注](./data/screenshots/annotations.png)
![文字转语音](./data/screenshots/tts_speak_aloud.png)
![DeepL 翻译](./data/screenshots/deepl.png)
![脚注](./data/screenshots/footnote_popover.png)
![深色主题](./data/screenshots/theming_dark_mode.png)

## 下载

本节链接下载的是上游 **Readest**，并非 **Readest Scholar**。Scholar 安装包尚未发布到本仓库的 [Releases](https://github.com/gkwfhv/readest-scholar/releases)。

### 移动应用

<div align="center">
  <a href="https://apps.apple.com/app/id6738622779">
    <img alt="在 App Store 下载" src="https://developer.apple.com/assets/elements/badges/download-on-the-app-store.svg" style="height: 50px;" /></a>
  <a href="https://play.google.com/store/apps/details?id=com.bilingify.readest">
    <img alt="在 Google Play 获取" src="https://upload.wikimedia.org/wikipedia/commons/7/78/Google_Play_Store_badge_EN.svg" style="height: 50px;" /></a>
</div>

- macOS / iOS / iPadOS：在 [App Store](https://apps.apple.com/app/apple-store/id6738622779?pt=127463130&ct=github&mt=8) 搜索并安装 **Readest**；也可通过 TestFlight 参加 beta 测试。
- Windows / Linux / Android：访问 [readest.com](https://readest.com) 或 [GitHub Releases](https://github.com/readest/readest/releases) 下载 **Readest**。
- Linux 用户也可从 [Flathub](https://flathub.org/en/apps/com.bilingify.readest) 安装。
- Web：访问 [web.readest.com](https://web.readest.com)。

### Nix

> Nix 软件包仅支持 x86_64-linux，不支持 nix-darwin。

无需安装即可试用。accept-flake-config 会启用项目二进制缓存；不使用它时，Nix 会从源码构建完整 Rust/Tauri 栈。

~~~
nix run --accept-flake-config github:readest/readest
~~~

更多 Nix 配置请参阅上游项目文档。

## 文档

安装和使用 Readest 的指南、教程与常见问题见 [官方文档](https://readest.com/docs)。

贡献者参考资料位于仓库中：[架构](./apps/readest-app/docs/architecture.md)、[代码布局](./apps/readest-app/docs/code-layout.md)和[测试](./apps/readest-app/docs/testing.md)。

## 从源码构建

要从最新提交构建 Readest，请参阅[入门指南](./CONTRIBUTING.md#getting-started)。

## 故障排除

### Windows 无法启动（缺少 Edge WebView2 Runtime）

**症状：** 双击 readest.exe 后没有任何反应，任务管理器中也没有进程；标准安装包和便携版都可能受影响。

**原因：** 系统缺少、使用了过期版本或未正确安装 Microsoft Edge WebView2 Runtime。Readest 依赖它在 Windows 上渲染界面。

**解决方法：**

1. 在 Windows 的“添加或删除程序”中查找 “Microsoft Edge WebView2 Runtime”。
2. 从 Microsoft 下载 [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2?form=MA13LH)；如需离线安装包，请以管理员身份运行。
3. 安装或更新后再次启动 readest.exe；如仍无效，请重启电脑后重试。

更多信息见 [readest/readest#358](https://github.com/readest/readest/issues/358)，也可在 [Discord](https://discord.gg/gntyVNk3BJ) 提供环境、日志和复现步骤寻求支持。

### Linux 在 Wayland / Niri 上无法启动

当前 Linux 构建（包括 Flatpak）使用带 X11 窗口后端的 CEF，因此 Wayland 会话需要 XWayland。没有 DISPLAY 时，较旧构建会在打开窗口前以 Runtime(CreateWindow) 退出。

在 Niri 上，请安装 xwayland-satellite 0.7 或更高版本并重启会话。Niri 25.08 及更高版本可按需启动它并为应用设置 DISPLAY。参阅 [Niri 的 XWayland 设置说明](https://niri-wm.github.io/niri/Xwayland.html)。

~~~
printenv DISPLAY
flatpak run com.bilingify.readest
~~~

Flatpak 已请求 X11 socket。若修改过沙箱权限，也需要允许该 socket；不要随意设置 DISPLAY，使用会话提供的值。此运行时不能通过 ozone-platform=wayland 启用原生 Wayland 支持，WebKitGTK 环境变量也不会影响 CEF。

## 贡献者

Readest 是开源项目，欢迎参与贡献。你可以提交 issue、提出功能建议或发起 pull request；开始前请先阅读[贡献指南](CONTRIBUTING.md)和[行为准则](CODE_OF_CONDUCT.md)。

<a href="https://github.com/readest/readest/graphs/contributors">
  <p align="left">
    <img width="500" src="https://contrib.rocks/image?repo=readest/readest" alt="项目贡献者头像表格" />
  </p>
</a>

## 支持

如果 Readest 对你有所帮助，欢迎在 [donate.readest.com](https://donate.readest.com) 支持其开发。该页面提供 GitHub Sponsors、PayPal、银行卡和加密货币等方式。

### 赞助商

<p align="center">
  <a title="由 TestMu AI 提供浏览器测试" href="https://www.testmuai.com/?utm_medium=sponsor&utm_source=readest" target="_blank">
    <img src="https://raw.githubusercontent.com/readest/readest/refs/heads/main/data/sponsors/testmu-ai-logo.png" style="vertical-align: middle;" width="250" />
  </a>
</p>

## 许可证

Readest 是自由软件：你可以依据 Free Software Foundation 发布的 [GNU Affero General Public License](https://www.gnu.org/licenses/agpl-3.0.html) 第 3 版或任何后续版本重新分发和/或修改它。详见 [LICENSE](LICENSE)。

本软件使用了以下库和框架：

- [foliate-js](https://github.com/johnfactotum/foliate-js)，采用 MIT 许可证。
- [zip.js](https://github.com/gildas-lormeau/zip.js)，采用 BSD-3-Clause 许可证。
- [fflate](https://github.com/101arrowz/fflate)、[marked](https://github.com/markedjs/marked)、[next.js](https://github.com/vercel/next.js)、[react](https://github.com/facebook/react) 和 [tauri](https://github.com/tauri-apps/tauri)，采用 MIT 许可证。
- [PDF.js](https://github.com/mozilla/pdf.js)，采用 Apache License 2.0。
- [daisyUI](https://github.com/saadeghi/daisyui)，采用 MIT 许可证。
- [react-icons](https://github.com/react-icons/react-icons)，采用多种开源许可证。

本软件使用 Bitter、Fira Code、Inter、Literata、Merriweather、Noto Sans、Roboto、LXGW WenKai、MiSans、Source Han 和 WenQuanYi Micro Hei 等字体；感谢 [Web Chinese Fonts Plan](https://chinese-font.netlify.app) 提供让网页能够使用中文字体的开源工具。

---

<div align="center" style="color: gray;">愿你在 Readest 中享受阅读！</div>
