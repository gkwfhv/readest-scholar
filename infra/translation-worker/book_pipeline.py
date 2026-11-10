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

from translation_style import NATURAL_CHINESE_RULES

BOOK_SYSTEM_PROMPT = (
    "Translate English book text into natural, publication-quality Simplified Chinese. "
    "Rewrite each complete paragraph in idiomatic Chinese instead of following English "
    "word order. Preserve meaning, certainty, numbers, units, citations, symbols and "
    "proper nouns; keep terminology consistent, using Chinese (English) at the first "
    "meaningful occurrence. Do not add, omit, summarize or explain. " + NATURAL_CHINESE_RULES
)
JSON_CONTRACT = (
    "Return only a JSON object of the form "
    '{"items":[{"id":<number>,"output":"<translated text>"}]} '
    "covering every id. Keep placeholder tokens such as ⟦I12⟧ or ⟦M3⟧ exactly "
    "as written, with no spaces inside the brackets. "
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
    source_text: str = ""
    width_em: float = 0.0
    rows: list[list[str]] | None = None
    header: bool = False
    inline_map: list[str] | None = None
    # ⟦I12⟧ token -> (image name, height in em, baseline descent in em)
    inline_images: dict[int, tuple[str, float, float]] | None = None


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
    if re.fullmatch(r"[0-9ivxlcdm]{1,6}", stripped, re.IGNORECASE) and (
        y0 < 60 or y1 > height - 50
    ):
        # Running headers/footers only; a lone "M" mid-page is a variable.
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


def _page_spans(page, height: float) -> list[dict]:
    """Text spans on a page, tagged with their column and font class."""
    spans = []
    for block in page.get_text("dict").get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            direction = line.get("dir") or (1.0, 0.0)
            if abs(direction[1]) > 0.1:
                # Rotated sidebar/watermark text has a bbox spanning the whole
                # page and would swallow every real row it overlaps.
                continue
            for span in line.get("spans", []):
                text = span.get("text") or ""
                if not text.strip():
                    continue
                bbox = span.get("bbox") or (0, 0, 0, 0)
                size = float(span.get("size") or 0)
                if size > 0 and bbox[3] - bbox[1] > size * 4:
                    continue
                if _is_furniture(text, bbox[1], bbox[3], height):
                    continue
                font = span.get("font") or ""
                spans.append({
                    "text": text,
                    "bbox": bbox,
                    "size": size,
                    "origin": span.get("origin") or (bbox[0], bbox[3]),
                    "font": font,
                    "math": bool(MATH_FONT_RE.search(font)),
                    "line_id": id(line),
                    "line_bbox": line.get("bbox") or (0, 0, 0, 0),
                })
    return spans


def _column_gutter(spans: list[dict], width: float) -> float | None:
    """X where the right column starts, when the page clearly has two columns.

    Works on spans rather than blocks: PDF text blocks routinely glue a line
    from the left column to the equation in the right column, which hid the
    gutter from the old block-bbox version.
    """
    if len(spans) < 20:
        return None
    low = int(width * 0.32)
    high = int(width * 0.68)
    if high - low < 12:
        return None
    cover = [0] * (high - low + 2)
    for span in spans:
        start = max(low, int(span["bbox"][0]))
        end = min(high, int(span["bbox"][2]))
        if end > start:
            cover[start - low] += 1
            cover[end - low] -= 1
    limit = max(2, int(len(spans) * 0.02))
    best_start = best_end = None
    running = 0
    run_start = None
    for index in range(high - low):
        running += cover[index]
        if running <= limit:
            if run_start is None:
                run_start = index
        else:
            if run_start is not None:
                if best_end is None or index - run_start > best_end - best_start:
                    best_start, best_end = run_start, index
                run_start = None
    if run_start is not None:
        if best_end is None or (high - low) - run_start > best_end - best_start:
            best_start, best_end = run_start, high - low
    if best_start is None or best_end - best_start < max(8, width * 0.012):
        return None
    gutter = low + best_end
    left = sum(1 for span in spans if span["bbox"][2] <= gutter * 1.01)
    right = sum(1 for span in spans if span["bbox"][0] >= gutter - 1)
    if left < len(spans) * 0.15 or right < len(spans) * 0.15:
        return None
    return float(gutter)



def _is_cjk(char: str) -> bool:
    return bool(char) and '\u3000' <= char <= '\u9fff'


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


def _symbol_ratio(text: str) -> float:
    """Share of visible characters that are not letters or digits."""
    visible = [char for char in text.strip() if not char.isspace()]
    if not visible:
        return 0.0
    return sum(1 for char in visible if not char.isalnum()) / len(visible)


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
    return _symbol_ratio(stripped) >= 0.14


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


def _crop_region(document, page_number: int, bbox, dpi: int = 200, padding: float = 2.0) -> bytes | None:
    try:
        page = document[page_number - 1]
        pixmap = page.get_pixmap(
            clip=(
                bbox[0] - padding, bbox[1] - padding,
                bbox[2] + padding, bbox[3] + padding,
            ),
            dpi=dpi,
        )
        return pixmap.tobytes("png")
    except Exception:
        return None


# Genuine math faces. Computer Modern Roman (cmr) and STIX text are the body
# fonts of many LaTeX books, so a span in them is not math by itself; those
# faces only supply a formula's digits, operators and punctuation.
MATH_FONT_RE = re.compile(
    r"(cmmi|cmsy|cmex|msam|msbm|eufm|rsfs|math|symbol)", re.IGNORECASE
)
MATH_ROMAN_FONT_RE = re.compile(r"^(cmr|stix)", re.IGNORECASE)
LETTER_RE = re.compile(r"[A-Za-z]")


def _ordered_spans(spans: list[dict]) -> list[dict]:
    return sorted(spans, key=lambda span: (span["bbox"][0], span["bbox"][1]))


def _row_plain_text(spans: list[dict]) -> str:
    out = ""
    previous = None
    for span in _ordered_spans(spans):
        text = span["text"]
        if not text.strip():
            continue
        if previous is not None:
            gap = span["bbox"][0] - previous["bbox"][2]
            if gap > 0.2 * max(span["size"], previous["size"], 1.0) and not out.endswith(" "):
                out += " "
        out += text
        previous = span
    return re.sub(r"[ \t]+", " ", out).strip()


def _promote_math_glue(spans: list[dict]) -> None:
    """Mark roman-font digits and operators that belong to a formula as math.

    TeX sets a formula's letters in math italic (cmmi) but its digits,
    operators and punctuation in the body roman font (cmr), so without this
    a display equation only scores for its letters. Prose spans contain
    letters and are never promoted; glue must also touch a math glyph.
    """
    ordered = _ordered_spans(spans)
    promoted = True
    while promoted:
        promoted = False
        for position, span in enumerate(ordered):
            if span["math"] or LETTER_RE.search(span["text"]):
                continue
            if not MATH_ROMAN_FONT_RE.search(span["font"]):
                continue
            neighbours = ordered[max(0, position - 1):position]
            neighbours += ordered[position + 1:position + 2]
            for neighbour in neighbours:
                if not neighbour["math"]:
                    continue
                gap = max(span["bbox"][0], neighbour["bbox"][0]) - min(
                    span["bbox"][2], neighbour["bbox"][2]
                )
                allowed = max(2.5, 0.9 * max(span["size"], neighbour["size"], 1.0))
                if gap <= allowed:
                    span["math"] = True
                    promoted = True
                    break


def _same_baseline_band(spans: list[dict], span: dict) -> bool:
    """Whether a span sits on the same printed line as a row's members.

    Adjacent lines overlap vertically when one carries tall math glyphs, and
    climbing from a small superscript into the next line interleaved the two
    lines' words. Sub/superscripts still share a baseline band with their base.
    """
    baseline = float(span["origin"][1])
    for member in spans:
        distance = abs(float(member["origin"][1]) - baseline)
        if distance <= max(2.0, 0.6 * max(span["size"], member["size"], 1.0)):
            return True
    return False


def _visual_rows(page, height: float) -> tuple[list[dict], float | None]:
    """Group spans into visual rows inside each column.

    A pdf line object may contain the left-column prose *and* a right-column
    equation on the same baseline, so rows are assembled per column from
    spans instead of trusting PyMuPDF's block/line grouping.
    """
    width = page.rect.width
    spans = _page_spans(page, height)
    gutter = _column_gutter(spans, width)
    lines: dict[int, dict] = {}
    for span in spans:
        entry = lines.setdefault(
            span["line_id"], {"bbox": span["line_bbox"], "spans": []},
        )
        entry["spans"].append(span)

    crossing: dict[int, bool] = {}
    body_top = body_bottom = None
    full_width_boxes: list[tuple[float, float, float, float]] = []
    if gutter is not None:
        for line_id, line in lines.items():
            box = line["bbox"]
            crossing[line_id] = box[0] < gutter - 5 and box[2] > gutter + 5
        left = [
            line["bbox"] for line in lines.values()
            if not crossing[line["spans"][0]["line_id"]]
            and line["bbox"][2] <= gutter * 0.98
        ]
        right = [
            line["bbox"] for line in lines.values()
            if not crossing[line["spans"][0]["line_id"]]
            and line["bbox"][0] >= gutter
        ]
        if left and right:
            body_top = max(min(box[1] for box in left), min(box[1] for box in right))
            body_bottom = min(max(box[3] for box in left), max(box[3] for box in right))
            if body_bottom <= body_top:
                body_top = body_bottom = None
        if body_top is not None:
            full_width_boxes = [
                line["bbox"] for line_id, line in lines.items()
                if crossing.get(line_id) and (
                    line["bbox"][3] <= body_top + 1
                    or line["bbox"][1] >= body_bottom - 1
                )
            ]

    def on_full_width_line(box) -> bool:
        height = max(1.0, box[3] - box[1])
        for other in full_width_boxes:
            overlap = min(box[3], other[3]) - max(box[1], other[1])
            if overlap > 0.5 * height:
                return True
        return False

    groups: dict[int, list[dict]] = {0: [], 1: [], 2: []}
    for span in spans:
        center = (span["bbox"][0] + span["bbox"][2]) / 2
        if gutter is None:
            column = 1
        elif crossing.get(span["line_id"]) and body_top is not None and (
            span["line_bbox"][3] <= body_top + 1 or span["line_bbox"][1] >= body_bottom - 1
        ):
            # Title/caption lines above or below the two-column body run across
            # the whole page: their halves must stay one row in x order.
            column = 0
        elif on_full_width_line(span["bbox"]):
            column = 0
        elif center < gutter - 2:
            column = 1
        elif center > gutter + 2:
            column = 2
        else:
            column = 0
        span["col"] = column
        groups[column].append(span)

    rows: list[dict] = []
    for column, items in groups.items():
        items.sort(key=lambda span: (span["bbox"][1], span["bbox"][0]))
        made: list[dict] = []
        for span in items:
            box = span["bbox"]
            span_height = max(1.0, box[3] - box[1])
            target = None
            for row in reversed(made[-8:]):
                other = row["bbox"]
                overlap = min(other[3], box[3]) - max(other[1], box[1])
                smaller = min(other[3] - other[1], span_height)
                if smaller <= 0 or overlap <= 0.55 * smaller:
                    continue
                if not _same_baseline_band(row["spans"], span):
                    continue
                target = row
                break
            if target is None:
                made.append({"col": column, "bbox": list(box), "spans": [span]})
            else:
                other = target["bbox"]
                target["bbox"] = [
                    min(other[0], box[0]), min(other[1], box[1]),
                    max(other[2], box[2]), max(other[3], box[3]),
                ]
                target["spans"].append(span)
        rows.extend(made)

    for row in rows:
        _promote_math_glue(row["spans"])
        chars = math = body = 0
        size = 0.0
        for span in row["spans"]:
            text = span["text"].strip()
            count = len(text)
            if not count:
                continue
            chars += count
            if span["math"]:
                math += count
            else:
                body += count
            size = max(size, span["size"])
        row["chars"] = chars
        row["m"] = math / max(1, chars)
        row["b"] = body / max(1, chars)
        row["size"] = size or 10.0
        row["text"] = _row_plain_text(row["spans"])
        row["inline"] = {}
    rows.sort(key=lambda row: (row["col"], row["bbox"][1], row["bbox"][0]))
    return rows, gutter


def _inline_runs(spans: list[dict]) -> list[list[dict]]:
    """Contiguous math-font spans form one inline formula."""
    ordered = _ordered_spans(spans)
    runs: list[list[dict]] = []
    current: list[dict] = []
    for span in ordered:
        text = span["text"]
        if span["math"]:
            if not current:
                if text.strip():
                    current = [span]
                continue
            last = current[-1]
            gap = span["bbox"][0] - last["bbox"][2]
            allowed = max(2.5, 0.9 * max(span["size"], last["size"], 1.0))
            if gap <= allowed:
                current.append(span)
            else:
                if any(item["text"].strip() for item in current):
                    runs.append(current)
                current = [span] if text.strip() else []
            continue
        if current and not text.strip():
            last = current[-1]
            gap = span["bbox"][0] - last["bbox"][2]
            if gap <= max(2.5, 0.9 * max(span["size"], last["size"], 1.0)):
                current.append(span)
                continue
        if current:
            if any(item["text"].strip() for item in current):
                runs.append(current)
            current = []
    if current and any(item["text"].strip() for item in current):
        runs.append(current)
    return runs


def _row_with_inline_images(
    row: dict,
    page,
    body_size: float,
    images: dict[str, bytes],
    image_dir: Path,
    token_state: dict,
) -> tuple[str, dict[int, tuple[str, float, float]]]:
    """Replace inline math runs with ⟦I<id>⟧ tokens backed by cropped PNGs."""
    import fitz

    ordered = _ordered_spans(row["spans"])
    runs = _inline_runs(ordered)
    token_of: dict[int, tuple[int, str, float, float, float]] = {}
    skip: set[int] = set()
    for run in runs:
        x0 = min(span["bbox"][0] for span in run)
        y0 = min(span["bbox"][1] for span in run)
        x1 = max(span["bbox"][2] for span in run)
        y1 = max(span["bbox"][3] for span in run)
        main = max(run, key=lambda span: span["size"])
        baseline = float(main["origin"][1])
        try:
            pixmap = page.get_pixmap(
                clip=fitz.Rect(x0 - 0.6, y0 - 0.6, x1 + 0.6, y1 + 0.6), dpi=300,
            )
            data = pixmap.tobytes("png")
        except Exception:
            continue
        name = _register_image(images, image_dir, data)
        token_state["next"] += 1
        token = token_state["next"]
        height = max(0.6, min(2.5, (y1 - y0) / max(1.0, body_size)))
        descent = max(-0.25, min(0.85, (y1 - baseline) / max(1.0, body_size)))
        token_of[id(run[0])] = (token, name, height, descent, x1)
        for span in run[1:]:
            skip.add(id(span))

    out = ""
    previous_end = None
    previous_size = 0.0
    for span in ordered:
        if id(span) in skip:
            continue
        text = span["text"]
        entry = token_of.get(id(span))
        if entry is None and not text.strip():
            continue
        if previous_end is not None:
            gap = span["bbox"][0] - previous_end
            if gap > 0.2 * max(span["size"], previous_size, 1.0) and not out.endswith(" "):
                out += " "
        if entry is not None:
            token, name, height, descent, end = entry
            out += f"⟦I{token}⟧"
            row["inline"][token] = (name, height, descent)
            previous_end = end
        else:
            out += text
            previous_end = span["bbox"][2]
        previous_size = span["size"]
    return out.strip(), row["inline"]


def _equation_material(row: dict, body_size: float) -> bool:
    """Whether a row can belong to a display equation (math or a short case)."""
    if row["size"] > body_size * 1.15:
        return False
    if row["chars"] > 45:
        return False
    if row["b"] >= 0.55:
        # Short right-aligned conditions ("j = 0", "otherwise") sit inside
        # piecewise equations; full prose rows also have a high body share
        # and are rejected by the length/position checks above.
        return (
            row["chars"] <= 30
            and not _ends_sentence(row["text"])
            and len(re.findall(r"[A-Za-z]{2,}", row["text"])) <= 6
        )
    return row["m"] >= 0.12


def _equation_continuation(above: dict, below: dict, body_size: float) -> bool:
    line_height = max(1.0, above["bbox"][3] - above["bbox"][1])
    gap = below["bbox"][1] - above["bbox"][3]
    if gap > max(7.0, 2.0 * line_height):
        return False
    if gap < -max(6.0, 1.2 * line_height):
        return False
    if not _equation_material(above, body_size) or not _equation_material(below, body_size):
        return False
    # A body-font condition row only belongs to the equation when it sits in
    # the right-hand condition column, not at the normal paragraph indent.
    if above["b"] >= 0.55 and above["bbox"][0] < below["bbox"][0] - 8:
        return False
    if below["b"] >= 0.55 and below["bbox"][0] < above["bbox"][0] - 8:
        return False
    return True


def _row_math_bounds(row: dict) -> tuple[float, float, float, float]:
    """Bounding box of the mathematical part of a row.

    A display equation often shares its last baseline with the first words of
    the following sentence ("... = 1. This for-"); the trailing prose must not
    be baked into the equation image.
    """
    if row["m"] < 0.6:
        return tuple(row["bbox"])
    boxes = [span["bbox"] for span in row["spans"] if span["math"]]
    if not boxes:
        return tuple(row["bbox"])
    return (
        min(box[0] for box in boxes),
        min(box[1] for box in boxes),
        max(box[2] for box in boxes),
        max(box[3] for box in boxes),
    )


def _is_core_equation_row(row: dict) -> bool:
    if row["m"] >= 0.55:
        return True
    return (
        row["m"] >= 0.45
        and row["chars"] <= 45
        and not _ends_sentence(row["text"])
    )


def _formula_regions(rows: list[dict], body_size: float) -> list[tuple[float, float, float, float]]:
    """Group math rows into complete display-equation regions.

    Equations are split into many tiny spans/rows (left-hand side, brace,
    condition columns, equation number); grouping rows rather than lines keeps
    one crop per equation instead of a handful of unreadable fragments.
    """
    if any(re.match(r"^\s*(algorithm|算法)\s*\d+", row["text"], re.IGNORECASE) for row in rows):
        # Algorithm listings use the same LaTeX fonts; keep them as code text.
        return []
    filled = [row for row in rows if row["chars"]]
    candidates = [row for row in filled if _is_core_equation_row(row)]
    if len(candidates) >= 6 and len(candidates) >= 0.8 * len(filled):
        ratios = sorted(_symbol_ratio(row["text"]) for row in candidates)
        if ratios[len(ratios) // 2] < 0.12:
            # A roman body font misread as math flags every prose line on the
            # page; that is body text, not a page of equations.
            return []
    regions: list[tuple[float, float, float, float]] = []
    for column in (0, 1, 2):
        sequence = [row for row in rows if row["col"] == column]
        index = 0
        while index < len(sequence):
            row = sequence[index]
            if not _is_core_equation_row(row) or row["chars"] > 160:
                index += 1
                continue
            if column == 0 and row["m"] < 0.7:
                # Full-width rows are usually headings; only a clearly
                # mathematical one is a display equation spanning both columns.
                index += 1
                continue
            start = end = index
            while start > 0 and _equation_continuation(sequence[start - 1], sequence[start], body_size):
                start -= 1
            while end + 1 < len(sequence) and _equation_continuation(sequence[end], sequence[end + 1], body_size):
                end += 1
            group = sequence[start:end + 1]
            boxes = [_row_math_bounds(item) for item in group]
            top = min(box[1] for box in boxes) - 0.8
            # Do not clamp to the next line: subscript glyphs often descend
            # below their reported span box. Allow only 2pt past the next
            # line's top, which is blank ascender space in normal text.
            max_bottom = max(box[3] for box in boxes)
            bottom = max_bottom + 3.0
            if end + 1 < len(sequence):
                bottom = max(
                    max_bottom,
                    min(bottom, sequence[end + 1]["bbox"][1] + 2.0),
                )
            regions.append((
                min(box[0] for box in boxes) - 1.5,
                top,
                max(box[2] for box in boxes) + 1.5,
                bottom,
            ))
            index = end + 1
    # Drop duplicate overlapping regions produced by page-spanning rows.
    unique: list[tuple[float, float, float, float]] = []
    for region in regions:
        area = max(1.0, (region[2] - region[0]) * (region[3] - region[1]))
        overlap = False
        for other in unique:
            width = max(0.0, min(region[2], other[2]) - max(region[0], other[0]))
            height = max(0.0, min(region[3], other[3]) - max(region[1], other[1]))
            if width * height / area > 0.7:
                overlap = True
                break
        if not overlap:
            unique.append(region)
    return unique


def _formula_filter_boxes(rows: list[dict], regions) -> list[tuple[float, float, float, float]]:
    """Full row boxes covered by each equation crop.

    Crops use the math-only bounds so trailing prose is not baked into the
    image, but text filtering needs the whole row (including an equation
    number at the far right) or the row survives as duplicated prose.
    """
    boxes = []
    for region in regions:
        x0, y0, x1, y1 = region
        members = []
        for row in rows:
            box = row["bbox"]
            height = max(1.0, box[3] - box[1])
            vertical = min(box[3], y1) - max(box[1], y0)
            horizontal = min(box[2], x1) - max(box[0], x0)
            if vertical > 0.5 * height and horizontal > 0:
                members.append(box)
        if members:
            boxes.append((
                min(box[0] for box in members),
                min(box[1] for box in members),
                max(box[2] for box in members),
                max(box[3] for box in members),
            ))
        else:
            boxes.append(region)
    return boxes


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


def _latex_plausible(latex: str, source: str) -> bool:
    """Reject a vision transcription that lost most of the printed symbols.

    The cropped equation is the ground truth; a hallucinated or truncated
    LaTeX string is worse than showing that crop as an image.
    """
    if len(latex.strip()) < 3:
        return False
    plain = re.sub(r"\\[A-Za-z]+", " ", latex)
    plain = re.sub(r"[{}_^&$\\]", " ", plain).lower()
    source_marks = source.count("*") + source.count("∗") + source.count("⋆")
    latex_marks = latex.count("*") + len(re.findall(r"\\ast\b|\\star\b", latex))
    if latex_marks > source_marks:
        # The model often turns a single R* into "R^* = *" and the result
        # renders as a bogus standalone asterisk; keep the crop instead.
        return False
    tokens = re.findall(r"[A-Za-z]{2,}|\d+(?:\.\d+)?", source)
    if not tokens:
        return True
    hits = sum(1 for token in tokens if token.lower() in plain)
    return hits / len(tokens) >= 0.6


def _latex_to_mathml(latex: str) -> str:
    if not latex:
        return ""
    try:
        from latex2mathml.converter import convert

        return convert(latex, display="block")
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
                    "You transcribe the mathematical equation shown in the image into "
                    "LaTeX. Preserve every symbol, subscript, superscript, fraction, "
                    "brace, matrix, case distinction and alignment. Use an aligned or "
                    "cases environment for multi-line equations. Ignore a trailing "
                    "equation number such as (6). Return ONLY the LaTeX source, "
                    "without $ delimiters or fences."
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
            token_state = {"next": 0}
            for page_number in range(chapter.start_page, chapter.end_page + 1):
                page = document[page_number - 1]
                width, height = page.rect.width, page.rect.height
                try:
                    tables = list(page.find_tables().tables)
                except Exception:
                    tables = []
                table_boxes = [table.bbox for table in tables]
                try:
                    rows, gutter = _visual_rows(page, height)
                except Exception:
                    rows, gutter = [], None
                page_body = _body_size(
                    [(row["size"], row["chars"]) for row in rows if row["chars"]]
                )
                try:
                    formulas = _formula_regions(rows, page_body)
                except Exception:
                    formulas = []
                if table_boxes:
                    formulas = [
                        region
                        for region in formulas
                        if not _inside_table(region, table_boxes)
                    ]

                def column_of(box: tuple[float, float, float, float]) -> int:
                    if gutter is None:
                        return 1
                    if box[0] < gutter - 5 and box[2] > gutter + 5:
                        return 0
                    center = (box[0] + box[2]) / 2
                    if center < gutter:
                        return 1
                    if center > gutter:
                        return 2
                    return 0

                figures: list[tuple[float, float, float, float]] = []
                for image in page.get_image_info(xrefs=True):
                    bbox = image.get("bbox") or (0, 0, 0, 0)
                    area = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1])
                    # A scanned page is one full-page image whose OCR text must
                    # stay; only treat figure-sized images as opaque regions.
                    if 0 < area < width * height * 0.7:
                        figures.append(bbox)
                if figures:
                    formulas = [
                        region for region in formulas
                        if not _inside_table(region, figures)
                    ]
                formula_boxes = _formula_filter_boxes(rows, formulas)

                left_margins: dict[int, float] = {}
                for row in rows:
                    if row["col"] in (1, 2):
                        left_margins[row["col"]] = min(
                            left_margins.get(row["col"], row["bbox"][0]),
                            row["bbox"][0],
                        )

                page_items: list[dict] = []
                for row in rows:
                    box = (row["bbox"][0], row["bbox"][1], row["bbox"][2], row["bbox"][3])
                    if _inside_table(box, table_boxes) or _inside_table(box, formula_boxes) or _inside_table(box, figures):
                        continue
                    if chapter.keep_source:
                        text, inline = row["text"], {}
                    else:
                        text, inline = _row_with_inline_images(
                            row, page, page_body, images, image_dir, token_state,
                        )
                    if not text.strip():
                        continue
                    page_items.append({
                        "kind": "text", "col": row["col"],
                        "x0": row["bbox"][0], "y0": row["bbox"][1],
                        "x1": row["bbox"][2], "y1": row["bbox"][3],
                        "size": row["size"], "text": text,
                        "plain": row["text"], "lines": [row["text"]],
                        "inline": inline, "page": page_number,
                        "left_margin": left_margins.get(row["col"], row["bbox"][0]),
                    })

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
                        page_items.append({
                            "kind": "image", "col": column_of(bbox),
                            "x0": bbox[0], "y0": bbox[1],
                            "x1": bbox[2], "y1": bbox[3], "payload": data,
                        })
                for formula_bbox in formulas:
                    source_text = " ".join(
                        row["text"] for row in rows
                        if _inside_table(
                            (row["bbox"][0], row["bbox"][1], row["bbox"][2], row["bbox"][3]),
                            [formula_bbox],
                        )
                    )
                    width_em = (formula_bbox[2] - formula_bbox[0]) / max(1.0, page_body)
                    page_items.append({
                        "kind": "formula", "col": column_of(formula_bbox),
                        "x0": formula_bbox[0], "y0": formula_bbox[1],
                        "x1": formula_bbox[2], "y1": formula_bbox[3],
                        "payload": (page_number, formula_bbox, source_text, width_em),
                    })
                for table in tables:
                    parsed = _table_rows(table)
                    if parsed is None:
                        cropped = _crop_region(document, page_number, table.bbox)
                        if not cropped:
                            continue
                        kind, payload = "image", cropped
                    else:
                        kind, payload = "table", parsed
                    page_items.append({
                        "kind": kind, "col": column_of(table.bbox),
                        "x0": table.bbox[0], "y0": table.bbox[1],
                        "x1": table.bbox[2], "y1": table.bbox[3],
                        "payload": payload,
                    })

                column_items = [item for item in page_items if item["col"] in (1, 2)]
                top = min((item["y0"] for item in column_items), default=0.0)
                bottom = max((item["y1"] for item in column_items), default=0.0)

                def order_key(item: dict) -> tuple[float, float, float]:
                    column = item["col"]
                    if column in (1, 2):
                        return (float(column), item["y0"], item["x0"])
                    if item["y0"] <= top + 2:
                        return (0.0, item["y0"], item["x0"])
                    if item["y0"] >= bottom - 2:
                        return (3.0, item["y0"], item["x0"])
                    return (1.5, item["y0"], item["x0"])

                page_items.sort(key=order_key)
                for item in page_items:
                    if item["kind"] == "text":
                        sizes.append((item["size"], len(item["plain"])))
                        payload = {
                            "y0": item["y0"], "y1": item["y1"], "page": page_number,
                            "size": item["size"], "text": item["text"],
                            "lines": item["lines"], "inline": item["inline"],
                            "col": item["col"], "plain": item["plain"],
                            "x0": item["x0"], "x1": item["x1"],
                            "left_margin": item.get("left_margin", item["x0"]),
                        }
                        items.append(("text", payload))
                    elif item["kind"] == "formula":
                        page_no, formula_bbox, source_text, width_em = item["payload"]
                        cropped = _crop_region(document, page_no, formula_bbox, dpi=240, padding=0)
                        if cropped:
                            items.append((
                                "formula",
                                (_register_image(images, image_dir, cropped), source_text, width_em),
                            ))
                    elif item["kind"] == "table":
                        items.append(("table", item["payload"]))
                    else:
                        data, _extension = _shrink_image(item["payload"])
                        items.append(("image", _register_image(images, image_dir, data)))


            body = _body_size(sizes)
            blocks: list[Block] = []
            pending: int | None = None
            code_buffer: list[str] | None = None
            last_bottom = 0.0
            last_page = 0
            last_col = -1
            last_x0 = 0.0
            references_mode = chapter.keep_source
            for kind, payload in items:
                if kind == "formula":
                    image_name, source_text, width_em = payload
                    blocks.append(
                        Block(
                            "formula", image_name=image_name,
                            source_text=source_text, width_em=width_em,
                        )
                    )
                    pending = None
                    continue
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
                plain = data.get("plain") or text
                inline = data.get("inline") or {}
                size = data["size"]
                lines = data["lines"]
                stripped = plain.strip()
                x0, y0 = data.get("x0", 0.0), data["y0"]
                x1, y1 = data.get("x1", 0.0), data["y1"]
                if re.fullmatch(
                    r"(?i)\s*(references|bibliography|works cited|参考文献|參考文獻)\s*",
                    stripped,
                ):
                    # A reference section can share its start page with the
                    # conclusion, so the TOC entry never becomes a chapter.
                    references_mode = True
                    blocks.append(Block("h2", text=text, size=size, inline_images=inline))
                    pending = None
                    last_bottom = y1
                    last_page = data["page"]
                    last_col = data["col"]
                    continue
                if references_mode:
                    joined = False
                    numbered = bool(
                        re.match(r"^\s*(?:\[\d+\]|\d{1,3}[.)])\s+", text)
                    )
                    margin = data.get("left_margin", x0)
                    contents = bool(CONTENTS_RE.match(chapter.title.strip()))
                    starts_entry = numbered or contents or x0 <= margin + 2
                    if pending is not None and not starts_entry:
                        previous = blocks[pending]
                        same_page = data["page"] == last_page
                        same_column = data["col"] == last_col
                        hyphenated = previous.text.rstrip().endswith("-") and (
                            text[:1].islower() or text[:1].isupper()
                        )
                        if (same_page and same_column) or not same_page or hyphenated:
                            previous.text = _merge_text(previous.text, text)
                            last_bottom = y1
                            last_page = data["page"]
                            last_col = data["col"]
                            last_x0 = x0
                            joined = True
                    if not joined:
                        blocks.append(Block("reference", text=text, size=size))
                        pending = len(blocks) - 1
                        last_bottom = y1
                        last_page = data["page"]
                        last_col = data["col"]
                        last_x0 = x0
                    continue
                if (
                    code_buffer is None
                    and not inline
                    and not _is_footnote(plain)
                    and _looks_like_formula(plain)
                ):
                    try:
                        crop = document[data["page"] - 1].get_pixmap(
                            clip=fitz.Rect(x0 - 2, y0 - 2, x1 + 2, y1 + 2), dpi=200,
                        )
                        payload_bytes = crop.tobytes("png")
                        name = f"img-{hashlib.sha1(payload_bytes).hexdigest()[:16]}.png"
                        if name not in images:
                            images[name] = payload_bytes
                            (image_dir / name).write_bytes(payload_bytes)
                        blocks.append(Block(
                            "formula", image_name=name,
                            width_em=(x1 - x0) / max(1.0, body),
                        ))
                        pending = None
                        continue
                    except Exception:
                        pass
                if code_buffer is not None:
                    if _code_line(stripped) or _looks_like_code(lines, plain):
                        code_buffer.extend(line.rstrip() for line in lines)
                        continue
                    blocks.append(Block("code", text="\n".join(code_buffer)))
                    code_buffer = None
                    pending = None
                if re.match(r"^\s*(algorithm|算法)\s*\d+", stripped, re.IGNORECASE):
                    code_buffer = [line.rstrip() for line in lines]
                    pending = None
                    continue
                if _looks_like_code(lines, plain):
                    blocks.append(Block("code", text="\n".join(line.rstrip() for line in lines)))
                    pending = None
                    continue
                if _is_footnote(plain):
                    blocks.append(Block("footnote", text=text, size=size, inline_images=inline))
                    continue
                if _is_numbered_heading(stripped):
                    blocks.append(Block("h2", text=text.strip(), size=size, inline_images=inline))
                    pending = None
                    continue
                if _is_section_heading(stripped):
                    blocks.append(Block("h2", text=text, size=size, inline_images=inline))
                    pending = None
                    continue
                heading = _heading_kind(size, body, stripped)
                if heading != "p":
                    if (
                        blocks
                        and blocks[-1].kind == heading
                        and data["page"] == last_page
                        and data["col"] == last_col
                        and y0 - last_bottom < size * 1.5
                    ):
                        blocks[-1].text = _merge_text(blocks[-1].text, text)
                        blocks[-1].size = max(blocks[-1].size, size)
                        if inline:
                            if blocks[-1].inline_images is None:
                                blocks[-1].inline_images = {}
                            blocks[-1].inline_images.update(inline)
                        last_bottom = y1
                        continue
                    blocks.append(Block(heading, text=text, size=size, inline_images=inline))
                    pending = None
                    last_bottom = y1
                    last_page = data["page"]
                    last_col = data["col"]
                    continue
                joined = False
                if pending is not None:
                    previous = blocks[pending]
                    same_page = data["page"] == last_page
                    same_column = data["col"] == last_col
                    gap = y0 - last_bottom
                    indented = x0 > last_x0 + size * 0.8
                    hyphenated = previous.text.rstrip().endswith("-") and (
                        text[:1].islower() or text[:1].isupper()
                    )
                    tight = gap < size * 0.8
                    continuous = (
                        same_page
                        and same_column
                        and gap < max(8.0, size * 1.6)
                        and (tight or not _ends_sentence(previous.text))
                        and not (indented and _ends_sentence(previous.text))
                    )
                    if hyphenated or continuous:
                        previous.text = _merge_text(previous.text, text)
                        previous.size = max(previous.size, size)
                        if inline:
                            if previous.inline_images is None:
                                previous.inline_images = {}
                            previous.inline_images.update(inline)
                        last_bottom = y1
                        last_page = data["page"]
                        last_col = data["col"]
                        last_x0 = x0
                        joined = True
                if not joined:
                    blocks.append(Block("p", text=text, size=size, inline_images=inline))
                    pending = len(blocks) - 1
                    last_bottom = y1
                    last_page = data["page"]
                    last_col = data["col"]
                    last_x0 = x0
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
    result: dict[int, str] = {}
    if isinstance(payload, list):
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
        if result:
            return result
    # Salvage item objects from a reply with broken JSON syntax (trailing
    # commas, unescaped quotes) instead of discarding the whole batch.
    for match in re.finditer(
        r'"id"\s*:\s*(\d+)[^{}]*?"(?:output|translation|text)"\s*:\s*'
        r'"((?:[^"\\]|\\.)*)"',
        reply,
        re.S,
    ):
        try:
            text = json.loads(f'"{match.group(2)}"')
        except ValueError:
            continue
        if text.strip():
            result[int(match.group(1))] = text.strip()
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
                missing = [item for item in items if item["id"] not in parsed]
                if missing and depth < 2:
                    # The model dropped items (usually output truncation);
                    # translate only the remainder instead of the whole batch.
                    parsed.update(
                        _translate_batch(missing, base_url, api_key, model, extra, depth + 1)
                    )
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


