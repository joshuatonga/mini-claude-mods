import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Combo, Current } from '../types'
import { DEFAULT_MODELS, allCombos, comboOfKey, keyOf, labelOf, rank } from './fuzzy'

const PANE = 'model-pick'
const MAX_RECENTS = 5
const MAX_MATCHES = 12
const HOTKEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
const ALIAS_RE = /^[a-z0-9][a-z0-9_.-]{0,15}$/

const query = atom({ plugin: 'model-pick', key: 'query' } as const, '')
const assign = atom({ plugin: 'model-pick', key: 'assign' } as const, null)
const notice = atom({ plugin: 'model-pick', key: 'notice' } as const, null)
const favorites = atom({ plugin: 'model-pick', key: 'favorites' } as const, [])
const recents = atom({ plugin: 'model-pick', key: 'recents' } as const, [])
const aliases = atom({ plugin: 'model-pick', key: 'aliases' } as const, {})
const current = atom({ plugin: 'model-pick', key: 'current' } as const, null)

// The combos offered: the built-in aliases, plus any model ids the person's
// settings name (`availableModels`, `model`). Rebuilt at session start.
let combos: Combo[] = allCombos(DEFAULT_MODELS)
let byKey = new Map<string, Combo>(combos.map(c => [keyOf(c), c]))

const setModels = (models: readonly string[]) => {
  combos = allCombos([...DEFAULT_MODELS, ...models])
  byKey = new Map(combos.map(c => [keyOf(c), c]))
}

/** Model names the settings name: the `availableModels` allowlist and the default `model`. */
const modelsInSettings = (settings: Readonly<Record<string, unknown>>): string[] => {
  const out: string[] = []
  const listed = settings['availableModels']
  if (Array.isArray(listed)) out.push(...listed.filter(isString))
  const chosen = settings['model']
  if (isString(chosen)) out.push(chosen)
  return out.map(m => m.trim()).filter(m => m !== '' && !m.includes(' '))
}

const loadModels = async ($: EngineInterface) => {
  try {
    setModels(modelsInSettings(await $.settings.read()))
  } catch {
    setModels([])
  }
}

const isString = (v: unknown): v is string => typeof v === 'string'

const isCombo = (v: unknown): v is Combo =>
  typeof v === 'object' &&
  v !== null &&
  isString((v as Combo).model) &&
  isString((v as Combo).effort)

const asAliases = (v: unknown): Record<string, string> => {
  if (typeof v !== 'object' || v === null) return {}
  const out: Record<string, string> = {}
  for (const [alias, key] of Object.entries(v as Record<string, unknown>)) {
    if (isString(key)) out[alias] = key
  }
  return out
}

const resolveKey = (key: string): Combo | null => byKey.get(key) ?? comboOfKey(key)

const aliasFor = (alis: Record<string, string>, key: string): string | undefined =>
  Object.keys(alis).find(alias => alis[alias] === key)

const boostOf =
  (favs: string[], recs: Combo[]) =>
  (key: string): number =>
    (favs.includes(key) ? 0.5 : 0) + (recs.some(c => keyOf(c) === key) ? 0.25 : 0)

/**
 * A trailing row number: "3" picks row 3 of the unfiltered list, "op hi 2"
 * row 2 of the matches for "op hi". `index` is 0-based; null when none.
 */
const splitRowNumber = (text: string): { base: string; index: number | null } => {
  const m = /^(?:(.*\S)\s+)?([1-9])$/.exec(text.trim())
  if (m === null) return { base: text, index: null }
  return { base: m[1] ?? '', index: Number(m[2]) - 1 }
}

const loadStore = async ($: EngineInterface) => {
  const fav = await $.store.get('favorites')
  const rec = await $.store.get('recents')
  const ali = await $.store.get('aliases')
  await update($, favorites, () => (Array.isArray(fav) ? fav.filter(isString) : []))
  await update($, recents, () => (Array.isArray(rec) ? rec.filter(isCombo).slice(0, MAX_RECENTS) : []))
  await update($, aliases, () => asAliases(ali))
}

const say = ($: EngineInterface, text: string | null) => update($, notice, () => text)

const pickBy = async ($: EngineInterface, text: string): Promise<Combo | null> => {
  const [favs, recs, alis] = await Promise.all([read($, favorites), read($, recents), read($, aliases)])
  const { base, index } = splitRowNumber(text)
  if (index !== null) {
    const rows = sectionsFor(base, favs, recs, alis, 999).flatMap(s => s.rows)
    return rows[index] ?? null
  }
  const q = text.trim().toLowerCase()
  if (q === '') {
    const first = favs[0] !== undefined ? resolveKey(favs[0]) : null
    return first ?? recs[0] ?? combos[0] ?? null
  }
  const aliased = alis[q]
  if (aliased !== undefined) {
    const found = resolveKey(aliased)
    if (found !== null) return found
  }
  const ranked = rank(q, combos, key => aliasFor(alis, key), boostOf(favs, recs))
  return ranked[0]?.combo ?? null
}

