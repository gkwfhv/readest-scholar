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
    def test_extraction_checkpoint_runs_after_each_page(self):
        checkpoints = []
        with tempfile.TemporaryDirectory() as folder:
            bp.extract_book(
                make_book_pdf(pages=4, sections=3),
                Path(folder),
                checkpoint=lambda _fraction: checkpoints.append(True),
            )
        self.assertEqual(len(checkpoints), 4)

    def test_chapters_follow_bookmarks_and_references_keep_source(self):
        with tempfile.TemporaryDirectory() as folder:
            extract = bp.extract_book(make_book_pdf(), Path(folder))
        self.assertGreaterEqual(len(extract.chapters), 3)
        self.assertEqual(extract.chapters[0].start_page, 1)
        references = [chapter for chapter in extract.chapters if chapter.title == "References"]
        self.assertEqual(len(references), 1)
        self.assertTrue(references[0].keep_source)
        self.assertTrue(any(block.text for chapter in extract.chapters for block in chapter.blocks))

    def test_inline_math_placeholders_survive_translation(self):
        masked, mapping = bp._protect_inline_math("We optimize x_i and ℓ_2 here.")
        self.assertIn("⟦M1⟧", masked)
        self.assertIn("⟦M2⟧", masked)
        restored = bp._restore_inline_math(masked.replace("⟦M1⟧", "x_i"), mapping)
        self.assertIn("x_i", restored)
        self.assertIn("ℓ_2", restored)

    def test_inline_math_runs_group_subscripts_into_one_image(self):
        def span(text, x0, x1, y0, y1, math):
            return {
                "text": text, "bbox": (x0, y0, x1, y1), "size": 10.0,
                "origin": (x0, y1 - 2.0), "font": "CMMI10" if math else "Body",
                "math": math,
            }

        spans = [
            span("memory ", 0, 50, 100, 110, False),
            span("M", 50, 58, 100, 110, True),
            span("1:", 58, 63, 103, 111, True),
            span("T", 63, 68, 103, 111, True),
            span(" here", 68, 90, 100, 110, False),
        ]
        runs = bp._inline_runs(spans)
        self.assertEqual(len(runs), 1)
        self.assertEqual("".join(item["text"] for item in runs[0]), "M1:T")

    def test_latex_validation_rejects_truncated_transcription(self):
        source = "theta_j(x') = alpha, j = 0 (null task) m"
        self.assertTrue(bp._latex_plausible(r"\theta_j(x')=\alpha,\ j=0\ (\text{null task})", source))
        self.assertFalse(bp._latex_plausible(r"\theta_j(x')", source))
        self.assertFalse(
            bp._latex_plausible(r"R^* = *\arg\min_R |R|,", "R∗ = argmin|R|, (2)")
        )

    def test_formula_filter_box_includes_the_equation_number(self):
        region = (138.0, 715.0, 214.0, 739.0)
        rows = [
            {"bbox": (140.0, 716.0, 298.0, 729.0)},  # equation + (2)
            {"bbox": (313.0, 720.0, 558.0, 730.0)},  # unrelated other column
        ]
        boxes = bp._formula_filter_boxes(rows, [region])
        self.assertEqual(boxes[0][2], 298.0)
        self.assertEqual(boxes[0][0], 140.0)

    def test_missing_or_echoed_translations_are_detected(self):
        original = "Robots are increasingly deployed across indoor environments and warehouses."
        self.assertTrue(bp._needs_translation(original, ""))
        self.assertTrue(bp._needs_translation(original, original))
        self.assertFalse(bp._needs_translation(original, "机器人正越来越多地部署在室内环境和仓库中。"))
        half = "机器人部署在仓库中。" + original
        self.assertTrue(bp._needs_translation(original, half))

    def test_inline_tokens_render_as_images(self):
        block = bp.Block(
            "p", text="能量 ⟦I1⟧ 与 ⟦I2⟧ 的关系",
            inline_images={1: ("a.png", 1.0, 0.2), 2: ("b.png", 0.8, 0.1)},
        )
        rendered = bp._inline_html(block.text, block)
        self.assertIn('<img class="inl" src="../images/a.png"', rendered)
        self.assertIn("height:1.00em;vertical-align:-0.20em", rendered)
        self.assertIn("能量", rendered)

    def test_markdown_table_from_model_becomes_a_real_table(self):
        text = (
            "Table I: comparison.\n\n"
            "| Task | Method | SR |\n"
            "| :--- | :--- | :--- |\n"
            "| Spat. | OpenGraph | 0.68 |\n"
            "|  | STaR | 0.89 |\n\n"
            "Trailing prose."
        )
        parsed = bp._markdown_table(text)
        self.assertIsNotNone(parsed)
        before, rows, after = parsed
        self.assertEqual(before, "Table I: comparison.")
        self.assertEqual(rows[0], ["Task", "Method", "SR"])
        self.assertEqual(len(rows), 3)
        self.assertEqual(after, "Trailing prose.")

        from book_pipeline import Block, BookExtract, Chapter

        extract = BookExtract(
            title="T", author="", images={},
            chapters=[Chapter("Chapter", 1, 1, blocks=[Block("p", text=text)])],
        )
        bp._normalize_markdown_tables(extract)
        kinds = [block.kind for block in extract.chapters[0].blocks]
        self.assertEqual(kinds, ["p", "table", "p"])
        self.assertEqual(extract.chapters[0].blocks[1].rows[1][0], "Spat.")

    def test_references_are_split_one_entry_per_paragraph(self):
        document = fitz.open()
        first = document.new_page(width=595, height=842)
        first.insert_text((72, 100), "Introduction body text.", fontsize=10)
        page = document.new_page(width=595, height=842)
        page.insert_text((72, 100), "REFERENCES", fontsize=12)
        page.insert_text((72, 140), "[1] Alpha reference starts here", fontsize=10)
        page.insert_text((86, 155), "and continues on this line.", fontsize=10)
        page.insert_text((72, 175), "[2] Beta reference.", fontsize=10)
        document.set_toc([[1, "Introduction", 1], [1, "References", 2]])
        with tempfile.TemporaryDirectory() as folder:
            extract = bp.extract_book(document.tobytes(), Path(folder))
        chapter = [item for item in extract.chapters if item.title == "References"][0]
        references = [block for block in chapter.blocks if block.kind == "reference"]
        self.assertEqual(len(references), 2)
        self.assertIn("continues on this line", references[0].text)
        self.assertTrue(references[1].text.startswith("[2]"))

    def test_ruled_table_becomes_a_table_block(self):
        document = fitz.open()
        page = document.new_page(width=595, height=842)
        for x in (72, 240, 408):
            page.draw_line(fitz.Point(x, 100), fitz.Point(x, 180))
        for y in (100, 130, 160, 180):
            page.draw_line(fitz.Point(72, y), fitz.Point(408, y))
        page.insert_text((80, 120), "Method", fontsize=10)
        page.insert_text((248, 120), "Score", fontsize=10)
        page.insert_text((80, 150), "Ours", fontsize=10)
        page.insert_text((248, 150), "62.5", fontsize=10)
        document.set_toc([[1, "Chapter", 1]])
        with tempfile.TemporaryDirectory() as folder:
            extract = bp.extract_book(document.tobytes(), Path(folder))
        tables = [
            block
            for chapter in extract.chapters
            for block in chapter.blocks
            if block.kind == "table"
        ]
        self.assertEqual(len(tables), 1)
        self.assertGreaterEqual(len(tables[0].rows or []), 2)
        self.assertIn("Method", tables[0].rows[0])

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

    def test_inline_math_and_table_cells_are_translated(self):
        from book_pipeline import Block, BookExtract, Chapter

        extract = BookExtract(
            title="T", author="", images={},
            chapters=[Chapter("Chapter", 1, 1)],
        )
        extract.chapters[0].blocks = [
            Block("p", text="We optimize x_i and ℓ_2 here."),
            Block("table", rows=[["Method", "Score"], ["Ours", "62.5"]], header=True),
        ]
        seen: list[str] = []

        def fake_chat(base_url, api_key, payload, timeout=120):
            items = json.loads(payload["messages"][1]["content"].split("Items:\n", 1)[1])
            seen.extend(item["input"] for item in items)
            return json.dumps(
                {"items": [{"id": item["id"], "output": "译:" + item["input"]} for item in items]}
            )

        with patch.object(bp, "_chat", side_effect=fake_chat), patch.object(
            bp, "_thinking_payload", return_value={}
        ):
            bp.translate_book(
                extract, base_url="https://model.test/v1", api_key="k", model="m",
                renew=lambda fraction: None,
            )
        paragraph = extract.chapters[0].blocks[0]
        self.assertIn("x_i", paragraph.text)
        self.assertIn("ℓ_2", paragraph.text)
        self.assertTrue(any("⟦M1⟧" in item for item in seen))
        rows = extract.chapters[0].blocks[1].rows
        self.assertEqual(rows[0][0], "译:Method")

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

    def test_formula_image_keeps_natural_text_scale(self):
        from book_pipeline import Block, Chapter

        chapter = Chapter("C", 1, 1)
        chapter.blocks = [Block("formula", image_name="f.png", width_em=20.0)]
        xhtml = bp._chapter_xhtml(1, chapter)
        self.assertIn('style="width:23.00em"', xhtml)

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
