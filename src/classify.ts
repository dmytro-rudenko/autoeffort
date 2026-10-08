// Determines the work phase from the tools of the previous step.
export type Phase = 'gather' | 'plan' | 'implement' | 'verify'
export const PHASES: readonly Phase[] = ['gather', 'plan', 'implement', 'verify']
export const isPhase = (x: unknown): x is Phase => typeof x === 'string' && (PHASES as readonly string[]).includes(x)

export type ToolUse = { name: string; command?: string }
export type History = {
  steps: readonly { tools: readonly ToolUse[] }[]
  readStreak: number
  editedThisTurn: boolean
  lastPhase?: Phase
}
export const EMPTY_HISTORY: History = { steps: [], readStreak: 0, editedThisTurn: false }
export type ClassifyCtx = { stepIndex: number; readStreak: number; verifyPattern: RegExp }

const EDIT: readonly string[] = ['Edit', 'Write', 'NotebookEdit', 'MultiEdit']
const READ: readonly string[] = ['Read', 'Grep', 'Glob', 'LS', 'WebFetch', 'WebSearch']
const isEdit = (t: ToolUse) => EDIT.includes(t.name)
const isRead = (t: ToolUse) => READ.includes(t.name)

// Rules are applied in order; the first match wins.
export function classify(h: History, ctx: ClassifyCtx): { phase: Phase; rule: string } {
  if (ctx.stepIndex === 0) return { phase: 'plan', rule: 'first-step' }
  const last = h.steps.at(-1)?.tools ?? []
  if (last.length > 0) {
    // Verify before edit: after a verification run, the next step analyses its results.
    if (h.editedThisTurn && last.some(t => t.name === 'Bash' && typeof t.command === 'string' && ctx.verifyPattern.test(t.command)))
      return { phase: 'verify', rule: 'verify-command' }
    if (last.some(isEdit)) return { phase: 'implement', rule: 'edit' }
    if (last.every(isRead)) {
      if (h.readStreak >= ctx.readStreak) return { phase: 'plan', rule: 'read-streak' }
      return { phase: 'gather', rule: 'read' }
    }
  }
  return { phase: h.lastPhase ?? 'plan', rule: 'carry' }
}

export function recordStep(h: History, tools: readonly ToolUse[], opts: { resetStreak: boolean }): History {
  const base = opts.resetStreak ? 0 : h.readStreak
  return {
    ...h,
    steps: [...h.steps, { tools }].slice(-10),
    editedThisTurn: h.editedThisTurn || tools.some(isEdit),
    readStreak: tools.length > 0 && tools.every(isRead) ? base + 1 : 0,
  }
}

export function startTurn(h: History): History {
  return { ...h, editedThisTurn: false, readStreak: 0 }
}
