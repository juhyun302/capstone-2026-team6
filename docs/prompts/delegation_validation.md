# 강의 5 — 출력 검증기 위임·검증 기록

**검토 상태: 2026-10-28 사용자 최종 승인 완료. `feature/my-work` push 및 원격 CI 통과. main 병합 전.**
승인 범위는 현재 강의 5 문서·골든 케이스·테스트·구현과 추가 판정 규칙이다. 지침 자동 로드·등록 스킬 호출은 미확인으로 유지한다.
기준 커밋: `efbfff2f9071f2ac8cce4eb7da0fe514a79ea8ce`. 승인된 구현 커밋은 `aa0677c32a2224a04e8655d80f0e492b3e8751bc`이며, 원격 실행 근거는 E·F절에 기록했다.

## A. 위임 대상 선정 (사람이 쓴다)

- 첫 위임 기능(경계 분명, 테스트로 명세 가능): [`src/aleph/validation.py`](../../src/aleph/validation.py)의 `validate_solution_idea`. 모델의 출력 문자열과 비교 근거 유무를 받아 `OK`, `QUESTION_ERROR`, `OUTPUT_ERROR` 중 하나를 반환한다. 변경 범위는 함수가 있는 파일 하나다. 모델 호출, 후보 생성, 수학적 타당성 판단은 포함하지 않는다.
- 직접 담당할 것(아키텍처, 판단 기준): 모델 추출 → 출력 검증 → 후보 생성의 기능 경계를 정한다. AC1·AC2에 따른 필수 정보, null과 형식 오류의 구분, 비교 근거 없는 `transferable`의 금지, 오류 검사 순서와 골든 기대값을 확정한다. 원문 근거와 두 요소의 의미상 구별은 사람이 검토한다.
- 위임한 이유 / 직접 담당한 이유: 입력과 반환값이 명확하고 외부 모델 없이 같은 결과를 반복 검사할 수 있기 때문이다. / 기능 경계와 오류 판정은 제품의 기준이다. 구현 결과에 맞춰 기준을 낮추지 않도록 사람이 근거와 함께 확정해야 한다.


## B. 골든 케이스 — 완료 기준을 데이터로 (사람이 쓴다)

케이스 원본: [`tests/harness/golden_cases.yaml`](../../tests/harness/golden_cases.yaml). 이 문서에 데이터를 복제하지 않고 YAML을 실행 기준으로 사용한다.

- 정상 케이스: **5개**. 정상 구조와 비교 근거가 있는 전이 판단 / 경계 케이스: **13개**. null, 요소 개수, 빈 값과 형식 경계 / **금지 행동 검증 케이스**: **15개**. 비교 근거 없는 전이 판단, 추가 필드, 중복 키, 출력에 섞인 지시 등.
- 각 케이스 ↔ 대응 AC 번호: YAML의 `ac`와 `note`에 기록했다. AC1의 구조 계약과 AC2의 필수 값 누락 처리를 검사한다. 각 케이스의 이름과 기대 판정 근거도 같은 YAML에 있다.
- 판정 키 목록과 각 키의 검사 범위: `expect_status`는 반환 상태, `expect_error_code`는 오류 분류, `expect_idea`는 반환 객체 전체를 검사한다. 공통 단언문은 반환 키 4개, 오류 이유, OK 객체의 스키마를 검사한다. 문자열의 의미나 원문 근거는 검사하지 않는다.
- 결과에 여러 항목이 나오는 기능이라면 규칙의 오류를 드러낼 **정답 후보와 오답 후보**가 있는가: 해당 없음. 후보 목록이나 순위를 반환하지 않고 입력 한 건의 판정 객체를 반환한다. 정상·오류 입력을 별도 케이스로 둔다.
- fixture의 경로와 기준 버전(커밋): `docs/spikes/evidence/parse_query_check_01_raw.txt`부터 `05_raw.txt`까지 5개. 기준은 `efbfff2f9071f2ac8cce4eb7da0fe514a79ea8ce`다. 나머지 28개는 YAML에 직접 적은 합성 입력이다.
- 아직 다루지 못한 필수 AC와 보완할 케이스: 이번 함수의 범위는 AC1의 구조 검사와 AC2의 null 후처리다. AC1의 원문 근거·두 요소의 의미상 구별, AC2의 후보 생성 중단은 파이프라인 통합 때 별도 검사한다. 서로 같은 뜻의 두 문장, 원문에 없는 요소, 검증 실패 시 생성 함수 미호출을 보완할 예정이다. AC3~AC9 전체 검증은 이번 함수 밖이다.

