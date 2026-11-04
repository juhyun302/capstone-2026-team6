import { Check } from 'lucide-react'
import { Badge, Bar, Button, Collapse, Connector, Stage, Text, Window, type Act } from '../stageshow'
import { useTheme } from '../components/theme'
import './demo.css'

// The product, built: a review ledger. The source problem and its explanation
// on the left; "요소 추출" lights the two key elements in the explanation and
// draws the mechanism between them; a candidate arrives on the right with its
// provisional verdict; the instructor approves it on the same button. "새 원문"
// is the loop's visible cause to reset.

type S = {
  e1: boolean
  e2: boolean
  link: boolean
  cand: boolean
  verdict: 'none' | 'checking' | 'provisional' | 'approved'
}

const initial: S = { e1: false, e2: false, link: false, cand: false, verdict: 'none' }
const POSTER: S = { e1: true, e2: true, link: true, cand: true, verdict: 'approved' }
const REST = { wide: { x: 440, y: 440 }, compact: { x: 300, y: 380 } }

async function script(a: Act<S>) {
  await a.wait(700)

  // 1. Extract: the two elements light in reading order, then the mechanism ties them
  await a.move('extract')
  await a.wait(240)
  await a.click()
  await a.set({ e1: true })
  await a.wait(520)
  await a.set({ e2: true })
  await a.wait(520)
  await a.set({ link: true })
  await a.move('rest-left')
  await a.wait(1100)

  // 2. The candidate arrives whole, with its review still running
  await a.set({ cand: true, verdict: 'checking' })
  await a.wait(1300)
  await a.set({ verdict: 'provisional' })
  await a.wait(1400)

  // 3. The instructor approves on the same button
  await a.move('approve')
  await a.wait(300)
  await a.click()
  await a.set({ verdict: 'approved' })
  await a.move('rest')
  await a.wait(2400)

  // 4. Reset with a visible cause: a new source
  await a.move('reset')
  await a.wait(240)
  await a.click()
  await a.set({ cand: false, verdict: 'none', link: false })
  await a.wait(260)
  await a.set({ e1: false, e2: false })
  await a.move('rest')
  await a.wait(500)
}

const STATEMENT = "f′(x) = 3 − 3x² 이고 f(0) = 2일 때, f(x)의 극댓값을 구하시오."
const E1 = 'f′(x)의 부호가 x = 1에서 양에서 음으로 바뀌므로 x = 1에서 극대이다.'
const E2 = 'f(x) = 3x − x³ + C에 f(0) = 2를 대입하면 C = 2.'
const E3 = '따라서 극댓값은 f(1) = 4.'
const CANDIDATE = "f′(x) = x² − 4x + 3 이고 f(1) = 5일 때, f(x)의 극솟값을 구하시오."

export function AlephDemo() {
  const { theme } = useTheme()
  return (
    <Stage
      key={theme}
      width={640}
      height={520}
      compact={{ below: 440, width: 358, height: 440 }}
      initial={initial}
      poster={POSTER}
      script={script}
      cursor={{ at: REST, style: 'real', idle: 2500 }}
      accent={theme === 'dark' ? '#4f9cf0' : '#005BAC'}
      theme={theme === 'dark' ? 'dark' : 'light'}
      greys="cool"
      tokens={{ '--ss-font': 'var(--font-body)' }}
      className="ad"
      play="loop"
    >
      {(s, rect, layout) => {
        const r1 = rect('e1')
        const r2 = rect('e2')
        const col = rect('source')
        const x = col.x + 9
        const connector = s.link && r1.height > 0 && r2.height > 0
        return (
          <>
            <Window
              title="검토 결과"
              className="ad-window"
              toolbar={
                <Button size="small" variant="ghost" data-target="reset">
                  새 원문
                </Button>
              }
            >
              <div className="ad-body" data-layout={layout}>
                <section className="ad-source" data-target="source">
                  <div className="ad-colhead">
                    <Text className="ad-h">원문</Text>
                    <Button size="small" variant="secondary" data-target="extract">
                      요소 추출
                    </Button>
                  </div>
                  <Text className="ad-statement" wrap>
                    {STATEMENT}
                  </Text>
                  <p className="ad-expl">
                    <span className="ad-el" data-target="e1" data-on={s.e1 || undefined}>
                      {E1}
                    </span>{' '}
                    <span className="ad-el" data-target="e2" data-on={s.e2 || undefined}>
                      {E2}
                    </span>{' '}
                    <span>{E3}</span>
                  </p>
                  <Text className="ad-mech" data-show={s.link || undefined} wrap>
                    메커니즘: 부호 변화로 위치를 정한 뒤, 적분으로 그 값을 구한다
                  </Text>
                  <span className="ad-rest" data-target="rest-left" />
                </section>

                <section className="ad-cand">
                  <div className="ad-colhead">
                    <Text className="ad-h">후보 문항</Text>
                    <Bar w={44} h={18} r={9} tone={2} />
                  </div>
                  <Collapse open={s.cand} reveal="drop" className="ad-collapse">
                    <div className="ad-card">
                      <Text className="ad-statement" wrap>
                        {CANDIDATE}
                      </Text>
                      <div className="ad-lines">
                        <Bar w="92%" h={6} tone={2} />
                        <Bar w="76%" h={6} tone={2} />
                        <Bar w="58%" h={6} tone={2} />
                      </div>
                      <div className="ad-review">
                        <Badge
                          tone={s.verdict === 'approved' ? 'success' : s.verdict === 'provisional' ? 'accent' : 'neutral'}
                          icon={s.verdict !== 'checking' ? <Check size={11} strokeWidth={2.4} aria-hidden="true" /> : undefined}
                          className="ad-badge"
                        >
                          {s.verdict === 'approved' ? '사용 승인됨' : s.verdict === 'provisional' ? '사용 가능, 잠정' : '검토 중'}
                        </Badge>
                        <Text className="ad-reason" wrap>
                          {s.verdict === 'approved' ? '강사가 승인' : s.verdict === 'provisional' ? '두 요소 적용 확인, 수학II 범위' : '조건과 풀이 성립 확인'}
                        </Text>
                      </div>
                      <Button
                        size="small"
                        variant={s.verdict === 'approved' ? 'secondary' : 'primary'}
                        icon={s.verdict === 'approved' ? <Check size={11} strokeWidth={2.4} aria-hidden="true" /> : undefined}
                        data-target="approve"
                        className="ad-approve"
                      >
                        {s.verdict === 'approved' ? '승인됨' : '사용 승인'}
                      </Button>
                    </div>
                  </Collapse>
                  <span className="ad-rest" data-target="rest" />
                </section>
              </div>
            </Window>

            <Connector
              show={connector}
              from={{ x, y: r1.y + r1.height / 2 }}
              to={{ x, y: r2.y + r2.height / 2 }}
              route="straight"
              dots="both"
              className="ad-link"
            />
          </>
        )
      }}
    </Stage>
  )
}
