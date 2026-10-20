# Turso 原生 L2 距离失败复现

日期：2026-10-19；平台：macOS arm64；Readest：`2d37bbfc2e94725e1343ab2a825573545aa59f5f`。

`apps/readest-app/src/__tests__/database/suites/vector-tests.ts` 在 `turso-node.test.ts` 的真实内存数据库上有 3 个断言失败。`vector32('[0,0]')` 到 `[3,4]` 的结果是 `4.99704122543335`（期望 `5`）；`[0,0]` 到 `[1,1]` 是 `1.414939284324646`（期望 `sqrt(2)`）。`vector64` 的 3-4-5 样例也返回相同的 `4.99704122543335`。测试以四位小数断言，误差远超允许范围。

Node 24 全量运行与 Node 26 定向运行均重复这 3 项失败，其余 `turso-node.test.ts` 51 项通过、1 项跳过。浏览器 WASM 适配的同一向量套件 54 项通过、1 项跳过。依赖锁定为 `@tursodatabase/database@0.6.0-pre.28`；没有更改测试或容差。原始日志在 `docs/evidence/phase0/`。

桌面构建依赖的 `turso_core-0.6.1` 源码中，原生 `vector_distance_l2` 的稠密向量路径调用 `simsimd::SpatialSimilarity::euclidean`，WASM 路径改用 Rust 平方求和与开方。这提供了“原生 SIMD 近似结果与 WASM 不同”的可检验线索；它不是对 npm `0.6.0-pre.28` 预编译二进制内部实现的直接证明。

[Turso 官方变更记录](https://github.com/tursodatabase/turso/blob/main/CHANGELOG.md) 在 0.7.0 条目中明确记载过“提高向量 L2 测试容差，以匹配 SimSIMD 与 Rust 的精度差异”。这支持两种计算路径可有数值差异，但不证明本次锁定的 npm 原生二进制采用了哪一条路径，也不自动决定 Scholar 应接受的数值误差。

隔离升级对照：从 npm 官方 registry 安装 `@tursodatabase/database@0.8.3` 及对应 `@tursodatabase/database-darwin-arm64@0.8.3` 到 `/private/tmp/scholar-turso-probe`，不改工程依赖或锁文件。在同一 macOS arm64 和 Node `24.11.1` 上直接调用原生 `connect(':memory:')`，上述三个 SQL 样例仍依次返回 `4.99704122543335`、`1.414939284324646`、`4.99704122543335`。所以仅把锁定的 `0.6.0-pre.28` 升到 `0.8.3` 不能消除本机的精度失败；这不等于测试了 0.8.3 的全部 Readest 兼容性。命令、版本与 npm 包完整性摘要见 [隔离对照证据](../evidence/phase0/turso-native-0.8.3.txt)。

[Turso 官方讨论](https://github.com/tursodatabase/turso/issues/7660) 已记录 `simsimd` 在 Rust 核心的依赖与功能开关变动。此前仅凭较新 Rust 源码不能断定锁定的 npm 原生包走哪条路径；下面是对**实际安装的二进制**的补证。

## 2026-10-20：锁定原生包的实现与误差测量

本机 `@tursodatabase/database-darwin-arm64@0.6.0-pre.28` 的 `turso.darwin-arm64.node` SHA-256 为 `76ff46f11bbb728eb115cc9c279d2675c4f5cba058f56ef5012436c458bb3b96`。`nm -a` 显示 `turso_core::vector::operations::distance_l2::vector_distance_l2`、`simsimd::SpatialSimilarity` 的 f32/f64 L2 包装和 `simsimd_l2_f32` 等符号。对同一文件用 `xcrun llvm-objdump -d --symbolize-operands` 检查调用点，f32 稠密向量分支直接调用 `simsimd::SpatialSimilarity::l2`，后者调用 `simsimd_l2_f32`。二进制还包含以位级初值和乘加计算平方根近似的 SimSIMD serial 路径。调用链已由锁定包本体确认；仅凭静态反汇编不能证明每次运行实际选中的 CPU 分支，实测值与该近似路径一致。

可复现实测脚本：[turso-l2-probe.mjs](../evidence/phase0/turso-l2-probe.mjs)。从 `apps/readest-app` 使用 Node `24.11.1` 执行：

```sh
node ../../docs/evidence/phase0/turso-l2-probe.mjs > ../../docs/evidence/phase0/turso-l2-probe-macos-arm64.json
```

[原始 JSON](../evidence/phase0/turso-l2-probe-macos-arm64.json)含固定种子、`vector32`/`vector64` 各 1200 组随机非零距离样本，维度 2/8/128/768、数值尺度 0.01/1/1000。与按输入精度量化后再用平方和开方计算的参考值相比，最大相对偏差分别为 **0.0650109%** 和 **0.0650013%**；2400 组中没有超过 **0.1%**。另对 0.1、1、5、100 附近各 1001 个逐步增大的距离做两种向量精度类型扫描，共 8008 个样本、8000 次相邻比较，未见倒序。这是本机这些输入的经验范围，**不是**所有平台、维度和数值的数学误差上界。零距离的两个示例都返回零。

应用层的 Reedy 混合检索使用 `vector_distance_cos` 加全文检索排序；旧 AI 路径在 JavaScript 中计算余弦相似度。当前 `apps/readest-app/src` 生产代码没有调用 `vector_distance_l2`。因此本次 L2 偏差首先影响全量测试基线，不能据此宣称已有 PDF 阅读、同步或 AI 引用结果出错；如果将来以 L2 距离做排名或阈值，应重新测量近邻边界与目标平台。

**处理决定**：共享测试保留 L2 数值检查，改用小于 0.1% 的相对误差判据，同时检查返回值有限，并在近邻查询中显式核对 `[1,3,2]` 的行顺序；零距离仍按原高精度断言。这个判据比本机实测最大偏差留有余量，也比只把小数位数调低更能适用于不同距离尺度。它是对所测原生后端数值契约的验收，不是修复 Turso 底层算法；没有修改生产检索实现、依赖版本或任意其他测试。浏览器 WASM 与 Node 原生的同一共享套件都需要通过，完整全量测试仍须单独运行后才能记为通过。
