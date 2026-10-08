// З'єднання мода з рушієм: керування effort кожного кроку моделі за фазою роботи.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, TurnStepInput, TurnStepResult, TurnStepChunk } from 'claude-code'
import type { AutoeffortThread, AutoeffortLogEntry } from '../types/index'
import { createMarkerFilter, stripMarkers } from '../src/marker'
import type { MarkerFilter, Phase as MarkerPhase } from '../src/marker'
import { decide, formatStatus } from '../src/decide'
import type { Decision } from '../src/decide'
import { loadConfig } from '../src/config'
import type { Config } from '../src/config'
import { EMPTY_HISTORY, isPhase, recordStep, startTurn } from '../src/classify'
import type { History, Phase, ToolUse } from '../src/classify'
import { isLevel } from '../src/levels'
import type { AnyLevel } from '../src/levels'

export const MARKER_PROMPT =
  'Effort control: begin every response, before any tool call, with exactly one marker naming what you will do in the NEXT step, after these tool results: ⟦phase:gather⟧ (reading/searching for context), ⟦phase:plan⟧ (analysing, deciding, designing), ⟦phase:implement⟧ (writing or editing), ⟦phase:verify⟧ (running/reading tests, lint, build, reviewing). The marker is stripped before anyone sees it; do not mention it.'

const LOG_LIMIT = 500

const threadsAtom = atom({ plugin: 'autoeffort', key: 'threads' } as const, {})
const logAtom = atom({ plugin: 'autoeffort', key: 'log' } as const, [])
const baselineAtom = atom({ plugin: 'autoeffort', key: 'baseline' } as const, null)
const skillAtom = atom({ plugin: 'autoeffort', key: 'skill' } as const, null)
const ENABLED_REF = { plugin: 'autoeffort', key: 'enabled' } as const

type Thread = History & { marker?: Phase }
type Prep = { key: string; thread: Thread; decision: Decision }
type Dollar = EngineInterface

// Стан — JSON без `undefined`: відсутні поля опускаються.
function toState(h: History, marker: Phase | undefined): AutoeffortThread {
  const out: AutoeffortThread = {
    steps: h.steps.map(s => ({ tools: s.tools.map(t => (t.command === undefined ? { name: t.name } : { name: t.name, command: t.command })) })),
    readStreak: h.readStreak,
    editedThisTurn: h.editedThisTurn,
  }
  if (h.lastPhase !== undefined) out.lastPhase = h.lastPhase
  if (marker !== undefined) out.marker = marker
  return out
}

async function prepare($: Dollar, e: TurnStepInput, config: Config): Promise<Prep> {
  const key = e.agentId ?? 'main'
  const threads = await read($, threadsAtom)
  let t: Thread = threads[key] ?? { ...EMPTY_HISTORY }
  // Новий хід: маркер останньої відповіді попереднього ходу не діє (крок 0 — правило first-step).
  if (e.index === 0) t = { ...startTurn(t), marker: undefined }
  const incoming: AnyLevel | undefined = typeof e.effort === 'string' && isLevel(e.effort) ? e.effort : undefined
  const skill = await read($, skillAtom)
  if (key === 'main' && skill === null && incoming !== undefined) await update($, baselineAtom, () => incoming)
  const baseline = await read($, baselineAtom)
  let floorLevel: AnyLevel | undefined
  let floorLabel: string | undefined
  if (incoming !== undefined && baseline !== null && incoming !== baseline && (key !== 'main' || skill !== null)) {
    floorLevel = incoming
    floorLabel = skill !== null ? `skill:${skill}` : 'agent'
  }
  const decision = decide({ history: t, stepIndex: e.index, marker: t.marker, floorLevel, floorLabel }, config)
  if (key === 'main') $.ui.status(formatStatus(decision))
  const entry: AutoeffortLogEntry = {
    at: await $.clock.now(), thread: key, step: e.index, incoming: String(e.effort),
    level: decision.level, phase: decision.phase, source: decision.source,
  }
  if (decision.floor !== undefined) entry.floor = decision.floor
  await update($, logAtom, log => [...log, entry].slice(-LOG_LIMIT))
  return { key, thread: t, decision }
}

