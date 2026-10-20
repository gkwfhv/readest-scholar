# Turso L2 验证记录（2026-10-20）

环境：macOS arm64，Node `24.11.1`，工程锁定的 `@tursodatabase/database@0.6.0-pre.28`。本次只改共享向量测试的 L2 数值判据和近邻行顺序检查；生产代码、依赖版本及锁文件未改。

## 复现与误差范围

在 `apps/readest-app` 执行 `node ../../docs/evidence/phase0/turso-l2-probe.mjs`。固定种子、2/8/128/768 维、三种尺度，`vector32` 与 `vector64` 各 1200 组随机非零距离；最大相对偏差分别为 `0.0650109%`、`0.0650013%`，没有样本超过 `0.1%`。两种类型的零距离样例均为零。另有 8008 个逐步增大的距离样本、8000 次相邻比较，没有倒序。原始结果见 [JSON](turso-l2-probe-macos-arm64.json)。这些是本机、锁定版本及输入范围的经验结果，不是所有输入的误差保证。

## 修改后验证

从 `apps/readest-app` 使用 Node 24、现有 `.env`/`.env.test.local` 和 Vitest：

```sh
dotenv -e .env -e .env.test.local -- vitest run --reporter=dot
```

结果：**1162 个测试文件通过、4 个跳过；13760 个测试通过、16 个跳过；退出码 0**。运行时间 133.25 秒。此工作树复用了本机已安装依赖，初始化了 `simplecc-wasm` 子模块，并临时让 `foliate-js/node_modules` 指向已安装依赖；临时链接已删除。完整标准输出保存在 [Node 24 全量日志](turso-l2-full-node24.txt)。

定向运行原生 `turso-node.test.ts`：54 通过、1 跳过、退出码 0。浏览器 WASM 同一共享套件：54 通过、1 跳过、退出码 0；浏览器运行时因依赖位于相邻工作树，临时 Vite 配置允许该本机依赖目录，配置在运行后删除。`tsc --noEmit` 退出码 0；`biome lint apps/readest-app/src/__tests__/database/suites/vector-tests.ts` 退出码 0。

本次通过表示上述测试契约已满足。未来若把 L2 用于产品检索排名或阈值，应在目标平台补充分布边界和近邻临界样本的实测。Phase 0 还需按总验收清单检查自托管对象存储、AI 运行时和资源基准。
