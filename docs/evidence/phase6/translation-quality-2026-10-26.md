# Phase 6 PDF 翻译质量记录（2026-10-26）

测试环境为服务器上的隔离 staging、pdf2zh-next Worker 与本地 Qwen3 模型；文献与账号均为公开论文和合成数据。原文 SHA-256 为 `bc7b8e0043ba8a5fd6301cacbd63b624dccd23098992623c795b568a8d2d46dc`，两页英文双栏 BERT 样本。

## 观察

- 标准矢量模式保留第一页的模型结构图，但原文在第二页译文上叠印。
- pdf2zh 的 `--ocr-workaround` 清理第二页叠印，使中文段落可读；整篇使用时会遮盖第一页图内标签。
- 因此队列新增显式页码选择：先生成普通矢量译文，再仅对所选纯文字页运行兼容模式，最后按 PDF 页替换。用户界面提示图内标签风险，避免默认应用到所有页。
- 小型 Qwen3-0.6B 的译文出现可见的原始 `<style ...>` 标记；单靠 PDF 合法性与页数检查无法发现此类坏输出。Worker 新增发布前文本检查；当原文没有该标记而译文出现时，以 `invalid_translation_markup` 失败，不上传译文，也不修改原文。
- 直接验证：小模型的双栏产物被质量检查拒绝；4B 模型的两页合成产物通过此项检查（SHA-256 `ccb42e8587deb96be9385b3ab4dc9bf6e1aef7ba19e4ce989257a1fcf42008dc`）。这仅是内容守门，最终仍需真实队列输出、视觉和公式/表格验收。

## 4B 队列产物

真实 Worker 任务 `55fefe09-ead1-420e-b46e-114bac99e5fb` 使用 Qwen3-4B-Q4_K_M 对两页 BERT 样本执行普通矢量翻译，并仅对第 2 页执行白底兼容。任务最终 `succeeded`、进度 100。原文 SHA-256 仍为 `bc7b8e0043ba8a5fd6301cacbd63b624dccd23098992623c795b568a8d2d46dc`；独立译文附件 SHA-256 为 `1f769fc6265a139128d43ea5831d4522642ac418335bcb1cc5a0ce6e53a5cca4`，776,365 字节、2 页，对象往返哈希相符、可见 `<style` 标记为 0。Worker 实际运行 1,061 秒（约 17 分 41 秒），服务器为 10 GiB 内存并使用 swap；这说明 CPU 本地 4B 模型适合功能验收，不宜承诺交互式翻译时延。高清页面目视检查：第一页结构图和标签完整，中文双栏正文可读；第二页无原文叠印，中文正文可读。术语、引用格式仍需读者校对，译文不是人工审校稿。

论文样本来自 [BERT arXiv:1810.04805](https://arxiv.org/abs/1810.04805)。两页高清 QA 截图留在测试服务器的 `/home/gavin/scholar-phase6-golden/e2e4b/`，未纳入公开仓库；它们的 SHA-256 分别是 `fe462c1734f72a19a50e9ee1a9b8f4c6e77de7c94818279457e9b9e3434d5407` 和 `b0d1ca3a96ba7636c7a44eacacf3c0f3fb7035067a645db`。原始 PDF 和译文也仅留在服务器 staging。该 arXiv 版本的[许可页面](https://arxiv.org/licenses/nonexclusive-distrib/1.0/license.html)只记录作者授予 arXiv 的分发权，故公开 PR 不上传论文页面截图。

## 公式/表格金样本

[Attention Is All You Need（arXiv:1706.03762）](https://arxiv.org/abs/1706.03762)的两页截取样本原文 SHA-256 为 `84a2253c63cb77062ae68a268a1163328c9acdbde6009ac62f924a8a842efdec`。4B 模型仅翻译包含表格与位置编码公式的第 2 页，产出单页双语 PDF：SHA-256 `2ac68c0f5e6ade0049aafb94d53163e40958f70e8006926ccdb56ae8ada4bcd5`、295,673 字节、736 个可抽取中文字符、0 个可见原始 `<style` 标记。高清目视检查中，表格横线、各行复杂度公式、正弦/余弦位置编码公式和中文正文均可读，没有明显叠印。该译文仍需专业术语校对。服务器私有 QA 图像为 `/home/gavin/scholar-phase6-golden/attention-output-4b-page2/page-2.png`，SHA-256 `a1c23d2e6c0a9969b98fffed5439829f359abe93c63f01a2823db4ede2aab126`，不纳入公开仓库。

## 界面图像证据

- [桌面翻译面板](images/translation-panel-desktop.png)
- [电子墨水模式面板](images/translation-panel-eink.png)

界面图的文件状态与任务历史使用合成响应，仅验证布局；真实 API 和 Worker 的结果单独验收。
