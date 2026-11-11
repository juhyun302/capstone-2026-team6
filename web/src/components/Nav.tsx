import { Link, useLocation } from 'react-router-dom'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from './theme'

const STEPS: { match: RegExp; index: number; label: string }[] = [
  { match: /^\/new/, index: 1, label: '원문 입력' },
  { match: /^\/jobs\//, index: 2, label: '추출과 생성' },
  { match: /^\/results\//, index: 3, label: '검토 결과' },
]

export function Nav() {
  const { theme, toggle } = useTheme()
  const { pathname } = useLocation()
  const step = STEPS.find((s) => s.match.test(pathname))
  return (
    <header className="nav">
      <div className="container nav__inner">
        <Link to="/" className="wordmark" aria-label="Aleph 홈으로">
          Aleph<span className="wordmark__point" aria-hidden="true">.</span>
          <span className="wordmark__sub">수학 연계문항 생성·검토</span>
        </Link>
        <div className="nav__right">
          {step && (
            <span className="nav__step" aria-live="polite">
              <strong>{step.index}</strong>
              <span aria-hidden="true"> / 3 </span>
              <span className="visually-hidden">단계 중 3단계, </span>
              {step.label}
            </span>
          )}
          {!step && (
            <Link to="/new" className="btn btn--sm">
              원문 올리기
            </Link>
          )}
          <button type="button" className="icon-btn" onClick={toggle} aria-label={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}>
            {theme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
          </button>
        </div>
      </div>
    </header>
  )
}
