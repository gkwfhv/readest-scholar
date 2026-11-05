"""Text-extraction book translation: PDF -> Chinese EPUB.

The pdf2zh pipeline reflows text inside the original PDF boxes, which suits
papers but breaks book layouts (printed TOC, margin notes, running headers).
This module extracts readable text in chapter order, translates it in batches
through the same OpenAI-compatible model, and assembles a standalone EPUB.
It only uses the standard library plus PyMuPDF.
"""
from __future__ import annotations

import hashlib
import html
import json
import re
import time
import urllib.error
import urllib.request
import uuid
import zipfile
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
    "covering every id. Do not return prose, Markdown or code fences."
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
    kind: str  # p | h1 | h2 | figcaption | image
    text: str = ""
    image_name: str = ""
    size: float = 0.0


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
    if len(toc) >= 20:
        return "book"
    if len(toc) >= 6 and per_page > 1200:
        return "book"
    return "paper"


def _body_size(sizes: list[float]) -> float:
    if not sizes:
        return 10.0
    counts: dict[float, int] = {}
    for size in sizes:
        key = round(size * 2) / 2
        counts[key] = counts.get(key, 0) + 1
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


def _two_column(page, width: float) -> bool:
    blocks = [
        block
        for block in page.get_text("dict").get("blocks", [])
        if block.get("type") == 0 and (block.get("bbox") or (0, 0, 0, 0))[2] > 0
    ]
    if len(blocks) < 6:
        return False
    left = sum(1 for block in blocks if (block["bbox"][0] + block["bbox"][2]) / 2 < width / 2)
    return 0.25 * len(blocks) <= left <= 0.75 * len(blocks)


def _sorted_text_blocks(page, width: float) -> list[tuple[float, float, float, str, float]]:
    """Return (y0, x0, y1, text, size) in reading order."""
    entries = []
    for block in page.get_text("dict").get("blocks", []):
        if block.get("type") != 0:
            continue
        lines = block.get("lines") or []
        text = "\n".join(
            "".join(span.get("text", "") for span in line.get("spans", []))
            for line in lines
        ).strip()
        if not text:
            continue
        bbox = block.get("bbox") or (0, 0, 0, 0)
        size = max(
            (float(span.get("size") or 0) for line in lines for span in line.get("spans", [])),
            default=0.0,
        )
        entries.append((bbox[1], bbox[0], bbox[3], text, size))
    if _two_column(page, width):
        entries.sort(key=lambda item: (0 if item[1] < width / 2 else 1, round(item[0] / 6), item[1]))
    else:
        entries.sort(key=lambda item: (round(item[0] / 6), item[1]))
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
        title = metadata.get("title") or "Untitled"
        author = metadata.get("author") or ""
        toc = [
            (int(level), str(name), int(page))
            for level, name, page in (document.get_toc(simple=True) or [])
            if page and 1 <= int(page) <= total
        ]
        # Parts and chapters (levels 1-2) make usable EPUB chapters; deeper
        # headings stay inside a chapter and are detected from font size.
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
            chapters.append(Chapter(title, 1, total))

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
                text_blocks = [
                    item
                    for item in _sorted_text_blocks(page, width)
                    if not _is_furniture(item[3], item[0], item[2], height)
                ]
                pictures = []
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
                        pictures.append((bbox[1], data))
                pictures.sort(key=lambda item: item[0])
                merged: list[tuple[float, int, object]] = [
                    (item[0], 0, item) for item in text_blocks
                ] + [(item[0], 1, item) for item in pictures]
                merged.sort(key=lambda item: (item[0], item[1]))
                for _, kind, payload in merged:
                    if kind == 1:
                        data = payload[1]
                        name = f"img-{hashlib.sha1(data).hexdigest()[:16]}.{_image_extension(data)}"
                        if name not in images:
                            images[name] = data
                            (image_dir / name).write_bytes(data)
                        items.append(("image", name))
                    else:
                        _, _, _, text, size = payload
                        sizes.append(size)
                        items.append(("text", (text, size)))

            body = _body_size(sizes)
            blocks: list[Block] = []
            for kind, payload in items:
                if kind == "image":
                    blocks.append(Block("image", image_name=str(payload)))
                else:
                    text, size = payload
                    blocks.append(Block(_heading_kind(size, body, text), text=text, size=size))
            for index, block in enumerate(blocks):
                if block.kind != "p" or not CAPTION_RE.match(block.text):
                    continue
                if index and blocks[index - 1].kind == "image":
                    block.kind = "figcaption"
            chapter.blocks = blocks

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
    pieces: list[Block] = [
        block
        for chapter in extract.chapters
        if not chapter.keep_source
        for block in chapter.blocks
        if block.kind != "image" and block.text.strip()
    ]
    total = len(pieces) + len(titles)
    if total == 0:
        return
    done = 0
    if titles:
        result = _translate_batch(
            [{"id": index, "input": chapter.title} for index, chapter in enumerate(titles)],
            base_url, api_key, model, extra,
        )
        for index, chapter in enumerate(titles):
            chapter.translated_title = result.get(index, chapter.title)
        done += len(titles)
        if renew:
            renew(done / total)

    pending = list(pieces)
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
                block.text = translated
        done += len(batch)
        if renew:
            renew(min(1.0, done / total))


def build_epub(work: Path, extract: BookExtract, out: Path, job_id: str) -> None:
    book_uuid = str(uuid.uuid5(uuid.NAMESPACE_URL, f"scholar-book:{job_id}"))
    title = extract.title or "Untitled"
    author = extract.author or ""
    chapters = [chapter for chapter in extract.chapters if chapter.blocks]
    manifest = [
        ("nav", "OEBPS/nav.xhtml", "application/xhtml+xml"),
        ("ncx", "OEBPS/toc.ncx", "application/x-dtbncx+xml"),
        ("css", "OEBPS/style.css", "text/css"),
    ]
    spine = []
    for index in range(1, len(chapters) + 1):
        item_id = f"chapter-{index:03d}"
        manifest.append((item_id, f"OEBPS/text/{item_id}.xhtml", "application/xhtml+xml"))
        spine.append(item_id)
    for image_name in extract.images:
        manifest.append((f"img-{image_name}", f"OEBPS/images/{image_name}", _media_type(image_name)))

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


def _chapter_xhtml(index: int, chapter) -> str:
    parts = []
    heading = chapter.translated_title or chapter.title
    if heading:
        parts.append(f"<h1>{html.escape(heading)}</h1>")
    for block in chapter.blocks:
        if block.kind == "image":
            parts.append(f'<div class="figure"><img src="../images/{block.image_name}" alt=""/></div>')
        elif block.kind == "h1":
            parts.append(f"<h2>{html.escape(block.text)}</h2>")
        elif block.kind == "h2":
            parts.append(f"<h3>{html.escape(block.text)}</h3>")
        elif block.kind == "figcaption":
            parts.append(f'<p class="caption">{html.escape(block.text)}</p>')
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
    ".figure{text-align:center;margin:1em 0;}img{max-width:100%;height:auto;}"
)