## C. 테스트 하니스 위임 — 골든 테스트 러너 (에이전트가 쓰고 사람이 함께 본다)

- 테스트 하니스 위임 프롬프트: 아래 작업 지시를 사용했다. 현재 참조할 기준은 기존 스키마·파싱 프롬프트와 골든 YAML이며, 추가 결정은 E절에 기록했다.

```text
tests/harness/golden_cases.yaml을 읽는 tests/test_validation_golden.py를 작성한다.
- 읽을 문서: AGENTS.md, docs/SPEC.md AC1·AC2,
  docs/implementation/solution_idea_validation.md, 기존 SolutionIdea 스키마와 파싱 프롬프트.
- YAML의 name을 pytest ID로 쓴다. 기대값을 테스트 코드에 복사하지 않는다.
- expect_status, expect_error_code, expect_idea를 실제 반환값과 각각 대조한다.
- 반환 키는 네 개로 제한한다. 오류 이유는 비어 있으면 실패한다.
- 입력 fixture는 기존 원출력 5개다. 경로와 기준 커밋을 유지한다.
- 로더는 오타 키, 기대값 누락, 잘못된 타입, 중복 이름, 빈 케이스를 거부한다.
- 미구현은 실패로 드러낸다. skip, xfail로 감추지 않는다.
- collect-only 결과와 실제 실행 결과를 구분한다.
- 기대값 고정 임시 구현의 전수 통과를 먼저 확인한다.
- 스키마 생략, 근거 없는 전이 판정, null 허용, 오류 이유 누락을 차례로 주입한다.
- 예상한 케이스의 단언문 실패를 확인한다. 테스트와 기대값은 함께 바꾸지 않는다.
- 주입 전 구현을 바이트 단위로 복구하고 기준 파일 해시를 대조한다.
- 중단 조건: 검사 코드 보완 3회 초과, 기준 변경 필요, 문서 충돌이면 원인과 변경안을 보고한다.
```

- (1) 수집과 실행 확인: 골든 케이스 **33개** / 보조 검사 **21개** / 수집 노드 **54개** / **passed 54, failed 0, skipped 0, xfailed 0**. 골든만 실행한 결과는 33 passed다. YAML의 케이스 이름 33개와 실행 노드 33개가 일치했다.
- (2) 결함 주입 및 검출 확인: 통과 가능 확인 **passed 34, skipped 0**(골든 33개 + 로더 보조 1개). 구현에만 결함을 한 종류씩 주입했다. 실패해야 할 케이스와 단언문, 실제 결과는 다음과 같다.
  - **스키마 검사 생략:** `one_element`의 상태 일치 단언문이 `OK != OUTPUT_ERROR`로 실패했다. 골든 11 passed / 22 failed, 로더 1 passed.
  - **비교 근거 없는 전이 판단 허용:** `forbid_transferable_true_without_comparison`과 `forbid_transferable_false_without_comparison`의 상태 일치 단언문이 모두 `OK != OUTPUT_ERROR`로 실패했다. 골든 30 passed / 3 failed, 로더 1 passed.
  - **필수 null 허용:** `null_elements_only`와 `null_mechanism_only`의 상태 일치 단언문이 모두 `OK != QUESTION_ERROR`로 실패했다. 골든 28 passed / 5 failed, 로더 1 passed.
  - **오류 이유 누락:** `recorded_output_02`의 `isinstance(result["reason"], str) and result["reason"].strip()` 단언문이 빈 문자열 때문에 `missing reason`으로 실패했다. 골든 6 passed / 27 failed, 로더 1 passed.
  - 상태 일치 단언문은 `assert result["status"] == case["expect_status"], "status mismatch"`다. 각 주입 실행의 skipped·xfailed·수집 오류는 0건이고, 종료 코드는 모두 1이었다. 통과 가능 확인의 종료 코드는 0이었다.
