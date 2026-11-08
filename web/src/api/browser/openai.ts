// One stateless call to the OpenAI Responses API from the browser, with the viewer's own key.
// The key goes only to api.openai.com.

import type { Complete } from './pipeline'

export class ModelCallError extends Error {
  constructor(message: string, readonly kind: 'auth' | 'quota' | 'model' | 'network' | 'other') {
    super(message)
  }
}

interface ResponseBody {
  status?: string
  output?: { type?: string; content?: { type?: string; text?: string }[] }[]
}

const outputText = (body: ResponseBody) =>
  (body.output ?? [])
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === 'output_text')
    .map((part) => part.text ?? '')
    .join('')

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function openaiComplete({ apiKey, model, reasoningEffort }: { apiKey: string; model: string; reasoningEffort?: string }): Complete {
  if (!apiKey.trim()) throw new ModelCallError('OpenAI API 키를 넣어 주세요.', 'auth')
  if (!model.trim()) throw new ModelCallError('모델 이름을 넣어 주세요.', 'model')
  return async (system, user) => {
    for (let attempt = 0; ; attempt += 1) {
      let response: Response
      try {
        response = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey.trim()}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: model.trim(), instructions: system, input: user, max_output_tokens: 24000, store: false,
            ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
          }),
        })
      } catch {
        if (attempt < 1) { await sleep(3000); continue }
        throw new ModelCallError('OpenAI에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.', 'network')
      }
      if (response.ok) {
        const body = (await response.json()) as ResponseBody
        // A truncated reply fails validation and is retried there.
        if (body.status === 'incomplete') return ''
        if (body.status !== 'completed') throw new ModelCallError(`모델 호출이 ${body.status ?? '알 수 없는'} 상태로 끝났습니다.`, 'other')
        return outputText(body)
      }
      const error = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null
      const code = error?.error?.code ?? ''
      if (response.status === 401) throw new ModelCallError('API 키가 맞지 않습니다. 키를 다시 확인해 주세요.', 'auth')
      if (code === 'insufficient_quota' || code === 'credit_balance_exhausted') throw new ModelCallError('이 키의 OpenAI 크레딧이 부족합니다. 결제 화면에서 잔액을 확인해 주세요.', 'quota')
      if (response.status === 404 || code === 'model_not_found') throw new ModelCallError(`이 키로는 ${model} 모델을 쓸 수 없습니다.`, 'model')
      if ((response.status === 429 || response.status >= 500) && attempt < 1) { await sleep(5000); continue }
      throw new ModelCallError(`모델 호출에 실패했습니다(${response.status}). 잠시 뒤 다시 시도해 주세요.`, 'other')
    }
  }
}