const pushRecent = async ($: EngineInterface, combo: Combo) => {
  const list = await update($, recents, old =>
    [combo, ...old.filter(c => keyOf(c) !== keyOf(combo))].slice(0, MAX_RECENTS),
  )
  await $.store.set('recents', list)
}

const applyCombo = ($: EngineInterface, combo: Combo) => {
  // Detached: a command may not run inside the frame of the hook that asks.
  $.clock.after(0, async () => {
    try {
      const model = await $.command.run({ command: 'model', args: combo.model })
      // "/model" answers "Kept model as ..." when the switch was declined or refused.
      if (model.text === undefined || !model.text.startsWith('Set model to')) {
        $.ui.toast(`${labelOf(combo)} not applied: ${model.text ?? 'model unchanged'}`)
        return
      }
      const effort = await $.command.run({ command: 'effort', args: combo.effort })
      await pushRecent($, combo)
      const applied = effort.text?.startsWith('Set effort') ?? false
      $.ui.toast(applied ? `now ${labelOf(combo)}` : `${combo.model} set, effort: ${effort.text ?? 'unchanged'}`)
    } catch (err) {
      $.ui.toast(`${err instanceof Error ? err.message : String(err)}`)
    }
  })
}

const choose = async ($: EngineInterface, combo: Combo, close = true) => {
  await update($, query, () => '')
  await update($, assign, () => null)
  await say($, null)
  if (close) await $.ui.close({ id: PANE })
  applyCombo($, combo)
}

const toggleFav = async ($: EngineInterface, combo: Combo) => {
  const key = keyOf(combo)
  let isFav = false
  const list = await update($, favorites, old => {
    isFav = !old.includes(key)
    return isFav ? [...old, key] : old.filter(k => k !== key)
  })
  await $.store.set('favorites', list)
  await say($, `${isFav ? '★ favorited' : '☆ unfavorited'} ${labelOf(combo)}`)
}

const setAlias = async ($: EngineInterface, combo: Combo, text: string) => {
  const key = keyOf(combo)
  const alias = text.trim().toLowerCase()
  if (alias !== '' && !ALIAS_RE.test(alias)) {
    await say($, `alias "${alias}" is refused: 1-16 of a-z 0-9 _ . -`)
    return
  }
  const map = await update($, aliases, old => {
    const next: Record<string, string> = {}
    for (const [a, k] of Object.entries(old)) if (k !== key && a !== alias) next[a] = k
    if (alias !== '') next[alias] = key
    return next
  })
  await $.store.set('aliases', map)
  await update($, assign, () => null)
  await update($, query, () => '')
  await say($, alias === '' ? `alias cleared for ${labelOf(combo)}` : `/pick ${alias} → ${labelOf(combo)}`)
}

const startAssign = async ($: EngineInterface, combo: Combo) => {
  await update($, assign, () => keyOf(combo))
  await update($, query, () => '')
  await say($, `type an alias for ${labelOf(combo)}, Enter saves, empty clears`)
}

const submit = async ($: EngineInterface, text: string) => {
  const pending = await read($, assign)
  if (pending !== null) {
    const combo = resolveKey(pending)
    if (combo !== null) await setAlias($, combo, text)
    else await update($, assign, () => null)
    return
  }
  const t = text.trim()
  if (t.startsWith('*')) {
    const combo = await pickBy($, t.slice(1))
    if (combo === null) await say($, `no match for "${t.slice(1).trim()}"`)
    else await toggleFav($, combo)
    await update($, query, () => '')
    return
  }
  if (t.startsWith('=')) {
    const [alias = '', ...rest] = t.slice(1).trim().split(/\s+/)
    const combo = await pickBy($, rest.join(' '))
    if (alias === '') await say($, 'usage: =alias model effort')
    else if (combo === null) await say($, `no match for "${rest.join(' ')}"`)
    else await setAlias($, combo, alias)
    return
  }
  const combo = await pickBy($, t)
  if (combo === null) {
    await say($, `no match for "${t}"`)
    return
  }
  await choose($, combo)
}

type Section = { title: string; rows: Combo[] }

