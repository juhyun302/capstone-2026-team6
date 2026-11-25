// The part of a prompt file that is sent to the model; same rule as load_prompt in
// src/aleph/generation.py. Shared by the browser pipeline and the web worker.

const START = '<!-- prompt:start -->'
const END = '<!-- prompt:end -->'

export const PROMPT_NAMES = ['parse_query', 'design_candidates', 'generate_candidate', 'solve_candidate', 'review_candidate'] as const
export type PromptName = (typeof PROMPT_NAMES)[number]

/** Prompts that may be sent figure pictures: the blind solver and the reviewer. */
export const IMAGE_PROMPTS: readonly PromptName[] = ['solve_candidate', 'review_candidate']
export const MAX_IMAGES = 2
const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/
/** About 1.5 MB of PNG; a 200dpi figure is far smaller. */
export const MAX_IMAGE_CHARS = 2_000_000

export function imagesOk(images: unknown): images is string[] {
  return Array.isArray(images) && images.length <= MAX_IMAGES
    && images.every((image) => typeof image === 'string' && image.length <= MAX_IMAGE_CHARS && PNG_DATA_URL.test(image))
}

/** The parts of a Responses API reply that Aleph reads. */
export interface ResponseBody {
  status?: string
  model?: string
  output?: { type?: string; content?: { type?: string; text?: string }[] }[]
  error?: { code?: string; message?: string }
  incomplete_details?: { reason?: string }
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number }
}

/** The reply's text: every output_text part of its message items, joined. */
export const outputText = (body: ResponseBody) =>
  (body.output ?? [])
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === 'output_text')
    .map((part) => part.text ?? '')
    .join('')

/** The Responses API `input`: the JSON text alone, or the text followed by the pictures. */
export function modelInput(user: string, images?: string[]) {
  if (!images?.length) return user
  return [{ role: 'user', content: [{ type: 'input_text', text: user }, ...images.map((image) => ({ type: 'input_image', image_url: image, detail: 'high' }))] }]
}

export function promptOf(markdown: string, name: string): string {
  const text = markdown.replace(/\r\n/g, '\n')
  if (text.split(START).length !== 2 || text.split(END).length !== 2) throw new Error(`${name}: prompt markers must appear exactly once`)
  return text.split(START)[1].split(END)[0].trim()
}
