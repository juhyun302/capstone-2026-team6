# Aleph 웹 초안

Aleph(수학 연계문항 생성·검토 도구)의 실제 구동용 프론트엔드 초안입니다. 저장소 `docs/SPEC.md`의 `generate_linked_question` / `review_candidate` 인터페이스와 `docs/ontology.yaml`의 이름을 그대로 쓰며, 기본으로 저장소의 실제 서버(`src/aleph/server.py`)를 호출하고, `VITE_API=mock`으로 빌드하면 서버 없이 `src/api/mock.ts`가 응답합니다.

## 실행

```bash
npm install
npm run dev
```

`http://localhost:5173` 에서 열립니다. 타입 검사는 `npm run typecheck`, 빌드는 `npm run build`.

실제 모델을 쓰려면 저장소 루트의 `.env`에 키를 넣고 다른 터미널에서 서버를 먼저 띄웁니다. Vite가 `/api`를 이 서버로 넘깁니다. 서버에 로그인이 없으므로 공개된 곳에 띄우지 않습니다.

```bash
python scripts/run_server.py
```

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
| `/new` | 원문 입력 | 원문 문항·해설을 수식·텍스트로 받음. 이미지는 서버가 아직 받지 않아 안내만 보여 줌. KaTeX 미리보기, 제출 전 검증. `curriculum_scope`는 화면에서 고르고 `intended_use`·`target_level`은 `src/api/config.ts`의 기본값을 보냄. |
| `/jobs/:id` | 추출과 생성 | 관제 패널형 노드 그래프: 입력 알약 → 원문 허브 → 읽기·추출·구조 검증·후보 생성·잠정 검토 구간의 노드 카드 → 후보별 검토 항목 칩 → 완료 고리. 담당(AI·코드·사람)을 표시하고, 단계 이벤트가 올 때만 빛이 전선을 타고 흐름(`src/components/graph/`). 후보 카드는 설계안마다 하나씩 셋. 경과 시간과 단계별 실측 시간, 그 아래 진행 바(끝난 모델 호출과 단계별 예상 시간으로 채움, 남은 시간 표시). 실패하면 실패 당시 단계의 노드가 빨갛게 멈춤. 두 요소를 못 찾으면 그 노드가 빨갛게 멈추고 뒤쪽은 막힘(AC2), 판독 불가면 읽기 노드에서 멈춤(AC9). |
| `/results/:id` | 검토 결과 | 원문 + 풀이 아이디어, 후보별 문항·풀이·`ReviewResult`(잠정). 강사가 직접 승인/수정/보류/폐기를 기록하면 `reviewer_type=SELF`, 승인만 `APPROVED`. |

### 모의 API가 흉내 내는 규칙

- 해설 텍스트가 40자 미만이면 요소 하나만 확인된 것으로 보고 `MISSING_ELEMENTS`를 돌려줍니다.
- 이미지 파일명에 `blur`, `흐림`, `low`가 들어 있으면 `UNREADABLE_INPUT`과 확인 항목을 돌려줍니다.
- 그 외에는 `tests/harness/golden_cases.yaml`의 recorded_output_01과 같은 풀이 아이디어로 후보 2개(USE 1, REVISE 1)를 만듭니다.

화면은 `src/api/index.ts`의 `api`만 호출합니다. `src/api/client.ts`(실제 서버)와 `src/api/mock.ts`(모의)가 같은 네 함수(`createJob`, `jobEvents`, `getResult`, `recordHumanReview`)를 제공합니다.

## 구조

```
src/
  api/        types.ts(도메인 타입) · config.ts(생성 조건 기본값) · fixtures.ts(골든 케이스 기반 예시) · mock.ts(모의 서버)
  components/ Nav, Footer, Math(KaTeX), Verdict(판정 배지·검토 항목), theme(다크 모드)
  hero/       AlephDemo.tsx + demo.css (stageshow 키트로 만든 히어로 데모)
  screens/    Landing, NewRequest, Analyzing, Result
  stageshow/  benjitaylor/skills의 stageshow 키트 복사본(React + CSS)
  styles/     tokens.css(디자인 토큰, Hallmark 스탬프) · base.css · app.css
  figure/     후보 그림(AC10 초안): expr.ts(식) · check.ts(명세 검사, src/aleph/figure.py와 같은 규칙) · render.ts(SVG) · png.ts · kit.ts(키트 스크립트) · zip.ts
```

