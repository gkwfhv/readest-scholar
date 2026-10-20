# Staging 空闲资源快照（2026-10-20）

测试环境：已授权的 Linux staging 主机，16 个逻辑 CPU、`MemTotal=11496572 KiB`，同时运行其他工作负载；Scholar 的六个容器当时已运行约一小时。本记录不包含 SSH 地址、登录信息或环境变量。

通过 SSH 在主机执行三次 `docker stats --no-stream`，每次间隔约 3 秒；采样时没有主动打开 PDF 或触发同步。原始输出如下，CPU 为 Docker 显示的瞬时百分比，内存为各容器用量/宿主机可用上限，Block I/O 是容器启动以来累计值：

```text
2026-10-20T06:26:22Z
scholar-staging-client|0.00%|97.32MiB / 10.96GiB|13.6MB / 143kB
scholar-staging-db|2.89%|74.02MiB / 10.96GiB|16.8MB / 66.6MB
scholar-staging-kong|0.17%|1.161GiB / 10.96GiB|2.93MB / 115kB
scholar-staging-minio|4.10%|149.4MiB / 10.96GiB|102MB / 5.02MB
scholar-staging-auth|0.00%|10.21MiB / 10.96GiB|2.48MB / 0B
scholar-staging-rest|0.21%|70.77MiB / 10.96GiB|3.87MB / 0B
2026-10-20T06:26:27Z
scholar-staging-client|0.00%|97.32MiB / 10.96GiB|13.6MB / 143kB
scholar-staging-db|0.07%|72.35MiB / 10.96GiB|16.8MB / 66.6MB
scholar-staging-kong|6.43%|1.163GiB / 10.96GiB|2.93MB / 115kB
scholar-staging-minio|4.02%|149.1MiB / 10.96GiB|102MB / 5.02MB
scholar-staging-auth|0.00%|10.21MiB / 10.96GiB|2.48MB / 0B
scholar-staging-rest|0.14%|70.77MiB / 10.96GiB|3.87MB / 0B
2026-10-20T06:26:32Z
scholar-staging-client|0.00%|97.32MiB / 10.96GiB|13.6MB / 143kB
scholar-staging-db|0.02%|72.24MiB / 10.96GiB|16.8MB / 66.6MB
scholar-staging-kong|0.17%|1.161GiB / 10.96GiB|2.93MB / 115kB
scholar-staging-minio|4.04%|149MiB / 10.96GiB|102MB / 5.02MB
scholar-staging-auth|0.00%|10.21MiB / 10.96GiB|2.48MB / 0B
scholar-staging-rest|0.18%|70.77MiB / 10.96GiB|3.87MB / 0B
```

同一时刻只读执行 `du -sh`：Postgres 数据目录 `42M`，MinIO `/data` 为 `380K`，Postgres 配置卷为 `108K`。这些是空闲时的容量快照。尚未采集同一栈在打开测试 PDF、上传和下载同步期间的受控 CPU/内存变化，也没有采集独立测试桌面客户端的资源；不能据此推定性能阈值或完成 Phase 0 全部资源基准。
