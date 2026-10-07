import { describe, expect, test } from 'claude-code/testing'

import { DEFAULT_MODELS, allCombos, fuzzyScore, keyOf, rank } from '../hooks/fuzzy'

const combos = allCombos(DEFAULT_MODELS)
const none = () => undefined
const flat = () => 0

describe('fuzzy', () => {
  test('a subsequence matches, anything else does not', async () => {
    expect(fuzzyScore('op', 'opus high')).not.toBeNull()
    expect(fuzzyScore('oh', 'opus high')).not.toBeNull()
    expect(fuzzyScore('z', 'opus high')).toBeNull()
  })

  test('"op hi" ranks opus · high first', async () => {
    const top = rank('op hi', combos, none, flat)[0]
    expect(top?.combo).toEqual({ model: 'opus', effort: 'high' })
  })

  test('"son max" ranks sonnet · max first', async () => {
    const top = rank('son max', combos, none, flat)[0]
    expect(top?.combo).toEqual({ model: 'sonnet', effort: 'max' })
  })

  test('an alias token matches its combo', async () => {
    const aliasOf = (key: string) => (key === 'fable/xhigh' ? 'fx' : undefined)
    const top = rank('fx', combos, aliasOf, flat)[0]
    expect(top?.combo).toEqual({ model: 'fable', effort: 'xhigh' })
  })

  test('a boost breaks ties toward favorites', async () => {
    const boost = (key: string) => (key === 'opus[1m]/high' ? 0.5 : 0)
    const top = rank('opus high', combos, none, boost)[0]
    expect(top === undefined ? '' : keyOf(top.combo)).toBe('opus[1m]/high')
  })
})
