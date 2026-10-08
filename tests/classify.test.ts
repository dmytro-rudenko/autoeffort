import { test, expect } from 'claude-code/testing'
import { classify, recordStep, startTurn, isPhase, PHASES, EMPTY_HISTORY } from '../src/classify'
import type { History, ToolUse } from '../src/classify'
import { DEFAULTS } from '../src/config'

const verifyPattern = DEFAULTS.verifyPattern
const ctx = (stepIndex: number, readStreak = 3) => ({ stepIndex, readStreak, verifyPattern })
const hist = (tools: ToolUse[], over: Partial<History> = {}): History => ({ ...EMPTY_HISTORY, steps: [{ tools }], ...over })

test('PHASES and isPhase', () => {
  expect(PHASES).toEqual(['gather', 'plan', 'implement', 'verify'])
  expect(isPhase('verify')).toBe(true)
  expect(isPhase('low')).toBe(false)
  expect(isPhase(1)).toBe(false)
})

test('1: stepIndex 0 → plan/first-step even after Edit', () => {
  expect(classify(hist([{ name: 'Edit' }]), ctx(0))).toEqual({ phase: 'plan', rule: 'first-step' })
})

test('3: Bash npm test after an edit → verify', () => {
  const h = hist([{ name: 'Bash', command: 'npm test' }], { editedThisTurn: true })
  expect(classify(h, ctx(1))).toEqual({ phase: 'verify', rule: 'verify-command' })
})

test('3: Bash npm test without editedThisTurn → carry', () => {
  const h = hist([{ name: 'Bash', command: 'npm test' }], { lastPhase: 'gather' })
  expect(classify(h, ctx(1))).toEqual({ phase: 'gather', rule: 'carry' })
})

test('4: Edit → implement', () => {
  expect(classify(hist([{ name: 'Edit' }]), ctx(1))).toEqual({ phase: 'implement', rule: 'edit' })
})

test('3 before 4: Edit + Bash vitest with editedThisTurn → verify', () => {
  const h = hist([{ name: 'Edit' }, { name: 'Bash', command: 'npx vitest run' }], { editedThisTurn: true })
  expect(classify(h, ctx(1))).toEqual({ phase: 'verify', rule: 'verify-command' })
})

test('5: Read at readStreak 3 (threshold 3) → plan/read-streak', () => {
  expect(classify(hist([{ name: 'Read' }], { readStreak: 3 }), ctx(1, 3))).toEqual({ phase: 'plan', rule: 'read-streak' })
})

test('6: Read at readStreak 1 → gather/read', () => {
  expect(classify(hist([{ name: 'Read' }, { name: 'Grep' }], { readStreak: 1 }), ctx(1, 3))).toEqual({ phase: 'gather', rule: 'read' })
})

test('7: Read + Bash ls → carry with lastPhase implement', () => {
  const h = hist([{ name: 'Read' }, { name: 'Bash', command: 'ls' }], { lastPhase: 'implement' })
  expect(classify(h, ctx(1))).toEqual({ phase: 'implement', rule: 'carry' })
})

test('7: empty history at step 2 → plan/carry', () => {
  expect(classify(EMPTY_HISTORY, ctx(2))).toEqual({ phase: 'plan', rule: 'carry' })
})

test('recordStep: streak grows on a read, resets on a mixed step', () => {
  let h = recordStep(EMPTY_HISTORY, [{ name: 'Read' }], { resetStreak: false })
  h = recordStep(h, [{ name: 'Grep' }, { name: 'Glob' }], { resetStreak: false })
  expect(h.readStreak).toBe(2)
  expect(h.editedThisTurn).toBe(false)
  h = recordStep(h, [{ name: 'Read' }, { name: 'Bash', command: 'ls' }], { resetStreak: false })
  expect(h.readStreak).toBe(0)
  h = recordStep(h, [], { resetStreak: false })
  expect(h.readStreak).toBe(0)
})

test('recordStep: resetStreak zeroes it before counting', () => {
  const h = recordStep({ ...EMPTY_HISTORY, readStreak: 5 }, [{ name: 'Read' }], { resetStreak: true })
  expect(h.readStreak).toBe(1)
})

test('recordStep: editedThisTurn and trimming steps to 10', () => {
  let h = recordStep(EMPTY_HISTORY, [{ name: 'Write' }], { resetStreak: false })
  expect(h.editedThisTurn).toBe(true)
  h = recordStep(h, [{ name: 'Read' }], { resetStreak: false })
  expect(h.editedThisTurn).toBe(true)
  for (let i = 0; i < 12; i++) h = recordStep(h, [{ name: 'Bash', command: `echo ${i}` }], { resetStreak: false })
  expect(h.steps.length).toBe(10)
  expect(h.steps.at(-1)?.tools[0]?.command).toBe('echo 11')
  expect(EMPTY_HISTORY.steps.length).toBe(0)
})

test('startTurn resets editedThisTurn and readStreak, steps stay', () => {
  const h = startTurn({ steps: [{ tools: [{ name: 'Edit' }] }], readStreak: 4, editedThisTurn: true, lastPhase: 'implement' })
  expect(h.editedThisTurn).toBe(false)
  expect(h.readStreak).toBe(0)
  expect(h.steps.length).toBe(1)
  expect(h.lastPhase).toBe('implement')
})
