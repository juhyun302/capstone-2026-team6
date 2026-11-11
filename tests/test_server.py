"""Web API checks with a scripted model; no network and no key."""

import itertools
import json
import threading

from fastapi.testclient import TestClient
import pytest

from aleph.generation import load_prompt
from aleph.server import create_app

REQUEST = {
    "source_question": {"problem": {"text": "원문 문항"}, "explanation": {"text": "원문 해설"}},
    "intended_use": "보충지", "target_level": "준킬러", "curriculum_scope": "수학Ⅱ",
}
IDEA = {"concept": "수열", "key_elements": ["요소 하나", "요소 둘"], "mechanism": "연결"}
STATEMENTS = ["등차수열의 공차를 구하는 새 문항", "원 위의 두 점 사이 거리를 묻는 문항",
              "로그방정식의 실근 개수로 상수를 정하는 문항", "포물선과 직선이 만나는 점의 개수를 따지는 문제",
              "삼각함수의 주기와 최댓값에서 계수를 찾게 한다"]
BLIND = {"status": "solved", "answer": "3", "solution": "독립 풀이", "issues": []}
REVIEW = {"validity_issue": False, "curriculum_issue": False, "transferable": True,
          "verdict": "USE", "reason": "요소 하나와 요소 둘이 연결대로 쓰인다."}


def plan(index):
    return {"id": f"p{index}", "object": "대상", "condition_form": "조건", "target": "질문",
            "representation": "제시", "solution_route": "풀이",
            "changed_axes": ["object", "condition_form", "target"], "added_judgment": f"판단 {index}"}


def model(count=1, idea=IDEA, review=REVIEW):
    """Each generator call gets a distinct statement, even from parallel threads."""
    statements = itertools.cycle(STATEMENTS)
    lock = threading.Lock()
    fixed = {load_prompt("parse_query"): json.dumps(idea, ensure_ascii=False),
             load_prompt("design_candidates"): json.dumps(
                 {"plans": [plan(i) for i in range(1, count + 1)]}, ensure_ascii=False),
             load_prompt("solve_candidate"): json.dumps(BLIND, ensure_ascii=False),
             load_prompt("review_candidate"): json.dumps(review, ensure_ascii=False)}

    def complete(system, user):
        if system == load_prompt("generate_candidate"):
            with lock:
                statement = next(statements)
            return json.dumps({"statement": statement, "solution": "후보 풀이"}, ensure_ascii=False)
        return fixed[system]

    return complete


def job_events(client, job_id):
    with client.stream("GET", f"/api/jobs/{job_id}/events") as stream:
        body = "".join(stream.iter_text())
    return [json.loads(chunk[len("data: "):]) for chunk in body.split("\n\n") if chunk]


def run_job(client, request=REQUEST):
    return job_events(client, client.post("/api/requests", json=request).json()["jobId"])


def run_more(client, result_id, count=2):
    response = client.post(f"/api/results/{result_id}/more", json={"count": count})
    return job_events(client, response.json()["jobId"])


def finished_result(client):
    return client.get(f"/api/results/{run_job(client)[-1]['result_id']}").json()


@pytest.fixture
def client():
    return TestClient(create_app(model(), count=1))


def test_events_follow_the_pipeline_stages(client):
    events = run_job(client)
    assert [event["stage"] for event in events] == [
        "read", "extract", "extract", "validate", "generate", "review", "done"]
    assert events[0]["source_statement"] == "원문 문항"
    assert events[2]["solution_idea"] == IDEA


def test_three_candidates_arrive_with_their_plans():
    client = TestClient(create_app(model(count=3), count=3))
    events = run_job(client)
    stages = [event["stage"] for event in events]
    assert stages == ["read", "extract", "extract", "validate", "generate", "review", "done"]
    result = client.get(f"/api/results/{events[-1]['result_id']}").json()
    assert [c["id"] for c in result["candidates"]] == ["p1", "p2", "p3"]
    assert len({c["statement"] for c in result["candidates"]}) == 3
    for candidate in result["candidates"]:
        assert candidate["plan"]["changed_axes"] == ["object", "condition_form", "target"]
        assert candidate["surface_check"]["copy_suspected"] is False
        assert candidate["review_result"]["approval_status"] == "PROVISIONAL"


def test_result_holds_reviewed_candidates_marked_provisional(client):
    result = finished_result(client)
    assert result["request"]["source"]["statement"] == "원문 문항"
    assert result["request"]["curriculum_scope"] == "수학Ⅱ"
    assert result["solution_idea"] == IDEA
    candidate = result["candidates"][0]
    assert candidate["statement"] == STATEMENTS[0]
    assert candidate["transferable"] is True
    assert candidate["review_result"]["reviewer_type"] == "AI"
    assert candidate["review_result"]["approval_status"] == "PROVISIONAL"


