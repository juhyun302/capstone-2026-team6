// The real API in src/aleph/server.py. Same functions as ./mock.ts.

import type { GenerationRequest, GenerationResult, JobEvent, ReviewResult, SourcePart, Verdict } from './types'

async function parsed<T>(response: Response): Promise<T> {
  if (response.ok) return (await response.json()) as T
  const body = (await response.json().catch(() => null)) as { detail?: unknown } | null
  throw new Error(typeof body?.detail === 'string' ? body.detail : '서버에 요청하지 못했습니다. 다시 시도해 주세요.')
}

const part = (p: SourcePart) => ({ text: p.text?.trim() || undefined, image: p.image?.name })

export async function createJob(req: GenerationRequest): Promise<{ jobId: string }> {
  const response = await fetch('/api/requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...req,
      source_question: { problem: part(req.source_question.problem), explanation: part(req.source_question.explanation) },
    }),
  })
  return parsed(response)
}

export async function createMoreJob(resultId: string, count: number): Promise<{ jobId: string }> {
  const response = await fetch(`/api/results/${resultId}/more`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ count }),
  })
  return parsed(response)
}

export async function* jobEvents(jobId: string, signal?: AbortSignal): AsyncGenerator<JobEvent> {
  const response = await fetch(`/api/jobs/${jobId}/events`, { signal })
  if (!response.ok || !response.body) {
    yield { stage: 'error', error: { status: 'SERVER_ERROR', error_code: 'JOB_NOT_FOUND', reason: '요청을 찾을 수 없습니다. 원문을 다시 올려 주세요.' } }
    return
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) return
    buffer += value
    let end = buffer.indexOf('\n\n')
    while (end >= 0) {
      const chunk = buffer.slice(0, end)
      buffer = buffer.slice(end + 2)
      if (chunk.startsWith('data: ')) yield JSON.parse(chunk.slice('data: '.length)) as JobEvent
      end = buffer.indexOf('\n\n')
    }
  }
}

export async function getResult(resultId: string): Promise<GenerationResult | null> {
  const response = await fetch(`/api/results/${resultId}`)
  if (response.status === 404) return null
  return parsed(response)
}

export async function undoHumanReview(resultId: string, candidateId: string): Promise<ReviewResult> {
  return parsed(await fetch(`/api/results/${resultId}/candidates/${candidateId}/review`, { method: 'DELETE' }))
}

export async function recordHumanReview(resultId: string, candidateId: string, verdict: Verdict, reason: string): Promise<ReviewResult> {
  const response = await fetch(`/api/results/${resultId}/candidates/${candidateId}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ verdict, reason }),
  })
  return parsed(response)
}
