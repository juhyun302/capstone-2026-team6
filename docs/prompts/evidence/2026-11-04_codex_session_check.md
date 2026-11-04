# 2026-11-04 Codex 새 세션 점검 — 지침 로드, 스킬 호출, 설정 적용

[위임·검증 기록 G절](../delegation_validation.md#g-에이전트-하니스-구성-사람이-쓴다)의 미확인 항목을 확인한 근거다. 점검은 이주현이 수행했다.
근거는 Codex가 남긴 세션 기록 파일(`~/.codex/sessions/2026/11/04/rollout-*.jsonl`)이다. 원본에는 실행 환경의 시스템 지침과 개인 경로가 들어 있어 저장소에 올리지 않고, 아래에 판정에 필요한 항목만 옮겼다.

## 실행 환경

| 항목 | 값 |
|---|---|
| 도구 | Codex Desktop, CLI `0.166.0-alpha.5.1`, 모델 `gpt-5.6-sol` |
| 작업 폴더 | 저장소 루트(`capstone-2026-team6`). 앱에서 기존 폴더를 프로젝트로 추가하고, 확인마다 새 대화로 시작했다. |
| 프로젝트 신뢰 상태 | 사용자 설정(`~/.codex/config.toml`)에 저장소 루트가 `trust_level = "trusted"`로 등록되어 있다. |
| 기준 커밋 | `9689171c3a5dab384475a00983ede266f0531a64` (PR #8 병합 후 main) |
| Python | 저장소 루트 `.venv`, Python 3.13.3 (CI는 3.12). 의존성은 `requirements-dev.txt` 고정 버전으로 설치했다. |

## 세션 목록

| 시각 (KST) | 세션 ID 앞부분 | 앱 권한 모드 | 확인 내용 |
|---|---|---|---|
| 16:02 | `01a1a55d` | 나 대신 승인 | ① 지침 자동 로드, ② `$aleph-check` 명시 호출 |
| 16:13 | `01a1a567` | 나 대신 승인 | ③ 자동 호출 끄기 |
| 16:42 | `01a1a582` | 나 대신 승인 | ④-1 설정 파일의 `network_access` 적용 |
| 16:46 | `01a1a586` | 나 대신 승인 | ④-2 설정 파일의 `approval_policy` 적용 |
| 16:56 | `01a1a58f` | 사용자 지정(config.toml) | ④-3 설정 파일의 `approval_policy` 적용 |

## ① 지침 자동 로드

첫 메시지로 "파일을 열거나 명령을 실행하지 말고, 처음부터 들어와 있는 지침만 보고 답하라"고 요청하고, 로드된 지침 경로와 `AGENTS.md` 4절 첫 항목을 물었다.

- 세션 기록의 7번째 항목에 `# AGENTS.md instructions for <저장소 루트>` 블록으로 `AGENTS.md` 전문이 들어 있다. 사용자 질문은 그 뒤인 14번째 항목이다.
- 첫 응답이 끝날 때까지 도구 호출(파일 읽기·명령 실행) 기록은 0건이다.
- 응답은 지침 경로로 저장소 루트의 `AGENTS.md`를 들었고, 4절 첫 항목을 "사람이 확정한 테스트 코드·골든 케이스·fixture는 승인 없이 변경하지 않는다."로 정확히 옮겼다.

판정: 저장소 루트에서 시작한 세션은 `AGENTS.md`를 자동으로 로드한다.

## ② `$aleph-check` 명시 호출

같은 세션에서 `$aleph-check`를 보냈다.

- 사용자 메시지가 `.agents/skills/aleph-check/SKILL.md`로 연결된 스킬 참조로 기록됐다.
- 에이전트는 `SKILL.md`를 읽고, 스킬 지시에 따라 `AGENTS.md`와 위임·검증 기록을 읽은 뒤 `.venv` Python을 확인했다.
- 실행한 검사와 결과:

| 순서 | 명령 | 종료 코드 | 결과 |
|---|---|---|---|
| 1 | `.venv\Scripts\python.exe -m ruff check .` | 0 | `All checks passed!` |
| 2 | `.venv\Scripts\python.exe -m pytest tests/test_validation_golden.py --collect-only -q` | 0 | `54 tests collected` (골든 33, 보조 21) |
| 3 | `.venv\Scripts\python.exe -m pytest -q -rs` | 0 | `54 passed`, failed·skipped·xfailed·error 0건 |

- 파일 수정과 패키지 설치 기록은 없다. 점검 후 `git status`에는 추적 파일 변경이 없고, `.gitignore`에 등록된 캐시만 생겼다.
- 2026-10-28 점검(E절 3회차)의 임시 경로 setup 오류 12건은 이번 환경에서 발생하지 않았다.

판정: 저장소 루트 세션에서 `$aleph-check`의 명시 호출이 동작하고, 스킬 범위(검사와 보고만)를 지켰다.

## ③ 자동 호출 끄기 (`allow_implicit_invocation: false`)

새 대화에서 `$` 없이 "테스트 진행해줘"라고만 요청했다.

| 비교 항목 | ② 명시 호출 (16:02) | ③ `$` 없이 요청 (16:13) |
|---|---|---|
| `SKILL.md` 읽기 | 있음 | 없음 |
| 세션 기록에 `aleph-check` 등장 | 35회 | 0회 |
| 에이전트가 처음 받는 사용 가능 스킬 목록에 `aleph-check` | 없음 | 없음 |
| 진행 방식 | 스킬 순서대로 `.venv` 확인 → Ruff → 수집 → 전체 테스트 | 스킬 없이 진행. 시스템 Python 3.10으로 먼저 실행해 `No module named pytest`로 실패한 뒤 `.venv`를 찾아 Ruff와 전체 테스트를 다시 실행했다(54 passed). 수집 단계는 없었다. |

에이전트는 `AGENTS.md` 6절의 검사 명령을 보고 테스트를 직접 실행했지만 `aleph-check` 스킬은 고르지 않았다. 스킬은 에이전트가 스스로 고르는 목록에서 빠져 있고, `$`로 명시할 때만 호출됐다.

판정: 자동 호출 끄기가 동작한다. 테스트 실행 자체를 막는 설정은 아니다.

## ④ 저장소 설정 파일(`.codex/config.toml`)의 적용

기존 값(`approval_policy="on-request"`, `sandbox_mode="workspace-write"`, `network_access=false`)은 저장소 밖 상위 폴더에서 연 2026-11-03 세션의 값과 같아서, 값만 보고는 저장소 설정에서 왔는지 앱 기본값인지 구분할 수 없었다. 그래서 설정 파일의 값 하나를 잠시 바꾸고, 새 대화에서 "안녕"만 보낸 뒤 세션 기록의 실행 정책을 확인했다. 실험 대화에서는 다른 작업을 시키지 않았고(도구 호출 0건), 실험이 끝날 때마다 즉시 원래 값으로 되돌렸다.

| 실험 | 앱 권한 모드 | 설정 파일에서 바꾼 값 | 세션 기록의 값 | 판정 |
|---|---|---|---|---|
| ④-1 | 나 대신 승인 | `network_access = true` | `network_access=true` | 파일대로 적용 |
| ④-2 | 나 대신 승인 | `approval_policy = "never"` | `approval_policy=on-request`, `approvals_reviewer=auto_review` | 파일 무시, 앱 모드가 우선 |
| ④-3 | 사용자 지정(config.toml) | `approval_policy = "never"` | `approval_policy=never`, `approvals_reviewer=user` | 파일대로 적용 |

- 앱 입력창의 권한 모드는 승인 요청 / 나 대신 승인 / 전체 권한 / 사용자 지정(config.toml) 네 가지다. "나 대신 승인"은 위험해 보이는 작업만 사람에게 묻고 나머지는 AI 검토자(`auto_review`)가 승인한다.
- 원복 확인: 세 실험 모두 끝난 뒤 `.codex/config.toml`의 SHA-256이 실험 전과 같았고(`D12ED9B9704DAA9DB5DE4101681CEB08617F9A2121A1D32217B99C7F8D9EF922`), `git diff`가 비어 있었다.

판정: 저장소 설정 파일은 로드된다. 다만 Codex Desktop에서 **승인 방식은 앱 권한 모드가 "사용자 지정(config.toml)"일 때만 설정 파일대로 적용**된다. 다른 모드에서는 앱이 승인 방식과 승인 주체를 정한다.

권장: 이 저장소에서 위임 작업을 할 때는 새 대화마다 권한 모드를 "사용자 지정(config.toml)"으로 확인한다. 그래야 팀이 정한 승인 방식(`on-request`)과 사람 승인(`approvals_reviewer=user`)이 적용된다.

## 확인하지 못한 것

- 권한 모드 선택이 이후 새 대화에도 유지되는지는 확인하지 않았다.
- "나 대신 승인" 모드에서 `sandbox_mode=workspace-write`가 설정 파일에서 왔는지 앱 모드에서 왔는지는 구분하지 않았다.
- 어떤 모드에서도 설정만으로 테스트 파일 쓰기가 차단되지는 않는다. 판정 기준의 무단 변경은 계속 기준 커밋과의 `git diff`로 확인한다.
