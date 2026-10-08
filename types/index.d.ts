// State contract of the autoeffort mod in $.state.
export type AutoeffortStep = { tools: { name: string; command?: string }[] }
export type AutoeffortThread = {
  steps: AutoeffortStep[]        // last ≤ 10 steps
  readStreak: number
  editedThisTurn: boolean
  lastPhase?: 'gather' | 'plan' | 'implement' | 'verify'
  marker?: 'gather' | 'plan' | 'implement' | 'verify'
}
export type AutoeffortLogEntry = {
  at: number; thread: string; step: number; incoming?: string
  level: string; phase: string; source: string; floor?: string
}
declare module 'claude-code' {
  interface PluginState {
    autoeffort: {
      threads: Record<string, AutoeffortThread>
      log: AutoeffortLogEntry[]
      enabled: boolean
      baseline: string | null
      skill: string | null
    }
  }
}
