"""pdf2zh Next 2.9.0 child adapter: emit structured progress for the queue."""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from string import Template

import babeldoc.assets.assets
from pdf2zh_next.config import ConfigManager
from pdf2zh_next.high_level import do_translate_async_stream


JSON_RESPONSE_SUFFIX = (
    "\n\n## Final Response Constraint\n"
    "Return only the JSON array required by Output Format. Keep every requested id and "
    "include its translated output. Do not return prose, explanations, or Markdown."
)
SCHOLAR_MAX_COMPLETION_TOKENS = 4096


def apply_completion_token_limit(options: dict) -> dict:
    """Set a bounded, JSON-safe completion budget unless a provider already set one."""
    options.setdefault("max_tokens", SCHOLAR_MAX_COMPLETION_TOKENS)
    return options


def configure_openai_completion_limit(translator_cls=None) -> None:
    """Teach pdf2zh Next's pinned OpenAI client to avoid truncating long JSON batches."""
    if translator_cls is None:
        from pdf2zh_next.translator.translator_impl.openai import OpenAITranslator
        translator_cls = OpenAITranslator

    if getattr(translator_cls, "_scholar_completion_limit", False):
        return
    original_init = translator_cls.__init__

    def limited_init(self, *args, **kwargs):
        original_init(self, *args, **kwargs)
        apply_completion_token_limit(self.options)
        self.add_cache_impact_parameters("max_tokens", self.options["max_tokens"])

    translator_cls.__init__ = limited_init
    translator_cls._scholar_completion_limit = True


def configure_model_call_probe(translator_cls=None) -> None:
    """Log each model reply's shape so empty-content failures are diagnosable.

    Only counts and finish reasons are printed; prompts, translations and
    reasoning text never leave the engine's private workspace.
    """
    if translator_cls is None:
        from pdf2zh_next.translator.translator_impl.openai import OpenAITranslator
        translator_cls = OpenAITranslator
    if getattr(translator_cls, "_scholar_model_probe", False):
        return
    original_init = translator_cls.__init__

    def probed_init(self, *args, **kwargs):
        original_init(self, *args, **kwargs)
        create = self.client.chat.completions.create

        def probed_create(*call_args, **call_kwargs):
            response = create(*call_args, **call_kwargs)
            try:
                choice = response.choices[0]
                message = choice.message
                extra = getattr(message, "model_extra", None) or {}
                reasoning = getattr(message, "reasoning_content", None) or extra.get(
                    "reasoning_content"
                ) or ""
                usage = getattr(response, "usage", None)
                print(
                    "@@MODEL_CALL finish=%s content_chars=%d reasoning_chars=%d "
                    "completion_tokens=%s max_tokens=%s"
                    % (
                        choice.finish_reason,
                        len(message.content or ""),
                        len(reasoning),
                        getattr(usage, "completion_tokens", None),
                        call_kwargs.get("max_tokens"),
                    ),
                    flush=True,
                )
            except Exception as exc:
                print(f"@@MODEL_CALL probe_failed {type(exc).__name__}", flush=True)
            return response

        self.client.chat.completions.create = probed_create

    translator_cls.__init__ = probed_init
    translator_cls._scholar_model_probe = True


def append_json_response_constraint(template: str) -> str:
    """Repeat pdf2zh's JSON contract after the variable PDF input."""
    if JSON_RESPONSE_SUFFIX.strip() in template:
        return template
    return template.rstrip() + JSON_RESPONSE_SUFFIX


def strengthen_pdf2zh_json_contract() -> None:
    """Keep the output contract nearest to the model's response position."""
    import babeldoc.format.pdf.document_il.midend.il_translator_llm_only as llm_only

    llm_only.PROMPT_TEMPLATE = Template(
        append_json_response_constraint(llm_only.PROMPT_TEMPLATE.template)
    )


async def main() -> int:
    logging.basicConfig(level=logging.WARNING)
    configure_openai_completion_limit()
    configure_model_call_probe()
    strengthen_pdf2zh_json_contract()
    settings = ConfigManager().initialize_config()
    files = list(settings.basic.input_files)
    if len(files) != 1:
        raise ValueError("translation engine requires exactly one PDF")
    babeldoc.assets.assets.warmup()
    finished = False
    async for event in do_translate_async_stream(settings, Path(files[0])):
        kind = event.get("type")
        if kind in {"progress_update", "progress_end"}:
            progress = event.get("overall_progress")
            if isinstance(progress, (int, float)):
                print(f"@@SCHOLAR_PROGRESS:{max(0, min(100, round(progress)))}", flush=True)
        elif kind == "error":
            raise RuntimeError("translation engine reported an error")
        elif kind == "finish":
            finished = True
            break
    return 0 if finished else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
