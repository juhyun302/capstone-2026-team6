---
name: aleph-check
description: Aleph 저장소의 린트와 테스트를 실행하고 결과를 보고한다. 구현 수정이나 기준 변경 요청에는 사용하지 않는다.
---

저장소 루트에서 `AGENTS.md`와 `docs/prompts/delegation_validation.md`를 읽는다.
설치된 프로젝트 Python으로 다음 명령을 실행한다. Windows 가상환경이면 `python` 대신 `.venv/Scripts/python.exe`를 쓴다.

1. `python -m ruff check .`
2. `python -m pytest tests/test_validation_golden.py --collect-only -q`
3. `python -m pytest -q -rs`

첫 검사가 실패해도 실행 가능한 다음 검사를 수행한다.
소스, 테스트, YAML, fixture, 설정을 수정하지 않는다. 패키지도 자동 설치하지 않는다.
명령별 종료 코드와 실제 출력을 보고한다. 골든 케이스와 보조 검사의 수를 구분한다.
필수 케이스의 skip·xfail은 통과로 세지 않는다. 실행 불가를 통과로 추정하지 않는다.
실패 시 수정할 위치와 이유만 제안한다. 한 번의 검사 묶음으로 끝낸다.
사람의 수용, 원격 CI 통과, LLM 품질을 로컬 테스트 결과로 대신 선언하지 않는다.
