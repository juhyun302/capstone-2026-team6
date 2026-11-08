// How the browser build reaches the model, and the secret it needs. Kept in memory; saved to
// this browser only when the viewer asks.
//   key      (HTML file): the viewer's own OpenAI key, sent straight to OpenAI.
//   password (web build): the team's access password; the OpenAI key stays on the server.

export const accessMode: 'key' | 'password' = import.meta.env.VITE_ACCESS === 'password' ? 'password' : 'key'
export const DEFAULT_MODEL = 'gpt-6-astra'
const STORE = accessMode === 'password' ? 'aleph.access.v1' : 'aleph.openai.v1'

export interface AccessSettings {
  /** The OpenAI key in key mode, the access password in password mode. */
  secret: string
  /** Used in key mode only; the server picks the model in password mode. */
  model: string
  remember: boolean
}

function load(): AccessSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? 'null') as { secret?: string; apiKey?: string; model?: string } | null
    const secret = saved?.secret ?? saved?.apiKey
    if (secret) return { secret, model: saved?.model || DEFAULT_MODEL, remember: true }
  } catch {
    /* storage can be blocked; fall through */
  }
  return { secret: '', model: DEFAULT_MODEL, remember: false }
}

let current = load()

export const getSettings = (): AccessSettings => ({ ...current })

export function setSettings(next: AccessSettings) {
  current = { ...next }
  try {
    if (next.remember && next.secret) localStorage.setItem(STORE, JSON.stringify({ secret: next.secret, model: next.model }))
    else localStorage.removeItem(STORE)
  } catch {
    /* the secret still works for this session */
  }
}
