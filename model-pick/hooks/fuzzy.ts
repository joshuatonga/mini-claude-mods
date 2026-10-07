import type { Combo } from '../types'

export const DEFAULT_MODELS = [
  'default',
  'opus',
  'sonnet',
  'haiku',
  'fable',
  'opusplan',
  'opus[1m]',
  'sonnet[1m]',
  'fable[1m]',
  'opusplan[1m]',
]

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'auto']

export const keyOf = (c: Combo): string => `${c.model}/${c.effort}`

export const labelOf = (c: Combo): string => `${c.model} · ${c.effort}`

export const comboOfKey = (key: string): Combo | null => {
  const at = key.lastIndexOf('/')
  if (at <= 0) return null
  return { model: key.slice(0, at), effort: key.slice(at + 1) }
}

export const allCombos = (models: readonly string[]): Combo[] => {
  const seen = new Set<string>()
  const out: Combo[] = []
  for (const model of models) {
    const m = model.trim()
    if (m === '' || seen.has(m)) continue
    seen.add(m)
    for (const effort of EFFORTS) out.push({ model: m, effort })
  }
  return out
}

const isWordChar = (ch: string | undefined): boolean =>
  ch !== undefined && /[a-z0-9]/i.test(ch)

/**
 * Subsequence score of `needle` in `hay`, higher is better; null when
 * `needle` is not a subsequence. Adjacent hits and word starts score more.
 */
export const fuzzyScore = (needle: string, hay: string): number | null => {
  if (needle === '') return 0
  let score = 0
  let from = 0
  let prev = -2
  for (const ch of needle) {
    const at = hay.indexOf(ch, from)
    if (at < 0) return null
    if (at === prev + 1) score += 3
    else if (at === 0 || !isWordChar(hay[at - 1])) score += 2
    else score += 1
    prev = at
    from = at + 1
  }
  if (hay.startsWith(needle)) score += 2
  return score - (prev + 1 - needle.length) * 0.01
}

export type Ranked = { combo: Combo; score: number }

/**
 * Every combo each whitespace-separated token of `query` fuzzy-matches, best
 * first. A token matches the model, the effort, or the combo's alias.
 */
export const rank = (
  query: string,
  combos: readonly Combo[],
  aliasOf: (key: string) => string | undefined,
  boost: (key: string) => number,
): Ranked[] => {
  const tokens = query.toLowerCase().split(/\s+/).filter(t => t !== '')
  const out: Ranked[] = []
  for (const combo of combos) {
    const key = keyOf(combo)
    const alias = aliasOf(key)
    const hay = `${combo.model} ${combo.effort}`.toLowerCase()
    let total = 0
    let ok = true
    for (const token of tokens) {
      const best = Math.max(
        fuzzyScore(token, hay) ?? -Infinity,
        alias !== undefined ? (fuzzyScore(token, alias) ?? -Infinity) + 1 : -Infinity,
      )
      if (best === -Infinity) {
        ok = false
        break
      }
      total += best
    }
    if (ok) out.push({ combo, score: total + boost(key) })
  }
  out.sort((a, b) => b.score - a.score)
  return out
}
