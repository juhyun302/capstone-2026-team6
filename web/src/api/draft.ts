// The input a run started from, so going back does not mean pasting it all again.

export interface Draft {
  statement: string
  solution: string
  scope: string
  count: number
}

let last: Draft | null = null

export const rememberDraft = (draft: Draft) => {
  last = draft
}
export const lastDraft = () => last
