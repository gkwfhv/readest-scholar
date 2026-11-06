"""Text-extraction book translation: PDF -> Chinese EPUB.

The pdf2zh pipeline reflows text inside the original PDF boxes, which suits
papers but breaks book layouts (printed TOC, margin notes, running headers).
This module extracts readable text in chapter order, translates it in batches
through the same OpenAI-compatible model, and assembles a standalone EPUB.
It only uses the standard library plus PyMuPDF.
"""
from __future__ import annotations

import base64
import hashlib
import html
import json
import re
import time
import urllib.error
import urllib.request
import uuid
import zipfile
import posixpath
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path

BOOK_SYSTEM_PROMPT = (
    "Translate English book text into natural, publication-quality Simplified Chinese. "
    "Rewrite each complete paragraph in idiomatic Chinese instead of following English "
    "word order. Preserve meaning, certainty, numbers, units, citations, symbols and "
    "proper nouns; keep terminology consistent, using Chinese (English) at the first "
    "meaningful occurrence. Do not add, omit, summarize or explain. Avoid translationese "
    "such as 使得, 值得注意的是, 具体来说, 通过……来……, 由……组成, 让……成为可能, 被……所……."
)
JSON_CONTRACT = (
    "Return only a JSON object of the form "
    '{"items":[{"id":<number>,"output":"<translated text>"}]} '
    "covering every id. Keep placeholder tokens like ⟦M1⟧ exactly as written. "
    "Do not return prose, Markdown or code fences."
)
CAPTION_RE = re.compile(r"^\s*(figure|fig\.|table|图|表)\s*[\d.:]", re.IGNORECASE)
KEEP_SOURCE_RE = re.compile(
    r"^(references|bibliography|works cited|index|notes|附录|参考文献|索引|注释)\b",
    re.IGNORECASE,
)
# The printed table of contents is layout-heavy and redundant once the EPUB
# has its own navigation; leave it in the source language.
CONTENTS_RE = re.compile(r"^(table of contents|contents|目录|目錄)$", re.IGNORECASE)
THINKING_DISABLE_BODIES = (
    {"chat_template_kwargs": {"enable_thinking": False}},
    {"enable_thinking": False},
    {"thinking": {"type": "disabled"}},
)
_THINKING_PAYLOAD: dict | None = None
_THINKING_PROBED = False


