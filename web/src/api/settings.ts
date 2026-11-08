// The viewer's OpenAI key and model for the browser build. Kept in memory; saved to this
// browser only when the viewer asks.

const KEY = 'aleph.openai.v1'
export const DEFAULT_MODEL = 'gpt-6-astra'

export interface OpenAISettings {
  apiKey: string
  model: string
  remember: boolean
}

function load(): OpenAISettings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<OpenAISettings> | null
    if (saved?.apiKey) return { apiKey: saved.apiKey, model: saved.model || DEFAULT_MODEL, remember: true }
  } catch {
    /* storage can be blocked; fall through */
  }
  return { apiKey: '', model: DEFAULT_MODEL, remember: false }
}

let current = load()

export const getSettings = (): OpenAISettings => ({ ...current })

export function setSettings(next: OpenAISettings) {
  current = { ...next }
  try {
    if (next.remember && next.apiKey) localStorage.setItem(KEY, JSON.stringify({ apiKey: next.apiKey, model: next.model }))
    else localStorage.removeItem(KEY)
  } catch {
    /* the key still works for this session */
  }
}
