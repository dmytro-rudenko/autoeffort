import { test, expect } from 'claude-code/testing'
import { loadConfig, DEFAULTS, DEFAULT_VERIFY_PATTERN } from '../src/config'

test('empty options → DEFAULTS', () => {
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
test('invalid level → default', () => {
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

const VERIFY_SRC = '(^|[\\s;&|(])((npm|pnpm|yarn|bun)\\s+(run\\s+)?(test|lint|build|typecheck|check)(?![\\w-])|npx\\s+(jest|vitest|eslint|tsc)\\b|(jest|vitest|pytest|eslint|tsc|mypy|ruff)(\\s|$)|cargo\\s+(check|test|clippy)\\b|go\\s+(test|vet)\\b|make\\s+(test|check|lint)\\b)'

test('default verifyPattern is a narrow pattern of verification commands', () => {
  expect(DEFAULT_VERIFY_PATTERN).toBe(VERIFY_SRC)
  expect(DEFAULTS.verifyPattern.source).toBe(VERIFY_SRC)
})

test('default verifyPattern: verification commands match', () => {
  for (const cmd of ['npm test', 'pnpm run build', 'npx vitest run', 'pytest -q', 'cd app && cargo test', 'tsc -p .', 'go test ./...', 'yarn lint', 'make check', '(tsc --noEmit)'])
    expect([cmd, DEFAULTS.verifyPattern.test(cmd)]).toEqual([cmd, true])
})

test('default verifyPattern: other commands do not match', () => {
  for (const cmd of ['git commit -m "add tests"', 'cat test.txt', 'ls tests', 'npm run build-docs', 'npm install', 'echo build', 'mkdir lint', 'npm run testing'])
    expect([cmd, DEFAULTS.verifyPattern.test(cmd)]).toEqual([cmd, false])
})
