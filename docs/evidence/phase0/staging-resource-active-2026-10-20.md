# Phase 0 合成负载资源采样（2026-10-20）

在已授权 Linux staging 和独立标识的 macOS 测试客户端上采样。仅使用仓库 `sample-paper.pdf`、既有合成账户与该主机的回环端口；不读取生产数据。服务端同时运行其他业务，以下是观测值而非 Scholar 的独占成本或性能上限。

## 服务端

复现：在主机的 staging checkout 执行 `python3 infra/staging/sample-active-resource.py`。脚本读私有 `docker/.env` 和既有合成账户文件，不输出口令；先读 60 次 Web 书库页，登录后读 200 次书籍元数据，再向独立测试键写入 88 KiB PDF，读取 150 次并逐次比对 SHA256，最后删除测试键。`docker stats --no-stream` 在前、中、后采样六个容器，CPU 是 Docker 瞬时值，Block/Net I/O 是启动以来累计值。运行结果三段操作均为 OK；首次编写脚本时 REST 列名和 `mc` 输出解析有误，修正后重跑，失败轮次未作为性能数据。

```text
2026-10-20T07:55:06Z idle_before / web_read_start
2026-10-20T07:55:06Z 60 Web library reads: OK
2026-10-20T07:55:06Z Synthetic Auth login and 200 book metadata reads: OK
2026-10-20T07:55:06Z s3_start
2026-10-20T07:55:08Z active
2026-10-20T07:55:09Z Synthetic PDF S3 write and 150 byte-verified reads: OK
2026-10-20T07:55:13Z idle_after; window 7.1 seconds

container                  before CPU / RSS    active CPU / RSS   after CPU / RSS    before -> after Net I/O
scholar-staging-client     0.00% / 110.4MiB   0.00% / 111.2MiB  0.00% / 111.2MiB  173kB/8.55MB -> 214kB/11.1MB
scholar-staging-db         2.73% / 72.54MiB   2.99% / 71.82MiB  0.04% / 71.31MiB  531kB/659kB -> 1.06MB/1.27MB
scholar-staging-kong       0.17% / 1.164GiB   7.63% / 1.165GiB  0.13% / 1.165GiB  1.49MB/1.51MB -> 1.85MB/1.92MB
scholar-staging-minio      0.10% / 155.7MiB  15.50% / 157.5MiB  4.13% / 164.8MiB  641kB/8.4MB -> 1.11MB/22.3MB
scholar-staging-auth       0.00% / 11.53MiB   0.01% / 11.7MiB   0.01% / 11.7MiB   143kB/174kB -> 158kB/189kB
scholar-staging-rest       0.18% / 77.41MiB   0.09% / 84.4MiB   0.16% / 84.4MiB   705kB/1.65MB -> 1.58MB/2.24MB
```

块 I/O 前后：client `37.6MB/438kB` 不变；db `17.2MB/66.7MB` 不变；kong `2.93MB/127kB` 不变；对象存储 `104MB/11.1MB -> 104MB/11.2MB`；auth `2.48MB/0B` 不变；rest `4.01MB/0B` 不变。短时间网络读写增加明显，块设备写入增量很小，不能据此推导持久化延迟或容量需求。

## 独立 macOS 测试客户端

使用以前构建的未签名 `com.readest.scholar.progress-test`，它的资料目录与日常 Readest 分离。先在其空闲书库对进程每秒运行一次 `ps -o %cpu,rss,vsz,etime`，然后在界面中打开同一合成 PDF（初始第 2/2 页），点击上一页，辅助功能树确认 `TITLE OF THE PAPER` 与第 1/2 页。采样进程 RSS：空闲约 **61–65 MiB**，打开过程最高 **125,328 KiB**（约 **122.4 MiB**），随后约 **92–105 MiB**；`ps` CPU 样点在打开过程出现 **60.2%**、下一秒 **30.0%**，之后回落。此为单次未签名 debug 包的窗口，不代表发布包或机型上限。

在切换 Silo 后，又对独立的 `com.readest.scholar.silo-test` 桌面包进行 100 次、间隔 0.2 秒的主进程采样，期间在界面打开合成 PDF 并翻页。`ps` 的 RSS 最小/均值/最大分别为 **93.23 / 108.32 / 126.84 MiB**，CPU 瞬时样点为 **0 / 4.93 / 32.9%**。这只统计 Tauri 主进程，未计入 WebKit 子进程，不能作为整个应用的内存总量。

## 范围

## 桌面文件同步期间补采

在 SSH 回环隧道恢复、staging Web 返回 HTTP 200 后，独立的 `com.readest.scholar.silo-test` 测试客户端显示一项先前失败的合成 PDF 云传输任务。先启动主进程 `ps -o %cpu,rss` 采样，再在测试客户端的“传输队列”点击重试。界面随后将该合成 PDF 标为“已下载”，队列统计为进行中 0、等待中 0、已完成 2、失败 0。采样时间为 **2026-10-20 11:25:38–11:26:21 UTC**，共 **200** 个样点，约每 0.2 秒一次；主进程 RSS 最小/均值/最大为 **59.11 / 62.86 / 66.61 MiB**，CPU 样点为 **1.2 / 2.83 / 22.3%**。采样覆盖重试与完成后的短暂空闲，因此均值不代表持续传输负载；`ps` 也未计入 WebKit 子进程。

这次服务端负载是 HTTP 书库/元数据和 S3 文件路径的合成操作；桌面端分别采到了实际 PDF 打开翻页和一次完成的合成文件云下载。[自托管跨端同步验收](README.md)与[Silo 切换后的界面复验](silo-object-2026-10-20.md)另验证上传、下载与阅读进度。服务端与桌面客户端的活跃窗口并非同时采样，不能把两端的瞬时峰值相加当作一条请求的端到端成本，也不能据此推导并发容量或性能上限。
