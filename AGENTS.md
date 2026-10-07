# AGENTS.md — Aleph 작업 규칙

> 제품의 **무엇을 만들지**는 [SPEC.md](docs/SPEC.md), 도메인 구조는 [ontology.yaml](docs/ontology.yaml)이 정본이다. 이 문서는 코딩 에이전트가 매 작업에서 읽을 최소 어휘와 규칙만 둔다.

## 1. 제품 맥락

Aleph는 업로드한 수학 원문항과 해설에서 핵심 풀이 요소 두 가지의 연결 메커니즘을 찾아, 이를 응용한 후보 문항을 만들고 검토하도록 돕는 제품이다. 이미지와 수식·텍스트 입력을 함께 받을 수 있다. 사용자 근거는 [인터뷰 기록](docs/research/interviews.md)에 있다.

## 2. 도메인 용어집

전체 설명·근거·관계는 `docs/ontology.yaml`을 읽는다. 여기에는 작업 중 이름이 흔들리면 안 되는 대표어와 필드만 둔다.

- QuestionDeveloper: `role`(수학 문항 제작자/학원 수학 강사)
- GenerationRequest: `intended_use`(문항 사용 목적), `curriculum_scope`(허용할 수업·교육과정 범위)
- Question: `question_role`(`SOURCE`/`CANDIDATE`), `statement`, `topic`, `solution`
- Condition: `content`, `role`, `boundary_rule`, `applicability_rule`, `curriculum_aligned`
- SolutionIdea: `concept`, `key_elements`(핵심 풀이 요소 목록, 2개), `mechanism`(두 요소의 연결), `transferable`(원문·후보 풀이를 비교할 때만 판단)
- DifficultyProfile: `target_level`(목표 난도), `student_verified`(실제 학생 풀이로 검증했는지)
- ReviewResult: `validity_issue`, `curriculum_issue`, `verdict`(`USE`/`REVISE`/`HOLD`/`REJECT`), `reason`, `reviewer_type`(`SELF`/`PEER`/`AI` — 검토 주체의 종류이며 1·2차 검수 단계와 별개), `approval_status`(`PROVISIONAL`/`APPROVED` — AI가 낸 결과는 항상 `PROVISIONAL`)

## 3. 절대 규칙

아래 규칙은 `docs/SPEC.md`의 AC와 대응한다.

1. 원문 해설에서 서로 다른 핵심 풀이 요소 두 개와 연결 메커니즘을 확인하지 못하면 문항 오류로 처리하고 후보를 만들지 않는다. 읽을 수 없는 이미지나 충돌하는 입력의 수식을 추측하지 않는다. (↔ AC1, AC2, AC8, AC9)
2. 제시한 후보에는 원본문항과의 연결, 두 요소의 메커니즘을 어떻게 응용했는지의 검토 근거를 드러낸다. 원문의 수치·기호만 바꾼 후보를 `USE`로 표시하지 않는다. (↔ AC3)
3. 알려진 수학적 결함이나 교육과정 이탈이 있는 후보를 `USE`로 표시하지 않는다. 검증하지 않은 후보를 검증 완료로 표현하지 않는다. (↔ AC4, AC5)
4. 실제 학생 풀이 자료 없이 정답률을 실측값으로 쓰거나 `DifficultyProfile.student_verified=true`로 표시하지 않는다. (↔ AC6)
5. 후보와 풀이를 내놓을 때 검토 이유를 함께 제공하고, AI의 잠정 판정을 사람의 최종 승인으로 표시하지 않는다. (↔ AC7)

## 4. 위임 작업의 금지 사항

- 사람이 정한 수용 기준과 골든 케이스를 실패를 피하려고 임의로 낮추거나 삭제하지 않는다. 팀이 명시적으로 기준 변경을 요청하면 관련 문서와 테스트를 함께 갱신한다.
- 테스트를 통과시키기 위해 검증을 건너뛰거나 `skip`·`xfail`을 추가하지 않는다.
- 실행하지 않은 테스트·평가를 통과했다고 보고하지 않는다. 수학적 타당성이나 학생 검증도 근거 없이 확정하지 않는다.

## 5. 코딩 컨벤션

- 도메인 이름과 필드명은 `docs/ontology.yaml` 및 `src/aleph/schemas/solution_idea.schema.json`과 맞춘다. 새 개념이 필요하면 정본을 먼저 갱신할지 팀에 제안한다.
- 런타임 프롬프트는 `src/aleph/prompts/`에 두고 코드 문자열에 복제하지 않는다. 프롬프트 전송부가 바뀌면 `prompt_version`과 변경 이력을 함께 갱신한다.
- 파서 출력은 JSON 파싱과 스키마 검증 후에 사용한다. `null`·생략·형식 오류를 구분하며 정보 부족을 재호출만으로 메우지 않는다.
- 후보 생성, 수학적 검토, 사용자에게 보이는 판정을 분리한다. 검토 근거와 입력 출처를 결과에서 추적 가능하게 한다.

## 6. 완료의 정의

- 변경한 기능이 확정된 AC와 연결된 골든 케이스를 통과한다. 아직 확정된 AC와 골든 케이스가 없으면 해당 기능의 완료를 주장하지 않는다.
- 실행한 검사와 결과, 확인하지 못한 수학적 조건, 남은 결정을 변경 요약에 적는다.
- 문서·스키마·프롬프트·코드에서 같은 개념을 같은 이름으로 사용한다.

## 7. 운영 정보

- `docs/research/interviews.md` — 사용자 진술과 로그 번호.
- `docs/ontology.yaml` — 도메인 대표어와 근거.
- `docs/PROBLEM.md` — 왜 만드는가; `docs/SPEC.md` — 무엇을 만들고 어떻게 판정하는가.
- `src/aleph/schemas/solution_idea.schema.json` — 구조화 출력 계약; `src/aleph/prompts/parse_query.md` — 런타임 프롬프트.
- `docs/ARCHITECTURE.md` — 구성요소·도구·데이터 흐름.