def test_question_error_ends_without_a_result():
    client = TestClient(create_app(model(idea={"concept": "미분", "key_elements": None,
                                               "mechanism": None}), count=1))
    last = run_job(client)[-1]
    assert last["stage"] == "error"
    assert last["error"]["status"] == "QUESTION_ERROR"
    assert last["error"]["error_code"] == "MISSING_ELEMENTS"
    assert last["error"]["reason"].strip()


def test_model_failure_does_not_leak_the_exception_text():
    def broken(system, user):
        raise ConnectionError("secret-detail")

    last = run_job(TestClient(create_app(broken, count=1)))[-1]
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
    url = f"/api/results/{result['id']}/candidates/p1/review"
    decided = client.post(url, json={"verdict": "USE", "reason": "직접 풀어 확인했다."}).json()
    assert decided["reviewer_type"] == "SELF"
    assert decided["approval_status"] == "APPROVED"
    candidate = client.get(f"/api/results/{result['id']}").json()["candidates"][0]
    assert candidate["ai_review_result"]["reviewer_type"] == "AI"
    assert candidate["ai_review_result"]["reason"] == REVIEW["reason"]


def test_human_revise_stays_provisional(client):
    result = finished_result(client)
    url = f"/api/results/{result['id']}/candidates/p1/review"
    decided = client.post(url, json={"verdict": "REVISE", "reason": "조건을 고친다."}).json()
    assert decided["reviewer_type"] == "SELF"
    assert decided["approval_status"] == "PROVISIONAL"


def test_a_human_can_change_a_decision_and_the_ai_verdict_stays(client):
    result = finished_result(client)
    url = f"/api/results/{result['id']}/candidates/p1/review"
    assert client.post(url, json={"verdict": "USE", "reason": "승인"}).json()["approval_status"] == "APPROVED"
    changed = client.post(url, json={"verdict": "REJECT", "reason": "잘못 눌렀다."}).json()
    assert changed["verdict"] == "REJECT"
    assert changed["reviewer_type"] == "SELF"
    assert changed["approval_status"] == "PROVISIONAL"
    candidate = client.get(f"/api/results/{result['id']}").json()["candidates"][0]
    assert candidate["review_result"]["verdict"] == "REJECT"
    assert candidate["ai_review_result"]["reviewer_type"] == "AI"
    assert candidate["ai_review_result"]["verdict"] == REVIEW["verdict"]
    again = client.post(url, json={"verdict": "USE", "reason": "다시 승인"}).json()
    assert again["approval_status"] == "APPROVED"


@pytest.mark.parametrize("issue", ["validity_issue", "curriculum_issue"])
def test_flagged_candidate_cannot_be_approved(issue):
    client = TestClient(create_app(model(review={**REVIEW, "verdict": "REVISE", issue: True}),
                                   count=1))
    result = finished_result(client)
    url = f"/api/results/{result['id']}/candidates/p1/review"
    assert client.post(url, json={"verdict": "USE", "reason": "승인"}).status_code == 409
    candidate = client.get(f"/api/results/{result['id']}").json()["candidates"][0]
    assert candidate["review_result"]["approval_status"] == "PROVISIONAL"


def test_undo_returns_a_candidate_to_the_ai_verdict(client):
    result = finished_result(client)
    url = f"/api/results/{result['id']}/candidates/p1/review"
    client.post(url, json={"verdict": "USE", "reason": "승인"})
    undone = client.delete(url)
    assert undone.status_code == 200
    assert undone.json()["reviewer_type"] == "AI"
    assert undone.json()["approval_status"] == "PROVISIONAL"
    assert undone.json()["verdict"] == REVIEW["verdict"]
    assert undone.json()["reason"] == REVIEW["reason"]
    candidate = client.get(f"/api/results/{result['id']}").json()["candidates"][0]
    assert candidate["review_result"] == candidate["ai_review_result"]
    assert client.post(url, json={"verdict": "HOLD", "reason": "보류"}).json()["reviewer_type"] == "SELF"


def test_undo_without_a_human_decision_changes_nothing(client):
    result = finished_result(client)
    undone = client.delete(f"/api/results/{result['id']}/candidates/p1/review")
    assert undone.status_code == 200
    assert undone.json()["reviewer_type"] == "AI"


def test_undo_for_unknown_ids_returns_404(client):
    result = finished_result(client)
    assert client.delete("/api/results/nope/candidates/p1/review").status_code == 404
    assert client.delete(f"/api/results/{result['id']}/candidates/p9/review").status_code == 404


@pytest.mark.parametrize("issue", ["validity_issue", "curriculum_issue"])
def test_flagged_candidate_stays_unapprovable_after_a_human_decision(issue):
    client = TestClient(create_app(model(review={**REVIEW, "verdict": "REVISE", issue: True}),
                                   count=1))
    result = finished_result(client)
    url = f"/api/results/{result['id']}/candidates/p1/review"
    assert client.post(url, json={"verdict": "HOLD", "reason": "보류"}).status_code == 200
    assert client.post(url, json={"verdict": "USE", "reason": "승인"}).status_code == 409
    candidate = client.get(f"/api/results/{result['id']}").json()["candidates"][0]
    assert candidate["review_result"]["verdict"] == "HOLD"


