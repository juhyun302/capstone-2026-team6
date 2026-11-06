import type { GenerationResult, SolutionIdea, CandidateQuestion } from './types'
import { CURRICULUM_SCOPE } from './config'

// The sample source is the problem behind tests/harness/golden_cases.yaml
// recorded_output_01: a derivative whose sign changes at x = 1, an initial
// value f(0) = 2, and the local maximum. The idea below is the golden case's
// recorded SolutionIdea, word for word.

export const SAMPLE_SOURCE = {
  label: '예시 원문',
  topic: '미분',
  statement:
    '함수 $f(x)$의 도함수가 $f\'(x) = 3 - 3x^2$ 이고 $f(0) = 2$ 일 때, 함수 $f(x)$의 극댓값을 구하시오.',
  solution:
    '$f\'(x) = 3(1-x)(1+x)$ 이므로 $f\'(x)$의 부호는 $x = 1$에서 양에서 음으로 바뀐다. 따라서 $x = 1$에서 극대이다. ' +
    '$f(x) = \\int (3 - 3x^2)\\,dx = 3x - x^3 + C$ 이고 $f(0) = 2$ 에서 $C = 2$. ' +
    '그러므로 극댓값은 $f(1) = 3 - 1 + 2 = 4$ 이다.',
}

export const SAMPLE_IDEA: SolutionIdea = {
  concept: '도함수 부호 변화와 극값',
  key_elements: [
    '도함수의 부호가 x=1에서 양에서 음으로 바뀌어 극대 위치가 x=1임을 판단한다',
    '도함수를 적분한 뒤 f(0)=2를 대입해 원함수 f(x)를 구한다',
  ],
  mechanism:
    '도함수의 부호 변화로 극대가 일어나는 입력값을 먼저 정하고, 적분과 초기값 조건으로 결정한 원함수에 그 값을 대입해 극댓값을 계산한다',
}

export const SAMPLE_CANDIDATES: CandidateQuestion[] = [
  {
    id: 'c1',
    statement:
      '함수 $f(x)$에 대하여 $f\'(x) = x^2 - 4x + 3$ 이고 $f(1) = 5$ 일 때, 함수 $f(x)$의 극솟값을 구하시오.',
    solution:
      '$f\'(x) = (x-1)(x-3)$ 이므로 부호는 $x=1$에서 양에서 음으로, $x=3$에서 음에서 양으로 바뀐다. 극소는 $x = 3$에서 일어난다. ' +
      '$f(x) = \\tfrac{1}{3}x^3 - 2x^2 + 3x + C$ 이고 $f(1) = \\tfrac{4}{3} + C = 5$ 에서 $C = \\tfrac{11}{3}$. ' +
      '따라서 극솟값은 $f(3) = 9 - 18 + 9 + \\tfrac{11}{3} = \\tfrac{11}{3}$ 이다.',
    element_marks: ["$f'(x) = x^2 - 4x + 3$", '$f(1) = 5$'],
    element_trace: [
      '도함수를 인수분해해 두 부호 변화점 중 음에서 양으로 바뀌는 x=3을 극소 위치로 고른다. 원문은 부호 변화가 한 곳이었고, 후보는 두 곳 중 하나를 가려내게 한다.',
      '도함수를 적분하고 f(1)=5를 대입해 상수항을 정한 뒤 f(3)을 계산한다. 초기값의 위치가 0이 아니어서 대입 계산이 한 단계 늘었다.',
    ],
    review_result: {
      validity_issue: false,
      curriculum_issue: false,
      verdict: 'USE',
      reason:
        '두 핵심 요소(부호 변화로 극값 위치 결정, 적분과 초기값으로 원함수 복원)가 같은 순서로 연결되며, 극대가 극소로 바뀌고 부호 변화점이 둘이 되어 수치만 바꾼 변형이 아니다. ' +
        '조건은 f(x)를 유일하게 결정하고 적분은 다항함수 범위(수학II) 안에 있다. 사용자가 독립적으로 풀어 확인해야 한다.',
      reviewer_type: 'AI',
      approval_status: 'PROVISIONAL',
    },
  },
  {
    id: 'c2',
    statement:
      '함수 $f(x)$의 도함수가 $f\'(x) = 1 - \\dfrac{1}{x^2}$ 이고 $f(1) = 3$ 일 때, 함수 $f(x)$의 극솟값을 구하시오.',
    solution:
      '$f\'(x) = \\dfrac{(x-1)(x+1)}{x^2}$ 이므로 $x = 1$에서 부호가 음에서 양으로 바뀌어 극소이다. ' +
      '$f(x) = x + \\dfrac{1}{x} + C$ 이고 $f(1) = 2 + C = 3$ 에서 $C = 1$. 극솟값은 $f(1) = 3$ 이다.',
    element_marks: ["$f'(x) = 1 - \\dfrac{1}{x^2}$", '$f(1) = 3$'],
    element_trace: [
      '도함수의 부호 변화로 극소 위치 x=1을 정한다. 다만 x=-1에서도 부호가 바뀌고 x=0에서 정의되지 않아, 정의역 조건 없이는 어느 극값을 묻는지 정해지지 않는다.',
      '도함수를 적분해 원함수를 복원하고 f(1)=3으로 상수항을 정한다. 이 적분은 x^{-2}의 부정적분으로, 다항함수 적분 범위를 벗어난다.',
    ],
    review_result: {
      validity_issue: true,
      curriculum_issue: true,
      verdict: 'REVISE',
      reason:
        '정의역 x>0 조건이 없어 x=-1의 극대와 x=0의 불연속을 함께 다뤄야 하고, 답이 하나로 정해지지 않는다. ' +
        '또한 x^{-2}의 적분은 요청한 범위(수학II, 다항함수의 적분)를 벗어나 미적분 과목의 내용이다. 정의역을 x>0으로 제한하고 도함수를 다항식으로 바꾸면 메커니즘은 유지된다.',
      reviewer_type: 'AI',
      approval_status: 'PROVISIONAL',
    },
  },
]

export function sampleResult(id: string, overrides?: Partial<GenerationResult['request']>): GenerationResult {
  return {
    id,
    created_at: new Date().toISOString(),
    request: {
      intended_use: '보충지',
      target_level: '준킬러',
      curriculum_scope: CURRICULUM_SCOPE,
      source: SAMPLE_SOURCE,
      ...overrides,
    },
    solution_idea: SAMPLE_IDEA,
    candidates: SAMPLE_CANDIDATES.map((c) => ({ ...c, review_result: { ...c.review_result } })),
  }
}
