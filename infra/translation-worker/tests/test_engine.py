import unittest

from engine import JSON_RESPONSE_SUFFIX, append_json_response_constraint


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


if __name__ == "__main__":
    unittest.main()
