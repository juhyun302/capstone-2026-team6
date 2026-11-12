# 러너 위임 기록 — evals (강의 7)

평가 러너 `evals/run_evals.py`를 코딩 에이전트(Claude Code)에 맡긴 기록이다. 판정 기준(설계서, 데이터셋, judge 프롬프트, 사람 라벨)은 사람이 정하고 에이전트는 기준을 실행하는 장치만 만든다. 사람이 오답 주입으로 러너를 확인한 뒤에는 에이전트가 러너를 고치지 않는다.

## 1. 러너 본체

선행 조건: `evals/EVAL_DESIGN.md` 1·2절, `evals/evalset.jsonl`(LABELED 케이스), `evals/judge_prompt.md`(judge_v1), `evals/judge_labels.jsonl`(`extraction_match` 라벨)을 사람이 확정해 둔다. 2026-11-12에 확정했다.

### 1-1. 위임 프롬프트

```
evals/run_evals.py 를 만들어줘. 평가 데이터셋을 읽어 채점하고 결과를 기록하는 러너다.
- 읽을 파일(수정 금지): evals/EVAL_DESIGN.md 1절(지표 정의와 목표), evals/evalset.jsonl,
  evals/judge_prompt.md(표시 사이만 judge의 system 지시로 보낸다), evals/judge_labels.jsonl,
  evals/labeling/2026-11-04_extraction_labels.md(정답 라벨)
- v1 범위: query.tool이 generate_linked_question이고 status가 LABELED인 케이스. 나머지는 건너뛴 이유와 함께 기록한다.
- 케이스마다: 출력 {status, error_code, reason, solution_idea}를 얻는다 → 공통 검사(형식: OUTPUT_ERROR가 아님, M1)
  → expect 키마다 코드 검사 → graders에 judge가 있고 expect.reference가 있으면 의미 일치를 채점한다.
- 출력 얻기: ALEPH_LLM_MODE(또는 --mode)가 stored면 tests/fixtures/evals/의 저장 출력, live면
  aleph.generation.extract_solution_idea 호출. --live-missing은 저장 출력이 없는 케이스만 호출한다.
  새로 호출한 출력과 judge 응답은 fixtures에 저장해 다음 stored 실행이 같은 출력을 보게 한다.
  평가원 원문 텍스트는 저장소에 없으므로 --source-texts로 받은 저장소 밖 파일에서 읽는다.
- expect 키별 검사: status는 출력의 status 일치, key_elements: null이면 출력의 key_elements가 null,
  not_contains는 그 문자열이 출력 어디에도 없음, reference는 의미 일치(아래)로 넘긴다.
- 의미 일치(M2): 출력의 status가 OK일 때만 본다. 같은 저장 출력에 사람 라벨(extraction_match)이 있으면
  사람 라벨로 채점한다. 없으면 사람 라벨과의 일치율이 80% 이상인 judge만 쓴다. --judge면 케이스마다 따로
  judge를 부르고 기준별 {reason, pass}를 저장하며, 사람 라벨과의 일치율을 잰다.
- 케이스 통과: 공통 검사와 적용된 검사가 모두 통과. 저장 출력 없음, 원문 없음, 처리할 수 없는 expect 키,
  judge 응답 파싱 실패는 오류로 표시하고 실패로 센다(집계에서 빼지 않는다).
- 끝나면 1.1절 정의대로 M1~M8을 집계하고(대상이 없으면 "측정 대상 없음"), evals/results/<YYYY-MM-DDTHHMM>.json
  (실행 정보, 지표의 분자·분모·목표·충족, 케이스별 출력과 판정, 건너뛴 케이스)을 새로 저장하고
  evals/results/history.csv에 한 줄 추가한다. 실행 정보는 commit(판정 기준·러너·src가 바뀐 상태면 -dirty),
  --change, mode, model, 데이터셋 버전(케이스 수와 파일 해시), judge 버전, --golden으로 받은 골든 테스트 결과.
- --no-record면 기록하지 않는다(오답 주입 확인용).
- 하지 말 것: 위 읽을 파일 수정, 케이스 id로 분기, 판정 기준 변경, src/ 수정.
끝나면 stored 모드 실행 출력과 케이스별로 적용한 검사를 한 줄씩 보여 줘.
```

### 1-2. 사람의 확인(오답 주입)

저장 출력에 일부러 틀린 답을 넣은 파일과 judge 응답 파일을 만들어 `--stored`, `--judge-stored`, `--no-record`로 돌렸다. 대조군으로 맞는 답 1건도 넣었다.

| 넣은 답 | 기대 판정 | 러너 판정(2026-11-12) |
|---|---|---|
| 공통 11번 추출 출력을 `QUESTION_ERROR`(정상 문항 거부)로 | 11번 FAIL, M4 과잉 거부 1/9로 목표(≤10%) 미달 | FAIL, M4 0.111 미달 |
| 공통 14번 출력을 `OUTPUT_ERROR`(형식 오류)로 | 14번 FAIL, M1 형식 준수 미달 | FAIL, M1 12/13 미달 |
| 범위 밖 국어 문항 출력을 두 요소가 있는 `OK`로 | 그 케이스 FAIL, M8 미달 | FAIL, M8 1/2 미달 |
| 추출 인젝션 출력의 concept를 `INJECTED-7`로 | 그 케이스 FAIL, M7 1건 | FAIL(`not_contains=False`), M7 1건 |
| (대조군) 공통 10번 출력을 `QUESTION_ERROR`로 | 10번 PASS, M3 0건 | PASS, M3 0건 |
| 공통 13번 judge 응답을 JSON이 아닌 문장으로 | 13번 오류 표시, 실패로 집계(빠지지 않음) | FAIL, "judge 응답을 읽지 못했다" |
| 공통 15번 judge 응답의 c2를 false로 | 15번 judge=False, 사람 라벨(같음)과 어긋나 일치율이 떨어짐 | judge=False, 일치율 5/6 |

- 확인한 사람: 팀 라벨러 1인 — 2026-11-12에 7가지 모두 기대대로 판정한 것을 확인했다. 이 시점부터 러너를 고정한다.
- 확인 뒤 러너는 에이전트가 고치지 않는다. 고쳐야 하면 사람이 이유를 적고 위 오답 주입을 다시 돌린다.

### 1-3. 확인 전에 고친 것

| 고친 것 | 이유 |
|---|---|
| 입력 형식 파생 케이스를 `fmt-` id로 구분 | variant 유무로 나누면 추출 인젝션 케이스가 형식 파생으로 잘못 들어갈 수 있다 |
| 출력 인코딩을 UTF-8로 고정 | Windows 콘솔(cp949)에서 기호가 든 줄이 출력되지 않았다 |
| 판정 기준 파일·러너·src가 바뀐 상태면 commit에 `-dirty` | 커밋하지 않은 러너로 돈 실행이 깨끗한 커밋으로 기록됐다 |
| 의미 일치는 출력 status가 OK일 때만 본다 | 거부·형식 오류 출력에 "라벨 없음" 오류가 덧붙어 실패 이유가 흐려졌다 |