async function commit($: Dollar, prep: Prep, phase: MarkerPhase | undefined, result: TurnStepResult): Promise<void> {
  const tools: ToolUse[] = result.toolUses.map(u => {
    const cmd = (u.input as { command?: unknown } | null | undefined)?.command
    return typeof cmd === 'string' ? { name: u.name, command: cmd } : { name: u.name }
  })
  const next = recordStep(prep.thread, tools, { resetStreak: prep.decision.source === 'rule:read-streak' })
  // Маркер цього кроку керує наступним кроком треду; відсутній — скидає.
  const state = toState({ ...next, lastPhase: prep.decision.phase }, isPhase(phase) ? phase : undefined)
  await update($, threadsAtom, threads => ({ ...threads, [prep.key]: state }))
}

// Fail-open: помилка в логіці мода лише логується, `next` викликається рівно раз.
async function safely($: Dollar, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (err) {
    $.ui.log(`autoeffort: ${String(err)}`)
  }
}

// Вирізає маркери з потоку чанків. Утримане скидається перед tool/thinking/input/stop,
// перед текстом іншого блоку і в кінці; engine-чанки проходять, не перериваючи утримання.
export async function* filterChunks(source: AsyncIterable<TurnStepChunk>, filter: MarkerFilter): AsyncGenerator<TurnStepChunk, void> {
  let lastIndex = 0
  const flush = function* (): Generator<TurnStepChunk> {
    const held = filter.flush()
    if (held) yield { kind: 'text', index: lastIndex, text: held }
  }
  for await (const c of source) {
    if (c.kind === 'engine') {
      yield c
      continue
    }
    if (c.kind === 'text') {
      if (c.index !== lastIndex) yield* flush()
      lastIndex = c.index
      const t = filter.push(c.text)
      if (t) yield { ...c, text: t }
      continue
    }
    yield* flush()
    yield c
  }
  yield* flush()
}

export const register: Register = (on, options) => {
  const config = loadConfig(options)
  const enabledAtom = atom(ENABLED_REF, config.enabled)

  on('session.start', async ($, e, next) => {
    await safely($, async () => {
      if ((await read($, ENABLED_REF)) === undefined) await update($, enabledAtom, () => config.enabled)
    })
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    let enabled = false
    await safely($, async () => { enabled = await read($, enabledAtom) })
    const r = await next(e)
    if (!enabled) return r
    return { sections: [...r.sections, { id: 'autoeffort:phase-marker', text: MARKER_PROMPT, scope: 'session' as const }] }
  })

  on('skill.prompt', async ($, e, next) => {
    await safely($, async () => { await update($, skillAtom, () => e.skill) })
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const agentId = e.agentId
    await safely($, async () => {
      if (agentId === undefined) await update($, skillAtom, () => null)
      else await update($, threadsAtom, threads => {
        // Хід субагента скінчився — його тред більше не потрібен.
        const rest = { ...threads }
        delete rest[agentId]
        return rest
      })
    })
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (!(await read($, enabledAtom))) return yield* next(e)
    // Без effort (або при помилці) запит іде незмінним, але маркери все одно вирізаються:
    // секцію промпту додано, тож модель їх пише.
    let prep: Prep | undefined
    if (e.effort !== undefined) {
      try {
        prep = await prepare($, e, config)
      } catch (err) {
        $.ui.log(`autoeffort: ${String(err)}`)
      }
    }
    const stream = next(prep ? { ...e, effort: prep.decision.level } : e)
    const filter = createMarkerFilter()
    yield* filterChunks(stream, filter)
    const result = await stream.result
    if (prep) {
      try {
        await commit($, prep, filter.phase, result)
      } catch (err) {
        $.ui.log(`autoeffort: ${String(err)}`)
      }
    }
    return { ...result, answer: stripMarkers(result.answer) }
  })
}
