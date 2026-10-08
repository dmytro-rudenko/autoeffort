// Combines the phase (marker or rules), the configured level and the skill/agent floor.
import { applyFloor, maxLevel, rank } from './levels'
import type { AnyLevel, Level } from './levels'
import { classify, isPhase } from './classify'
import type { History, Phase } from './classify'
import type { Config } from './config'

export type Decision = { level: Level; phase: Phase; source: string; floor?: string }
export type DecideInput = {
  history: History
  stepIndex: number
  marker?: Phase // from the previous step of this thread
  floorLevel?: AnyLevel // skill/agent floor, if any
  floorLabel?: string // 'skill:<name>' | 'agent'
}

export function decide(input: DecideInput, config: Config): Decision {
  let phase: Phase
  let source: string
  if (isPhase(input.marker)) {
    phase = input.marker
    source = 'marker'
  } else {
    const r = classify(input.history, {
      stepIndex: input.stepIndex,
      readStreak: config.readStreak,
      verifyPattern: config.verifyPattern,
    })
    phase = r.phase
    source = 'rule:' + r.rule
  }
  const base = config.levels[phase]
  const fl = input.floorLevel
  if (fl !== undefined && rank(fl) > rank(base)) {
    return {
      level: maxLevel(base, fl),
      phase,
      source,
      floor: `${input.floorLabel ?? 'floor'}:${applyFloor(fl)}`,
    }
  }
  return { level: applyFloor(base), phase, source }
}

// Status line: `⚙ high · gather (rule:read) ↑skill`.
export function formatStatus(d: Decision): string {
  return `⚙ ${d.level} · ${d.phase} (${d.source})` + (d.floor ? ` ↑${d.floor.split(':')[0]}` : '')
}
