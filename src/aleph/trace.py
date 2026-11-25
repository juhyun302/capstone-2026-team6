"""The operations trace: one JSON line per model call, appended to logs/trace.jsonl.

The local server writes its lines itself (scripts/run_server.py). The deployed worker prints the
same lines to its log, and scripts/tail_trace.py copies them out of `wrangler tail`.
A line holds the exam text a teacher pasted and the model's whole reply, so logs/ stays out of git.
It never holds the key or the password, and an error is kept only as its type or code, because an
error message can quote part of the key.
"""

from datetime import datetime, timezone
import json
from pathlib import Path
import threading
import time

from aleph.generation import Complete, load_prompt

SCHEMA = "aleph.trace.v1"
PROMPT_NAMES = ("parse_query", "design_candidates", "generate_candidate", "solve_candidate",
                "review_candidate")


class TraceLog:
    """An append-only JSONL file; candidates call the model in parallel, so writes take a lock."""

    def __init__(self, path: Path):
        self.path = Path(path)
        self._lock = threading.Lock()

    def write(self, line: dict) -> None:
        text = json.dumps(line, ensure_ascii=False) + "\n"
        with self._lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with self.path.open("a", encoding="utf-8") as file:
                file.write(text)


def _now() -> str:
    """The same form as JavaScript's toISOString, so worker and server lines sort together."""
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def traced(complete: Complete, trace_id: str | None, *, log: TraceLog, model: str) -> Complete:
    """Record every call of one generation request under trace_id; the reply passes through as is.

    The local model client returns "" for a truncated reply, so an empty output is "incomplete".
    It does not report token counts, so usage stays null on server lines.
    """
    names = {load_prompt(name): name for name in PROMPT_NAMES}

    def call(system: str, user: str, images: list | None = None) -> str:
        line = {"schema": SCHEMA, "ts": _now(), "source": "server", "trace_id": trace_id,
                "prompt": names.get(system), "model": model or None}
        started = time.monotonic()

        def finish(status: str, error: str | None, output: str | None) -> None:
            log.write({**line, "status": status, "error": error,
                       "ms": round((time.monotonic() - started) * 1000), "input": user,
                       "images": len(images or []), "output": output, "usage": None})

        try:
            output = complete(system, user, images) if images else complete(system, user)
        except Exception as exc:
            finish("error", type(exc).__name__, None)
            raise
        finish("completed" if output else "incomplete", None, output)
        return output

    return call


def tail_events(lines):
    """Yield each event `wrangler tail --format json` prints.

    Wrangler indents each event, so it starts with a line that is only "{" and ends with a line
    that is only "}"; strings never hold a raw newline. Its other messages are skipped.
    """
    buffer = []
    for raw in lines:
        line = raw.rstrip("\r\n")
        if line == "{":
            buffer = [line]
        elif buffer:
            buffer.append(line)
            if line == "}":
                try:
                    yield json.loads("\n".join(buffer))
                except ValueError:
                    pass
                buffer = []
        elif line.startswith("{") and line.endswith("}"):
            try:
                yield json.loads(line)
            except ValueError:
                pass


def worker_lines(event: dict) -> list:
    """The trace lines the worker printed during one tail event, in order."""
    found = []
    for log in event.get("logs") or []:
        for part in log.get("message") or []:
            if isinstance(part, str):
                try:
                    part = json.loads(part)
                except ValueError:
                    continue
            if isinstance(part, dict) and part.get("schema") == SCHEMA:
                found.append(part)
    return found
