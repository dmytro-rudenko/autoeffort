import { test, expect } from 'claude-code/testing'
import { applyFloor, maxLevel, isLevel, rank } from '../src/levels'
test('low піднімається до medium', () => { expect(applyFloor('low')).toBe('medium') })
test('maxLevel бере вищий', () => {
  expect(maxLevel('medium', 'xhigh')).toBe('xhigh')
  expect(maxLevel('max', 'high')).toBe('max')
  expect(maxLevel('low', 'low')).toBe('medium')
})
test('isLevel', () => { expect(isLevel('xhigh')).toBe(true); expect(isLevel('auto')).toBe(false); expect(isLevel(3)).toBe(false); expect(isLevel('toString')).toBe(false); expect(isLevel('constructor')).toBe(false) })
test('rank', () => { expect(rank('low')).toBe(0); expect(rank('max')).toBe(4) })
