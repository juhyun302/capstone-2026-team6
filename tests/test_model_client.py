"""Model-call boundary checks with a fake client; no network and no key."""

import os
from types import SimpleNamespace

import pytest

from aleph.model_client import load_settings, openai_complete


class FakeResponses:
    def __init__(self, status="completed", output_text="{}"):
        self.reply = SimpleNamespace(status=status, output_text=output_text)
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return self.reply


def fake_client(**reply):
    return SimpleNamespace(responses=FakeResponses(**reply))


def test_sends_system_and_user_separately_without_storing():
    client = fake_client(output_text='{"ok":true}')
    assert openai_complete("model-a", client=client)("규칙", "자료") == '{"ok":true}'
    call = client.responses.calls[0]
    assert (call["model"], call["instructions"], call["input"]) == ("model-a", "규칙", "자료")
    assert call["store"] is False
    assert "reasoning" not in call


def test_reasoning_effort_is_passed_when_set():
    client = fake_client()
    openai_complete("model-a", reasoning_effort="high", client=client)("규칙", "자료")
    assert client.responses.calls[0]["reasoning"] == {"effort": "high"}


def test_truncated_reply_becomes_empty_so_validation_rejects_it():
    client = fake_client(status="incomplete", output_text='{"statement":"잘린')
    assert openai_complete("model-a", client=client)("규칙", "자료") == ""


@pytest.mark.parametrize("status", ["failed", "cancelled", "in_progress"])
def test_failed_call_is_not_reported_as_model_output(status):
    client = fake_client(status=status)
    with pytest.raises(RuntimeError):
        openai_complete("model-a", client=client)("규칙", "자료")


@pytest.mark.parametrize("model", ["", "  ", None])
def test_model_name_is_required(model):
    with pytest.raises(ValueError):
        openai_complete(model, client=fake_client())


def test_load_settings_reads_only_named_values(tmp_path, monkeypatch):
    for name in ("OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_REASONING_EFFORT", "OTHER_SECRET"):
        monkeypatch.delenv(name, raising=False)
    path = tmp_path / ".env"
    path.write_text(
        '# 주석\nOPENAI_API_KEY="abc"\nOPENAI_MODEL=model-a\n'
        "OPENAI_REASONING_EFFORT=\nOTHER_SECRET=nope\nbroken line\n",
        encoding="utf-8",
    )
    load_settings(path)
    assert os.environ["OPENAI_API_KEY"] == "abc"
    assert os.environ["OPENAI_MODEL"] == "model-a"
    assert "OPENAI_REASONING_EFFORT" not in os.environ
    assert "OTHER_SECRET" not in os.environ


def test_load_settings_keeps_existing_environment(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENAI_MODEL", "from-shell")
    path = tmp_path / ".env"
    path.write_text("OPENAI_MODEL=from-file\n", encoding="utf-8")
    load_settings(path)
    assert os.environ["OPENAI_MODEL"] == "from-shell"


def test_load_settings_allows_missing_file(tmp_path):
    load_settings(tmp_path / "missing.env")
