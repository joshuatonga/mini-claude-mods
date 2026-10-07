import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const PLUGIN = 'model-pick'
const PANE = {
  plugin: PLUGIN,
  component: 'Pane',
  requestId: 'model-pick',
  props: {
    title: 'model · effort',
    isFocused: true,
    bodyColumns: 80,
    placement: 'inline',
    scroll: { offset: 0, bodyRows: 18 },
    view: {},
  },
} as const

/** Answers what the engine would beneath the plugins, then starts the session. */
const boot = async ($: Engine, on: On, ran: string[] = []) => {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('command.run', ($, e) => {
    ran.push(`${e.command} ${e.args}`)
    return { text: e.command === 'model' ? `Set model to ${e.args}` : `Set effort level to ${e.args}` }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
}

test('typing filters the rows and Enter applies the top match', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const ran: string[] = []
  await boot($, on, ran)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.input({ key: 'q', text: 'op hi', kind: 'change' })
    const first = await ui.find({ type: 'Button', text: /opus · high/ })
    expect(first?.key).toBe('apply:opus/high')
    await ui.input({ key: 'q', text: 'op hi' })
    await clock.advance(1)
    expect(ran.slice(-2)).toEqual(['model opus', 'effort high'])
    await ui.unmount()
  }
})

test('a favorite is marked and listed first; the last 5 picks are the recents', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  await boot($, on)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'fav:sonnet/low' })
  expect((await ui.find({ key: 'fav:sonnet/low' }))?.text).toBe('★')

  const picks = ['haiku low', 'opus max', 'sonnet high', 'fable xhigh', 'default medium', 'opus low']
  for (const pick of picks) {
    await ui.input({ key: 'q', text: pick })
    await clock.advance(1)
  }
  await ui.input({ key: 'q', text: '', kind: 'change' })
  const recent = (await ui.findAll({ type: 'Button', text: /·/ }))
    .map(b => b.key ?? '')
    .filter(k => k.startsWith('apply:'))
  // favorites first, then the five newest picks, newest first
  expect(recent.slice(0, 6)).toEqual([
    'apply:sonnet/low',
    'apply:opus/low',
    'apply:default/medium',
    'apply:fable/xhigh',
    'apply:sonnet/high',
    'apply:opus/max',
  ])
  expect(recent).not.toContain('apply:haiku/low')
  await ui.unmount()
})

test('an alias binds a combo and /pick <alias> applies it', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const ran: string[] = []
  await boot($, on, ran)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'q', text: '=fx fable xhigh' })
  expect(await ui.find({ type: 'Text', text: /\/pick fx/ })).toBeDefined()
  await ui.input({ key: 'q', text: 'fab xh', kind: 'change' })
  expect((await ui.find({ key: 'alias:fable/xhigh' }))?.text).toBe('=fx')

  await ui.input({ key: 'q', text: 'fx' })
  await clock.advance(1)
  expect(ran.slice(-2)).toEqual(['model fable', 'effort xhigh'])

  const out = await $.command.run({
    command: 'pick',
    args: 'fx',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  expect(out.text).toContain('fable · xhigh')
  await clock.advance(1)
  expect(ran.slice(-2)).toEqual(['model fable', 'effort xhigh'])
  await ui.unmount()
})

test('a declined model switch applies nothing and records no recent', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.close', () => ({ value: undefined }))
  const toasts: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const ran: string[] = []
  on('command.run', ($, e) => {
    ran.push(e.command)
    return { text: e.command === 'model' ? 'Kept model as `Fable 5.1`' : 'Set effort level to max' }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'q', text: 'son max' })
  await clock.advance(1)
  expect(ran).toEqual(['model'])
  expect(toasts.at(-1)).toContain('not applied')
  expect(await ui.find({ type: 'Text', text: 'recent' })).toBeUndefined()
  await ui.unmount()
})

test('a bad alias is refused with a notice', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  await boot($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'q', text: '=bad! opus high' })
  expect(await ui.find({ type: 'Text', text: /refused/ })).toBeDefined()
  expect((await ui.find({ key: 'alias:opus/high' }))?.text).toBe('=…')
  await ui.unmount()
})

test('the first row carries the marker Enter applies', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  await boot($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'q', text: 'op hi', kind: 'change' })
  const marks = (await ui.findAll({ type: 'Text', text: /^▸$/ })).length
  expect(marks).toBe(1)
  const rows = await ui.findAll({ type: 'Box' })
  const top = rows.find(b => JSON.stringify(b.children).includes('▸'))
  expect(JSON.stringify(top?.children)).toContain('apply:opus/high')
  await ui.unmount()
})

test('a row number picks that row: alone from the unfiltered list, after a query from its matches', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on, { favorites: ['sonnet/low'] })
  const ran: string[] = []
  await boot($, on, ran)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  // rows: 1 sonnet·low (favorite), then all: 2 default·low, 3 default·medium ...
  await ui.input({ key: 'q', text: '3', kind: 'change' })
  const marked = await ui.findAll({ type: 'Box' })
  const top = marked.find(b => JSON.stringify(b.children).includes('▸'))
  expect(JSON.stringify(top?.children)).toContain('apply:default/medium')
  await ui.input({ key: 'q', text: '3' })
  await clock.advance(1)
  expect(ran.slice(-2)).toEqual(['model default', 'effort medium'])

  // "op hi 2": the second match for "op hi"
  await ui.input({ key: 'q', text: 'op hi 2', kind: 'change' })
  const second = (await ui.findAll({ type: 'Button', text: /·/ })).map(b => b.key)[1]
  await ui.input({ key: 'q', text: 'op hi 2' })
  await clock.advance(1)
  expect(`apply:${ran.at(-2)?.slice(6)}/${ran.at(-1)?.slice(7)}`).toBe(second)
  await ui.unmount()
})

test('favorites survive /clear, which resets state but not the store', async ($, on) => {
  mock.clock(on)
  mock.store(on, { favorites: ['opus/max'], aliases: { om: 'opus/max' } })
  on('classic.SessionStart', () => ({}))
  await boot($, on)
  await $.classic.SessionStart({ source: 'clear' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ key: 'fav:opus/max' }))?.text).toBe('★')
  expect((await ui.find({ key: 'alias:opus/max' }))?.text).toBe('=om')
  await ui.unmount()
})
