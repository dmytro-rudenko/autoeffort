import { test, expect } from 'claude-code/testing'
import { decide, formatStatus } from '../src/decide'
import { DEFAULTS, loadConfig } from '../src/config'
import { EMPTY_HISTORY } from '../src/classify'
import type { History } from '../src/classify'

const readHist: History = { ...EMPTY_HISTORY, steps: [{ tools: [{ name: 'Read' }] }], readStreak: 1 }

test('маркер має пріоритет над first-step', () => {
  const d = decide({ history: EMPTY_HISTORY, stepIndex: 0, marker: 'implement' }, DEFAULTS)
  expect(d).toEqual({ level: 'medium', phase: 'implement', source: 'marker' })
})

test('невалідний маркер ігнорується → правила', () => {
  const d = decide({ history: EMPTY_HISTORY, stepIndex: 0, marker: 'bogus' as any }, DEFAULTS)
  expect(d).toEqual({ level: 'xhigh', phase: 'plan', source: 'rule:first-step' })
})

test('межа дорівнює базі (xhigh при plan) → без floor', () => {
  const d = decide({ history: EMPTY_HISTORY, stepIndex: 0, floorLevel: 'xhigh', floorLabel: 'agent' }, DEFAULTS)
  expect(d).toEqual({ level: 'xhigh', phase: 'plan', source: 'rule:first-step' })
})

test('без маркера, крок 0 → xhigh/plan/rule:first-step', () => {
  const d = decide({ history: EMPTY_HISTORY, stepIndex: 0 }, DEFAULTS)
  expect(d).toEqual({ level: 'xhigh', phase: 'plan', source: 'rule:first-step' })
  expect(formatStatus(d)).toBe('⚙ xhigh · plan (rule:first-step)')
})

test('статус маркера без підлоги', () => {
  expect(formatStatus({ level: 'xhigh', phase: 'plan', source: 'marker' })).toBe('⚙ xhigh · plan (marker)')
})

test('Read-крок, межа high від skill:review → high з floor', () => {
  const d = decide({ history: readHist, stepIndex: 1, floorLevel: 'high', floorLabel: 'skill:review' }, DEFAULTS)
  expect(d.level).toBe('high')
  expect(d.phase).toBe('gather')
  expect(d.source).toBe('rule:read')
  expect(d.floor).toBe('skill:review:high')
  expect(formatStatus(d)).toBe('⚙ high · gather (rule:read) ↑skill')
})

test('межа без мітки → floor:<level>', () => {
  const d = decide({ history: readHist, stepIndex: 1, floorLevel: 'max' }, DEFAULTS)
  expect(d.level).toBe('max')
  expect(d.floor).toBe('floor:max')
  expect(formatStatus(d).endsWith(' ↑floor')).toBe(true)
})

test('межа medium при фазі plan → xhigh без floor', () => {
  const d = decide({ history: EMPTY_HISTORY, stepIndex: 0, floorLevel: 'medium', floorLabel: 'agent' }, DEFAULTS)
  expect(d).toEqual({ level: 'xhigh', phase: 'plan', source: 'rule:first-step' })
})

test('межа low не впливає, рівень ≥ medium', () => {
  const d = decide({ history: readHist, stepIndex: 1, floorLevel: 'low', floorLabel: 'agent' }, DEFAULTS)
  expect(d).toEqual({ level: 'medium', phase: 'gather', source: 'rule:read' })
})

test('levels.gather = max → Read-крок дає max', () => {
  const cfg = loadConfig({ gather: 'max' })
  expect(cfg.levels.gather).toBe('max')
  const d = decide({ history: readHist, stepIndex: 1 }, cfg)
  expect(d).toEqual({ level: 'max', phase: 'gather', source: 'rule:read' })
})
