"""Run the Aleph API for the web client on localhost.

    python scripts/run_server.py

The key and model come from .env. The server has no login, so do not expose it publicly.
Every model call is appended to logs/trace.jsonl (git-ignored; it holds the pasted exam text).
"""

from functools import partial
import os
from pathlib import Path
import sys

import uvicorn

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from aleph.model_client import load_settings, openai_complete  # noqa: E402
from aleph.server import create_app  # noqa: E402
from aleph.trace import TraceLog, traced  # noqa: E402


def main():
    load_settings(ROOT / ".env")
    if not os.environ.get("OPENAI_API_KEY"):
        sys.exit("OPENAI_API_KEY가 없습니다. 저장소 루트의 .env에 넣으세요.")
    model = os.environ.get("OPENAI_MODEL", "")
    complete = openai_complete(model, reasoning_effort=os.environ.get("OPENAI_REASONING_EFFORT"))
    log = TraceLog(ROOT / "logs/trace.jsonl")
    print(f"운영 기록: {log.path.relative_to(ROOT)}")
    uvicorn.run(create_app(complete, trace=partial(traced, log=log, model=model)),
                host="127.0.0.1", port=8000)


if __name__ == "__main__":
    main()