- (3) 원복 및 재실행 확인: 백업 또는 체크포인트는 저장소 밖 로컬 작업 폴더의 `../lecture05-ready-verification/validation-before-injection.py.txt`다. / 정상 구현을 백업하고 결함을 한 종류씩 주입했다. 주입 후 백업을 복원했으며 구현 파일의 SHA-256은 주입 전후 `4e45785a10c72d771f14a0178c28a25812267855dbaa1056a36f42d2afc4fdee`로 같았다. 테스트·YAML·fixture·스키마의 해시도 주입 전후 같았다. 원복 후 **54 passed, failed 0, skipped 0, xfailed 0**과 Ruff 통과를 확인했다.
- 수정 금지 문장을 `AGENTS.md` 어디에 적었나: **4절 「위임 작업의 금지 사항」의 첫 번째 항목**. “사람이 확정한 테스트 코드·골든 케이스·fixture는 승인 없이 변경하지 않는다.”라고 적었다.

| 회차 | 걸린 것 | 무엇이 문제였나 | 무엇을 고쳤나 (프롬프트/케이스/테스트 코드) |
|---|---|---|---|
| 1 — 독립 검토 | 반환값 타입, YAML 중복 키, 기대 판정의 일관성 | Python에서는 true와 1이 같다고 비교됐다. 중복 cases 키가 앞의 33개 케이스를 덮어쓸 수 있었다. OK의 빈 객체와 잘못된 상태·오류 코드 조합을 로더가 허용했다. | 테스트 코드: 실제·기대 OK 객체의 스키마 검사, YAML 중복 키 거부, 상태별 오류 코드 검사를 추가했다. 보조 검사 6개를 추가했다. 프롬프트와 골든 입력·기대값은 변경하지 않았다. |
| 2 — 수정 후 재검토 | 앞 회차의 세 허점과 4종 결함 주입을 재검사 | 앞 회차의 잘못된 입력이 모두 거부됐다. 주입한 구현 결함도 지정한 단언문에서 검출됐다. 추가 필수 문제는 없었다. | 추가 수정 없음. 정상 구현을 복원하고 전체 54개 통과를 확인했다. |


## D. 기능 위임 — 프롬프트 원본 (사람이 쓴다)
```t
src/aleph/validation.py의 validate_solution_idea를 구현해줘.
- 목표: 모델 원출력 JSON을 기존 스키마와 필수 값 규칙으로 검사한다.
- 계약: docs/implementation/solution_idea_validation.md 2·3절.
- 절대 규칙: AGENTS.md 3·5절. 없는 풀이 정보를 보충하지 않는다.
- concept=null은 허용한다. 두 요소 또는 연결이 null이면 QUESTION_ERROR다.
- JSON/스키마 오류, 공백뿐인 값, 비교 근거 없는 transferable은 OUTPUT_ERROR다.
- 기존 스키마를 직접 읽는다. 원출력을 정정하거나 후보를 생성하지 않는다.
- 완료 검사: python -m pytest tests/test_validation_golden.py -v -rs
  골든 33개 전수 실행·통과, skip·xfail 0건. 보조 검사는 별도로 센다.
- 테스트, 케이스, fixture, 기존 스키마를 수정하지 않는다. 구현만 고친다.
- 중단 조건: 구현 보완 3회 초과, 미명세, 기준 변경 필요, 규칙 충돌이면 사람에게 보고한다.
- 실제 실행 출력과 각 케이스가 통과한 이유를 보고한다.
```

