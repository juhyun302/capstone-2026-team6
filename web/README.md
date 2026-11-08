# Aleph 웹 초안

Aleph(수학 연계문항 생성·검토 도구)의 실제 구동용 프론트엔드 초안입니다. 저장소 `docs/SPEC.md`의 `generate_linked_question` / `review_candidate` 인터페이스와 `docs/ontology.yaml`의 이름을 그대로 쓰며, 백엔드가 없는 동안은 `src/api/mock.ts`가 같은 모양으로 응답합니다.

## 실행

```bash
npm install
npm run dev
```

`http://localhost:5173` 에서 열립니다. 타입 검사는 `npm run typecheck`, 빌드는 `npm run build`.

### 정적 공유본 만들기

해시 라우팅과 상대 경로로 빌드하면 어느 정적 호스트에서도 그대로 열립니다(아티팩트, GitHub Pages 하위 경로 등).

```bash
VITE_ROUTER=hash VITE_BASE=./ npx vite build
```

`dist/index.html`과 `dist/assets/`를 통째로 올리면 됩니다. 아티팩트에 올릴 때는 `dist/artifact.html`(스켈레톤 태그와 Pretendard 링크를 뺀 본문)을 페이지로, `assets/`를 파일로 보냅니다.

## 흐름 (화면 4개)

| 경로 | 화면 | 하는 일 |
|---|---|---|
| `/` | 첫 화면 | 한 화면만. 원문 문항을 전시 조판하고 두 요소·메커니즘·후보·잠정 도장이 한 번 그려짐(anime.js). |
| `/new` | 원문 입력 | 원문 문항·해설을 이미지 또는 수식·텍스트로 받음. KaTeX 미리보기, 제출 전 검증. 생성 조건(`intended_use`·`target_level`·`curriculum_scope`)은 화면에서 받지 않고 `src/api/config.ts`의 기본값을 보냄. 교육과정 범위는 팀의 별도 문서로 정할 예정. |
| `/jobs/:id` | 추출과 생성 | 관제 패널형 노드 그래프: 입력 알약 → 원문 허브 → 읽기·추출·구조 검증·후보 생성·잠정 검토 구간의 노드 카드 → 후보별 검토 항목 칩 → 완료 고리. 담당(AI·코드·사람)을 표시하고, 단계 이벤트가 올 때만 빛이 전선을 타고 흐름(`src/components/graph/`). 경과 시간과 단계별 실측 시간. 두 요소를 못 찾으면 그 노드가 빨갛게 멈추고 뒤쪽은 막힘(AC2), 판독 불가면 읽기 노드에서 멈춤(AC9). |
| `/results/:id` | 검토 결과 | 원문 + 풀이 아이디어, 후보별 문항·풀이·`ReviewResult`(잠정). 강사가 직접 승인/수정/보류/폐기를 기록하면 `reviewer_type=SELF`, 승인만 `APPROVED`. |

### 모의 API가 흉내 내는 규칙

- 해설 텍스트가 40자 미만이면 요소 하나만 확인된 것으로 보고 `MISSING_ELEMENTS`를 돌려줍니다.
- 이미지 파일명에 `blur`, `흐림`, `low`가 들어 있으면 `UNREADABLE_INPUT`과 확인 항목을 돌려줍니다.
- 그 외에는 `tests/harness/golden_cases.yaml`의 recorded_output_01과 같은 풀이 아이디어로 후보 2개(USE 1, REVISE 1)를 만듭니다.

실제 서버를 붙일 때는 `src/api/mock.ts`의 네 함수(`createJob`, `jobEvents`, `getResult`, `recordHumanReview`)만 바꾸면 됩니다. 진행 이벤트는 SSE나 WebSocket으로 대체할 수 있도록 async generator 형태입니다.

## 구조

```
src/
  api/        types.ts(도메인 타입) · config.ts(생성 조건 기본값) · fixtures.ts(골든 케이스 기반 예시) · mock.ts(모의 서버)
  components/ Nav, Footer, Math(KaTeX), Verdict(판정 배지·검토 항목), theme(다크 모드)
  hero/       AlephDemo.tsx + demo.css (stageshow 키트로 만든 히어로 데모)
  screens/    Landing, NewRequest, Analyzing, Result
  stageshow/  benjitaylor/skills의 stageshow 키트 복사본(React + CSS)
  styles/     tokens.css(디자인 토큰, Hallmark 스탬프) · base.css · app.css
```

## 쓴 라이브러리

- **motion** (`motion/react`): 화면 전환, 세그먼트·탭의 미끄러지는 하이라이트, 후보 카드 등장.
- **animejs** v4: 분석 화면의 요소 흐름도(`svg.createDrawable`)가 단계마다 그려짐.
- **skullet**: 결과 화면 로딩 스켈레톤. 샘플 데이터의 실제 레이아웃을 측정해 자리를 잡으므로 콘텐츠가 와도 움직이지 않음.
- **stageshow 키트**: 히어로의 가짜 제품 UI(창, 버튼, 배지, 접힘, 연결선, 커서 연출).
- **katex**: 문항·풀이 수식 렌더링.
- **lucide-react**: 아이콘(키트가 고정한 0.468 버전).

디자인 결정과 토큰은 [`../DESIGN.md`](../DESIGN.md)에 있습니다.
