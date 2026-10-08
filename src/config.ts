// Налаштування мода з `userConfig`: кожне поле перевіряється окремо, невалідне → типове значення.
import { type Level, isLevel, applyFloor } from './levels'

export type PhaseName = 'gather' | 'plan' | 'implement' | 'verify'
export type Config = { enabled: boolean; levels: Record<PhaseName, Level>; readStreak: number; verifyPattern: RegExp }

export const DEFAULT_VERIFY_PATTERN = '(^|[\\s;&|(])((npm|pnpm|yarn|bun)\\s+(run\\s+)?(test|lint|build|typecheck|check)(?![\\w-])|npx\\s+(jest|vitest|eslint|tsc)\\b|(jest|vitest|pytest|eslint|tsc|mypy|ruff)(\\s|$)|cargo\\s+(check|test|clippy)\\b|go\\s+(test|vet)\\b|make\\s+(test|check|lint)\\b)'

const DEFAULT_LEVELS: Readonly<Record<PhaseName, Level>> = { gather: 'medium', plan: 'xhigh', implement: 'medium', verify: 'xhigh' }
const PHASES: readonly PhaseName[] = ['gather', 'plan', 'implement', 'verify']

export const DEFAULTS: Config = {
  enabled: true,
  levels: { ...DEFAULT_LEVELS },
  readStreak: 3,
  verifyPattern: new RegExp(DEFAULT_VERIFY_PATTERN),
}

// Некоректний RegExp не має зламати мод — повертаємось до типового.
const compile = (src: unknown): RegExp => {
  if (typeof src === 'string') {
    try { return new RegExp(src) } catch { /* типовий нижче */ }
  }
  return new RegExp(DEFAULT_VERIFY_PATTERN)
}

export function loadConfig(options: Readonly<Record<string, unknown>>): Config {
  const levels = {} as Record<PhaseName, Level>
  for (const p of PHASES) {
    const v = options[p]
    // `low` проходить isLevel і піднімається підлогою до `medium`.
    levels[p] = isLevel(v) ? applyFloor(v) : DEFAULT_LEVELS[p]
  }
  const rs = options.readStreak
  return {
    enabled: typeof options.enabled === 'boolean' ? options.enabled : true,
    levels,
    readStreak: typeof rs === 'number' && Number.isInteger(rs) && rs >= 1 ? rs : 3,
    verifyPattern: compile(options.verifyPattern),
  }
}
