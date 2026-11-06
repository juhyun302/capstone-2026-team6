"""Web API checks with a scripted model; no network and no key."""

import json

from fastapi.testclient import TestClient
import pytest

from aleph.generation import load_prompt
from aleph.server import create_app

REQUEST = {
    "source_question": {"problem": {"text": "원문 문항"}, "explanation": {"text": "원문 해설"}},
    "intended_use": "보충지", "target_level": "준킬러", "curriculum_scope": "수학Ⅱ",
}
IDEA = {"concept": "수열", "key_elements": ["요소 하나", "요소 둘"], "mechanism": "연결"}
CANDIDATE = {"statement": "후보 문항", "solution": "후보 풀이"}
BLIND = {"status": "solved", "answer": "3", "solution": "독립 풀이", "issues": []}
REVIEW = {"validity_issue": False, "curriculum_issue": False, "transferable": True,
          "verdict": "USE", "reason": "요소 하나와 요소 둘이 연결대로 쓰인다."}


def model(idea=IDEA, review=REVIEW):
    outputs = {"parse_query": idea, "generate_candidate": CANDIDATE,
               "solve_candidate": BLIND, "review_candidate": review}
    by_prompt = {load_prompt(name): json.dumps(value, ensure_ascii=False)
                 for name, value in outputs.items()}
    return lambda system, user: by_prompt[system]


def run_job(client, request=REQUEST):
    job_id = client.post("/api/requests", json=request).json()["jobId"]
    with client.stream("GET", f"/api/jobs/{job_id}/events") as stream:
        body = "".join(stream.iter_text())
    return [json.loads(chunk[len("data: "):]) for chunk in body.split("\n\n") if chunk]


def finished_result(client):
    return client.get(f"/api/results/{run_job(client)[-1]['result_id']}").json()


@pytest.fixture
def client():
    return TestClient(create_app(model()))


def test_events_follow_the_pipeline_stages(client):
    events = run_job(client)
    assert [event["stage"] for event in events] == [
        "read", "extract", "extract", "generate", "review", "done"]
    assert events[0]["source_statement"] == "원문 문항"
    assert events[2]["solution_idea"] == IDEA


def test_result_holds_one_reviewed_candidate_marked_provisional(client):
    result = finished_result(client)
    assert result["request"]["source"]["statement"] == "원문 문항"
    assert result["request"]["curriculum_scope"] == "수학Ⅱ"
    assert result["solution_idea"] == {**IDEA, "transferable": True}
    assert len(result["candidates"]) == 1
    candidate = result["candidates"][0]
    assert candidate["statement"] == "후보 문항"
    assert candidate["review_result"]["reviewer_type"] == "AI"
    assert candidate["review_result"]["approval_status"] == "PROVISIONAL"


def test_question_error_ends_without_a_result():
    client = TestClient(create_app(model(idea={"concept": "미분", "key_elements": None,
                                               "mechanism": None})))
    last = run_job(client)[-1]
    assert last["stage"] == "error"
    assert last["error"]["status"] == "QUESTION_ERROR"
    assert last["error"]["error_code"] == "MISSING_ELEMENTS"
    assert last["error"]["reason"].strip()


def test_model_failure_does_not_leak_the_exception_text():
    def broken(system, user):
        raise ConnectionError("secret-detail")

    last = run_job(TestClient(create_app(broken)))[-1]
    assert last["stage"] == "error"
    assert last["error"]["status"] == "SERVER_ERROR"
    assert "secret-detail" not in json.dumps(last, ensure_ascii=False)


@pytest.mark.parametrize("field", ["problem", "explanation"])
def test_image_is_refused_in_korean_before_any_job(client, field):
    request = json.loads(json.dumps(REQUEST))
    request["source_question"][field] = {"image": "photo.png"}
    response = client.post("/api/requests", json=request)
    assert response.status_code == 422
    assert "이미지" in response.json()["detail"]


@pytest.mark.parametrize("key", ["intended_use", "target_level", "curriculum_scope"])
def test_missing_condition_is_refused(client, key):
    request = {name: value for name, value in REQUEST.items() if name != key}
    assert client.post("/api/requests", json=request).status_code == 422


def test_human_use_is_the_only_path_to_approved_and_keeps_the_ai_verdict(client):
    result = finished_result(client)
    url = f"/api/results/{result['id']}/candidates/c1/review"
    decided = client.post(url, json={"verdict": "USE", "reason": "직접 풀어 확인했다."}).json()
    assert decided["reviewer_type"] == "SELF"
    assert decided["approval_status"] == "APPROVED"
    candidate = client.get(f"/api/results/{result['id']}").json()["candidates"][0]
    assert candidate["ai_review_result"]["reviewer_type"] == "AI"
    assert candidate["ai_review_result"]["reason"] == REVIEW["reason"]


def test_human_revise_stays_provisional(client):
    result = finished_result(client)
    url = f"/api/results/{result['id']}/candidates/c1/review"
    decided = client.post(url, json={"verdict": "REVISE", "reason": "조건을 고친다."}).json()
    assert decided["reviewer_type"] == "SELF"
    assert decided["approval_status"] == "PROVISIONAL"


def test_second_human_decision_is_refused(client):
    result = finished_result(client)
    url = f"/api/results/{result['id']}/candidates/c1/review"
    assert client.post(url, json={"verdict": "HOLD", "reason": "보류"}).status_code == 200
    assert client.post(url, json={"verdict": "USE", "reason": "승인"}).status_code == 409


@pytest.mark.parametrize("issue", ["validity_issue", "curriculum_issue"])
def test_flagged_candidate_cannot_be_approved(issue):
    client = TestClient(create_app(model(review={**REVIEW, "verdict": "REVISE", issue: True})))
    result = finished_result(client)
    url = f"/api/results/{result['id']}/candidates/c1/review"
    assert client.post(url, json={"verdict": "USE", "reason": "승인"}).status_code == 409
    candidate = client.get(f"/api/results/{result['id']}").json()["candidates"][0]
    assert candidate["review_result"]["approval_status"] == "PROVISIONAL"


@pytest.mark.parametrize("decision", [{"verdict": "OK", "reason": "이유"},
                                      {"verdict": "USE", "reason": "  "}, {"verdict": "USE"}])
def test_invalid_decision_is_refused(client, decision):
    result = finished_result(client)
    url = f"/api/results/{result['id']}/candidates/c1/review"
    assert client.post(url, json=decision).status_code == 422


def test_unknown_ids_return_404(client):
    assert client.get("/api/jobs/nope/events").status_code == 404
    assert client.get("/api/results/nope").status_code == 404
    assert client.post("/api/results/nope/candidates/c1/review",
                       json={"verdict": "HOLD", "reason": "보류"}).status_code == 404
