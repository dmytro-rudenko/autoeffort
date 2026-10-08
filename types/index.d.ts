// Контракт стану мода autoeffort у $.state.
export type AutoeffortStep = { tools: { name: string; command?: string }[] }
export type AutoeffortThread = {
  steps: AutoeffortStep[]        // останні ≤ 10 кроків
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
