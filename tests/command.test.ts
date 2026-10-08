import { test, expect, mock } from 'claude-code/testing'
import type { On, TurnStepToolUse, TurnStepChunk } from 'claude-code'
import type { Engine } from 'claude-code/testing'

type Script = { text: string[]; tools: TurnStepToolUse[] }
type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | undefined

// Bottoms for the events the mod's hooks enter: model, status, log, clock.
function bottoms(on: On, script: Script, seen: Effort[], statuses: (string | undefined)[] = []) {
  mock.clock(on, { now: 1000 })
  on('ui.status', (_$, e) => (statuses.push(e.text), { value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('skill.prompt', (_$, e) => ({ text: e.text }))
  on('turn.step', async function* (_$, e) {
    seen.push(e.effort as Effort)
    for (const t of script.text) yield { kind: 'text', index: 0, text: t }
    return { turnId: e.turnId, index: e.index, answer: script.text.join(''), toolUses: script.tools, stopReason: 'end_turn', usage: null }
  })
}

async function step($: Engine, index: number, effort: Effort, agentId?: string) {
  const input = { turnId: 't1', index, model: 'claude-opus-5-5', messageCount: 1, ...(effort !== undefined ? { effort } : {}), ...(agentId !== undefined ? { agentId } : {}) }
  const s = $.turn.step(input)
  const chunks: TurnStepChunk[] = []
  for (;;) {
    const r = await s.next()
    if (r.done) return { chunks, result: r.value }
    chunks.push(r.value)
  }
}

// Command input as the engine stamps it for a typed `/autoeffort <args>`.
const run = ($: Engine, args = '') =>
  $.command.run({ command: 'autoeffort', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

const READ: TurnStepToolUse[] = [{ name: 'Read', input: {} }]

test('session.start registers the autoeffort command', async ($, on) => {
  const specs: { name: string; description: string }[] = []
  on('command.register', (_$, e) => (specs.push(e), { value: { command: e.name } }))
  on('session.start', (_$, e) => e)
  await $.session.start({ cwd: '/', surface: null, isInteractive: false })
  expect(specs.map(s => s.name)).toEqual(['autoeffort'])
  expect(specs[0]?.description).toBe('autoeffort status and control: /autoeffort [on|off|log]')
})

test('/autoeffort: status and recent decisions', async ($, on) => {
  const script: Script = { text: [], tools: READ }
  bottoms(on, script, [])
  await step($, 0, 'high')
  await $.skill.prompt({ skill: 'review', text: 'x' })
  await step($, 1, 'max')
  const r = await run($, '')
  const text = r.text ?? ''
  expect(text).toContain('autoeffort: enabled')
  expect(text).toContain('baseline: high')
  expect(text).toContain('skill: review')
  expect(text).toContain('thread main: gather')
  expect(text).toContain('Recent decisions:')
  expect(text).toContain('main#0 xhigh · plan (rule:first-step)')
  expect(text).toContain('main#1 max · gather (rule:read) ↑skill:review:max')
})

test('/autoeffort shows at most 20 decisions', async ($, on) => {
  bottoms(on, { text: [], tools: READ }, [])
  for (let i = 0; i < 25; i++) await step($, i, 'high')
  const text = (await run($)).text ?? ''
  const lines = text.split('\n')
  const decisions = lines.slice(lines.indexOf('Recent decisions:') + 1)
  expect(decisions.length).toBe(20)
  expect(decisions[0]?.startsWith('main#5 ')).toBe(true)
  expect(decisions[19]?.startsWith('main#24 ')).toBe(true)
})

test('/autoeffort without decisions: baseline and skill are a dash', async ($, on) => {
  bottoms(on, { text: [], tools: [] }, [])
  const text = (await run($)).text ?? ''
  expect(text).toContain('baseline: —')
  expect(text).toContain('skill: —')
})

test('/autoeffort off → effort unchanged; on → controls again', async ($, on) => {
  const seen: Effort[] = []
  bottoms(on, { text: ['x'], tools: [] }, seen)
  expect((await run($, 'off')).text).toBe('autoeffort disabled')
  await step($, 0, 'high')
  expect(seen).toEqual(['high'])
  expect((await run($)).text).toContain('autoeffort: disabled')
  expect((await run($, 'on')).text).toBe('autoeffort enabled')
  await step($, 0, 'high')
  expect(seen).toEqual(['high', 'xhigh'])
})

test('/autoeffort log: all entries with ISO time', async ($, on) => {
  bottoms(on, { text: [], tools: READ }, [])
  for (let i = 0; i < 22; i++) await step($, i, 'high')
  const text = (await run($, 'log')).text ?? ''
  const lines = text.split('\n')
  expect(lines.length).toBe(22)
  expect(lines[0]).toBe('1970-01-01T00:00:01.000Z main#0 xhigh · plan (rule:first-step) · incoming high')
})

test('unknown argument → usage hint', async ($, on) => {
  bottoms(on, { text: [], tools: [] }, [])
  const text = (await run($, 'foo')).text ?? ''
  expect(text).toContain('Usage: /autoeffort [on|off|log]')
})

test('/autoeffort off clears the status line', async ($, on) => {
  const statuses: (string | undefined)[] = []
  bottoms(on, { text: ['x'], tools: [] }, [], statuses)
  await step($, 0, 'high')
  expect(statuses).toEqual(['⚙ xhigh · plan (rule:first-step)'])
  await run($, 'off')
  expect(statuses).toEqual(['⚙ xhigh · plan (rule:first-step)', undefined])
  await run($, 'on')
  expect(statuses.length).toBe(2)
})