@pytest.mark.parametrize("decision", [{"verdict": "OK", "reason": "이유"},
                                      {"verdict": "USE", "reason": "  "}, {"verdict": "USE"}])
def test_invalid_decision_is_refused(client, decision):
    result = finished_result(client)
    url = f"/api/results/{result['id']}/candidates/p1/review"
    assert client.post(url, json=decision).status_code == 422


def test_unknown_ids_return_404(client):
    assert client.get("/api/jobs/nope/events").status_code == 404
    assert client.get("/api/results/nope").status_code == 404
    assert client.post("/api/results/nope/candidates/p1/review",
                       json={"verdict": "HOLD", "reason": "보류"}).status_code == 404
    assert client.post("/api/results/nope/more", json={"count": 2}).status_code == 404


def test_request_count_sets_how_many_candidates_are_made():
    client = TestClient(create_app(model(count=2), count=3))
    events = run_job(client, {**REQUEST, "count": 2})
    assert events[0]["candidates"] == 2
    result = client.get(f"/api/results/{events[-1]['result_id']}").json()
    assert [c["id"] for c in result["candidates"]] == ["p1", "p2"]


def test_request_without_a_count_uses_the_server_default():
    client = TestClient(create_app(model(count=2), count=2))
    assert run_job(client)[0]["candidates"] == 2


@pytest.mark.parametrize("count", [0, 6, "3", True, None])
def test_bad_count_is_refused_before_any_job(client, count):
    response = client.post("/api/requests", json={**REQUEST, "count": count})
    assert response.status_code == 422
    assert "문항 수" in response.json()["detail"]


def test_more_appends_new_candidates_and_keeps_human_decisions():
    client = TestClient(create_app(model(count=2), count=2))
    first = run_job(client)
    result_id = first[-1]["result_id"]
    client.post(f"/api/results/{result_id}/candidates/p1/review",
                json={"verdict": "USE", "reason": "직접 풀어 확인했다."})

    events = run_more(client, result_id, count=2)

    assert [event["stage"] for event in events] == [
        "read", "extract", "validate", "generate", "review", "done"]
    assert events[0]["back_to"] == result_id
    assert events[0]["candidates"] == 2
    assert events[1]["solution_idea"] == IDEA
    assert events[-1]["result_id"] == result_id
    result = client.get(f"/api/results/{result_id}").json()
    assert [c["id"] for c in result["candidates"]] == ["p1", "p2", "p3", "p4"]
    assert result["candidates"][0]["review_result"]["approval_status"] == "APPROVED"
    assert result["candidates"][2]["review_result"]["reviewer_type"] == "AI"
    decided = client.post(f"/api/results/{result_id}/candidates/p4/review",
                          json={"verdict": "HOLD", "reason": "보류"})
    assert decided.status_code == 200


def test_more_ids_stay_unique_after_an_earlier_candidate_was_dropped():
    scripted = model(count=2)
    bad_drafts = iter(["not json", "not json"])

    def complete(system, user):
        if system == load_prompt("generate_candidate"):
            bad = next(bad_drafts, None)
            if bad:
                return bad
        return scripted(system, user)

    client = TestClient(create_app(complete, count=2, workers=1))
    result_id = run_job(client)[-1]["result_id"]
    assert [c["id"] for c in client.get(f"/api/results/{result_id}").json()["candidates"]] == ["p2"]
    run_more(client, result_id, count=2)
    assert [c["id"] for c in client.get(f"/api/results/{result_id}").json()["candidates"]] == [
        "p2", "p3", "p4"]


@pytest.mark.parametrize("count", [0, 6, "2", True, None, 5])
def test_more_is_refused_for_a_bad_count_or_past_the_cap(count):
    client = TestClient(create_app(model(count=5), count=5))
    result_id = run_job(client)[-1]["result_id"]
    response = client.post(f"/api/results/{result_id}/more", json={"count": count})
    assert response.status_code == 422
    assert "문항 수" in response.json()["detail"]


def test_more_failure_leaves_the_result_alone():
    scripted = model(count=1)
    broken = {"on": False}

    def complete(system, user):
        if broken["on"]:
            raise ConnectionError("secret-detail")
        return scripted(system, user)

    client = TestClient(create_app(complete, count=1))
    result_id = run_job(client)[-1]["result_id"]
    broken["on"] = True
    events = run_more(client, result_id, count=1)
    assert events[0]["back_to"] == result_id
    assert events[-1]["stage"] == "error"
    assert events[-1]["error"]["status"] == "SERVER_ERROR"
    assert [c["id"] for c in client.get(f"/api/results/{result_id}").json()["candidates"]] == ["p1"]
