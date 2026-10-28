# Phase 8 Scholar 发布身份与许可证复核记录（2026-10-28）

范围：check-scholar-release-identity.mjs 对正式 Scholar Tauri 配置、根 LICENSE、现有 LICENSES.md 警告和 Tauri Rust 包元数据做静态检查。它由 Scholar baseline 的离线测试执行，并在受保护发布预检中生成 RELEASE-IDENTITY.json。

## 已由机器检查的静态事实

- 正式产品名为 Readest Scholar，标识符为 io.github.gkwfhv.readestscholar，主二进制名为 readest-scholar。
- 移动端和桌面深链 scheme 都是 readest-scholar。
- Scholar 配置禁止生成更新器工件，更新端点和公钥均为空。
- 根 LICENSE 是 AGPL v3 文本；LICENSES.md 保留“待人工复核，不能用于发布”与 readest.com 上游商标复核提示。

配置偏离、重新启用更新器或移除这些许可证警告会使检查失败。该检查不扫描所有源码字符串，因为源码兼容层、迁移和第三方来源中仍会合法出现上游名称；它只核对实际选择的 Scholar 发布配置和发布元数据输入。

## 输出与当前结果

每次受保护预检都会产出 RELEASE-IDENTITY.json，其中包含正式身份、Cargo [package] 原始元数据和 metadataReview。输出固定为 "releaseReady": false。

目前 Rust 包元数据仍是上游或空白值：包名 Readest、说明 Your online library、作者 Bilingify LLC，且 license、repository 为空。候选桌面包的用户可见身份来自 scholar.release.json，但在确定这些 Cargo 字段会不会影响最终分发前，不能直接替换它们。

## 仍需人工完成

- 确认 Scholar 对名称、图标、域名及残留上游引用拥有适当的商标和品牌使用权。
- 根据每个平台最终产物审查仓库、子模块、容器和打包依赖的许可证正文与 NOTICE。
- 明确每个分发物的 AGPL 对应源码提供地址、保存期限和获取方式。
- 由具备相应权限的人确认最终的版权、作者、说明、许可证与仓库元数据；确认后再调整 Cargo 元数据并重新验证候选包。

这份记录不是法律意见，也不接受任何许可证、安全或商标风险。