const sectionsFor = (
  q: string,
  favs: string[],
  recs: Combo[],
  alis: Record<string, string>,
  room: number,
): Section[] => {
  if (q.trim() !== '') {
    const ranked = rank(q, combos, key => aliasFor(alis, key), boostOf(favs, recs))
    return [
      {
        title: ranked.length === 0 ? 'no matches' : 'matches',
        rows: ranked.slice(0, MAX_MATCHES).map(r => r.combo),
      },
    ]
  }
  const favRows = favs.map(resolveKey).filter((c): c is Combo => c !== null)
  const out: Section[] = []
  if (favRows.length > 0) out.push({ title: 'favorites', rows: favRows })
  if (recs.length > 0) out.push({ title: 'recent', rows: recs.slice(0, MAX_RECENTS) })
  const used = favRows.length + Math.min(recs.length, MAX_RECENTS)
  out.push({ title: 'all (type to filter)', rows: combos.slice(0, Math.max(3, room - used)) })
  return out
}

const HINT = 'Enter applies ▸ · a row number picks that row · *q favorites · =alias q binds · Esc closes'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'pick',
      description: 'Fuzzy-pick model + effort; favorites, aliases, 5 recents',
      argumentHint: '[query or alias]',
      immediate: true,
    })
    await loadModels($)
    await loadStore($)
    return next(e)
  })

  // /clear, /resume and /branch reset $.state without a session.start: load again.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    await loadModels($)
    await loadStore($)
    return next(e)
  })

  on('command.run', { command: 'pick' }, async ($, e) => {
    const args = e.args.trim()
    if (args === '') {
      await update($, query, () => '')
      await update($, assign, () => null)
      await say($, null)
      const opened = await $.ui.open({
        id: PANE,
        title: 'model · effort',
        focus: true,
        closeOnEscape: true,
        rows: 18,
      })
      return { text: opened.isPlaced ? 'picker opened' : opened.reason }
    }
    const combo = await pickBy($, args)
    if (combo === null) return { text: `no match for "${args}"` }
    await choose($, combo, false)
    return { text: labelOf(combo) }
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      const now: Current = { model: e.model, effort: e.effort === undefined ? null : String(e.effort) }
      await update($, current, () => now)
    }
    return yield* next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const [q, pending, note, favs, recs, alis, cur] = await Promise.all([
      read($, query),
      read($, assign),
      read($, notice),
      read($, favorites),
      read($, recents),
      read($, aliases),
      read($, current),
    ])
    const pendingCombo = pending === null ? null : resolveKey(pending)
    const room = Math.max(6, (e.props.scroll?.bodyRows ?? 18) - 5)
    const { base, index } = pendingCombo === null ? splitRowNumber(q) : { base: q, index: null }
    const sections = sectionsFor(base, favs, recs, alis, room)
    const topIndex = index ?? 0
    const nowLine =
      cur === null ? 'now: unknown until the next request' : `now: ${cur.model} · ${cur.effort ?? 'default'}`
    let hot = 0

    const { Box, Text, Button } = $.ui.resolve(e)
    const rows = sections.map(section => (
      <Box flexDirection="column">
        <Text bold>{section.title}</Text>
        {section.rows.map(combo => {
          const key = keyOf(combo)
          const isFav = favs.includes(key)
          const alias = aliasFor(alis, key)
          const isTop = hot === topIndex
          const hotkey = hot < HOTKEYS.length ? HOTKEYS[hot++] : undefined
          return (
            <Box flexDirection="row" gap={1}>
              <Text color="suggestion" bold>{isTop ? '▸' : ' '}</Text>
              <Button
                key={`apply:${key}`}
                plain
                {...(hotkey === undefined ? {} : { hotkey })}
                label={labelOf(combo)}
                onPress={() => void choose($, combo)}
              />
              <Button
                key={`fav:${key}`}
                plain
                dimColor={!isFav}
                label={isFav ? '★' : '☆'}
                onPress={() => void toggleFav($, combo)}
              />
              <Button
                key={`alias:${key}`}
                plain
                dimColor={alias === undefined}
                label={alias === undefined ? '=…' : `=${alias}`}
                onPress={() => void startAssign($, combo)}
              />
            </Box>
          )
        })}
      </Box>
    ))

    if (e.surface === 'mobile') {
      // No Input on this surface yet: the rows and their buttons still work.
      return (
        <Box flexDirection="column">
          <Text dimColor>{nowLine}</Text>
          {rows}
          <Text dimColor>{note ?? 'tap a row to apply'}</Text>
        </Box>
      )
    }

    const { Input } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Input
          key="q"
          label={pendingCombo === null ? 'find' : `alias for ${labelOf(pendingCombo)}`}
          placeholder={pendingCombo === null ? 'model effort, e.g. "op hi"' : 'a-z 0-9, empty clears'}
          value={q}
          submitLabel={pendingCombo === null ? 'apply' : 'save'}
          autoFocus
          onInput={value => void update($, query, () => value)}
          onSubmit={value => void submit($, value)}
        />
        <Text dimColor>{nowLine}</Text>
        {rows}
        <Text dimColor>{note ?? HINT}</Text>
      </Box>
    )
  })
}
