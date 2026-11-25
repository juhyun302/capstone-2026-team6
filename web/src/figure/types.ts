// FigureSpec: src/aleph/schemas/figure.schema.json as TypeScript types.

export type Num = number | string
export type Pair = [Num, Num]
export type Pos = string | Pair
export type Style = 'main' | 'aux' | 'dashed'
export type Position = 'center' | 'above' | 'below' | 'left' | 'right' | 'above left' | 'above right' | 'below left' | 'below right'

export type FigureItem =
  | { type: 'axes'; x: Pair; y: Pair; labels?: boolean }
  | { type: 'curve'; id?: string; expr: string; domain: Pair; style?: Style }
  | { type: 'piecewise'; id?: string; pieces: { expr: string; domain: Pair }[]; style?: Style }
  | { type: 'segment'; from: Pos; to: Pos; style?: Style; arrow?: boolean }
  | { type: 'polygon'; points: Pos[]; closed?: boolean; style?: Style }
  | { type: 'circle'; center: Pos; radius: Num; style?: Style }
  | { type: 'arc'; center: Pos; radius: Num; from_deg: Num; to_deg: Num; style?: Style }
  | { type: 'dot'; at: Pos; open?: boolean; on?: string[] }
  | { type: 'guide'; at: Pos; to: 'x' | 'y' | 'both'; on?: string[] }
  | { type: 'shade'; upper: string; lower: string; domain: Pair }
  | { type: 'shade_polygon'; points: Pos[] }
  | { type: 'label'; tex: string; at: Pos; position?: Position }
  | { type: 'tick'; axis: 'x' | 'y'; value: Num; tex?: string; side?: 'below' | 'above' | 'left' | 'right' }
  | { type: 'point_names'; names: string[]; center?: Pos }
  | { type: 'callout'; from: Pos; to: Pos; bend?: number }
  | { type: 'same_length'; from: Pos; to: Pos; side?: 'left' | 'right' }
  | { type: 'right_angle'; vertex: Pos; a: Pos; b: Pos }
  | { type: 'angle'; vertex: Pos; a: Pos; b: Pos; tex?: string }

export interface FigureSpec {
  width_mm: number
  height_mm?: number
  aspect: 'equal' | 'free'
  view: { x: Pair; y: Pair }
  points?: Record<string, Pair>
  items: FigureItem[]
}

export const FIGURE_KEYS = ['statement_figure', 'solution_figure'] as const
export type FigureKey = (typeof FIGURE_KEYS)[number]
export const FIGURE_NAME: Record<FigureKey, string> = {
  statement_figure: '문항 그림(statement_figure)',
  solution_figure: '풀이 그림(solution_figure)',
}
