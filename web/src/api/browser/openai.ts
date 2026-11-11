// One stateless model call from the browser, in one of two ways:
//   key mode:      straight to the OpenAI Responses API with the viewer's own key.
//   password mode: to the team worker (/api/openai) with the access password; the worker holds
//                  the key, picks the prompt by name and the model, and wraps OpenAI's reply as
//                  {status, body} after whitespace heartbeats (see web/worker/index.ts).

import type { AccessSettings } from '../settings'
import { PROMPT_NAMES, type PromptName } from '../promptText'
import type { Complete } from './pipeline'
import { PROMPTS } from './rules'

export class ModelCallError extends Error {
  constructor(message: string, readonly kind: 'auth' | 'quota' | 'model' | 'network' | 'other') {
    super(message)
  }
}

interface ResponseBody {
  status?: string
  output?: { type?: string; content?: { type?: string; text?: string }[] }[]
  error?: { code?: string; message?: string }
}

const outputText = (body: ResponseBody) =>
  (body.output ?? [])
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === 'output_text')
    .map((part) => part.text ?? '')
    .join('')

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const NAME_BY_PROMPT = new Map<string, PromptName>(PROMPT_NAMES.map((name) => [PROMPTS[name], name]))
export const WORKER_PATH = '/api'
const DAILY_LIMIT = '오늘 사용 한도를 다 썼습니다. 한도는 매일 자정(한국 시간)에 다시 채워집니다. 내일 다시 시도해 주세요.'

type Owner = 'viewer' | 'team'
const RETRY = Symbol('retry')

/** Turn one OpenAI reply into text, a retry, or an error the viewer can act on. */
function read(status: number, body: ResponseBody | null, owner: Owner, model: string, attempt: number): string | typeof RETRY {
  if (status >= 200 && status < 300 && body) {
    // A truncated reply fails validation and is retried there.
    if (body.status === 'incomplete') return ''
    if (body.status !== 'completed') throw new ModelCallError(`모델 호출이 ${body.status ?? '알 수 없는'} 상태로 끝났습니다.`, 'other')
    return outputText(body)
  }
  const code = body?.error?.code ?? ''
  const tell = owner === 'team' ? ' 관리자에게 알려 주세요.' : ''
  if (status === 401) throw new ModelCallError(owner === 'team' ? `서버에 등록된 OpenAI 키가 맞지 않습니다.${tell}` : 'API 키가 맞지 않습니다. 키를 다시 확인해 주세요.', 'auth')
  if (code === 'insufficient_quota' || code === 'credit_balance_exhausted') {
    throw new ModelCallError(owner === 'team' ? `팀 OpenAI 크레딧이 부족합니다.${tell}` : '이 키의 OpenAI 크레딧이 부족합니다. 결제 화면에서 잔액을 확인해 주세요.', 'quota')
  }
  if (status === 404 || code === 'model_not_found') throw new ModelCallError(owner === 'team' ? `서버에 설정된 모델을 쓸 수 없습니다.${tell}` : `이 키로는 ${model} 모델을 쓸 수 없습니다.`, 'model')
  if ((status === 429 || status >= 500) && attempt < 1) return RETRY
  throw new ModelCallError(`모델 호출에 실패했습니다(${status}). 잠시 뒤 다시 시도해 주세요.`, 'other')
}

function direct(apiKey: string, model: string): Complete {
  return async (system, user) => {
    for (let attempt = 0; ; attempt += 1) {
      let response: Response
      try {
        response = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model, instructions: system, input: user, max_output_tokens: 24000, store: false,
          }),
        })
      } catch {
        if (attempt < 1) { await sleep(3000); continue }
        throw new ModelCallError('OpenAI에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.', 'network')
      }
      const body = (await response.json().catch(() => null)) as ResponseBody | null
      const text = read(response.status, body, 'viewer', model, attempt)
      if (text === RETRY) { await sleep(5000); continue }
      return text
    }
  }
}

function viaWorker(password: string): Complete {
  return async (system, user) => {
    const prompt = NAME_BY_PROMPT.get(system)
    if (!prompt) throw new ModelCallError('알 수 없는 프롬프트입니다.', 'other')
    for (let attempt = 0; ; attempt += 1) {
      let response: Response
      let wrapped: { status?: number; body?: ResponseBody | null } | null = null
      try {
        response = await fetch(`${WORKER_PATH}/openai`, {
          method: 'POST',
          headers: { 'X-Aleph-Password': password, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, input: user }),
        })
        if (response.ok) wrapped = JSON.parse(await response.text())
      } catch {
        if (attempt < 1) { await sleep(3000); continue }
        throw new ModelCallError('서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.', 'network')
      }
      if (response.status === 401) throw new ModelCallError('비밀번호가 맞지 않습니다. 비밀번호를 다시 확인해 주세요.', 'auth')
      if (response.status === 429) throw new ModelCallError(DAILY_LIMIT, 'quota')
      if (!response.ok || !wrapped || typeof wrapped.status !== 'number') {
        if (response.status >= 500 && attempt < 1) { await sleep(5000); continue }
        throw new ModelCallError(`서버가 요청을 처리하지 못했습니다(${response.status}). 잠시 뒤 다시 시도해 주세요.`, 'other')
      }
      const text = read(wrapped.status, wrapped.body ?? null, 'team', '', attempt)
      if (text === RETRY) { await sleep(5000); continue }
      return text
    }
  }
}

/** The model call for the current access mode. */
export function modelComplete(mode: 'key' | 'password', settings: AccessSettings): Complete {
  const secret = settings.secret.trim()
  if (!secret) throw new ModelCallError(mode === 'password' ? '비밀번호를 넣어 주세요.' : 'OpenAI API 키를 넣어 주세요.', 'auth')
  if (mode === 'password') return viaWorker(secret)
  if (!settings.model.trim()) throw new ModelCallError('모델 이름을 넣어 주세요.', 'model')
  return direct(secret, settings.model.trim())
}

/** Ask the worker whether the password is right, before a job starts. */
export async function checkPassword(password: string): Promise<void> {
  let response: Response
  try {
    response = await fetch(`${WORKER_PATH}/check`, { method: 'POST', headers: { 'X-Aleph-Password': password.trim() } })
  } catch {
    throw new ModelCallError('서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.', 'network')
  }
  if (response.status === 401) throw new ModelCallError('비밀번호가 맞지 않습니다. 비밀번호를 다시 확인해 주세요.', 'auth')
  if (response.status === 429) throw new ModelCallError(DAILY_LIMIT, 'quota')
  if (!response.ok) throw new ModelCallError(`서버가 요청을 처리하지 못했습니다(${response.status}).`, 'other')
}
