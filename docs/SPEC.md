# 제품 스펙 (SDD)과 수용 기준

> 문제와 증거는 [PROBLEM.md](PROBLEM.md), 도메인 대표어는 [ontology.yaml](ontology.yaml)을 정본으로 삼는다.

## 1. 문제

수학 연계문항 제작·검토자는 원문의 핵심 풀이 의도를 유지하면서 후보 문항의 조건과 풀이가 성립하는지 확인하기 위해 수정과 재검토를 반복한다. 자세한 근거와 반증 조건은 [문제 정의서](PROBLEM.md)에 둔다.

## 2. 타깃 사용자

- **1차 사용자:** 원본문항을 바탕으로 연계문항을 만들고 검토하는 수학 문항 제작자와 학원 수학 강사. (로그 1~10)
- **현재 비대상:** 학생용 문제 풀이 서비스, 비수학 문항 제작, 문항 판매·정산 업무.

## 3. 핵심 기능 — 한 문장

업로드한 원본문항과 해설에서 핵심 풀이 요소 두 가지와 그 연결 메커니즘을 구조화하고, 이를 응용한 새 문항과 풀이를 만든 뒤 수학적 성립·교육과정 문제를 검토 근거와 함께 제시한다.

## 4. 범위

**포함**

- 원본문항과 해설을 이미지, 수식·텍스트, 또는 두 형식의 조합으로 받는다. 이미지 속 문항과 수식을 읽어 입력으로 활용하며, 판독이 불명확하면 확인을 요청한다.
- 원본문항과 해설에서 `SolutionIdea.concept`, 근거 있는 `key_elements` 두 개, 두 요소의 `mechanism`을 추출한다. 현재 산출물: `src/aleph/schemas/solution_idea.schema.json`, `src/aleph/prompts/parse_query.md`.
- `GenerationRequest`의 사용 목적과 목표 난도를 받아 두 요소의 메커니즘을 응용한 `Question(CANDIDATE)` 및 풀이를 생성한다.
- 후보의 조건 누락·경계값·적용 조건·수학적 성립과 교육과정 문제에 관한 잠정 검토 정보와 이유를 제시한다. (로그 3, 4, 7, 8, 9, 10)

**비포함**

- 결제·판매·정산, PDF 수식 복원, 공간도형 자동 작도, 비수학 문항 생성.
- 실제 학생 풀이 데이터 없이 정답률이나 체감 난도를 확정하는 기능.
- 모든 수학 영역에서 전문가 검수 없이 상용 품질을 보장한다는 주장.

비포함 항목은 [온톨로지의 범위 밖](ontology.yaml)과 맞춘다.

## 5. 인터페이스

`generate_linked_question`과 `review_candidate`는 사용자에게 제공할 논리적 호출과 입출력 형태를 나타낸다.

- `generate_linked_question` — 입력: `{source_question: {problem: {image?, text?}, explanation: {image?, text?}}, intended_use, target_level, curriculum_scope}` → 출력: `{candidate_question: {statement, solution}, solution_idea: {concept, key_elements[2], mechanism, transferable?}, review_result: {validity_issue, curriculum_issue, verdict, reason, reviewer_type, approval_status}}`. `text`에는 수식 표현을 포함할 수 있고, 문제와 해설 각각에 이미지·텍스트 중 하나 이상이 필요하다. 두 형식을 함께 보내도 된다.
- `review_candidate` — 입력: `{source_question: {problem: {image?, text?}, explanation: {image?, text?}}, candidate_question: {statement, solution}, curriculum_scope}` → 출력: `{review_result: {validity_issue, curriculum_issue, verdict, reason, reviewer_type, approval_status}}`. 이미 만들어진 후보를 새로 생성하지 않고 검토만 한다. 사람이 결함 여부를 확정한 후보를 넣어 AC3·AC4·AC5를 판정하는 입구다.
- 생성 직후의 `review_result`는 AI가 제시하는 **잠정 검토 기록**이다. `verdict`가 `USE`여도 사람의 검수 통과를 뜻하지 않는다. AI가 낸 `review_result`의 `approval_status`는 항상 `PROVISIONAL`이며, `APPROVED`는 수학 강사의 최종 사용 승인에만 쓴다.
- 원문 해설에서 근거 있는 핵심 요소 두 개나 그 연결 메커니즘을 확인할 수 없을 때 → `QUESTION_ERROR`와 이유를 반환하고 후보를 만들지 않는다. 이미지가 판독 불가이거나 이미지·텍스트 내용이 충돌하면 추측하지 않고 확인이 필요한 부분을 반환한다. (AC2, AC9)

## 6. 수용 기준

각 AC의 조건 유형을 표시했다. AC 번호는 `tests/harness/golden_cases.yaml`의 골든 케이스와 연결할 예정이다.