- 각 항목을 어느 파일의 어느 대목에서 옮겨 왔나: 목표·필수 정보는 `docs/SPEC.md` AC1·AC2, 절대 규칙은 `AGENTS.md` 3절, 검증 후 사용 원칙은 5절, 출력 구조는 `src/aleph/schemas/solution_idea.schema.json`, null·생략·비교 정책은 `src/aleph/prompts/parse_query.md`의 필드 매핑과 실패 모드에서 옮겼다. 추가 판정 규칙은 E절의 미명세 항목에 기록했고, 실제 오류 코드와 기대값은 `src/aleph/validation.py`와 골든 YAML에서 대조할 수 있다. 필수 33개와 기대값은 `tests/harness/golden_cases.yaml`에 있다. 보완 한도는 최대 3회이며 미명세·기준 변경·규칙 충돌 시 중단한다.
- 재사용 명령으로 등록한 프롬프트가 있다면: `$aleph-check`를 `.agents/skills/aleph-check/SKILL.md`에 등록했다. 파일을 수정하지 않고 Ruff·pytest를 실행해 보고하는 검사 명령이다. 기능 구현 프롬프트는 위 블록을 명시적으로 전달한다. 새 위임에서는 삭제된 계약 문서 대신 기존 스키마·파싱 프롬프트, 골든 YAML과 E절의 추가 결정 사항을 참조한다.

## E. 검증 루프 기록 (사람이 쓴다)

통과 수는 골든 케이스와 보조 검사를 구분했다.

| 회차 | 결과 | 무엇이 문제였나 | 무엇을 고쳤나 |
|---|---|---|---|
| 1 — 첫 구현 | **골든 33/33, 보조 15/15 통과** | 실행은 통과했으나 독립 검토에서 하니스의 검사 누락 3건을 발견했다. | 출력 검증기를 구현하고 하니스 보완 항목을 정리했다. |
| 2 — 하니스 보완 | **골든 33/33, 보조 21/21 통과** | 반환 타입, YAML 중복 키, 기대 판정의 일관성 검사가 부족했다. | C절의 검사와 보조 6개를 추가했다. 결함 4종의 검출과 구현 원복을 확인했다. |
| 3 — 별도 세션 최초 검사 | **골든 33/33, 보조 9개 통과·12개 오류** | 임시 경로 설정 때문에 보조 검사 12개에서 setup 오류가 발생했다. | 경로를 `--basetemp` 인자로 전달하도록 보정했다. |
| 4 — 경로 보정 후 재검사 | **골든 33/33, 보조 21/21 통과** | 추가 오류 없음. | 파일 수정 없이 수동 검사를 다시 실행했다. |
| 5 — 승인 후 CI | **골든 33/33, 보조 21/21 통과** | 추가 오류 없음. | `feature/my-work`에 push하고 자동 CI 통과를 확인했다. |

