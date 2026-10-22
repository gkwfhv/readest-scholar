# Phase 2：服务器 Linux 原生客户端构建与运行（2026-10-22）

## 构建

- 仅在测试主机 `gavinserver` 的 Docker 容器 `scholar-native-builder` 中构建；主机为 Linux x86_64，容器内为 Node 24.15.0、Rust 1.95.0、GTK 3.24.38、WebKitGTK 2.50.6。源码、Cargo 缓存、target 分别挂载到 `/workspace`、`/root/.cargo`、`/workspace/target`。
- Web 静态资源使用 Scholar 自托管标记构建，认证地址 `http://127.0.0.1:8130`，候选 Web API 地址 `http://127.0.0.1:3132`。Linux 桌面走仓库 `apps/readest-app/scripts/tauri.mjs` 的 CEF 分支及 `Cargo.cef.lock`；Tauri 配置叠加 `apps/readest-app/src-tauri/scholar.release.json`，正式测试身份为 `io.github.gkwfhv.readestscholar`。本次是未签名 debug 包。
可复现的容器内原生构建入口（已预先生成 `apps/readest-app/out`，CEF CLI 与 Cargo 依赖缓存在容器中）：

```sh
cd /workspace/apps/readest-app
export PATH=/root/.cargo/bin:$PATH
export TAURI_CEF_CLI="$(find /root/.local/share/pnpm/store/v11/links/@tauri-apps/cli-cef/3.0.0-alpha.27 -name tauri.js -print -quit)"
pnpm tauri build --debug --no-sign --no-bundle --config src-tauri/scholar.release.json
```

- 首次完整原生编译在 `apps/readest-app/src-tauri/src/lib.rs:457` 暴露 `AppHandle` 默认运行时与 Linux CEF 运行时类型不符；改为 `AppHandle<AppRuntime>` 后重新编译成功。最终构建日志 `/home/gavin/.cache/scholar-native-target/scholar-native-build.log` 记录 `Finished dev profile` 和 `Built application at: /workspace/target/debug/readest-scholar`，退出码文件为 `0`。二进制 SHA-256 为 `1791d7cf9615d07be64b8b0aa8030b7e9935048513a4994325c8824dd0f039ec`。
- 按上面的命令以 `CARGO_NET_OFFLINE=true` 再次运行，`scholar-native-repro.exit` 为 `0`，28.67 秒完成；二进制 SHA-256 与首次成功构建完全相同。日志为 `/home/gavin/.cache/scholar-native-target/scholar-native-repro.log`。复跑后 `Cargo.lock.wry` 不存在，`Cargo.lock` 已恢复。
- CEF 官方归档在容器中按 SHA-1 `b1e99d3e3ff4213f99f7cda0211db89454398811` 校验。构建过程从 TUNA crates 镜像和本机 Git 浅镜像读取依赖；没有向 GitHub 或 GHCR 推送。Cargo 锁文件已恢复，插件构建自动生成文件已清理；源码修复提交为 `97b94428d`，仅在服务器本地分支。

## 隔离运行

- 从构建容器制作本机 Docker 镜像 `scholar-native-runtime:20261022`，启动 `scholar-native-qa`，只接入 `scholar-staging_default` 桥接网络。VNC 的唯一宿主机端口绑定是 `127.0.0.1:6082`；通过 SSH 隧道映射到测试电脑的 `127.0.0.1:6083`。没有公网端口、没有 GitHub 上传。
- 容器内用 Xvfb、x11vnc、noVNC 显示客户端；回环 TCP 代理将 `127.0.0.1:8130` 转至 staging Kong，将 `127.0.0.1:3132` 转至独立候选 Web。两个代理目标的 GET 健康检查均返回 200；宿主机没有 LocalSend 53318 监听。
- 原生进程以非 root 用户启动，CEF 子进程、登录界面与正式产品名均实际显示。首次运行因镜像中遗留的 Chromium SingletonLock 退出；确认旧进程已结束后，仅在新测试容器删除过期锁并重启，第二次保持运行。
- 登录测试时 CEF 显示“Access other apps and services on this device”许可，测试已停在该弹窗，等待本次容器范围的授权。原生客户端的本地 201 份合成 PDF 导入与三栏视觉检查已经通过；新版 Linux 客户端连接 staging 的同步仍待许可后验证。

## 登录许可诊断

- CEF 弹窗请求的来源是 `http://tauri.localhost`，文案为“Access other apps and services on this device”。测试时关闭弹窗后，登录表单显示 `Failed to fetch`；同一时段 GoTrue Auth 没有收到对应登录请求，而容器内直接 GET `127.0.0.1:8130/auth/v1/health` 返回 200。因此失败位于 CEF 页面发起回环请求的许可环节，而不是 Auth 服务不可用。这里的因果关系是根据请求缺失和浏览器行为推断，待允许后用成功登录验证。
- [Chrome 的 Local Network Access 说明](https://developer.chrome.com/blog/local-network-access)指出网页请求本地网络/回环服务可能触发来源级许可提示；当前 CEF 151 的实际弹窗与这一机制一致。没有关闭安全检查或预授予许可。产品 Linux 客户端对自托管回环服务的首次登录体验仍需评估，不能把本次容器许可当作正式产品的解决方案。

## 原生批量导入与三栏视觉

- 合成目录 `/home/gavin/scholar-phase2-scale-fixtures` 含 201 份两页 PDF，约 87.7 KiB/份；仅在隔离容器中作为只读测试输入。首轮测试容器沿用 Docker 默认 64 MiB `/dev/shm`，在导入约 53 份时 CEF compositor 触发 `SIGTRAP`；内核日志指向 `libcef.so` 的 compositor trap，cgroup `memory.events` 没有 OOM 记录。该证据不足以证明唯一根因，但说明默认共享内存不足以支撑此测试。
- 保留旧容器为停止状态 `scholar-native-qa-64m`，用相同源码、二进制、网络和数据重新建立 `scholar-native-qa`，仅将 `/dev/shm` 提升到 1 GiB；容器需安装 `zenity` 才能在无桌面 portal 的 Xvfb 环境打开文件夹选择器。导入过程中 `/dev/shm` 曾达到约 497 MiB，201 份导入完成后约 553 MiB，未出现 OOM 或渲染器崩溃。此处是 QA 容器运行参数，不代表已修复代码缺陷或确定产品内存上界。
- 原生 UI 显示 `Search in 201 books...`；“Research Library”三栏视图显示左侧 `All (201)` 和 `fixtures 201`，中间可滚动论文列表，右侧选中 `Scholar Scale Paper 001` 的标题、作者、PDF 封面、2 页、文件大小、元数据。实际通过 SSH 隧道/noVNC 操作 CEF 桌面界面，截图见 [201 份合成文献的原生三栏界面](linux-native-three-pane-201.jpg)。单份 PDF 可打开并显示两页。
- 这完成本地导入、基础管理界面和宽屏三栏布局的 Linux 原生验收。登录 CEF 对回环 API 的 Local Network Access 许可仍待明确授权，尚不能声称此新 Linux 客户端已经完成 Web↔桌面同步；此前独立 macOS 测试包的 201 本集合、DOI、标签双向往返另有证据。