class BookFailure(Exception):
    """Failure carrying the queue's error code."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


@dataclass
class Block:
    kind: str  # p | h1 | h2 | figcaption | image | formula | code | footnote | table
    text: str = ""
    image_name: str = ""
    size: float = 0.0
    mathml: str = ""
    rows: list[list[str]] | None = None
    header: bool = False
    inline_map: list[str] | None = None


@dataclass
class Chapter:
    title: str
    start_page: int
    end_page: int
    translated_title: str = ""
    keep_source: bool = False
    blocks: list[Block] = field(default_factory=list)


@dataclass
class BookExtract:
    title: str
    author: str
    chapters: list[Chapter]
    images: dict[str, bytes]


def classify_pdf(pdf_bytes: bytes) -> str:
    """Heuristic: bookmarks plus dense prose mean a book, not a paper."""
    try:
        import fitz

        with fitz.open(stream=pdf_bytes, filetype="pdf") as document:
            pages = len(document)
            if pages < 1:
                return "paper"
            toc = document.get_toc(simple=True) or []
            sample = min(pages, 40)
            chars = sum(len(document[index].get_text("text")) for index in range(sample))
            per_page = chars / sample if sample else 0
    except Exception:
        return "paper"
    # Short documents are papers even when the publisher added many section
    # bookmarks; a full book runs well past this.
    if pages < 100:
        return "paper"
    if len(toc) >= 20:
        return "book"
    if len(toc) >= 6 and per_page > 1200:
        return "book"
    return "paper"


def _body_size(sizes: list[tuple[float, int]]) -> float:
    """Most common font size, weighted by characters so author lines at a
    larger point size cannot become the body size."""
    if not sizes:
        return 10.0
    counts: dict[float, int] = {}
    for size, chars in sizes:
        key = round(size * 2) / 2
        counts[key] = counts.get(key, 0) + max(1, chars)
    return max(counts, key=counts.get)


def _heading_kind(size: float, body: float, text: str) -> str:
    stripped = text.strip()
    if not stripped or len(stripped) > 140:
        return "p"
    if size >= body + 5:
        return "h1"
    if size >= body + 2:
        return "h2"
    return "p"


def _is_furniture(text: str, y0: float, y1: float, height: float) -> bool:
    stripped = text.strip()
    if not stripped:
        return True
    if re.fullmatch(r"[0-9ivxlcdm]{1,6}", stripped, re.IGNORECASE):
        return True
    if len(stripped) <= 90 and (y0 < 45 or y1 > height - 32):
        return True
    return False


def _image_extension(data: bytes) -> str:
    if data.startswith(b"\x89PNG"):
        return "png"
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:4] == b"RIFF":
        return "webp"
    return "bin"


def _column_gutter(page, width: float) -> float | None:
    """X where the right column starts, when the page clearly has two columns."""
    boxes = [
        block["bbox"]
        for block in page.get_text("dict").get("blocks", [])
        if block.get("type") == 0 and (block.get("bbox") or (0, 0, 0, 0))[2] > 0
    ]
    # Ignore full-width headings and figures when measuring the gutter.
    left = [box for box in boxes if box[2] < width * 0.50]
    right = [box for box in boxes if box[0] > width * 0.45]
    if not left or not right:
        return None
    gutter = min(box[0] for box in right) - max(box[2] for box in left)
    return min(box[0] for box in right) if gutter > width * 0.03 else None


def _is_cjk(char: str) -> bool:
    return bool(char) and '\u3000' <= char <= '\u9fff'


def _join_lines(lines: list[str]) -> str:
    """Join wrapped PDF lines, repairing hyphenation and CJK line breaks."""
    out = ""
    for line in lines:
        piece = line.strip()
        if not piece:
            continue
        if not out:
            out = piece
        elif out.endswith("-") and piece[:1].islower():
            out = out[:-1] + piece
        elif out.endswith("-") and piece[:1].isupper():
            out += piece
        elif _is_cjk(out[-1]) and _is_cjk(piece[0]):
            out += piece
        else:
            out += " " + piece
    return out


def _ends_sentence(text: str) -> bool:
    return bool(re.search(r"[.!?。！？:：;；]$", text.rstrip()))


SECTION_HEADING_RE = re.compile(
    r"^\s*(abstract|introduction|related work|background|method|methods|approach|"
    r"experiments?|evaluation|results?|discussion|conclusion|references|"
    r"acknowledg(e)?ments?)\s*$",
    re.IGNORECASE,
)


NUMBERED_HEADING_RE = re.compile(r"^\s*\d+(?:\.\d+)*\.?\s+[A-Z][A-Za-z0-9 ,&/\-]{2,70}$")


def _is_numbered_heading(line: str) -> bool:
    return bool(NUMBERED_HEADING_RE.match(line.strip()))


def _is_section_heading(text: str) -> bool:
    return bool(SECTION_HEADING_RE.match(text)) and len(text.strip()) <= 60


MATH_CHARS = set("∈∑∏∫√±×÷≤≥≠≈∞∂∇αβγδεζηθικλμνξοπρστυφχψωΓΔΘΛΞΠΣΦΨΩ^_{}\\|")


def _looks_like_formula(text: str) -> bool:
    """Display equations are common in books but carry no LaTeX in the PDF.

    Cropping them as images keeps every symbol exactly as printed instead of
    letting the translation model rewrite them as prose.
    """
    stripped = text.strip()
    if not 4 <= len(stripped) <= 250 or "=" not in stripped:
        return False
    if _ends_sentence(stripped):
        return False
    visible = [char for char in stripped if not char.isspace()]
    if not visible:
        return False
    symbol_ratio = sum(1 for char in visible if not char.isalnum()) / len(visible)
    return symbol_ratio >= 0.14


def _is_footnote(text: str) -> bool:
    return bool(re.match(r"^\s*[*†‡]", text))


def _looks_like_code(lines: list[str], text: str) -> bool:
    numbered = sum(1 for line in lines if re.match(r"^\s*\d+:", line))
    if numbered >= 2 and len(lines) >= 2:
        return True
    return bool(re.match(r"^\s*(algorithm|算法)\s*\d+", text.strip(), re.IGNORECASE))


def _merge_text(previous: str, following: str) -> str:
    left = previous.rstrip()
    right = following.lstrip()
    if not right:
        return previous
    if left.endswith("-") and right[:1].islower():
        return left[:-1] + right
    if left.endswith("-") and right[:1].isupper():
        return left + right
    if _is_cjk(left[-1]) and _is_cjk(right[0]):
        return left + right
    return f"{left} {right}"


def _shrink_image(data: bytes) -> tuple[bytes, str]:
    """Downscale oversized figures so an EPUB page is not dominated by one image."""
    import fitz

    try:
        pixmap = fitz.Pixmap(data)
        if max(pixmap.width, pixmap.height) <= 1400:
            return data, _image_extension(data)
        if pixmap.colorspace is None or pixmap.colorspace.n not in (1, 3):
            pixmap = fitz.Pixmap(fitz.csRGB, pixmap)
        while max(pixmap.width, pixmap.height) > 1400:
            pixmap.shrink(1)
        return pixmap.tobytes("png"), "png"
    except Exception:
        return data, _image_extension(data)


def _code_line(text: str) -> bool:
    return bool(re.match(
        r"^\s*(\d+\s*:|Require\s*:|Ensure\s*:|Input\s*:|Output\s*:|return\b|end\b)",
        text,
    ))


def _register_image(images: dict[str, bytes], image_dir: Path, data: bytes) -> str:
    extension = "png" if not data.startswith(b"\xff\xd8\xff") else "jpg"
    name = f"img-{hashlib.sha1(data).hexdigest()[:16]}.{extension}"
    if name not in images:
        images[name] = data
        (image_dir / name).write_bytes(data)
    return name


def _crop_region(document, page_number: int, bbox, dpi: int = 200) -> bytes | None:
    try:
        page = document[page_number - 1]
        pixmap = page.get_pixmap(
            clip=(bbox[0] - 2, bbox[1] - 2, bbox[2] + 2, bbox[3] + 2), dpi=dpi,
        )
        return pixmap.tobytes("png")
    except Exception:
        return None


def _table_rows(table):
    try:
        data = table.extract()
    except Exception:
        return None
    rows = [
        [(cell or "").strip().replace("\n", " ") for cell in row]
        for row in (data or [])
    ]
    rows = [row for row in rows if any(row)]
    if len(rows) < 2:
        return None
    width = max(len(row) for row in rows)
    if width < 2:
        return None
    rows = [row + [""] * (width - len(row)) for row in rows]
    header_names = getattr(getattr(table, "header", None), "names", None)
    return rows, bool(header_names)


def _inside_table(bbox, table_boxes) -> bool:
    if not table_boxes:
        return False
    area = max(1.0, (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]))
    for box in table_boxes:
        overlap_w = max(0.0, min(bbox[2], box[2]) - max(bbox[0], box[0]))
        overlap_h = max(0.0, min(bbox[3], box[3]) - max(bbox[1], box[1]))
        if overlap_w * overlap_h / area > 0.5:
            return True
    return False


INLINE_MATH_RE = re.compile(
    r"("
    r"[A-Za-z]\s*[_^]\s*\{?[A-Za-z0-9]+\}?"
    r"|[\u0370-\u03ff\u2200-\u22ff\u2070-\u209fℓℏ][A-Za-z0-9_^{}]*"
    r"|\d+\s*[\u00d7\u00b7]\s*10\s*\^?\s*[-+]?\d+"
    r")"
)


def _protect_inline_math(text: str) -> tuple[str, list[str]]:
    """Replace inline math with tokens the model must keep verbatim."""
    mapping: list[str] = []

    def replace(match):
        mapping.append(match.group(0))
        return f"⟦M{len(mapping)}⟧"

    return INLINE_MATH_RE.sub(replace, text), mapping


def _restore_inline_math(text: str, mapping: list[str] | None) -> str:
    if not mapping:
        return text

    def replace(match):
        index = int(match.group(1)) - 1
        return mapping[index] if 0 <= index < len(mapping) else match.group(0)

    return re.sub(r"⟦M(\d+)⟧", replace, text)


def _latex_to_mathml(latex: str) -> str:
    if not latex:
        return ""
    try:
        from latex2mathml.converter import convert

        return convert(latex)
    except Exception:
        return ""


def _vision_latex(
    image: bytes, base_url: str, api_key: str, model: str, extra: dict,
) -> str:
    encoded = base64.b64encode(image).decode("ascii")
    payload = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You transcribe mathematical equations from images. "
                    "Return ONLY the LaTeX source, without $ delimiters or fences."
                ),
            },
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Transcribe this equation to LaTeX."},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{encoded}"},
                    },
                ],
            },
        ],
        "max_tokens": 2048,
        "temperature": 0,
        **extra,
    }
    try:
        reply = _chat(base_url, api_key, payload, timeout=90).strip()
    except Exception:
        return ""
    reply = re.sub(r"^```[A-Za-z0-9_-]*\s*|\s*```$", "", reply).strip()
    return reply.strip("$").strip()


def _sorted_text_blocks(
    page, width: float,
) -> list[tuple[float, float, float, float, str, float, list[str]]]:
    """Return (y0, x0, x1, y1, text, size, lines) in reading order."""
    entries = []
    for block in page.get_text("dict").get("blocks", []):
        if block.get("type") != 0:
            continue
        line_texts = [
            "".join(span.get("text", "") for span in line.get("spans", []))
            for line in (block.get("lines") or [])
        ]
        line_texts = [line for line in line_texts if line.strip()]
        if not line_texts:
            continue
        bbox = block.get("bbox") or (0, 0, 0, 0)
        size = max(
            (
                float(span.get("size") or 0)
                for line in block.get("lines", [])
                for span in line.get("spans", [])
            ),
            default=0.0,
        )
        entries.append((
            bbox[1], bbox[0], bbox[2], bbox[3],
            _join_lines(line_texts), size, line_texts,
        ))
    gutter = _column_gutter(page, width)
    if gutter is None:
        entries.sort(key=lambda entry: (round(entry[0] / 6), entry[1]))
    else:
        def key(entry):
            y0, x0, x1, _y1, _text, _size, _lines = entry
            if x1 <= gutter * 0.98:
                column = 1
            elif x0 >= gutter:
                column = 2
            else:
                column = 0
            return (column, round(y0 / 6), x0)

        entries.sort(key=key)
    return entries


def extract_book(pdf_bytes: bytes, work: Path) -> BookExtract:
    import fitz

    work.mkdir(parents=True, exist_ok=True)
    image_dir = work / "images"
    image_dir.mkdir(exist_ok=True)
    images: dict[str, bytes] = {}

    with fitz.open(stream=pdf_bytes, filetype="pdf") as document:
        total = len(document)
        metadata = document.metadata or {}
        title = (metadata.get("title") or "").strip()
        author = metadata.get("author") or ""
        toc = [
            (int(level), str(name), int(page))
            for level, name, page in (document.get_toc(simple=True) or [])
            if page and 1 <= int(page) <= total
        ]
        chapter_level = 2 if sum(1 for level, _, _ in toc if level <= 2) >= 3 else 1
        starts = []
        for level, name, page in toc:
            if level > chapter_level:
                continue
            if starts and page <= starts[-1][1]:
                continue
            starts.append((name, page))
        if len(starts) < 2:
            starts = []

        chapters: list[Chapter] = []
        if starts:
            if starts[0][1] > 1:
                chapters.append(Chapter("Front Matter", 1, starts[0][1] - 1))
            for index, (name, start) in enumerate(starts):
                end = starts[index + 1][1] - 1 if index + 1 < len(starts) else total
                chapters.append(Chapter(name, start, max(start, end)))
        else:
            chapters.append(Chapter(title or "Document", 1, total))

        for chapter in chapters:
            stripped_title = chapter.title.strip()
            chapter.keep_source = bool(
                KEEP_SOURCE_RE.match(stripped_title) or CONTENTS_RE.match(stripped_title)
            )
            sizes: list[float] = []
            items: list[tuple[str, object]] = []
            for page_number in range(chapter.start_page, chapter.end_page + 1):
                page = document[page_number - 1]
                width, height = page.rect.width, page.rect.height
                try:
                    tables = list(page.find_tables().tables)
                except Exception:
                    tables = []
                table_boxes = [table.bbox for table in tables]
                text_blocks = [
                    item
                    for item in _sorted_text_blocks(page, width)
                    if not _is_furniture(item[4], item[0], item[3], height)
                    and not _inside_table((item[1], item[0], item[2], item[3]), table_boxes)
                ]
                extras: list[tuple[float, str, object]] = []
                for image in page.get_image_info(xrefs=True):
                    bbox = image.get("bbox") or (0, 0, 0, 0)
                    if bbox[2] - bbox[0] < 120 or bbox[3] - bbox[1] < 80:
                        continue
                    if (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]) < width * height * 0.02:
                        continue
                    try:
                        data = document.extract_image(image["xref"]).get("image")
                    except Exception:
                        continue
                    if data:
                        extras.append((bbox[1], "image", data))
                for table in tables:
                    parsed = _table_rows(table)
                    if parsed is not None:
                        extras.append((table.bbox[1], "table", parsed))
                        continue
                    cropped = _crop_region(document, page_number, table.bbox)
                    if cropped:
                        extras.append((table.bbox[1], "image", cropped))
                extras.sort(key=lambda item: item[0])
                # Insert figures/tables where they start in the (already ordered)
                # text flow. Re-sorting by y would undo the column ordering.
                ordered: list[tuple[str, object]] = []
                extra_index = 0
                for block in text_blocks:
                    while extra_index < len(extras) and extras[extra_index][0] <= block[0]:
                        _, extra_kind, extra_payload = extras[extra_index]
                        ordered.append((extra_kind, extra_payload))
                        extra_index += 1
                    ordered.append(("text", block))
                for _, extra_kind, extra_payload in extras[extra_index:]:
                    ordered.append((extra_kind, extra_payload))

                for kind, payload in ordered:
                    if kind == "image":
                        data, extension = _shrink_image(payload)
                        name = _register_image(images, image_dir, data)
                        items.append(("image", name))
                        continue
                    if kind == "table":
                        items.append(("table", payload))
                        continue
                    y0, x0, x1, y1, text, size, lines = payload
                    sizes.append((size, len(text)))
                    items.append((
                        "text",
                        {"y0": y0, "y1": y1, "page": page_number,
                         "size": size, "text": text, "lines": lines},
                    ))

            body = _body_size(sizes)
            blocks: list[Block] = []
            pending: int | None = None
            code_buffer: list[str] | None = None
            last_bottom = 0.0
            last_page = 0
            for kind, payload in items:
                if kind == "table":
                    if code_buffer is not None:
                        blocks.append(Block("code", text="\n".join(code_buffer)))
                        code_buffer = None
                    rows, header = payload
                    blocks.append(Block("table", rows=rows, header=header))
                    pending = None
                    continue
                if kind == "image":
                    if code_buffer is not None:
                        blocks.append(Block("code", text="\n".join(code_buffer)))
                        code_buffer = None
                    blocks.append(Block("image", image_name=str(payload)))
                    pending = None
                    continue
                data = payload
                text = data["text"]
                size = data["size"]
                lines = data["lines"]
                stripped = text.strip()
                if code_buffer is None and not _is_footnote(text) and _looks_like_formula(text):
                    try:
                        crop = document[data["page"] - 1].get_pixmap(
                            clip=fitz.Rect(x0 - 2, y0 - 2, x1 + 2, y1 + 2), dpi=200,
                        )
                        payload_bytes = crop.tobytes("png")
                        name = f"img-{hashlib.sha1(payload_bytes).hexdigest()[:16]}.png"
                        if name not in images:
                            images[name] = payload_bytes
                            (image_dir / name).write_bytes(payload_bytes)
                        blocks.append(Block("formula", image_name=name))
                        pending = None
                        continue
                    except Exception:
                        pass
                if code_buffer is not None:
                    if _code_line(stripped) or _looks_like_code(lines, text):
                        code_buffer.extend(line.rstrip() for line in lines)
                        continue
                    blocks.append(Block("code", text="\n".join(code_buffer)))
                    code_buffer = None
                    pending = None
                if re.match(r"^\s*(algorithm|算法)\s*\d+", stripped, re.IGNORECASE):
                    code_buffer = [line.rstrip() for line in lines]
                    pending = None
                    continue
                if _looks_like_code(lines, text):
                    blocks.append(Block("code", text="\n".join(line.rstrip() for line in lines)))
                    pending = None
                    continue
                if _is_footnote(text):
                    blocks.append(Block("footnote", text=text, size=size))
                    continue
                if len(lines) <= 1 and _is_numbered_heading(text):
                    blocks.append(Block("h2", text=text.strip(), size=size))
                    pending = None
                    continue
                if len(lines) > 1 and _is_numbered_heading(lines[0]):
                    blocks.append(Block("h2", text=lines[0].strip(), size=size))
                    pending = None
                    text = _join_lines(lines[1:])
                    lines = lines[1:]
                    stripped = text.strip()
                if _is_section_heading(text):
                    blocks.append(Block("h2", text=text, size=size))
                    pending = None
                    continue
                heading = _heading_kind(size, body, text)
                if heading != "p":
                    blocks.append(Block(heading, text=text, size=size))
                    pending = None
                    continue
                joined = False
                if pending is not None:
                    previous = blocks[pending]
                    same_page = data["page"] == last_page
                    gap = data["y0"] - last_bottom
                    hyphenated = previous.text.rstrip().endswith("-") and (
                        text[:1].islower() or text[:1].isupper()
                    )
                    continuous = (
                        same_page
                        and gap < max(8.0, size * 1.6)
                        and not _ends_sentence(previous.text)
                    )
                    if hyphenated or continuous:
                        previous.text = _merge_text(previous.text, text)
                        previous.size = max(previous.size, size)
                        last_bottom = data["y1"]
                        last_page = data["page"]
                        joined = True
                if not joined:
                    blocks.append(Block("p", text=text, size=size))
                    pending = len(blocks) - 1
                    last_bottom = data["y1"]
                    last_page = data["page"]
            if code_buffer is not None:
                blocks.append(Block("code", text="\n".join(code_buffer)))
            for index, block in enumerate(blocks):
                if block.kind != "p" or not CAPTION_RE.match(block.text):
                    continue
                if index and blocks[index - 1].kind == "image":
                    block.kind = "figcaption"
            chapter.blocks = blocks

        # A paragraph cut by a chapter bookmark (an abstract continuing past
        # "Introduction") still belongs to the previous chapter.
        for index in range(1, len(chapters)):
            previous, current = chapters[index - 1], chapters[index]
            last_index = next(
                (i for i in range(len(previous.blocks) - 1, -1, -1)
                 if previous.blocks[i].kind == "p"),
                None,
            )
            first_index = next(
                (i for i, block in enumerate(current.blocks) if block.kind == "p"),
                None,
            )
            if last_index is None or first_index is None or first_index != 0:
                continue
            last_block = previous.blocks[last_index]
            first_block = current.blocks[first_index]
            if _ends_sentence(last_block.text):
                continue
            if last_block.text.rstrip().endswith("-") or first_block.text[:1].islower():
                last_block.text = _merge_text(last_block.text, first_block.text)
                del current.blocks[first_index]

        if not title:
            for chapter in chapters:
                found = next(
                    (block.text.strip() for block in chapter.blocks
                     if block.kind in ("h1", "h2") and block.text.strip()),
                    "",
                )
                if found:
                    title = found[:120]
                    break
        title = title or "Untitled"

    return BookExtract(title=title, author=author, chapters=chapters, images=images)


def _chat(base_url: str, api_key: str, payload: dict, timeout: float = 120) -> str:
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        body = json.loads(response.read(8 * 1024 * 1024))
    choices = body.get("choices") or []
    if not choices:
        raise ValueError("model returned no choices")
    return (choices[0].get("message") or {}).get("content") or ""


def _thinking_payload(base_url: str, api_key: str, model: str) -> dict:
    global _THINKING_PAYLOAD, _THINKING_PROBED
    if _THINKING_PROBED:
        return _THINKING_PAYLOAD or {}
    _THINKING_PROBED = True
    base = {
        "model": model,
        "messages": [{"role": "user", "content": "Reply with the single word ok."}],
        "max_tokens": 64,
    }
    for body in THINKING_DISABLE_BODIES:
        try:
            _chat(base_url, api_key, {**base, **body})
        except Exception:
            continue
        _THINKING_PAYLOAD = body
        return body
    _THINKING_PAYLOAD = None
    return {}


def _extract_json(text: str):
    candidate = text.strip()
    fenced = re.match(r"^```[A-Za-z0-9_-]*\s*(.*?)\s*```$", candidate, re.S)
    if fenced:
        candidate = fenced.group(1).strip()
    for pattern in (r"\{.*\}", r"\[.*\]"):
        match = re.search(pattern, candidate, re.S)
        if not match:
            continue
        try:
            return json.loads(match.group(0))
        except (TypeError, ValueError):
            continue
    return None


def _parse_items(reply: str) -> dict[int, str]:
    payload = _extract_json(reply)
    if isinstance(payload, dict):
        payload = payload.get("items") or payload.get("translations")
    if not isinstance(payload, list):
        return {}
    result: dict[int, str] = {}
    for item in payload:
        if not isinstance(item, dict):
            continue
        try:
            item_id = int(item.get("id"))
        except (TypeError, ValueError):
            continue
        text = item.get("output") or item.get("translation") or item.get("text")
        if isinstance(text, str) and text.strip():
            result[item_id] = text.strip()
    return result


def _translate_batch(
    items: list[dict],
    base_url: str,
    api_key: str,
    model: str,
    extra: dict,
    depth: int = 0,
) -> dict[int, str]:
    prompt = f"{JSON_CONTRACT}\n\nItems:\n" + json.dumps(items, ensure_ascii=False)
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": BOOK_SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        "max_tokens": 20480,
        "temperature": 0,
        **extra,
    }
    for attempt in range(5):
        try:
            parsed = _parse_items(_chat(base_url, api_key, payload))
            if parsed:
                return parsed
            break
        except urllib.error.HTTPError as error:
            if error.code not in (429, 500, 502, 503, 504) or attempt == 4:
                break
        except Exception:
            if attempt == 4:
                break
        time.sleep(min(8, 2**attempt))
    if depth < 2 and len(items) > 1:
        middle = len(items) // 2
        result = _translate_batch(items[:middle], base_url, api_key, model, extra, depth + 1)
        result.update(
            _translate_batch(items[middle:], base_url, api_key, model, extra, depth + 1)
        )
        return result
    return {}


def translate_book(
    extract: BookExtract,
    *,
    base_url: str,
    api_key: str,
    model: str,
    renew,
    canceled=None,
    deadline: float | None = None,
) -> None:
    extra = _thinking_payload(base_url, api_key, model)
    titles = [chapter for chapter in extract.chapters if not chapter.keep_source]
    text_blocks: list[Block] = []
    formulas: list[Block] = []
    tables: list[Block] = []
    for chapter in extract.chapters:
        if chapter.keep_source:
            continue
        for block in chapter.blocks:
            if block.kind in ("image", "code"):
                continue
            if block.kind == "formula":
                formulas.append(block)
            elif block.kind == "table":
                tables.append(block)
            elif block.text.strip():
                block.text, block.inline_map = _protect_inline_math(block.text)
                text_blocks.append(block)

    table_cells = sum(
        1
        for table in tables
        for row in (table.rows or [])
        for cell in row
        if re.search(r"[A-Za-z]", cell)
    )
    total = len(titles) + len(text_blocks) + len(formulas) + table_cells
    if total == 0:
        return
    done = 0

    def advance(count: int) -> None:
        nonlocal done
        done += count
        if renew:
            renew(min(1.0, done / total))

    if titles:
        result = _translate_batch(
            [{"id": index, "input": chapter.title} for index, chapter in enumerate(titles)],
            base_url, api_key, model, extra,
        )
        for index, chapter in enumerate(titles):
            chapter.translated_title = result.get(index, chapter.title)
        advance(len(titles))

    for block in formulas:
        if canceled and canceled():
            raise BookFailure("canceled")
        if deadline is not None and time.monotonic() > deadline:
            raise BookFailure("engine_timeout")
        image = extract.images.get(block.image_name)
        if image:
            latex = _vision_latex(image, base_url, api_key, model, extra)
            block.mathml = _latex_to_mathml(latex)
        advance(1)

    pending = list(text_blocks)
    while pending:
        if canceled and canceled():
            raise BookFailure("canceled")
        if deadline is not None and time.monotonic() > deadline:
            raise BookFailure("engine_timeout")
        batch: list[Block] = []
        items: list[dict] = []
        used = 0
        while pending:
            block = pending[0]
            if batch and (len(batch) >= 24 or used + len(block.text) > 6000):
                break
            pending.pop(0)
            batch.append(block)
            items.append({"id": len(batch) - 1, "input": block.text})
            used += len(block.text)
        result = _translate_batch(items, base_url, api_key, model, extra)
        for identifier, block in enumerate(batch):
            translated = result.get(identifier)
            if translated:
                block.text = _restore_inline_math(translated, block.inline_map)
        advance(len(batch))

    for table in tables:
        if canceled and canceled():
            raise BookFailure("canceled")
        if deadline is not None and time.monotonic() > deadline:
            raise BookFailure("engine_timeout")
        rows = table.rows or []
        cells = [
            (row_index, column_index, cell)
            for row_index, row in enumerate(rows)
            for column_index, cell in enumerate(row)
            if re.search(r"[A-Za-z]", cell)
        ]
        for start in range(0, len(cells), 24):
            chunk = cells[start : start + 24]
            items = [
                {"id": index, "input": cell}
                for index, (_, _, cell) in enumerate(chunk)
            ]
            result = _translate_batch(items, base_url, api_key, model, extra)
            for index, (row_index, column_index, _) in enumerate(chunk):
                translated = result.get(index)
                if translated:
                    rows[row_index][column_index] = translated
            advance(len(chunk))


def build_epub(work: Path, extract: BookExtract, out: Path, job_id: str) -> None:
    book_uuid = str(uuid.uuid5(uuid.NAMESPACE_URL, f"scholar-book:{job_id}"))
    title = extract.title or "Untitled"
    author = extract.author or ""
    chapters = [chapter for chapter in extract.chapters if chapter.blocks]
    # href values are relative to content.opf, which itself lives in OEBPS/.
    manifest = [
        ("nav", "nav.xhtml", "application/xhtml+xml"),
        ("ncx", "toc.ncx", "application/x-dtbncx+xml"),
        ("css", "style.css", "text/css"),
    ]
    spine = []
    for index in range(1, len(chapters) + 1):
        item_id = f"chapter-{index:03d}"
        manifest.append((item_id, f"text/{item_id}.xhtml", "application/xhtml+xml"))
        spine.append(item_id)
    for image_name in extract.images:
        manifest.append((f"img-{image_name}", f"images/{image_name}", _media_type(image_name)))

    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
        mimetype = zipfile.ZipInfo("mimetype")
        mimetype.compress_type = zipfile.ZIP_STORED
        archive.writestr(mimetype, "application/epub+zip")
        archive.writestr("META-INF/container.xml", _container_xml())
        archive.writestr("OEBPS/content.opf", _content_opf(book_uuid, title, author, manifest, spine))
        archive.writestr("OEBPS/nav.xhtml", _nav_xhtml(chapters))
        archive.writestr("OEBPS/toc.ncx", _toc_ncx(book_uuid, chapters))
        archive.writestr("OEBPS/style.css", _STYLE)
        for index, chapter in enumerate(chapters, start=1):
            archive.writestr(f"OEBPS/text/chapter-{index:03d}.xhtml", _chapter_xhtml(index, chapter))
        for image_name, data in extract.images.items():
            archive.writestr(f"OEBPS/images/{image_name}", data)


def inspect_epub(path: Path, source_pages: int) -> dict:
    if path.is_symlink() or not path.is_file():
        raise BookFailure("missing_output")
    size = path.stat().st_size
    if not 0 < size <= 268435456:
        raise BookFailure("output_size_limit")
    if not zipfile.is_zipfile(path):
        raise BookFailure("invalid_output_epub")
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        if not entries or entries[0].filename != "mimetype":
            raise BookFailure("invalid_output_epub")
        if entries[0].compress_type != zipfile.ZIP_STORED:
            raise BookFailure("invalid_output_epub")
        if archive.read("mimetype") != b"application/epub+zip":
            raise BookFailure("invalid_output_epub")
        names = {entry.filename for entry in entries}
        for required in ("META-INF/container.xml", "OEBPS/content.opf", "OEBPS/nav.xhtml"):
            if required not in names:
                raise BookFailure("invalid_output_epub")
        if not any(name.startswith("OEBPS/text/") for name in names):
            raise BookFailure("invalid_output_epub")
        try:
            package = ET.fromstring(archive.read("OEBPS/content.opf"))
        except ET.ParseError:
            raise BookFailure("invalid_output_epub") from None
        ns = {"opf": "http://www.idpf.org/2007/opf"}
        manifest_ids = set()
        for item in package.findall(".//opf:manifest/opf:item", ns):
            item_id = item.get("id")
            href = item.get("href")
            if not item_id or not href:
                raise BookFailure("invalid_output_epub")
            manifest_ids.add(item_id)
            target = posixpath.normpath(posixpath.join("OEBPS", href))
            if target not in names:
                raise BookFailure("invalid_output_epub")
        for itemref in package.findall(".//opf:spine/opf:itemref", ns):
            if itemref.get("idref") not in manifest_ids:
                raise BookFailure("invalid_output_epub")
        if sum(entry.file_size for entry in entries) > 512 * 1024 * 1024:
            raise BookFailure("output_size_limit")
    return {"sha256": digest, "fileSize": size, "pageCount": max(1, source_pages)}


def _media_type(name: str) -> str:
    if name.endswith(".png"):
        return "image/png"
    if name.endswith(".jpg"):
        return "image/jpeg"
    if name.endswith(".webp"):
        return "image/webp"
    return "application/octet-stream"


def _container_xml() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
        '<rootfiles><rootfile full-path="OEBPS/content.opf" '
        'media-type="application/oebps-package+xml"/></rootfiles></container>'
    )


def _content_opf(book_uuid, title, author, manifest, spine) -> str:
    items = "".join(
        f'<item id="{item_id}" href="{href}" media-type="{media}"/>'
        for item_id, href, media in manifest
    )
    spine_items = "".join(f'<itemref idref="{item_id}"/>' for item_id in spine)
    creator = f"<dc:creator>{html.escape(author)}</dc:creator>" if author else ""
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">'
        '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
        f'<dc:identifier id="bookid">urn:uuid:{book_uuid}</dc:identifier>'
        f"<dc:title>{html.escape(title)}</dc:title>"
        f"{creator}<dc:language>zh-CN</dc:language>"
        '<meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>'
        "</metadata>"
        f"<manifest>{items}</manifest>"
        f'<spine toc="ncx">{spine_items}</spine>'
        "</package>"
    )


def _nav_xhtml(chapters) -> str:
    entries = "".join(
        f'<li><a href="text/chapter-{index:03d}.xhtml">'
        f"{html.escape(chapter.translated_title or chapter.title)}</a></li>"
        for index, chapter in enumerate(chapters, start=1)
    )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        "<!DOCTYPE html>\n"
        '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" '
        'lang="zh-CN"><head><title>目录</title></head><body>'
        f'<nav epub:type="toc"><h1>目录</h1><ol>{entries}</ol></nav></body></html>'
    )


def _toc_ncx(book_uuid, chapters) -> str:
    points = "".join(
        f'<navPoint id="nav-{index}" playOrder="{index}">'
        f"<navLabel><text>{html.escape(chapter.translated_title or chapter.title)}</text></navLabel>"
        f'<content src="text/chapter-{index:03d}.xhtml"/></navPoint>'
        for index, chapter in enumerate(chapters, start=1)
    )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">'
        f'<head><meta name="dtb:uid" content="urn:uuid:{book_uuid}"/></head>'
        "<docTitle><text>目录</text></docTitle>"
        f"<navMap>{points}</navMap></ncx>"
    )


def _table_xhtml(block) -> str:
    rows = block.rows or []
    parts = ['<table class="data">']
    for row_index, row in enumerate(rows):
        cell_tag = "th" if block.header and row_index == 0 else "td"
        parts.append(
            "<tr>"
            + "".join(f'<{cell_tag}>{html.escape(cell)}</{cell_tag}>' for cell in row)
            + "</tr>"
        )
    parts.append("</table>")
    return "".join(parts)


def _chapter_xhtml(index: int, chapter) -> str:
    parts = []
    heading = chapter.translated_title or chapter.title
    if heading:
        parts.append(f"<h1>{html.escape(heading)}</h1>")
    for block in chapter.blocks:
        if block.kind == "image":
            parts.append(f'<div class="figure"><img src="../images/{block.image_name}" alt=""/></div>')
        elif block.kind == "formula":
            if block.mathml:
                parts.append(f'<div class="math">{block.mathml}</div>')
            else:
                parts.append(
                    f'<figure class="formula"><img src="../images/{block.image_name}" alt=""/></figure>'
                )
        elif block.kind == "table":
            parts.append(_table_xhtml(block))
        elif block.kind == "h1":
            parts.append(f"<h2>{html.escape(block.text)}</h2>")
        elif block.kind == "h2":
            parts.append(f"<h3>{html.escape(block.text)}</h3>")
        elif block.kind == "figcaption":
            parts.append(f'<p class="caption">{html.escape(block.text)}</p>')
        elif block.kind == "code":
            parts.append(f'<pre class="code">{html.escape(block.text)}</pre>')
        elif block.kind == "footnote":
            parts.append(f'<p class="footnote">{html.escape(block.text)}</p>')
        else:
            parts.append(f"<p>{html.escape(block.text)}</p>")
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        "<!DOCTYPE html>\n"
        f'<html xmlns="http://www.w3.org/1999/xhtml" lang="zh-CN"><head>'
        f"<title>{html.escape(heading)}</title>"
        '<link rel="stylesheet" type="text/css" href="../style.css"/></head><body>'
        + "".join(parts)
        + "</body></html>"
    )


_STYLE = (
    "body{font-family:serif;line-height:1.7;margin:1.2em;}"
    "h1{font-size:1.6em;margin:1.2em 0 .6em;}"
    "h2{font-size:1.3em;margin:1em 0 .5em;}"
    "h3{font-size:1.15em;margin:.9em 0 .4em;}"
    "p{text-indent:2em;margin:.5em 0;}"
    ".caption{font-size:.9em;text-align:center;text-indent:0;color:#444;}"
    ".footnote{font-size:.8em;color:#555;text-indent:0;}"
    "pre.code{white-space:pre-wrap;font-family:monospace;font-size:.82em;"
    "line-height:1.45;background:#f6f6f6;padding:.6em;border-radius:.3em;}"
    ".figure{text-align:center;margin:1em 0;}"
    ".formula{text-align:center;margin:1em 0;}"
    "img{max-width:90%;max-height:50vh;height:auto;object-fit:contain;}"
    ".formula img{max-height:none;}"
    ".math{margin:1em 0;text-align:center;overflow-x:auto;}"
    "table.data{border-collapse:collapse;width:100%;font-size:.9em;margin:1em 0;}"
    "table.data th,table.data td{border:1px solid #bbb;padding:.35em .5em;"
    "text-align:left;vertical-align:top;}"
)
