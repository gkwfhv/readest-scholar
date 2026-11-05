import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

import fitz

import book_pipeline as bp


def make_book_pdf(pages: int = 6, sections: int = 5) -> bytes:
    document = fitz.open()
    for index in range(pages):
        page = document.new_page(width=595, height=842)
        body = (
            "This is a dense paragraph of book prose that explains an idea in detail. "
            "It continues for several lines so the extractor sees a real text block. "
        ) * 8
        page.insert_text((72, 100), body, fontsize=10, fontname="helv")
        page.insert_text((72, 780), str(index + 1), fontsize=9, fontname="helv")
    toc = [[1, f"Section {index + 1}", index + 1] for index in range(min(sections, pages - 1))]
    toc.append([1, "References", pages])
    document.set_toc(toc)
    return document.tobytes()


def make_many_bookmarks_pdf(pages: int) -> bytes:
    document = fitz.open()
    for index in range(pages):
        page = document.new_page(width=595, height=842)
        page.insert_text((72, 100), f"Page {index + 1} body text.", fontsize=10)
    document.set_toc([[1, f"Section {index + 1}", 1] for index in range(24)])
    return document.tobytes()


def make_image_pdf() -> bytes:
    document = fitz.open()
    page = document.new_page(width=595, height=842)
    pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 240, 180), False)
    pix.clear_with(0x80)
    page.insert_image(fitz.Rect(100, 100, 340, 280), stream=pix.tobytes("png"))
    page.insert_text((100, 320), "Figure 1. A synthetic illustration.", fontsize=10)
    page.insert_text((100, 360), "Body paragraph after the figure.", fontsize=10)
    document.set_toc([[1, "Chapter", 1]])
    return document.tobytes()


class ClassifyTests(unittest.TestCase):
    def test_bookmarks_make_a_book(self):
        self.assertEqual(bp.classify_pdf(make_many_bookmarks_pdf(120)), "book")

    def test_many_bookmarks_do_not_turn_a_short_paper_into_a_book(self):
        self.assertEqual(bp.classify_pdf(make_many_bookmarks_pdf(10)), "paper")

    def test_short_document_without_bookmarks_is_a_paper(self):
        document = fitz.open()
        page = document.new_page(width=595, height=842)
        page.insert_text((72, 100), "Short abstract only.", fontsize=10)
        self.assertEqual(bp.classify_pdf(document.tobytes()), "paper")


class ExtractTests(unittest.TestCase):
    def test_chapters_follow_bookmarks_and_references_keep_source(self):
        with tempfile.TemporaryDirectory() as folder:
            extract = bp.extract_book(make_book_pdf(), Path(folder))
        self.assertGreaterEqual(len(extract.chapters), 3)
        self.assertEqual(extract.chapters[0].start_page, 1)
        references = [chapter for chapter in extract.chapters if chapter.title == "References"]
        self.assertEqual(len(references), 1)
        self.assertTrue(references[0].keep_source)
        self.assertTrue(any(block.text for chapter in extract.chapters for block in chapter.blocks))

    def test_display_equations_are_kept_as_images(self):
        document = fitz.open()
        page = document.new_page(width=595, height=842)
        page.insert_text((72, 120), "f(x) = (a + b) / (c - d) * sum(x_i, i=1..n)", fontsize=11)
        page.insert_text(
            (72, 160), "Normal running prose about the method and its results.", fontsize=11
        )
        document.set_toc([[1, "Chapter", 1]])
        with tempfile.TemporaryDirectory() as folder:
            extract = bp.extract_book(document.tobytes(), Path(folder))
        blocks = [block for chapter in extract.chapters for block in chapter.blocks]
        self.assertTrue(any(block.kind == "formula" for block in blocks))
        self.assertTrue(any(block.kind == "p" for block in blocks))

    def test_images_are_extracted_and_captions_marked(self):
        with tempfile.TemporaryDirectory() as folder:
            work = Path(folder)
            extract = bp.extract_book(make_image_pdf(), work)
            blocks = [block for chapter in extract.chapters for block in chapter.blocks]
            images = [block for block in blocks if block.kind == "image"]
            captions = [block for block in blocks if block.kind == "figcaption"]
            self.assertEqual(len(images), 1)
            self.assertEqual(len(captions), 1)
            self.assertTrue((work / "images" / images[0].image_name).is_file())
            self.assertTrue(extract.images)


