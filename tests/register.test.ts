import { test, expect, mock } from 'claude-code/testing'
import type { On, TurnStepToolUse, TurnStepChunk } from 'claude-code'
import type { AutoeffortLogEntry, AutoeffortThread } from '../types/index'
import type { Engine } from 'claude-code/testing'
import { MARKER_PROMPT, filterChunks } from '../hooks/register'
import { createMarkerFilter } from '../src/marker'

type Script = { text: string[]; tools: TurnStepToolUse[] }
type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | undefined

const COMPOSE = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: [], tools: [], outputStyle: null, traits: [] }

// Кіт не дає тесту читати $.state, тож останній записаний лог ловимо на state.set.
function captureLog(on: On) {
  const box: { log: AutoeffortLogEntry[]; threads: Record<string, AutoeffortThread> } = { log: [], threads: {} }
  on('state.set', (_$, e, next) => {
    if (e.plugin === 'autoeffort' && e.key === 'log') box.log = e.value as AutoeffortLogEntry[]
    if (e.plugin === 'autoeffort' && e.key === 'threads') box.threads = e.value as Record<string, AutoeffortThread>
    return next(e)
  })
  return box
}

// Дно для подій, у які заходять хуки мода: модель, статус, лог, годинник.
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
  // Читаємо вручну: результат потоку — значення `done`-кроку генератора.
  for (;;) {
    const r = await s.next()
    if (r.done) return { chunks, result: r.value }
    chunks.push(r.value)
  }
}

const textOf = (chunks: TurnStepChunk[]) => chunks.map(c => (c.kind === 'text' ? c.text : '')).join('')
const READ: TurnStepToolUse[] = [{ name: 'Read', input: {} }]

test('крок 0 → xhigh; маркер вирізано; крок 1 → medium за маркером implement', async ($, on) => {
  const script: Script = { text: ['⟦phase:impl', 'ement⟧', '\nпишу'], tools: [] }
  const seen: Effort[] = []
  bottoms(on, script, seen)
  const r0 = await step($, 0, 'high')
  expect(seen[0]).toBe('xhigh')
  expect(textOf(r0.chunks)).toBe('пишу')
  expect(r0.result.answer).toBe('пишу')
  script.text = ['ok']
  await step($, 1, 'high')
  expect(seen[1]).toBe('medium')
})

test('без маркерів: Read → medium, три Read поспіль → xhigh (read-streak)', async ($, on) => {
  const script: Script = { text: ['x'], tools: READ }
  const seen: Effort[] = []
  bottoms(on, script, seen)
  await step($, 0, 'high')
  await step($, 1, 'high')
  await step($, 2, 'high')
  await step($, 3, 'high')
  expect(seen).toEqual(['xhigh', 'medium', 'medium', 'xhigh'])
})

