import { test, expect } from 'claude-code/testing'
import { loadConfig, DEFAULTS, DEFAULT_VERIFY_PATTERN } from '../src/config'

test('порожні options → DEFAULTS', () => {
  const c = loadConfig({})
  expect(c.enabled).toBe(true)
  expect(c.levels).toEqual({ gather: 'medium', plan: 'xhigh', implement: 'medium', verify: 'xhigh' })
  expect(c.levels).toEqual(DEFAULTS.levels)
  expect(c.readStreak).toBe(3)
  expect(c.verifyPattern.source).toBe(DEFAULT_VERIFY_PATTERN)
  expect(DEFAULTS.verifyPattern.source).toBe(DEFAULT_VERIFY_PATTERN)
})
test('plan: max', () => { expect(loadConfig({ plan: 'max' }).levels.plan).toBe('max') })
test('low → medium', () => { expect(loadConfig({ gather: 'low', verify: 'low' }).levels).toEqual({ gather: 'medium', plan: 'xhigh', implement: 'medium', verify: 'medium' }) })
test('невалідний рівень → типовий', () => {
  expect(loadConfig({ gather: 'turbo' }).levels.gather).toBe('medium')
  expect(loadConfig({ plan: 'toString' }).levels.plan).toBe('xhigh')
  expect(loadConfig({ verify: 4 }).levels.verify).toBe('xhigh')
})
test('readStreak', () => {
  expect(loadConfig({ readStreak: 0 }).readStreak).toBe(3)
  expect(loadConfig({ readStreak: 2.5 }).readStreak).toBe(3)
  expect(loadConfig({ readStreak: '5' }).readStreak).toBe(3)
  expect(loadConfig({ readStreak: 5 }).readStreak).toBe(5)
})
test('verifyPattern', () => {
  expect(loadConfig({ verifyPattern: '(' }).verifyPattern.source).toBe(DEFAULT_VERIFY_PATTERN)
  expect(loadConfig({ verifyPattern: 42 }).verifyPattern.source).toBe(DEFAULT_VERIFY_PATTERN)
  expect(loadConfig({ verifyPattern: 'make check' }).verifyPattern.test('make check')).toBe(true)
})
test('enabled', () => {
  expect(loadConfig({ enabled: false }).enabled).toBe(false)
  expect(loadConfig({ enabled: 'no' }).enabled).toBe(true)
})
