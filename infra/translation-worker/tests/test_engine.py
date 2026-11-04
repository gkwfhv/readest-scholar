import unittest

from engine import (
    JSON_RESPONSE_SUFFIX,
    SCHOLAR_MAX_COMPLETION_TOKENS,
    apply_completion_token_limit,
    configure_openai_completion_limit,
    append_json_response_constraint,
    strengthen_pdf2zh_json_contract,
    unwrap_structured_reply,
)


class FallbackReplyTests(unittest.TestCase):
    def test_fenced_output_objects_become_prose(self):
        reply = '```json\n[{"id": 1, "output": "第一段。"}, {"id": 2, "output": "第二段。"}]\n```'
        self.assertEqual(unwrap_structured_reply(reply), "第一段。\n第二段。")

    def test_fenced_string_array_becomes_prose(self):
        reply = '```json\n["参考文献一。", "参考文献二。"]\n```'
        self.assertEqual(unwrap_structured_reply(reply), "参考文献一。\n参考文献二。")

    def test_echoed_input_schema_keeps_the_text(self):
        reply = '```json\n[{"id": "1", "text": "Y. Du et al. 2023."}]\n```'
        self.assertEqual(unwrap_structured_reply(reply), "Y. Du et al. 2023.")

    def test_plain_translation_is_untouched(self):
        self.assertEqual(unwrap_structured_reply("普通译文。"), "普通译文。")

    def test_unclosed_fence_is_stripped(self):
        self.assertEqual(
            unwrap_structured_reply('```json\n["第一段。"]'),
            "第一段。",
        )

    def test_invalid_json_is_kept_verbatim(self):
        reply = '["这不是 JSON'
        self.assertEqual(unwrap_structured_reply(reply), reply)


class EnginePromptContractTests(unittest.TestCase):
    def test_json_constraint_is_appended_once_after_the_pdf_input(self):
        template = "input: $json_input_str"
        strengthened = append_json_response_constraint(template)
        self.assertTrue(strengthened.endswith(JSON_RESPONSE_SUFFIX))
        self.assertEqual(
            append_json_response_constraint(strengthened),
            strengthened,
        )
        self.assertIn("every requested id", strengthened)

    def test_completion_limit_preserves_a_provider_override(self):
        self.assertEqual(
            apply_completion_token_limit({})["max_tokens"],
            SCHOLAR_MAX_COMPLETION_TOKENS,
        )
        self.assertEqual(
            apply_completion_token_limit({"max_tokens": 1024})["max_tokens"],
            1024,
        )

    def test_runtime_limit_patch_updates_request_options_once(self):
        class FakeTranslator:
            def __init__(self):
                self.options = {}
                self.cache_parameters = []

            def add_cache_impact_parameters(self, name, value):
                self.cache_parameters.append((name, value))

        configure_openai_completion_limit(FakeTranslator)
        patched_init = FakeTranslator.__init__
        configure_openai_completion_limit(FakeTranslator)
        self.assertIs(FakeTranslator.__init__, patched_init)
        translator = FakeTranslator()
        self.assertEqual(translator.options["max_tokens"], SCHOLAR_MAX_COMPLETION_TOKENS)
        self.assertIn(("max_tokens", SCHOLAR_MAX_COMPLETION_TOKENS), translator.cache_parameters)

    def test_runtime_patch_updates_pdf2zh_template(self):
        import babeldoc.format.pdf.document_il.midend.il_translator_llm_only as llm_only

        original = llm_only.PROMPT_TEMPLATE
        try:
            strengthen_pdf2zh_json_contract()
            self.assertIn(JSON_RESPONSE_SUFFIX.strip(), llm_only.PROMPT_TEMPLATE.template)
        finally:
            llm_only.PROMPT_TEMPLATE = original


if __name__ == "__main__":
    unittest.main()
