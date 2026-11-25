"""Operations trace (logs/trace.jsonl) with a scripted model; no network and no key."""

from functools import partial
import json
import threading

from fastapi.testclient import TestClient
import pytest

from aleph.generation import load_prompt
from aleph.server import create_app
from aleph.trace import SCHEMA, TraceLog, tail_events, traced, worker_lines
from test_server import IDEA, REQUEST, job_events, model

KEYS = ["schema", "ts", "source", "trace_id", "prompt", "model", "status", "error", "ms", "input",
        "images", "output", "usage"]


def read(path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


def traced_client(log, count=2):
    return TestClient(create_app(model(count=count), count=count,
                                 trace=partial(traced, log=log, model="test-model")))


def test_every_model_call_of_a_request_is_one_line(tmp_path):
    log = TraceLog(tmp_path / "logs/trace.jsonl")
    client = traced_client(log)
    job_id = client.post("/api/requests", json=REQUEST).json()["jobId"]
    assert job_events(client, job_id)[-1]["stage"] == "done"

    lines = read(log.path)
    # extraction and design once, then draft, blind solve and review for each of two candidates
    assert sorted(line["prompt"] for line in lines) == sorted(
        ["parse_query", "design_candidates"] + ["generate_candidate", "solve_candidate",
                                                "review_candidate"] * 2)
    assert all(list(line) == KEYS for line in lines)
    assert all(line["schema"] == SCHEMA and line["source"] == "server" for line in lines)
    assert all(line["trace_id"] == job_id and line["model"] == "test-model" for line in lines)
    assert all(line["status"] == "completed" and line["error"] is None for line in lines)
    first = lines[0]
    assert first["prompt"] == "parse_query"
    assert "원문 해설" in first["input"]
    assert json.loads(first["output"]) == IDEA


def test_a_more_request_gets_its_own_trace_id(tmp_path):
    log = TraceLog(tmp_path / "trace.jsonl")
    client = traced_client(log)
    first_id = client.post("/api/requests", json=REQUEST).json()["jobId"]
    result_id = job_events(client, first_id)[-1]["result_id"]
    more_id = client.post(f"/api/results/{result_id}/more", json={"count": 2}).json()["jobId"]
    assert job_events(client, more_id)[-1]["stage"] == "done"

    more = [line for line in read(log.path) if line["trace_id"] == more_id]
    assert more_id != first_id
    # the idea is reused, so a more request never extracts again
    assert sorted(line["prompt"] for line in more) == sorted(
        ["design_candidates"] + ["generate_candidate", "solve_candidate", "review_candidate"] * 2)


def test_a_failed_call_is_kept_by_its_type_only(tmp_path):
    log = TraceLog(tmp_path / "trace.jsonl")

    def broken(system, user):
        raise RuntimeError("Incorrect API key provided: sk-proj-abcd")

    with pytest.raises(RuntimeError):
        traced(broken, "job_x", log=log, model="m")(load_prompt("parse_query"), "{}")

    [line] = read(log.path)
    assert (line["status"], line["error"], line["output"]) == ("error", "RuntimeError", None)
    assert "sk-proj" not in log.path.read_text(encoding="utf-8")


def test_a_truncated_reply_is_incomplete_and_pictures_are_only_counted(tmp_path):
    log = TraceLog(tmp_path / "trace.jsonl")
    picture = "data:image/png;base64,AAAA"
    traced(lambda system, user, images: "", "job_x", log=log, model="m")(
        load_prompt("solve_candidate"), "{}", [picture])

    [line] = read(log.path)
    assert (line["prompt"], line["status"], line["images"]) == ("solve_candidate", "incomplete", 1)
    assert picture not in log.path.read_text(encoding="utf-8")


def test_parallel_writes_stay_whole_lines(tmp_path):
    log = TraceLog(tmp_path / "trace.jsonl")
    text = "가" * 20000
    threads = [threading.Thread(target=log.write, args=({"n": n, "text": text},))
               for n in range(20)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert sorted(line["n"] for line in read(log.path)) == list(range(20))


def test_worker_lines_are_picked_out_of_wrangler_tail():
    line = {"schema": SCHEMA, "ts": "2026-11-25T03:04:05.678Z", "source": "worker",
            "trace_id": "job_ab12cd34", "prompt": "parse_query", "model": "gpt-6.1-sol",
            "status": "completed", "error": None, "ms": 812, "input": '{"problem": "원문 {x}"}',
            "images": 0, "output": "{}", "usage": {"input_tokens": 10}}
    event = {"outcome": "ok", "scriptName": "aleph", "exceptions": [], "logs": [
        {"message": [json.dumps(line, ensure_ascii=False)], "level": "log", "timestamp": 1},
        {"message": ["something else"], "level": "log", "timestamp": 2},
        {"message": [{"schema": "other"}], "level": "log", "timestamp": 3},
    ], "eventTimestamp": 1, "event": {"request": {"url": "https://x/api/openai", "method": "POST"}}}
    # wrangler prints its own messages and then each event with four-space indentation
    printed = ("Successfully created tail\nConnected to aleph, waiting for logs...\n"
               + json.dumps(event, ensure_ascii=False, indent=4) + "\n"
               + json.dumps({"logs": []}, indent=4) + "\n")

    events = list(tail_events(printed.splitlines(keepends=True)))

    assert len(events) == 2
    assert worker_lines(events[0]) == [line]
    assert worker_lines(events[1]) == []
