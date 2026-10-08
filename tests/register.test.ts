import { test, expect, mock } from 'claude-code/testing'
import type { On, TurnStepToolUse, TurnStepChunk } from 'claude-code'
import type { AutoeffortLogEntry, AutoeffortThread } from '../types/index'
import type { Engine } from 'claude-code/testing'
import { MARKER_PROMPT, filterChunks } from '../hooks/register'
import { createMarkerFilter } from '../src/marker'

type Script = { text: string[]; tools: TurnStepToolUse[] }
type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | undefined

const COMPOSE = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: [], tools: [], outputStyle: null, traits: [] }

// The kit does not let a test read $.state, so the last written log is captured on state.set.
function captureLog(on: On) {
  const box: { log: AutoeffortLogEntry[]; threads: Record<string, AutoeffortThread> } = { log: [], threads: {} }
  on('state.set', (_$, e, next) => {
    if (e.plugin === 'autoeffort' && e.key === 'log') box.log = e.value as AutoeffortLogEntry[]
    if (e.plugin === 'autoeffort' && e.key === 'threads') box.threads = e.value as Record<string, AutoeffortThread>
    return next(e)
  })
  return box
}

// Bottoms for the events the mod's hooks enter: model, status, log, clock.
function bottoms(on: On, script: Script, seen: Effort[], statuses: (string | undefined)[] = []) {
  mock.clock(on, { now: 1000 })
  on('ui.status', (_$, e) => (statuses.push(e.text), { value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('skill.prompt', (_$, e) => ({ text: e.text }))
  on('prompt.compose', () => ({ sections: [] }))
  on('turn.step', async function* (_$, e) {
    seen.push(e.effort as Effort)
    for (const t of script.text) yield { kind: 'text', index: 0, text: t }
    return { turnId: e.turnId, index: e.index, answer: script.text.join(''), toolUses: script.tools, stopReason: 'end_turn', usage: null }
  })
}

async function step($: Engine, index: number, effort: Effort, agentId?: string, turnId = 't1') {
  const input = { turnId, index, model: 'claude-opus-5-5', messageCount: 1, ...(effort !== undefined ? { effort } : {}), ...(agentId !== undefined ? { agentId } : {}) }
  const s = $.turn.step(input)
  const chunks: TurnStepChunk[] = []
  // Read manually: the stream's result is the value of the generator's `done` step.
  for (;;) {
    const r = await s.next()
    if (r.done) return { chunks, result: r.value }
    chunks.push(r.value)
  }
}

const textOf = (chunks: TurnStepChunk[]) => chunks.map(c => (c.kind === 'text' ? c.text : '')).join('')
const READ: TurnStepToolUse[] = [{ name: 'Read', input: {} }]

test('step 0 → xhigh; marker stripped; step 1 → medium by the implement marker', async ($, on) => {
  const script: Script = { text: ['⟦phase:impl', 'ement⟧', '\nwriting'], tools: [] }
  const seen: Effort[] = []
  bottoms(on, script, seen)
  const r0 = await step($, 0, 'high')
  expect(seen[0]).toBe('xhigh')
  expect(textOf(r0.chunks)).toBe('writing')
  expect(r0.result.answer).toBe('writing')
  script.text = ['ok']
  await step($, 1, 'high')
  expect(seen[1]).toBe('medium')
})

test('no markers: Read → medium, three Reads in a row → xhigh (read-streak)', async ($, on) => {
  const script: Script = { text: ['x'], tools: READ }
  const seen: Effort[] = []
  bottoms(on, script, seen)
  await step($, 0, 'high')
  await step($, 1, 'high')
  await step($, 2, 'high')
  await step($, 3, 'high')
  expect(seen).toEqual(['xhigh', 'medium', 'medium', 'xhigh'])
})

test('Edit, then Bash npm test → next step xhigh (verify)', async ($, on) => {
  const script: Script = { text: [], tools: [{ name: 'Edit', input: {} }] }
  const seen: Effort[] = []
  bottoms(on, script, seen)
  const box = captureLog(on)
  await step($, 0, 'high')
  script.tools = [{ name: 'Bash', input: { command: 'npm test' } }]
  await step($, 1, 'high')
  await step($, 2, 'high')
  expect(seen).toEqual(['xhigh', 'medium', 'xhigh'])
  expect(box.log.at(-1)).toEqual({ at: 1000, thread: 'main', step: 2, incoming: 'high', level: 'xhigh', phase: 'verify', source: 'rule:verify-command' })
})

test('incoming low on a gather step → medium', async ($, on) => {
  const script: Script = { text: [], tools: READ }
  const seen: Effort[] = []
  bottoms(on, script, seen)
  await step($, 0, 'low')
  await step($, 1, 'low')
  expect(seen[1]).toBe('medium')
})

test('review skill with floor level max at baseline high → max, floor in the log', async ($, on) => {
  const script: Script = { text: [], tools: READ }
  const seen: Effort[] = []
  bottoms(on, script, seen)
  const box = captureLog(on)
  await step($, 0, 'high')
  await $.skill.prompt({ skill: 'review', text: 'x' })
  await step($, 1, 'max')
  expect(seen[1]).toBe('max')
  expect(box.log.at(-1)?.floor).toBe('skill:review:max')
})

test('a subagent has its own thread state', async ($, on) => {
  const script: Script = { text: ['⟦phase:implement⟧ writing'], tools: [] }
  const seen: Effort[] = []
  bottoms(on, script, seen)
  await step($, 0, 'high')
  script.text = ['ok']
  await step($, 0, 'high', 'a1')
  await step($, 1, 'high', 'a1')
  await step($, 1, 'high')
  expect(seen).toEqual(['xhigh', 'xhigh', 'xhigh', 'medium'])
})

test('effort missing → e unchanged', async ($, on) => {
  const seen: Effort[] = []
  bottoms(on, { text: ['⟦phase:plan⟧hi'], tools: [] }, seen)
  const r = await step($, 0, undefined)
  expect(seen).toEqual([undefined])
  expect(textOf(r.chunks)).toBe('hi')
  expect(r.result.answer).toBe('hi')
})

test('turn.complete of the main thread lifts the skill floor', async ($, on) => {
  const script: Script = { text: [], tools: READ }
  const seen: Effort[] = []
  bottoms(on, script, seen)
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  const box = captureLog(on)
  await step($, 0, 'high')
  await $.skill.prompt({ skill: 'review', text: 'x' })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await step($, 1, 'max')
  expect(box.log.at(-1)?.floor).toBeUndefined()
  expect(seen[1]).toBe('medium')
})

test('disabled', { options: { enabled: false } }, async ($, on) => {
  const seen: Effort[] = []
  bottoms(on, { text: ['x'], tools: [] }, seen)
  await step($, 0, 'high')
  expect(seen).toEqual(['high'])
  const r = await $.prompt.compose(COMPOSE)
  expect(r.sections.some(s => s.id === 'autoeffort:phase-marker')).toBe(false)
})

test('prompt.compose adds the marker section', async ($, on) => {
  bottoms(on, { text: [], tools: [] }, [])
  const r = await $.prompt.compose(COMPOSE)
  expect(r.sections).toEqual([{ id: 'autoeffort:phase-marker', text: MARKER_PROMPT, scope: 'session' }])
})

test('the marker of the last response in a turn does not carry into the next turn', async ($, on) => {
  const script: Script = { text: ['⟦phase:implement⟧ Done.'], tools: [] }
  const seen: Effort[] = []
  bottoms(on, script, seen)
  const box = captureLog(on)
  await step($, 0, 'high', undefined, 't1')
  script.text = ['ok']
  await step($, 0, 'high', undefined, 't2')
  expect(seen[1]).toBe('xhigh')
  expect(box.log.at(-1)?.source).toBe('rule:first-step')
})

// The kit does not let a test bottom fabricate an engine chunk (ref must come from the engine),
// so the filtering loop is tested directly through the exported filterChunks.
test('an engine chunk in the middle of a marker does not flush the hold', async () => {
  async function* src(): AsyncGenerator<TurnStepChunk> {
    yield { kind: 'text', index: 0, text: '⟦phase:ga' }
    yield { kind: 'engine', ref: 1 }
    yield { kind: 'text', index: 0, text: 'ther⟧\nok' }
  }
  const filter = createMarkerFilter()
  const out: TurnStepChunk[] = []
  for await (const c of filterChunks(src(), filter)) out.push(c)
  expect(out).toEqual([{ kind: 'engine', ref: 1 }, { kind: 'text', index: 0, text: 'ok' }])
  expect(filter.phase).toBe('gather')
})

test('flush before a tool chunk and before text of another block', async () => {
  async function* src(): AsyncGenerator<TurnStepChunk> {
    yield { kind: 'text', index: 0, text: 'a⟦ph' }
    yield { kind: 'text', index: 1, text: 'b' }
    yield { kind: 'text', index: 1, text: '⟦' }
    yield { kind: 'stop', stopReason: 'end_turn', usage: null }
  }
  const out: TurnStepChunk[] = []
  for await (const c of filterChunks(src(), createMarkerFilter())) out.push(c)
  expect(out.map(c => (c.kind === 'text' ? `${c.index}:${c.text}` : c.kind))).toEqual(['0:a', '0:⟦ph', '1:b', '1:⟦', 'stop'])
})

test('status only for the main thread', async ($, on) => {
  const statuses: (string | undefined)[] = []
  bottoms(on, { text: ['x'], tools: [] }, [], statuses)
  const box = captureLog(on)
  await step($, 0, 'high', 'a1')
  expect(statuses).toEqual([])
  expect(box.log.at(-1)?.thread).toBe('a1')
  await step($, 0, 'high')
  expect(statuses).toEqual(['⚙ xhigh · plan (rule:first-step)'])
})

test('turn.complete of a subagent deletes its thread', async ($, on) => {
  bottoms(on, { text: ['x'], tools: [] }, [])
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  const box = captureLog(on)
  await step($, 0, 'high', 'a1')
  expect(Object.keys(box.threads)).toEqual(['a1'])
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer', agentId: 'a1' })
  expect(Object.keys(box.threads)).toEqual([])
})

// Test state.set hook that refuses to write the given key: simulates a state write failure.
function failWrite(on: On, key: string) {
  on('state.set', (_$, e, next) => {
    if (e.plugin === 'autoeffort' && e.key === key) return { deny: `denied ${key}` }
    return next(e)
  })
}

test('fail-open: prepare failure (baseline write) → original effort, markers stripped', async ($, on) => {
  const seen: Effort[] = []
  bottoms(on, { text: ['⟦phase:plan⟧\nhi'], tools: [] }, seen)
  failWrite(on, 'baseline')
  const r = await step($, 0, 'high')
  expect(seen).toEqual(['high'])
  expect(textOf(r.chunks)).toBe('hi')
  expect(r.result.answer).toBe('hi')
})

test('fail-open: prepare failure (log write) → original effort, markers stripped', async ($, on) => {
  const seen: Effort[] = []
  bottoms(on, { text: ['⟦phase:plan⟧\nhi'], tools: [] }, seen)
  failWrite(on, 'log')
  const r = await step($, 0, 'high')
  expect(seen).toEqual(['high'])
  expect(textOf(r.chunks)).toBe('hi')
  expect(r.result.answer).toBe('hi')
})

test('fail-open: commit failure (threads write) → result is returned, markers stripped', async ($, on) => {
  const seen: Effort[] = []
  bottoms(on, { text: ['⟦phase:plan⟧\nhi'], tools: READ }, seen)
  failWrite(on, 'threads')
  const r = await step($, 0, 'high')
  expect(seen).toEqual(['xhigh'])
  expect(textOf(r.chunks)).toBe('hi')
  expect(r.result.answer).toBe('hi')
  expect(r.result.toolUses).toEqual(READ)
})

test('subagent floor: baseline high, agent with max → max, floor agent:max', async ($, on) => {
  const seen: Effort[] = []
  bottoms(on, { text: [], tools: READ }, seen)
  const box = captureLog(on)
  await step($, 0, 'high')
  await step($, 0, 'max', 'a1')
  expect(seen).toEqual(['xhigh', 'max'])
  expect(box.log.at(-1)?.thread).toBe('a1')
  expect(box.log.at(-1)?.floor).toBe('agent:max')
})

test('a main-thread step without effort clears the status', async ($, on) => {
  const statuses: (string | undefined)[] = []
  bottoms(on, { text: ['x'], tools: [] }, [], statuses)
  await step($, 0, 'high')
  await step($, 1, undefined)
  expect(statuses).toEqual(['⚙ xhigh · plan (rule:first-step)', undefined])
})

test('a subagent step without effort leaves the status alone', async ($, on) => {
  const statuses: (string | undefined)[] = []
  bottoms(on, { text: ['x'], tools: [] }, [], statuses)
  await step($, 0, undefined, 'a1')
  expect(statuses).toEqual([])
})

test('thread state: command only for Bash, truncated to 200 characters', async ($, on) => {
  const long = 'npm test ' + 'x'.repeat(300)
  const tools: TurnStepToolUse[] = [
    { name: 'Bash', input: { command: long } },
    { name: 'Task', input: { command: 'not a shell command' } },
  ]
  bottoms(on, { text: [], tools }, [])
  const box = captureLog(on)
  await step($, 0, 'high')
  expect(box.threads.main?.steps.at(-1)?.tools).toEqual([{ name: 'Bash', command: long.slice(0, 200) }, { name: 'Task' }])
})

test('a marker in a thinking chunk is not shown', async ($, on) => {
  const seen: Effort[] = []
  mock.clock(on, { now: 1000 })
  on('ui.status', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('turn.step', async function* (_$, e) {
    seen.push(e.effort as Effort)
    yield { kind: 'thinking', index: 0, text: '⟦phase:pl' }
    yield { kind: 'thinking', index: 0, text: 'an⟧\npondering' }
    yield { kind: 'text', index: 1, text: 'ok' }
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  const box = captureLog(on)
  const r = await step($, 0, 'high')
  expect(r.chunks.map(c => (c.kind === 'thinking' || c.kind === 'text' ? `${c.kind}:${c.text}` : c.kind))).toEqual(['thinking:pondering', 'text:ok'])
  // The phase from thinking is ignored: there was no marker in the text.
  expect(box.threads.main?.marker).toBeUndefined()
})

test('filterChunks: thinking is held separately and flushed before text', async () => {
  async function* src(): AsyncGenerator<TurnStepChunk> {
    yield { kind: 'thinking', index: 0, text: 'a⟦ph' }
    yield { kind: 'text', index: 1, text: '⟦phase:verify⟧b' }
  }
  const filter = createMarkerFilter()
  const out: TurnStepChunk[] = []
  for await (const c of filterChunks(src(), filter, createMarkerFilter())) out.push(c)
  expect(out.map(c => (c.kind === 'thinking' || c.kind === 'text' ? `${c.kind}:${c.index}:${c.text}` : c.kind))).toEqual(['thinking:0:a', 'thinking:0:⟦ph', 'text:1:b'])
  expect(filter.phase).toBe('verify')
})
