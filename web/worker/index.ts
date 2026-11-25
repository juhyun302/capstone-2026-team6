// Cloudflare Worker for the web build (npm run deploy). Static files in dist-web are served
// before this code runs; this code answers only /api/*:
//   POST /api/check   204 when the X-Aleph-Password header is right and a whole request still
//                     fits in today's limit; 401 for a wrong password, 429 when the day is used up.
//   POST /api/openai  {prompt, input, images?}: runs one of Aleph's five prompts on OpenAI with the
//                     server's key and model. images (at most two PNG data URLs) are the figure
//                     pictures the blind solver and the reviewer look at; other prompts take none.
//                     The reply is {status, body} from OpenAI, sent after whitespace heartbeats so
//                     a two-minute call is not cut as idle.
// The key never reaches the browser, and the password only unlocks these five prompts.
// DAILY_CALL_LIMIT caps model calls per day (Korean time) for everyone together, counted
// in one Durable Object, so a password made public in the README has a bounded cost.
// Secrets (npx wrangler secret put NAME): OPENAI_API_KEY, ACCESS_PASSWORD.
// Each /api/openai request prints one trace line (schema aleph.trace.v1, the same as the local
// server's) with console.log; scripts/tail_trace.py copies them from `wrangler tail` into
// logs/trace.jsonl. The worker stores none of them.

import { DurableObject } from 'cloudflare:workers'
import { IMAGE_PROMPTS, imagesOk, MAX_IMAGES, modelInput, outputText, PROMPT_NAMES, promptOf, type PromptName, type ResponseBody } from '../src/api/promptText'
import parseQueryMd from '../../src/aleph/prompts/parse_query.md'
import designMd from '../../src/aleph/prompts/design_candidates.md'
import generateMd from '../../src/aleph/prompts/generate_candidate.md'
import solveMd from '../../src/aleph/prompts/solve_candidate.md'
import reviewMd from '../../src/aleph/prompts/review_candidate.md'

interface UsageStub {
  take(day: string, limit: number): Promise<boolean>
  used(day: string): Promise<number>
}
interface Env {
  USAGE: { idFromName(name: string): unknown; get(id: unknown): UsageStub }
  DAILY_CALL_LIMIT?: string
  OPENAI_API_KEY?: string
  ACCESS_PASSWORD?: string
  OPENAI_MODEL?: string
  OPENAI_REASONING_EFFORT?: string
  /** Local tests only: a fake OpenAI. */
  OPENAI_BASE_URL?: string
}
interface Context {
  waitUntil(promise: Promise<unknown>): void
}

const PROMPTS: Record<PromptName, string> = {
  parse_query: promptOf(parseQueryMd, 'parse_query'),
  design_candidates: promptOf(designMd, 'design_candidates'),
  generate_candidate: promptOf(generateMd, 'generate_candidate'),
  solve_candidate: promptOf(solveMd, 'solve_candidate'),
  review_candidate: promptOf(reviewMd, 'review_candidate'),
}
const MAX_INPUT = 200_000
const HEARTBEAT_MS = 10_000
const WRONG_PASSWORD_DELAY_MS = 1_000
/** Model calls in the largest request: extract, design, and generate, solve, review for five candidates. */
const CALLS_PER_REQUEST = 17

/** One counter for the whole site; calls are counted per day in Korean time. */
export class Usage extends DurableObject {
  async take(day: string, limit: number): Promise<boolean> {
    const used = (await this.ctx.storage.get<number>(day)) ?? 0
    if (used >= limit) return false
    if (used === 0) for (const key of (await this.ctx.storage.list()).keys()) if (key !== day) await this.ctx.storage.delete(key)
    await this.ctx.storage.put(day, used + 1)
    return true
  }

  async used(day: string): Promise<number> {
    return (await this.ctx.storage.get<number>(day)) ?? 0
  }
}

const today = () => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10)
const usage = (env: Env) => env.USAGE.get(env.USAGE.idFromName('site'))
const dailyLimit = (env: Env) => Number(env.DAILY_CALL_LIMIT) || 450
const LIMIT_REACHED = { error: 'daily_limit' }

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function sha256(text: string) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
}

/** Compare digests in constant time, so the answer time says nothing about the password. */
async function passwordOk(request: Request, env: Env) {
  const given = request.headers.get('x-aleph-password') ?? ''
  if (!env.ACCESS_PASSWORD || !given) return false
  const [a, b] = await Promise.all([sha256(given), sha256(env.ACCESS_PASSWORD)])
  return (crypto.subtle as unknown as { timingSafeEqual(a: ArrayBufferView, b: ArrayBufferView): boolean }).timingSafeEqual(a, b)
}

const TRACE_SCHEMA = 'aleph.trace.v1'
/** The browser's job id (X-Aleph-Trace); anything else is dropped rather than logged. */
const TRACE_ID = /^[a-z]{1,8}_[a-z0-9]{1,32}$/

interface Traced {
  prompt?: PromptName | null
  model?: string | null
  status: string
  error?: string | null
  input?: string | null
  images?: number
  output?: string | null
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number } | null
}

