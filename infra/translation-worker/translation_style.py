"""Shared anti-translationese rules for every translation pipeline."""

NATURAL_CHINESE_RULES = (
    "用中文母语习惯重写，不要按英文语序逐句搬。先读懂整段，再组织中文：多用短句和主动语态，"
    "一句话只讲一件事；超过 80 个汉字就断句，一句出现四个以上“的”就重写；先条件后结论。"
    "禁用这些英文骨架：使得、让……成为可能、值得注意的是、值得一提的是、需要指出的是、"
    "一般地、更一般地、特别地、具体地、具体来说、另一方面、通过……来……、由……组成、"
    "被……所……、对……进行……、对于……而言，以及连续堆定语。"
    "英文句首副词（In general / More generally / In particular / Specifically / Note that / "
    "Importantly / Interestingly / Intuitively）不要直译：优先删掉，或换成具体关系（但、"
    "问题在于、代价是、进一步说、前提是），必要时用“一般而言”“大多数情况下”；不要写"
    "“X 地，”。It is worth noting that 多数情况删掉；只有作者自己的观察或推导"
    "（Note that… / We note that…）才写“我们注意到”。“……的是，”一段最多一次，"
    "删掉不丢信息就删。"
    "名词化改回动词（对图像进行分割→分割图像），去掉形式主语 it，拆开英语式长定语从句，"
    "少用“它/它们/这”指代，改用重复名词或省略。术语首次出现写“中文（English）”，之后只用中文；"
    "session、token、benchmark 这类约定俗成的词可以保留。参考文献不逐条翻译。"
)
