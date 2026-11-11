import type { IntendedUse, TargetLevel } from './types'

// 생성 조건의 기본값. SPEC § 5의 generate_linked_question 입력 모양은 그대로
// 두되, 입력 화면에서는 받지 않는다.
// - curriculum_scope: 허용 교육과정 범위는 팀의 별도 문서로 명시할 예정이다.
//   그 문서가 나오면 이 값을 그 문서(또는 서버 설정)로 교체한다.
// - intended_use, target_level: 사용자 입력을 나중에 추가할 때까지 기본값.

export const CURRICULUM_SCOPE = '팀 문서로 정한 교육과정 범위'

// 실제 서버로 보내는 값. 팀 문서가 나오기 전까지 입력 화면에서 과목을 고른다.
export const CURRICULUM_OPTIONS = ['수학Ⅰ', '수학Ⅱ', '미적분'] as const

// 한 번에 만드는 후보 수. MAX_CANDIDATES(src/aleph/pipeline.py)와 맞춘다.
export const CANDIDATE_COUNTS = [1, 2, 3, 4, 5] as const
export const DEFAULT_CANDIDATE_COUNT = 3
// 결과 화면에서 같은 유형으로 더 뽑을 때의 기본 수와 한 결과의 후보 상한(MAX_TOTAL_CANDIDATES).
export const MORE_CANDIDATES = 2
export const MAX_TOTAL_CANDIDATES = 9

export const DEFAULT_INTENDED_USE: IntendedUse = '보충지'
export const DEFAULT_TARGET_LEVEL: TargetLevel = '준킬러'