| 번호 | 유형 | 수용 기준 | 판정 예시 |
|---|---|---|---|
| AC1 | 이벤트 기반 | 원본문항과 해설에서 풀이 아이디어를 추출할 때, Aleph는 `SolutionIdea` 스키마에 맞게 근거 있는 핵심 풀이 요소 두 개와 두 요소의 연결 메커니즘을 출력한다. | 정상 골든 케이스에서 `key_elements`가 정확히 두 개이고 `mechanism`이 비어 있지 않으며 JSON 스키마 검증을 통과한다. |
| AC2 | 예외 대응 | 해설에서 근거 있는 핵심 풀이 요소 두 개나 그 연결을 확인할 수 없을 때, Aleph는 `QUESTION_ERROR`와 이유를 반환하고 후보 생성을 진행하지 않는다. | 한 요소만 확인되는 입력에서 임의의 두 번째 요소나 후보 문항이 나오면 실패한다. |
| AC3 | 이벤트 기반 | Aleph가 후보 문항을 제시할 때마다, 원문에서 추출한 두 요소와 연결 메커니즘이 후보 풀이에서 어떻게 응용됐는지 `ReviewResult.reason`에 기록한다. 원문의 수치·기호만 바꾼 후보는 잠정 `ReviewResult.verdict=USE`로 표시하지 않는다. | 두 요소 중 하나의 역할이나 연결 근거가 빠지면 실패한다. 전문가가 메커니즘이 응용되지 않았거나 수치·기호만 바뀌었다고 표시한 골든 케이스를 `USE`로 판정해도 실패한다. |
| AC4 | 예외 대응 | 반례·정의역 누락·경계값 오류가 확인된 후보를 검토할 때, Aleph는 `ReviewResult.validity_issue=true`와 이유를 제시하고 잠정 `USE`를 추천하지 않는다. | 로그 3, 4, 6, 7, 8, 10 유형의 오류가 확인된 골든 케이스에서 결함을 놓치거나 `USE`를 추천하면 실패한다. |
| AC5 | 예외 대응 | 교육과정 범위를 벗어난 후보를 검토할 때, Aleph는 `ReviewResult.curriculum_issue=true`와 이유를 제시하고 잠정 `USE`를 추천하지 않는다. | 로그 9 유형의 교육과정 이탈이 확인된 골든 케이스에서 결함을 놓치거나 `USE`를 추천하면 실패한다. |
| AC6 | 상시 적용 | 실제 학생 풀이 데이터가 없으면, Aleph는 `DifficultyProfile.student_verified=true`나 실측 정답률이라고 표현한 값을 만들지 않는다. | 학생 풀이 데이터가 없는 케이스에 검증됨 표시나 실측 수치가 있으면 실패한다. |
| AC7 | 이벤트 기반 | 후보 생성이 끝나면, Aleph는 문항·풀이와 잠정 `ReviewResult.verdict`, `reason`을 함께 제시하고 이를 최종 사용 승인으로 표시하지 않는다(`ReviewResult.approval_status=PROVISIONAL`). | 후보만 있고 풀이·검토 이유가 빠지거나 AI의 잠정 판정을 최종 승인으로 표시하면 실패한다. AI가 낸 `review_result`의 `approval_status`가 `PROVISIONAL`이 아니면 실패한다. |
| AC8 | 이벤트 기반 | 원문·해설이 이미지와 수식·텍스트 중 한 형식 또는 두 형식의 조합으로 입력되면, Aleph는 확인 가능한 문항·수식을 읽어 동일한 풀이 요소 추출 흐름으로 처리한다. | 같은 문항의 이미지·텍스트·혼합 입력 골든 케이스에서 핵심 두 요소가 일치해야 한다. |
| AC9 | 예외 대응 | 원문·해설 이미지가 판독 불가이거나 이미지와 텍스트의 내용이 서로 충돌할 때, Aleph는 수식을 추측하지 않고 확인이 필요한 부분을 반환한다. | 흐리거나 서로 충돌하는 입력 골든 케이스에서 수식을 지어내면 실패한다. |

AC3·AC4·AC5는 사람이 오류 여부를 확정한 골든 케이스를 `review_candidate`로 입력해 AI의 **잠정 검토 결과**와 대조한다. AI의 검토는 최종 사용 판정을 대신하지 않는다.

**스파이크에서 확인한 AC4 점검 사례:** [Artist 미적분 Main 재실험 A1](spikes/artist_calculus_retest.md)에서 짝수 번째 부분합의 수렴만 보고 공비 `−1`을 바로 배제한 최초 해설의 누락을 발견했다. 같은 유형의 경계값이 있는 문항에서는 예외를 원문 조건으로 배제하는 이유까지 풀이에 있어야 한다. 사람 검토에서도 A1은 해설 완결성 미흡으로 불통과했으며, 이 사례를 향후 AC4 골든 케이스의 후보로 보관한다.

**전체 평가 목표:** [PROBLEM.md](PROBLEM.md#5-성공의-정의)에 정한 개발자 1차 통과율과 수학 강사 2차 통과율은 각각 **70% 이상**이다. 개발 과정에서 생성한 문항 묶음을 개발자가 먼저 평가하고, 1차 통과율이 70% 이상일 때 수학 강사에게 2차 평가를 요청한다. 강사의 사용 승인이 최종 판정이다. 이 비율은 여러 후보를 대상으로 재는 제품 품질 지표이며, 개별 입력에 대한 AC와 구분한다.
