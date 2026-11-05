"""Run generate_candidate once per request file and keep every call under .tmp/.

This checks the real model path. It does not measure quality and its results are not eval scores.
Requests can hold exam text, so they and the results stay in the git-ignored .tmp/ folder.

    python scripts/run_generation_smoke.py .tmp/generation-smoke/requests/*.json
"""

import argparse
from datetime import datetime
import json
import os
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from aleph.generation import generate_candidate  # noqa: E402
from aleph.model_client import load_settings, openai_complete  # noqa: E402


def recording(complete, calls):
    def wrapped(system, user):
        started = time.monotonic()
        output = complete(system, user)
        calls.append({"system_head": system[:40], "user": user, "output": output,
                      "seconds": round(time.monotonic() - started, 1)})
        return output

    return wrapped


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("requests", nargs="+", type=Path)
    args = parser.parse_args()

    load_settings(ROOT / ".env")
    model = os.environ.get("OPENAI_MODEL", "")
    if not os.environ.get("OPENAI_API_KEY"):
        sys.exit("OPENAI_API_KEY가 없습니다. 저장소 루트의 .env에 넣으세요.")
    complete = openai_complete(model,
                               reasoning_effort=os.environ.get("OPENAI_REASONING_EFFORT"))

    output_dir = ROOT / ".tmp/generation-smoke" / datetime.now().strftime("%Y%m%d-%H%M%S")
    output_dir.mkdir(parents=True)
    for path in args.requests:
        request = json.loads(path.read_text(encoding="utf-8"))
        calls = []
        result = generate_candidate(request, recording(complete, calls))
        record = {"model": model, "request": path.name, "result": result, "calls": calls}
        (output_dir / f"{path.stem}.json").write_text(
            json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
        seconds = sum(call["seconds"] for call in calls)
        print(f"{path.stem}: {result['status']} {result['error_code'] or ''} "
              f"(calls {len(calls)}, {seconds:.0f}s)")
    print(f"saved: {output_dir.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
