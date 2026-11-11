"""Send one stateless model call; prompts and validation stay in generation.py."""

import os
from pathlib import Path

_SETTINGS = {"OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_REASONING_EFFORT"}
_MAX_OUTPUT_TOKENS = 24000


def load_settings(path: Path) -> None:
    """Copy only the named settings into the environment; never log their values."""
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        name, separator, value = line.strip().partition("=")
        name = name.strip()
        value = value.strip().strip("\"'")
        if separator and value and name in _SETTINGS and not os.environ.get(name):
            os.environ[name] = value


def openai_complete(model: str, *, reasoning_effort: str | None = None, client=None):
    """Return a Complete function; a truncated reply fails validation and is retried."""
    if not isinstance(model, str) or not model.strip():
        raise ValueError("model is required")
    if client is None:
        from openai import OpenAI

        client = OpenAI(timeout=900, max_retries=1)
    options = {"reasoning": {"effort": reasoning_effort}} if reasoning_effort else {}

    def complete(system: str, user: str) -> str:
        response = client.responses.create(
            model=model, instructions=system, input=user,
            max_output_tokens=_MAX_OUTPUT_TOKENS, store=False, **options,
        )
        if response.status == "incomplete":
            return ""
        if response.status != "completed":
            raise RuntimeError(f"model call ended with status {response.status}")
        return response.output_text

    return complete