def _needs_translation(original: str, translated: str) -> bool:
    """Detect an item the model skipped, echoed or only half-translated."""
    if not translated.strip():
        return True
    original_latin = len(re.findall(r"[A-Za-z]", original))
    if original_latin < 8:
        return False
    cjk = len(re.findall(r"[\u4e00-\u9fff]", translated))
    latin = len(re.findall(r"[A-Za-z]", translated))
    if cjk == 0:
        return True
    if latin > cjk * 2 and latin > 80:
        return True
    for run in re.findall(r"(?:[A-Za-z][A-Za-z'’-]*[ ,;]+){5,}[A-Za-z][A-Za-z'’-]*", translated):
        if run.lower() in original.lower():
            return True
    return False


MARKDOWN_SEPARATOR_RE = re.compile(
    r"^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$"
)


def _markdown_table(text: str) -> tuple[str, list[list[str]], str] | None:
    """Extract a Markdown table the translation model emitted as prose."""
    lines = text.splitlines()
    separator = None
    for index, line in enumerate(lines):
        if MARKDOWN_SEPARATOR_RE.match(line):
            separator = index
            break
    if separator is None or separator == 0 or "|" not in lines[separator - 1]:
        return None

    def cells(line: str) -> list[str]:
        return [part.strip() for part in line.strip().strip("|").split("|")]

    start = separator - 1
    end = separator + 1
    while end < len(lines) and "|" in lines[end] and lines[end].strip():
        end += 1
    rows = [cells(lines[start])]
    for line in lines[separator + 1:end]:
        rows.append(cells(line))
    width = max(len(row) for row in rows)
    rows = [row + [""] * (width - len(row)) for row in rows]
    before = "\n".join(lines[:start]).strip()
    after = "\n".join(lines[end:]).strip()
    return before, rows, after