/** Print one line of logs/trace.jsonl. It never holds the key or the password. */
function trace(request: Request, started: number, fields: Traced) {
  const id = request.headers.get('x-aleph-trace') ?? ''
  console.log(JSON.stringify({
    schema: TRACE_SCHEMA, ts: new Date(started).toISOString(), source: 'worker', trace_id: TRACE_ID.test(id) ? id : null,
    prompt: fields.prompt ?? null, model: fields.model ?? null, status: fields.status, error: fields.error ?? null,
    ms: Date.now() - started, input: fields.input ?? null, images: fields.images ?? 0, output: fields.output ?? null, usage: fields.usage ?? null,
  }))
}

/** What the trace keeps of OpenAI's reply. Only the error code: OpenAI's error message can quote part of the key. */
function replyFields(reply: { status: number; body: unknown }): Traced {
  const body = (reply.body ?? {}) as ResponseBody
  if (reply.status < 200 || reply.status >= 300) return { status: 'error', error: body.error?.code || `http_${reply.status}` }
  const counts = body.usage
  return {
    model: body.model ?? null, status: body.status ?? 'unknown', error: body.error?.code ?? body.incomplete_details?.reason ?? null,
    output: outputText(body),
    usage: counts ? { input_tokens: counts.input_tokens, output_tokens: counts.output_tokens, total_tokens: counts.total_tokens } : null,
  }
}

/** Send heartbeats until OpenAI answers, then OpenAI's status and body; `done` sees the same reply. */
function relay(upstream: Promise<Response>, ctx: Context, done: (reply: { status: number; body: unknown }) => void) {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  const writer = writable.getWriter()
  const encoder = new TextEncoder()
  const work = (async () => {
    const beat = setInterval(() => void writer.write(encoder.encode(' ')).catch(() => {}), HEARTBEAT_MS)
    let reply: { status: number; body: unknown }
    try {
      const response = await upstream
      const text = await response.text()
      let body: unknown = null
      try {
        body = JSON.parse(text)
      } catch {
        /* a non-JSON error page; the status still tells the client what happened */
      }
      reply = { status: response.status, body }
    } catch {
      reply = { status: 502, body: { error: { code: 'upstream_unreachable', message: 'OpenAI did not answer' } } }
    } finally {
      clearInterval(beat)
    }
    await writer.write(encoder.encode(JSON.stringify(reply))).catch(() => {})
    await writer.close().catch(() => {})
    done(reply)
  })()
  ctx.waitUntil(work)
  // Compression buffers small writes, which would hold the heartbeats back until the end.
  return new Response(readable, {
    headers: { 'content-type': 'application/json; charset=utf-8', 'content-encoding': 'identity', 'cache-control': 'no-store, no-transform' },
  })
}

export default {
  async fetch(request: Request, env: Env, ctx: Context): Promise<Response> {
    const started = Date.now()
    const { pathname } = new URL(request.url)
    if (pathname !== '/api/check' && pathname !== '/api/openai') return json(404, { error: 'not found' })
    if (request.method !== 'POST') return json(405, { error: 'POST only' })
    if (!env.OPENAI_API_KEY || !env.ACCESS_PASSWORD) return json(503, { error: 'server secrets are not set' })
    // a refused model call is traced too, without its input: a run of them is what an attack looks like
    const refuse = (status: number, body: unknown, error: string, prompt: PromptName | null = null) => {
      if (pathname === '/api/openai') trace(request, started, { prompt, status: 'rejected', error })
      return json(status, body)
    }
    if (!(await passwordOk(request, env))) {
      await sleep(WRONG_PASSWORD_DELAY_MS)
      return refuse(401, { error: 'wrong password' }, 'wrong_password')
    }
    if (pathname === '/api/check') {
      const left = dailyLimit(env) - (await usage(env).used(today()))
      return left >= CALLS_PER_REQUEST ? new Response(null, { status: 204 }) : json(429, LIMIT_REACHED)
    }

    let payload: { prompt?: unknown; input?: unknown; images?: unknown }
    try {
      payload = await request.json()
    } catch {
      return refuse(400, { error: 'body must be JSON' }, 'bad_json')
    }
    const prompt = payload.prompt as PromptName
    if (!PROMPT_NAMES.includes(prompt)) return refuse(400, { error: 'unknown prompt' }, 'unknown_prompt')
    if (typeof payload.input !== 'string' || !payload.input || payload.input.length > MAX_INPUT) return refuse(400, { error: 'input must be a non-empty string' }, 'bad_input', prompt)
    const input = payload.input
    const images = payload.images
    if (images !== undefined && (!IMAGE_PROMPTS.includes(prompt) || !imagesOk(images))) {
      return refuse(400, { error: `images must be at most ${MAX_IMAGES} PNG data URLs, for solve_candidate or review_candidate only` }, 'bad_images', prompt)
    }
    const pictures = images as string[] | undefined

    if (!(await usage(env).take(today(), dailyLimit(env)))) return refuse(429, LIMIT_REACHED, 'daily_limit', prompt)

    const effort = env.OPENAI_REASONING_EFFORT
    const model = env.OPENAI_MODEL || 'gpt-6.1-sol'
    const upstream = fetch(`${env.OPENAI_BASE_URL ?? 'https://api.openai.com'}/v1/responses`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, instructions: PROMPTS[prompt], input: modelInput(input, pictures),
        max_output_tokens: 24000, store: false, ...(effort ? { reasoning: { effort } } : {}),
      }),
    })
    return relay(upstream, ctx, (reply) => {
      const fields = replyFields(reply)
      trace(request, started, { prompt, input, images: pictures?.length ?? 0, ...fields, model: fields.model ?? model })
    })
  },
}