test('Edit, далі Bash npm test → наступний крок xhigh (verify)', async ($, on) => {
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

test('вхідний low на кроці gather → medium', async ($, on) => {
  const script: Script = { text: [], tools: READ }
  const seen: Effort[] = []
  bottoms(on, script, seen)
  await step($, 0, 'low')
  await step($, 1, 'low')
  expect(seen[1]).toBe('medium')
})

test('скіл review з межею max при baseline high → max, floor у лозі', async ($, on) => {
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

test('субагент має окремий стан треду', async ($, on) => {
  const script: Script = { text: ['⟦phase:implement⟧ пишу'], tools: [] }
  const seen: Effort[] = []
  bottoms(on, script, seen)
  await step($, 0, 'high')
  script.text = ['ok']
  await step($, 0, 'high', 'a1')
  await step($, 1, 'high', 'a1')
  await step($, 1, 'high')
  expect(seen).toEqual(['xhigh', 'xhigh', 'xhigh', 'medium'])
})

test('effort відсутній → e без змін', async ($, on) => {
  const seen: Effort[] = []
  bottoms(on, { text: ['⟦phase:plan⟧hi'], tools: [] }, seen)
  const r = await step($, 0, undefined)
  expect(seen).toEqual([undefined])
  expect(textOf(r.chunks)).toBe('hi')
  expect(r.result.answer).toBe('hi')
})

test('turn.complete основного треду знімає межу скіла', async ($, on) => {
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

test('вимкнено', { options: { enabled: false } }, async ($, on) => {
  const seen: Effort[] = []
  bottoms(on, { text: ['x'], tools: [] }, seen)
  await step($, 0, 'high')
  expect(seen).toEqual(['high'])
  const r = await $.prompt.compose(COMPOSE)
  expect(r.sections.some(s => s.id === 'autoeffort:phase-marker')).toBe(false)
})

test('prompt.compose додає секцію маркера', async ($, on) => {
  bottoms(on, { text: [], tools: [] }, [])
  const r = await $.prompt.compose(COMPOSE)
  expect(r.sections).toEqual([{ id: 'autoeffort:phase-marker', text: MARKER_PROMPT, scope: 'session' }])
})

test('маркер останньої відповіді ходу не переходить у наступний хід', async ($, on) => {
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

// Кіт не дає тестовому дну вигадати engine-чанк (ref має прийти від рушія),
// тож цикл фільтрації перевіряється напряму через експортований filterChunks.
test('engine-чанк посеред маркера не скидає утримання', async () => {
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

test('flush перед tool-чанком і перед текстом іншого блоку', async () => {
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

test('статус лише для основного треду', async ($, on) => {
  const statuses: (string | undefined)[] = []
  bottoms(on, { text: ['x'], tools: [] }, [], statuses)
  const box = captureLog(on)
  await step($, 0, 'high', 'a1')
  expect(statuses).toEqual([])
  expect(box.log.at(-1)?.thread).toBe('a1')
  await step($, 0, 'high')
  expect(statuses).toEqual(['⚙ xhigh · plan (rule:first-step)'])
})

test('turn.complete субагента видаляє його тред', async ($, on) => {
  bottoms(on, { text: ['x'], tools: [] }, [])
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  const box = captureLog(on)
  await step($, 0, 'high', 'a1')
  expect(Object.keys(box.threads)).toEqual(['a1'])
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer', agentId: 'a1' })
  expect(Object.keys(box.threads)).toEqual([])
})

// Тестовий хук state.set, що відмовляє в записі заданого ключа: імітує збій запису стану.
function failWrite(on: On, key: string) {
  on('state.set', (_$, e, next) => {
    if (e.plugin === 'autoeffort' && e.key === key) return { deny: `denied ${key}` }
    return next(e)
  })
}

test('fail-open: збій prepare (запис baseline) → вихідний effort, маркери вирізано', async ($, on) => {
  const seen: Effort[] = []
  bottoms(on, { text: ['⟦phase:plan⟧\nhi'], tools: [] }, seen)
  failWrite(on, 'baseline')
  const r = await step($, 0, 'high')
  expect(seen).toEqual(['high'])
  expect(textOf(r.chunks)).toBe('hi')
  expect(r.result.answer).toBe('hi')
})

test('fail-open: збій prepare (запис log) → вихідний effort, маркери вирізано', async ($, on) => {
  const seen: Effort[] = []
  bottoms(on, { text: ['⟦phase:plan⟧\nhi'], tools: [] }, seen)
  failWrite(on, 'log')
  const r = await step($, 0, 'high')
  expect(seen).toEqual(['high'])
  expect(textOf(r.chunks)).toBe('hi')
  expect(r.result.answer).toBe('hi')
})

test('fail-open: збій commit (запис threads) → результат повертається, маркери вирізано', async ($, on) => {
  const seen: Effort[] = []
  bottoms(on, { text: ['⟦phase:plan⟧\nhi'], tools: READ }, seen)
  failWrite(on, 'threads')
  const r = await step($, 0, 'high')
  expect(seen).toEqual(['xhigh'])
  expect(textOf(r.chunks)).toBe('hi')
  expect(r.result.answer).toBe('hi')
  expect(r.result.toolUses).toEqual(READ)
})

test('межа субагента: baseline high, агент з max → max, floor agent:max', async ($, on) => {
  const seen: Effort[] = []
  bottoms(on, { text: [], tools: READ }, seen)
  const box = captureLog(on)
  await step($, 0, 'high')
  await step($, 0, 'max', 'a1')
  expect(seen).toEqual(['xhigh', 'max'])
  expect(box.log.at(-1)?.thread).toBe('a1')
  expect(box.log.at(-1)?.floor).toBe('agent:max')
})

test('крок основного треду без effort очищає статус', async ($, on) => {
  const statuses: (string | undefined)[] = []
  bottoms(on, { text: ['x'], tools: [] }, [], statuses)
  await step($, 0, 'high')
  await step($, 1, undefined)
  expect(statuses).toEqual(['⚙ xhigh · plan (rule:first-step)', undefined])
})

test('крок субагента без effort статус не чіпає', async ($, on) => {
  const statuses: (string | undefined)[] = []
  bottoms(on, { text: ['x'], tools: [] }, [], statuses)
  await step($, 0, undefined, 'a1')
  expect(statuses).toEqual([])
})

test('стан треду: command лише для Bash, обрізаний до 200 символів', async ($, on) => {
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

test('маркер у thinking-чанку не показується', async ($, on) => {
  const seen: Effort[] = []
  mock.clock(on, { now: 1000 })
  on('ui.status', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('turn.step', async function* (_$, e) {
    seen.push(e.effort as Effort)
    yield { kind: 'thinking', index: 0, text: '⟦phase:pl' }
    yield { kind: 'thinking', index: 0, text: 'an⟧\nдумаю' }
    yield { kind: 'text', index: 1, text: 'ok' }
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  const box = captureLog(on)
  const r = await step($, 0, 'high')
  expect(r.chunks.map(c => (c.kind === 'thinking' || c.kind === 'text' ? `${c.kind}:${c.text}` : c.kind))).toEqual(['thinking:думаю', 'text:ok'])
  // Фаза з thinking ігнорується: маркера в тексті не було.
  expect(box.threads.main?.marker).toBeUndefined()
})

test('filterChunks: thinking утримується окремо і скидається перед текстом', async () => {
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
