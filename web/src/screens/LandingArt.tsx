import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { ProblemArt } from '../components/ProblemArt'
import '../styles/landing.css'

// Version B: the first screen only. The problem itself is the picture.
export function LandingArt() {
  return (
    <div className="screen screen--one">
      <section className="one container">
        <div className="one__text">
          <h1>
            원문 하나에서,
            <br />
            근거가 붙은 연계문항.
          </h1>
          <p className="lead">해설 속 두 풀이 요소와 그 연결을 찾아 후보를 만들고, 쓸 수 있는지 왜 그런지를 함께 적습니다.</p>
          <div className="one__actions">
            <Link to="/new" className="btn btn--lg">
              원문 올리기
              <ArrowRight aria-hidden="true" />
            </Link>
          </div>
        </div>
        <div className="one__visual">
          <ProblemArt />
        </div>
        <div className="one__foot">
          <span>Aleph. 아주대학교 캡스톤 디자인 6팀.</span>
          <span>AI의 검토는 잠정 판정이며 최종 승인은 사람이 합니다.</span>
        </div>
      </section>
    </div>
  )
}
