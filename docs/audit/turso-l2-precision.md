# Turso 原生 L2 距离失败复现

日期：2026-10-19；平台：macOS arm64；Readest：`2d37bbfc2e94725e1343ab2a825573545aa59f5f`。

`apps/readest-app/src/__tests__/database/suites/vector-tests.ts` 在 `turso-node.test.ts` 的真实内存数据库上有 3 个断言失败。`vector32('[0,0]')` 到 `[3,4]` 的结果是 `4.99704122543335`（期望 `5`）；`[0,0]` 到 `[1,1]` 是 `1.414939284324646`（期望 `sqrt(2)`）。`vector64` 的 3-4-5 样例也返回相同的 `4.99704122543335`。测试以四位小数断言，误差远超允许范围。

Node 24 全量运行与 Node 26 定向运行均重复这 3 项失败，其余 `turso-node.test.ts` 51 项通过、1 项跳过。浏览器 WASM 适配的同一向量套件 54 项通过、1 项跳过。依赖锁定为 `@tursodatabase/database@0.6.0-pre.28`；没有更改测试或容差。原始日志在 `docs/evidence/phase0/`。

桌面构建依赖的 `turso_core-0.6.1` 源码中，原生 `vector_distance_l2` 的稠密向量路径调用 `simsimd::SpatialSimilarity::euclidean`，WASM 路径改用 Rust 平方求和与开方。这提供了“原生 SIMD 近似结果与 WASM 不同”的可检验线索；它不是对 npm `0.6.0-pre.28` 预编译二进制内部实现的直接证明。

[Turso 官方变更记录](https://github.com/tursodatabase/turso/blob/main/CHANGELOG.md) 在 0.7.0 条目中明确记载过“提高向量 L2 测试容差，以匹配 SimSIMD 与 Rust 的精度差异”。这支持两种计算路径可有数值差异，但不证明本次锁定的 npm 原生二进制采用了哪一条路径，也不自动决定 Scholar 应接受的数值误差。

下一步需在与锁定 npm 原生包对应的 Turso 源码或调试符号中核实实现，并在 macOS arm64 上复现底层 SIMD 调用。修复应来自正确的原生距离实现或上游版本升级，并继续保留现有精度断言。完成前不能把全量单测记为通过，也不能用 L2 绝对值作为 Scholar 的严格阈值。