- 수용 판단(무엇을 확인하고 병합했나): 2026-10-28 골든 33개·보조 21개와 Ruff 통과, 결함 검출·원복, 기준 파일 보존을 확인해 출력 검증기를 최종 수용했다. 이후 원격 CI도 통과했다. 수용은 구현·검증 후에 진행했으며 main에는 아직 병합하지 않았다.
- 실행한 커밋과 명령, 로그 위치: 1~4회차는 기준 커밋 `efbfff2`에 추가한 미커밋 작업본, 5회차는 구현 커밋 `aa0677c`에서 검사했다. 실행 결과는 위 표, 결함별 실패 단언문과 원복 근거는 C절에 기록했다. 원격 로그는 [구현 커밋 CI](https://github.com/Imeanstar/capstone-2026-team6/actions/runs/40671393760)와 [기록 갱신 커밋 `562318f`의 CI](https://github.com/Imeanstar/capstone-2026-team6/actions/runs/40671835797)에서 확인할 수 있다. CI 검사 명령은 다음과 같다.

```sh
python -m pytest tests/test_validation_golden.py --collect-only -q
python -m pytest -q -rs
python -m ruff check .
```

- 각 회차의 skipped / xfailed와 보조 검사 결과: 보조 검사 결과는 표에 구분했다. 모든 회차의 failed·skipped·xfailed는 0건이다. 단, 3회차는 setup 오류 12건으로 전체 검사가 실패했고 4회차에 해소했다. 최종 결과는 **54 passed, errors·skipped·xfailed 0건**이다.
- 한 회차에 끝났다면 제공한 컨텍스트와 추가로 확인한 근거: SPEC AC1·AC2, AGENTS, 기존 스키마·파싱 프롬프트와 골든 케이스를 제공해 첫 구현에서 33개가 통과했다. 이후 하니스 보완과 결함 주입 검사를 수행했으므로 전체 작업이 한 회차에 끝난 것은 아니다.
- 새로 발견한 미명세 항목과 반영 위치: 형식 오류와 필수 null의 구분, 공백·중복 키 거부, 비교 근거 없는 전이 판단 금지와 오류 검사 순서를 확정했다. 세부 규칙은 [SPEC 5.1절](../SPEC.md#51-풀이-아이디어-출력-검증--ac1ac2의-세부-규칙), 기대값은 골든 YAML, 기준 보호는 AGENTS 4·6절에 반영했다.

## F. 구현 코드 (에이전트가 쓰고 사람이 검증한다)

구현 파일: [`src/aleph/validation.py`](../../src/aleph/validation.py)의 `validate_solution_idea`.
체크 표시는 실행 기록·코드 대조, 2026-10-28 사용자 승인과 E절 5회차의 원격 CI 결과에 따른 상태다.

### 사람이 검증할 것

- [x] 필수 골든 케이스가 전부 실행되고 통과했는가(skip 및 xfail 0건)
- [x] 실제 실행 출력과 **케이스별 통과 이유 설명**을 함께 받았는가
- [x] 설명이 팀의 판정 기준과 일치하는가(기준과 다른 이유로 통과하지 않았는가)
- [x] 승인된 기준 커밋과 비교해 **테스트, 케이스 및 fixture에 승인 없는 변경이 없는가**(커밋된 변경과 새 파일 포함)
- [x] 스펙의 필수 조건이 점수나 가중치가 아니라 **판정 조건**으로 구현되었는가(단골: 식이제약의 하드 필터)
- [x] 스펙에 없는 동작을 사람이 검토하고 필요한 규칙과 테스트를 보완했는가
- [x] 합의한 린트와 CI 검사도 통과했는가
- [x] 팀원 누구나 통과 근거를 설명할 수 있는가

### 우리 팀

- 수용한 커밋 / 비교한 기준 커밋: **2026-10-28 승인한 작업본을 커밋한 `aa0677c32a2224a04e8655d80f0e492b3e8751bc`** / `efbfff2f9071f2ac8cce4eb7da0fe514a79ea8ce`. 기준 커밋 대비 신규 테스트·골든 케이스와 보완 이력을 포함해 승인했다. 기존 fixture의 내용은 기준 커밋과 같다. 검증 당시 승인 상태 갱신 전의 파일 해시는 로컬 `../lecture05-ready-verification/mutation_summary.json`에 있다. 승인 시 문서의 승인 기록과 YAML의 주석·`review_status`를 갱신했고 케이스 입력·기대값은 유지했다. CI 확인 후에는 이 문서에 실행 근거만 추가했다.
- 수용 전에 되돌려 보낸 것이 있었다면 그 이유: C절의 독립 검토에서 테스트 하니스의 허점 3개를 발견해 보완했다. boolean과 숫자의 혼동, YAML 케이스 덮어쓰기, 잘못된 기대 판정이 통과할 수 있었기 때문이다. 보조 검사 6개와 검증 로직을 추가한 뒤 재검토했다. 사람의 반려나 승인 이력으로 기록한 것은 아니다.

## G. 에이전트 하니스 구성 (사람이 쓴다)

### 우리 팀

- 도구와 버전, 진입점 파일 및 로드 확인 결과: 2026-10-28 별도 세션에서 **codex-cli 0.157.1**, Python 3.12.14, Ruff 0.11.13, pytest 8.3.5를 확인했다. 앱 도구가 보고한 설치 버전은 26.1021.31345, 빌드는 21828이며 실행 중인 빌드와의 일치는 미확인이다. 진입점은 저장소 루트의 `AGENTS.md`다. 별도 세션은 대상 저장소가 아닌 `C:/Users/user/Documents/Codex/2026-10-28/5-c-users-user-documents-codex`에서 시작했다. 저장소 지침은 작업 중 직접 읽었다. **지침 자동 로드, 프로젝트 신뢰 상태, 저장소 설정 로드는 미확인**이다. 대상 저장소에서 시작한 세션의 자동 인식을 검증한 결과로 보지 않는다. 별도 세션의 실행 결과는 E절에 기록했다.
- 허용(allow)한 명령 / 확인(ask) 대상 명령: **작업상 허용**은 저장소 읽기, `git status`, `git diff`, `git ls-files`, 프로젝트 Python으로 실행하는 Ruff·pytest다. / **사전 확인 대상**은 `git push`, 기준 파일 변경, 새 의존성 설치와 허용 범위 밖 접근이다. 현재 명시된 사용자 조건에 따라 push는 최종 검토 전 실행하지 않는다. 이 구분은 작업 규칙이며, Codex 설정에 명령별 allow/ask 목록을 등록한 것은 아니다. 저장소 설정 파일의 값은 `approval_policy="on-request"`, `sandbox_mode="workspace-write"`, `network_access=false`다. 별도 세션이 제공한 정책은 `sandbox_mode=workspace-write`, `approvals_reviewer=auto_review`, 파일시스템·네트워크 제한이다. 정확한 `approval_policy`와 저장소 설정의 실제 적용 여부는 미확인이다. 설정값만으로 push 확인이나 테스트 파일 쓰기 차단이 강제된다고 주장하지 않는다.
- 판정 기준 보호: 금지 사항의 위치 **`AGENTS.md` 4절 첫 항목과 skip·xfail 금지 항목** / 수용 전 확인 방법 **기준 커밋과 tracked 변경을 비교하고, untracked 파일을 별도로 열어 확인한다.** `git diff efbfff2f9071f2ac8cce4eb7da0fe514a79ea8ce -- tests src/aleph/schemas docs/spikes/evidence`, `git ls-files --others --exclude-standard`, 로컬 `../lecture05-ready-verification/mutation_summary.json`의 해시를 함께 사용한다. 테스트 파일은 쓰기 가능한 경로에 있으므로 지침만으로 쓰기가 차단되지는 않는다.
- 사용하는 코딩 에이전트와 각 항목의 파일 위치: **Codex**. 지침 로드는 `AGENTS.md`, 권한 설정은 `.codex/config.toml`, 재사용 명령 본문은 `.agents/skills/aleph-check/SKILL.md`, 자동 호출 정책은 `.agents/skills/aleph-check/agents/openai.yaml`, 작업별 범위·중단 조건·보고는 이 문서 C·D·G절, CI는 `.github/workflows/tests.yml`에 둔다. Codex 대응 경로를 사용하므로 Claude 전용 파일은 만들지 않는다.
- 등록한 재사용 명령과 실행 범위(검사와 보고 / 수정 포함), 자동 호출 여부: **`$aleph-check` — 검사와 보고만 수행, 수정 없음, 자동 호출 끄기로 설정.** Ruff → pytest 수집 → 전체 pytest를 실행한다. 소스·테스트·골든·fixture·설정 수정과 패키지 자동 설치는 하지 않는다. `agents/openai.yaml`에는 `policy.allow_implicit_invocation: false`를 지정했다. **별도 세션의 등록 스킬 목록에는 없었고, 명시적 호출 성공은 미확인**이다. 스킬 파일을 직접 읽고 절차를 수동 실행해 Ruff와 최종 54개 테스트를 통과했다. 수동 실행을 스킬 호출 성공으로 기록하지 않는다.
- 작업별 중단 조건과 보고 방법: **테스트 하니스 보완 최대 3회, 구현 보완 최대 3회, `$aleph-check`는 검사 묶음 1회**로 제한한다. 기준 변경 필요, 미명세, 문서 충돌, 실행 권한·의존성 문제를 만나면 영향을 받는 작업을 중단한다. 실패 케이스, 실행 명령·종료 코드, 원인, 변경이 필요한 파일과 제안을 보고한다. C절에는 하니스 보완을, E절에는 구현·재검증 회차를 기록한다. 통과를 만들기 위한 케이스 삭제나 skip·xfail 추가는 금지한다.
  이번 수동 점검에서는 실행자가 지정한 임시 경로 오류를 보정해 pytest를 1회 추가 실행한 예외를 E절에 기록했다. 보고서에 따르면 검사 전후 431개 파일의 내용 해시와 Git 상태가 같았다. `.git`과 `.venv` 내부는 해시 비교에서 제외했다.

### 테스트 하니스와의 연결

| 연결 항목 | 에이전트 하니스에 두는 곳 | Aleph |
|---|---|---|
| 실행 명령 | `AGENTS.md` 6·7절, 이 문서 C·D절, `$aleph-check` | Ruff, pytest 수집, 전체 테스트. 골든 33개 전수 통과와 skip·xfail 0건 |
| 실행 권한 | `.codex/config.toml`, 현재 세션의 상위 정책 | workspace-write / on-request / 네트워크 비활성. 프로젝트 설정의 실제 적용 여부와 작업상 허용을 구분 |
| 판정 기준 보호 | `AGENTS.md` 4절, 이 문서 F·G절 | 승인 없는 기준 변경 금지. 기준 커밋 diff, 새 파일, 주입 전후 해시 대조 |
| 완료의 정의 | `AGENTS.md` 6절 | 필수 골든 통과, Ruff 통과, 개념·타입 일관성, 변경과 한계의 근거 보고 |
| 결과 보고 | 이 문서 D·E절, `$aleph-check` | 실제 실행 출력, 골든·보조 수, passed/failed/skipped/xfailed, 케이스별 이유 |
| 중단 조건 | 이 문서 C·D·G절, `$aleph-check` | 보완 한도, 미명세·규칙 충돌·기준 변경 필요 시 보고. 검사 명령은 수정하지 않고 종료 |

프로젝트 설정은 신뢰 상태와 상위 정책의 영향을 받는다. 설정 파일이 존재한다는 사실과 현재 세션에서 그 설정이 강제된다는 사실은 구분한다. [OpenAI 설정 기본](https://learn.chatgpt.com/docs/config-file/config-basic), [설정 참조](https://learn.chatgpt.com/docs/config-file/config-reference).
명시적 스킬 호출과 자동 호출 정책은 [OpenAI 스킬 문서](https://learn.chatgpt.com/docs/build-skills)에 따라 확인했다. 확인일: 2026-10-28.

### 실행 환경과 재사용 명령

Python 3.12에서 저장소 루트에 가상환경을 만들고 개발 의존성을 설치한다. 이미 설치된 환경에서는 설치를 반복하지 않는다.

```powershell
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements-dev.txt
.venv/Scripts/python.exe -m ruff check .
.venv/Scripts/python.exe -m pytest tests/test_validation_golden.py --collect-only -q
.venv/Scripts/python.exe -m pytest -q -rs
```

macOS·Linux는 `.venv/bin/python`을 사용한다. 골든만 실행할 때는 `python -m pytest tests/test_validation_golden.py::test_validation_golden -v -rs`를 쓴다.
자동 인식 재확인은 `C:/Users/user/Documents/Codex/2026-10-07/https-github-com-imeanstar-capstone-2026/work/lecture05-review`를 시작 작업 폴더로 지정한 새 세션에서 수행한다. 지침과 `$aleph-check`의 인식 근거를 먼저 확인하고, 등록 명령으로 실행한 결과를 수동 실행과 구분해 기록한다.
