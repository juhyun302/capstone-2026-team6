// The part of a prompt file that is sent to the model; same rule as load_prompt in
// src/aleph/generation.py. Shared by the browser pipeline and the web worker.

const START = '<!-- prompt:start -->'
const END = '<!-- prompt:end -->'

export const PROMPT_NAMES = ['parse_query', 'design_candidates', 'generate_candidate', 'solve_candidate', 'review_candidate'] as const
export type PromptName = (typeof PROMPT_NAMES)[number]

export function promptOf(markdown: string, name: string): string {
  const text = markdown.replace(/\r\n/g, '\n')
  if (text.split(START).length !== 2 || text.split(END).length !== 2) throw new Error(`${name}: prompt markers must appear exactly once`)
  return text.split(START)[1].split(END)[0].trim()
}