## 후보 그림

설계안이 그림을 정하면(`plan.figure`) 후보에 문항 그림(`statement_figure`)이나 풀이 그림(`solution_figure`)이 붙습니다. 모델은 그림 명세(`src/aleph/schemas/figure.schema.json`)만 쓰고, 그리는 것은 `src/figure/render.ts`입니다.

- **규격**: 그림 제작 키트(`figlib_tikz.py`, `수학그림_제작_매뉴얼_TikZ.md`)의 값을 그대로 옮겼습니다. 곡선 0.8pt, 축·보조선 0.35pt, 점선 1.5pt/1.5pt(양 끝 반 대시), Stealth 화살촉 2.06 x 1.05mm, 점 1.1mm, 색칠 RGB(188,188,188), 글자 11pt, x·y·O 자리, 대지 너비 65~90mm·높이 120mm 이하.
- **글자**: MathJax로 SVG 경로를 만들어 그림 하나가 글꼴 파일 없이 완결됩니다. 한컴 수식 글꼴(HyhwpEQ)은 웹에 넣을 수 없어 글자 모양은 해설 본문과 조금 다릅니다. 글자는 선과 0.3mm 이상 떨어지게 자리를 고르고, 그래도 닿으면 그림 아래에 보고합니다. x·y·O는 키트 자리에 두고, 곡선이 그 자리를 지나면 반대쪽(O는 다른 사분면)으로 옮깁니다.
- **모델이 보는 그림**: 블라인드 풀이와 검토는 그림을 200dpi PNG로 받습니다(`png.ts`). 블라인드 풀이는 그림 명세를 받지 않습니다. 비밀번호 모드에서는 worker가 `solve_candidate`, `review_candidate`에만 PNG 두 장까지 받습니다.
- **받기**: 그림 아래에서 SVG, PNG(600dpi, 파일에 해상도 기록), 키트 스크립트(zip: `이름.py` + `이름.eq.txt`)를 받습니다. 키트 스크립트를 키트의 `temp\`에 풀고 `run_tikz.py`로 돌리면 한컴 수식 글자가 들어간 인쇄용 PDF·PNG가 나옵니다. 스크립트는 키트 함수를 쓰되 두 경우만 `fig.raw`로 화면과 같은 경로를 넣습니다. 색칠은 전부 한 경로로 넣습니다(`fig.shade`는 두 곡선의 오른쪽 끝이 떨어져 있으면 그 변을 곧게 긋지 못하고, 조각마다 따로 칠하면 사이에 틈이 보임). 곡선은 키트의 등분 조각이 0.05mm 넘게 어긋날 때만 넣습니다(원의 √식처럼 끝점 기울기가 무한대인 경우).
- **크기**: MathJax 글리프 때문에 `render.js`가 약 1.7 MB(gzip 0.6 MB)입니다. 그림이 있을 때만 불러옵니다. 한 파일 빌드(`build:single`)에는 처음부터 들어갑니다.
- **Python 서버**는 그림을 그리지 못해, 문항 그림이 있는 후보를 블라인드 풀이 전에 `FIGURE_UNRENDERED`로 멈춥니다. 문항 그림까지 쓰려면 브라우저 빌드(`VITE_API=browser`, 배포본)를 씁니다.

## 쓴 라이브러리

- **motion** (`motion/react`): 화면 전환, 세그먼트·탭의 미끄러지는 하이라이트, 후보 카드 등장.
- **animejs** v4: 분석 화면의 요소 흐름도(`svg.createDrawable`)가 단계마다 그려짐.
- **skullet**: 결과 화면 로딩 스켈레톤. 샘플 데이터의 실제 레이아웃을 측정해 자리를 잡으므로 콘텐츠가 와도 움직이지 않음.
- **stageshow 키트**: 히어로의 가짜 제품 UI(창, 버튼, 배지, 접힘, 연결선, 커서 연출).
- **katex**: 문항·풀이 수식 렌더링.
- **mathjax-full** 3.2.2: 그림 글자를 SVG 경로로(`src/figure/tex.ts`). 그림이 있을 때만 불러옴.
- **lucide-react**: 아이콘(키트가 고정한 0.468 버전).

디자인 결정과 토큰은 [`../DESIGN.md`](../DESIGN.md)에 있습니다.
