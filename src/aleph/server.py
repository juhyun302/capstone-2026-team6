"""Serve generate_linked_questions to the web client.

Jobs and results live in this process only. There is no login, so bind it to localhost.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
import json
import threading
import time
import uuid

from fastapi import Body, FastAPI, HTTPException
from fastapi.responses import StreamingResponse

from aleph.generation import Complete, check_generation_request, load_prompt
from aleph.pipeline import generate_linked_questions
from aleph.validation import validate_solution_idea

_VERDICTS = {"USE", "REVISE", "HOLD", "REJECT"}
_STAGES = ["read", "extract", "generate", "review"]
_POLL_SECONDS = 0.2
_SERVER_FAILURE = "모델 호출에 실패했습니다. 잠시 뒤 다시 시도해 주세요."


@dataclass
class _Job:
    request: dict
    events: list = field(default_factory=list)
    stage: str = "read"
    lock: threading.Lock = field(default_factory=threading.Lock)
    done: threading.Event = field(default_factory=threading.Event)


def _stage_by_prompt() -> dict:
    return {load_prompt("parse_query"): "extract", load_prompt("design_candidates"): "generate",
            load_prompt("generate_candidate"): "generate", load_prompt("solve_candidate"): "review",
            load_prompt("review_candidate"): "review"}


def _reporting(complete: Complete, job: _Job) -> Complete:
    """Turn model calls into progress events; candidates run in parallel, so stages only move forward."""
    stages = _stage_by_prompt()

    def reported(system: str, user: str) -> str:
        stage = stages[system]
        with job.lock:
            if _STAGES.index(stage) > _STAGES.index(job.stage):
                job.stage = stage
                job.events.append({"stage": stage})
        output = complete(system, user)
        if stage == "extract":
            checked = validate_solution_idea(output)
            if checked["status"] == "OK":
                with job.lock:
                    job.events.append({"stage": stage, "solution_idea": checked["solution_idea"]})
        return output

    return reported


def _shown(candidate: dict) -> dict:
    plan = candidate["plan"]
    return {"id": candidate["id"], **candidate["candidate_question"],
            "plan": {"changed_axes": plan["changed_axes"], "added_judgment": plan["added_judgment"]},
            "surface_check": candidate["surface_check"], "transferable": candidate["transferable"],
            "review_result": candidate["review_result"], "ai_review_result": candidate["review_result"]}


def _result_record(job: _Job, output: dict) -> dict:
    request = job.request
    source = request["source_question"]
    return {
        "id": f"res_{uuid.uuid4().hex[:12]}",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "request": {
            "intended_use": request["intended_use"],
            "target_level": request["target_level"],
            "curriculum_scope": request["curriculum_scope"],
            "source": {"label": "입력한 원문", "topic": request["curriculum_scope"],
                       "statement": source["problem"]["text"],
                       "solution": source["explanation"]["text"]},
        },
        "solution_idea": output["solution_idea"],
        "candidates": [_shown(c) for c in output["candidates"] if c["review_result"]],
    }


def _run(job: _Job, complete: Complete, results: dict, count: int, workers: int) -> None:
    try:
        output = generate_linked_questions(job.request, _reporting(complete, job), count=count,
                                           workers=workers)
    except Exception:
        event = {"stage": "error", "error": {
            "status": "SERVER_ERROR", "error_code": "MODEL_CALL_FAILED", "reason": _SERVER_FAILURE}}
    else:
        if output["status"] == "OK":
            record = _result_record(job, output)
            results[record["id"]] = record
            event = {"stage": "done", "result_id": record["id"],
                     "solution_idea": output["solution_idea"]}
        else:
            event = {"stage": "error", "error": {
                "status": output["status"], "error_code": output["error_code"],
                "reason": output["reason"]}}
    with job.lock:
        job.events.append(event)
    job.done.set()


def _stream(job: _Job):
    sent = 0
    while True:
        finished = job.done.is_set()
        with job.lock:
            pending = job.events[sent:]
        for event in pending:
            sent += 1
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        if finished and sent == len(job.events):
            return
        time.sleep(_POLL_SECONDS)


def _candidate_of(results: dict, result_id: str, candidate_id: str) -> dict:
    result = results.get(result_id)
    candidate = next((c for c in (result or {}).get("candidates", [])
                      if c["id"] == candidate_id), None)
    if candidate is None:
        raise HTTPException(404, "후보를 찾을 수 없습니다.")
    return candidate


def create_app(complete: Complete, *, count: int = 3, workers: int = 3) -> FastAPI:
    app = FastAPI(title="Aleph")
    jobs: dict = {}
    results: dict = {}

    @app.post("/api/requests")
    def create_job(request: dict = Body(...)) -> dict:
        try:
            source, _ = check_generation_request(request)
        except ValueError as exc:
            message = "이미지 입력은 아직 지원하지 않습니다. 수식·텍스트로 넣어 주세요." \
                if "image" in str(exc) else "원문, 해설, 교육과정 범위를 모두 넣어 주세요."
            raise HTTPException(422, message) from exc
        job_id = f"job_{uuid.uuid4().hex[:12]}"
        job = _Job(request, [{"stage": "read", "source_statement": source["problem"]}])
        jobs[job_id] = job
        threading.Thread(target=_run, args=(job, complete, results, count, workers),
                         daemon=True).start()
        return {"jobId": job_id}

    @app.get("/api/jobs/{job_id}/events")
    def job_events(job_id: str) -> StreamingResponse:
        job = jobs.get(job_id)
        if job is None:
            raise HTTPException(404, "요청을 찾을 수 없습니다.")
        return StreamingResponse(_stream(job), media_type="text/event-stream")

    @app.get("/api/results/{result_id}")
    def get_result(result_id: str) -> dict:
        if result_id not in results:
            raise HTTPException(404, "검토 결과를 찾을 수 없습니다.")
        return results[result_id]

    @app.post("/api/results/{result_id}/candidates/{candidate_id}/review")
    def record_human_review(result_id: str, candidate_id: str,
                            decision: dict = Body(...)) -> dict:
        """The only path to APPROVED; the AI's verdict stays in ai_review_result."""
        candidate = _candidate_of(results, result_id, candidate_id)
        verdict, reason = decision.get("verdict"), decision.get("reason")
        if verdict not in _VERDICTS or not isinstance(reason, str) or not reason.strip():
            raise HTTPException(422, "판정과 이유를 넣어 주세요.")
        ai_review = candidate["ai_review_result"]
        if candidate["review_result"]["reviewer_type"] != "AI":
            raise HTTPException(409, "이미 사람이 판정한 후보입니다.")
        if verdict == "USE" and (ai_review["validity_issue"] or ai_review["curriculum_issue"]):
            raise HTTPException(409, "결함이나 교육과정 이탈이 표시된 후보는 사용 승인할 수 없습니다.")
        candidate["review_result"] = {
            **ai_review, "verdict": verdict, "reason": reason, "reviewer_type": "SELF",
            "approval_status": "APPROVED" if verdict == "USE" else "PROVISIONAL",
        }
        return candidate["review_result"]

    return app
