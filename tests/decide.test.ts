import { test, expect } from 'claude-code/testing'
import { decide, formatStatus } from '../src/decide'
import { DEFAULTS, loadConfig } from '../src/config'
import { EMPTY_HISTORY } from '../src/classify'
import type { History } from '../src/classify'

const readHist: History = { ...EMPTY_HISTORY, steps: [{ tools: [{ name: 'Read' }] }], readStreak: 1 }

test('marker takes priority over first-step', () => {
  const d = decide({ history: EMPTY_HISTORY, stepIndex: 0, marker: 'implement' }, DEFAULTS)
  expect(d).toEqual({ level: 'medium', phase: 'implement', source: 'marker' })
})

test('invalid marker is ignored → rules', () => {
  const d = decide({ history: EMPTY_HISTORY, stepIndex: 0, marker: 'bogus' as any }, DEFAULTS)
  expect(d).toEqual({ level: 'xhigh', phase: 'plan', source: 'rule:first-step' })
})

test('floor level equals the base (xhigh at plan) → no floor', () => {
  const d = decide({ history: EMPTY_HISTORY, stepIndex: 0, floorLevel: 'xhigh', floorLabel: 'agent' }, DEFAULTS)
  expect(d).toEqual({ level: 'xhigh', phase: 'plan', source: 'rule:first-step' })
})

test('no marker, step 0 → xhigh/plan/rule:first-step', () => {
  const d = decide({ history: EMPTY_HISTORY, stepIndex: 0 }, DEFAULTS)
  expect(d).toEqual({ level: 'xhigh', phase: 'plan', source: 'rule:first-step' })
  expect(formatStatus(d)).toBe('⚙ xhigh · plan (rule:first-step)')
})

test('marker status without a floor', () => {
  expect(formatStatus({ level: 'xhigh', phase: 'plan', source: 'marker' })).toBe('⚙ xhigh · plan (marker)')
})

test('Read step, floor level high from skill:review → high with floor', () => {
  const d = decide({ history: readHist, stepIndex: 1, floorLevel: 'high', floorLabel: 'skill:review' }, DEFAULTS)
  expect(d.level).toBe('high')
  expect(d.phase).toBe('gather')
  expect(d.source).toBe('rule:read')
  expect(d.floor).toBe('skill:review:high')
  expect(formatStatus(d)).toBe('⚙ high · gather (rule:read) ↑skill')
})

test('floor level without a label → floor:<level>', () => {
  const d = decide({ history: readHist, stepIndex: 1, floorLevel: 'max' }, DEFAULTS)
  expect(d.level).toBe('max')
  expect(d.floor).toBe('floor:max')
  expect(formatStatus(d).endsWith(' ↑floor')).toBe(true)
})

test('floor level medium at plan phase → xhigh without floor', () => {
  const d = decide({ history: EMPTY_HISTORY, stepIndex: 0, floorLevel: 'medium', floorLabel: 'agent' }, DEFAULTS)
  expect(d).toEqual({ level: 'xhigh', phase: 'plan', source: 'rule:first-step' })
})

test('floor level low has no effect, level ≥ medium', () => {
  const d = decide({ history: readHist, stepIndex: 1, floorLevel: 'low', floorLabel: 'agent' }, DEFAULTS)
  expect(d).toEqual({ level: 'medium', phase: 'gather', source: 'rule:read' })
})

test('levels.gather = max → a Read step yields max', () => {
  const cfg = loadConfig({ gather: 'max' })
  expect(cfg.levels.gather).toBe('max')
  const d = decide({ history: readHist, stepIndex: 1 }, cfg)
  expect(d).toEqual({ level: 'max', phase: 'gather', source: 'rule:read' })
})