class TranslationTests(unittest.TestCase):
    def setUp(self):
        sleep = patch.object(bp.time, "sleep")
        sleep.start()
        self.addCleanup(sleep.stop)

    def _extract(self):
        with tempfile.TemporaryDirectory() as folder:
            extract = bp.extract_book(make_book_pdf(pages=4, sections=3), Path(folder))
        return extract

    def test_batches_translate_blocks_and_titles(self):
        extract = self._extract()
        calls = []

        def fake_chat(base_url, api_key, payload, timeout=120):
            items = json.loads(payload["messages"][1]["content"].split("Items:\n", 1)[1])
            calls.append(items)
            return json.dumps(
                {"items": [{"id": item["id"], "output": f"译:{item['input'][:20]}"}
                           for item in items]},
                ensure_ascii=False,
            )

        with patch.object(bp, "_chat", side_effect=fake_chat), patch.object(
            bp, "_thinking_payload", return_value={}
        ):
            bp.translate_book(
                extract,
                base_url="https://model.test/v1",
                api_key="k",
                model="m",
                renew=lambda fraction: None,
            )
        self.assertTrue(calls)
        translated = [
            block
            for chapter in extract.chapters
            if not chapter.keep_source
            for block in chapter.blocks
            if block.text
        ]
        self.assertTrue(all(block.text.startswith("译:") for block in translated))
        self.assertTrue(extract.chapters[0].translated_title.startswith("译:"))

    def test_json_drift_splits_the_batch(self):
        extract = self._extract()

        def fake_chat(base_url, api_key, payload, timeout=120):
            items = json.loads(payload["messages"][1]["content"].split("Items:\n", 1)[1])
            if len(items) > 1:
                return "not json at all"
            item = items[0]
            return json.dumps({"items": [{"id": item["id"], "output": "单条译文"}]})

        with patch.object(bp, "_chat", side_effect=fake_chat), patch.object(
            bp, "_thinking_payload", return_value={}
        ):
            bp.translate_book(
                extract,
                base_url="https://model.test/v1",
                api_key="k",
                model="m",
                renew=lambda fraction: None,
            )
        texts = [
            block.text
            for chapter in extract.chapters
            if not chapter.keep_source
            for block in chapter.blocks
            if block.text
        ]
        self.assertTrue(any(text == "单条译文" for text in texts))

    def test_cancel_and_deadline_raise_failures(self):
        extract = self._extract()
        with self.assertRaises(bp.BookFailure) as canceled:
            bp.translate_book(
                extract,
                base_url="https://model.test/v1",
                api_key="k",
                model="m",
                renew=lambda fraction: None,
                canceled=lambda: True,
            )
        self.assertEqual(canceled.exception.code, "canceled")
        with self.assertRaises(bp.BookFailure) as timeout:
            bp.translate_book(
                extract,
                base_url="https://model.test/v1",
                api_key="k",
                model="m",
                renew=lambda fraction: None,
                deadline=0,
            )
        self.assertEqual(timeout.exception.code, "engine_timeout")


class EpubTests(unittest.TestCase):
    def _build(self):
        folder = tempfile.mkdtemp()
        self.addCleanup(lambda: __import__("shutil").rmtree(folder, ignore_errors=True))
        work = Path(folder)
        extract = bp.extract_book(make_image_pdf(), work)
        for chapter in extract.chapters:
            chapter.translated_title = "第一章"
            for block in chapter.blocks:
                if block.text:
                    block.text = "中文段落"
        out = work / "book.epub"
        bp.build_epub(work, extract, out, "job-1")
        return out

    def test_epub_layout_and_inspection(self):
        out = self._build()
        with zipfile.ZipFile(out) as archive:
            entries = archive.infolist()
            self.assertEqual(entries[0].filename, "mimetype")
            self.assertEqual(entries[0].compress_type, zipfile.ZIP_STORED)
            self.assertEqual(archive.read("mimetype"), b"application/epub+zip")
            names = {entry.filename for entry in entries}
            self.assertIn("META-INF/container.xml", names)
            self.assertIn("OEBPS/content.opf", names)
            self.assertIn("OEBPS/nav.xhtml", names)
            self.assertIn("OEBPS/text/chapter-001.xhtml", names)
            self.assertTrue(any(name.startswith("OEBPS/images/") for name in names))
            nav = archive.read("OEBPS/nav.xhtml").decode("utf-8")
            self.assertIn("第一章", nav)
            opf = archive.read("OEBPS/content.opf").decode("utf-8")
            self.assertIn('href="nav.xhtml"', opf)
            self.assertIn('href="text/chapter-001.xhtml"', opf)
            self.assertNotIn('href="OEBPS/', opf)
        metadata = bp.inspect_epub(out, 1)
        self.assertEqual(metadata["pageCount"], 1)
        self.assertEqual(len(metadata["sha256"]), 64)

    def test_epub_must_start_with_stored_mimetype(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("mimetype", "application/epub+zip")
            archive.writestr("META-INF/container.xml", "<container/>")
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "bad.epub"
            path.write_bytes(buffer.getvalue())
            with self.assertRaises(bp.BookFailure):
                bp.inspect_epub(path, 1)


if __name__ == "__main__":
    unittest.main()
