"""Run the Aleph API for the web client on localhost.

    python scripts/run_server.py

The key and model come from .env. The server has no login, so do not expose it publicly.
"""

import os
from pathlib import Path
import sys

import uvicorn

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from aleph.model_client import load_settings, openai_complete  # noqa: E402
from aleph.server import create_app  # noqa: E402


def main():
    load_settings(ROOT / ".env")
    if not os.environ.get("OPENAI_API_KEY"):
        sys.exit("OPENAI_API_KEY가 없습니다. 저장소 루트의 .env에 넣으세요.")
    complete = openai_complete(os.environ.get("OPENAI_MODEL", ""),
                               reasoning_effort=os.environ.get("OPENAI_REASONING_EFFORT"))
    uvicorn.run(create_app(complete), host="127.0.0.1", port=8000)


if __name__ == "__main__":
    main()