def _normalize_markdown_tables(extract: BookExtract) -> None:
    """Turn model-emitted Markdown tables back into real table blocks."""
    for chapter in extract.chapters:
        if not chapter.blocks:
            continue
        blocks: list[Block] = []
        for block in chapter.blocks:
            if block.kind in ("p", "figcaption") and "\n" in block.text and "|" in block.text:
                parsed = _markdown_table(block.text)
                if parsed:
                    before, rows, after = parsed
                    if before:
                        blocks.append(Block(
                            "figcaption" if CAPTION_RE.match(before) else "p",
                            text=before, size=block.size,
                            inline_images=block.inline_images,
                        ))
                    blocks.append(Block(
                        "table", rows=rows, header=True,
                        inline_images=block.inline_images,
                    ))
                    if after:
                        blocks.append(Block(
                            "p", text=after, size=block.size,
                            inline_images=block.inline_images,
                        ))
                    continue
            blocks.append(block)
        chapter.blocks = blocks


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
            if block.kind in ("image", "code", "reference"):
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
            translated = result.get(index) or ""
            if _needs_translation(chapter.title, translated):
                retry = _translate_batch(
                    [{"id": 0, "input": chapter.title}], base_url, api_key, model, extra,
                )
                translated = retry.get(0) or next(iter(retry.values()), "") or translated
            chapter.translated_title = translated or chapter.title
        advance(len(titles))

    for block in formulas:
        if canceled and canceled():
            raise BookFailure("canceled")
        if deadline is not None and time.monotonic() > deadline:
            raise BookFailure("engine_timeout")
        image = extract.images.get(block.image_name)
        if image:
            latex = _vision_latex(image, base_url, api_key, model, extra)
            if latex and _latex_plausible(latex, block.source_text):
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
            if batch and (len(batch) >= 12 or used + len(block.text) > 4000):
                break
            pending.pop(0)
            batch.append(block)
            items.append({"id": len(batch) - 1, "input": block.text})
            used += len(block.text)
        result = _translate_batch(items, base_url, api_key, model, extra)
        if len(result) < len(batch):
            print(
                f"translation: batch returned {len(result)}/{len(batch)} paragraphs",
                flush=True,
            )
        retry: list[tuple[Block, str]] = []
        for identifier, block in enumerate(batch):
            original = block.text
            translated = result.get(identifier) or ""
            candidate = _restore_inline_math(translated, block.inline_map) if translated else ""
            if candidate:
                block.text = candidate
            if not candidate or _needs_translation(original, candidate):
                retry.append((block, original))
        for block, original in retry:
            if canceled and canceled():
                raise BookFailure("canceled")
            single = _translate_batch(
                [{"id": 0, "input": original}], base_url, api_key, model, extra,
            )
            translated = single.get(0) or next(iter(single.values()), "") or ""
            if translated:
                candidate = _restore_inline_math(translated, block.inline_map)
                if not _needs_translation(original, candidate):
                    block.text = candidate
        if retry:
            still_english = sum(
                1 for block, original in retry if _needs_translation(original, block.text)
            )
            print(
                f"translation: retried {len(retry)} skipped paragraphs, "
                f"{still_english} still untranslated",
                flush=True,
            )
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

    _normalize_markdown_tables(extract)


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
            + "".join(
                f'<{cell_tag}>{_inline_html(cell, block)}</{cell_tag}>'
                for cell in row
            )
            + "</tr>"
        )
    parts.append("</table>")
    return "".join(parts)


