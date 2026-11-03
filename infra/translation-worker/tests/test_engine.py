import unittest

from engine import (
    JSON_RESPONSE_SUFFIX,
    SCHOLAR_MAX_COMPLETION_TOKENS,
    apply_completion_token_limit,
    append_json_response_constraint,
    strengthen_pdf2zh_json_contract,
)


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
