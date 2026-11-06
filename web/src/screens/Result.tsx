import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Skeleton } from 'skullet/react'
import { api } from '../api'
import { sampleResult } from '../api/fixtures'
import type { GenerationResult } from '../api/types'
import { PlainView } from './result/Plain'

const SAMPLE = sampleResult('sample')

export function Result() {
  const { id } = useParams()
  const [result, setResult] = useState<GenerationResult | null | undefined>(undefined)

  useEffect(() => {
    let alive = true
    setResult(undefined)
    if (!id) return
    api.getResult(id).then((r) => {
      if (alive) setResult(r)
    })
    return () => {
      alive = false
    }
  }, [id])

  if (result === null) {
    return (
      <div className="screen">
        <div className="container empty">
          <h1>이 검토 결과를 찾을 수 없습니다.</h1>
          <p className="lead">세션이 끝나면 결과가 지워집니다. 원문을 다시 올려 주세요.</p>
          <Link to="/new" className="btn">
            원문 올리기
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="screen">
      <div className="container doc">
        <Skeleton data={result} sample={SAMPLE} id="result" label="검토 결과를 불러오는 중">
          {(r) => <PlainView result={r} />}
        </Skeleton>
      </div>
    </div>
  )
}