INLINE_IMAGE_TOKEN_RE = re.compile(r"⟦I(\d+)⟧")


def _inline_html(text: str, block) -> str:
    """Render ⟦I<n>⟧ inline-formula tokens as cropped images."""
    mapping = block.inline_images or {}
    if not mapping or "⟦I" not in text:
        return html.escape(text)
    parts = []
    cursor = 0
    for match in INLINE_IMAGE_TOKEN_RE.finditer(text):
        parts.append(html.escape(text[cursor:match.start()]))
        entry = mapping.get(int(match.group(1)))
        if entry:
            name, height, descent = entry
            parts.append(
                f'<img class="inl" src="../images/{name}" alt="" '
                f'style="height:{height:.2f}em;vertical-align:{-descent:.2f}em"/>'
            )
        cursor = match.end()
    parts.append(html.escape(text[cursor:]))
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
                style = (
                    f' style="width:{block.width_em * 1.15:.2f}em"'
                    if block.width_em > 0 else ""
                )
                parts.append(
                    f'<figure class="formula"><img src="../images/{block.image_name}"'
                    f'{style} alt=""/></figure>'
                )
        elif block.kind == "table":
            parts.append(_table_xhtml(block))
        elif block.kind == "reference":
            parts.append(f'<p class="reference">{_inline_html(block.text, block)}</p>')
        elif block.kind == "h1":
            parts.append(f"<h2>{_inline_html(block.text, block)}</h2>")
        elif block.kind == "h2":
            parts.append(f"<h3>{_inline_html(block.text, block)}</h3>")
        elif block.kind == "figcaption":
            parts.append(f'<p class="caption">{_inline_html(block.text, block)}</p>')
        elif block.kind == "code":
            parts.append(f'<pre class="code">{html.escape(block.text)}</pre>')
        elif block.kind == "footnote":
            parts.append(f'<p class="footnote">{_inline_html(block.text, block)}</p>')
        else:
            parts.append(f"<p>{_inline_html(block.text, block)}</p>")
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
    ".reference{text-indent:-1.4em;padding-left:1.4em;margin:.2em 0;"
    "line-height:1.45;word-break:break-word;}"
    "pre.code{white-space:pre-wrap;font-family:monospace;font-size:.82em;"
    "line-height:1.45;background:#f6f6f6;padding:.6em;border-radius:.3em;}"
    ".figure{text-align:center;margin:1em 0;}"
    ".formula{text-align:center;margin:1em 0;}"
    "img{max-width:90%;max-height:50vh;height:auto;object-fit:contain;}"
    ".formula img{max-height:none;max-width:100%;}"
    "img.inl{max-width:none;max-height:none;height:auto;margin:0 .06em;"
    "vertical-align:middle;}"
    ".math{margin:1em 0;text-align:center;overflow-x:auto;font-size:1.1em;}"
    "table.data{border-collapse:collapse;width:100%;font-size:.9em;margin:1em 0;}"
    "table.data th,table.data td{border:1px solid #bbb;padding:.35em .5em;"
    "text-align:left;vertical-align:top;}"
)
