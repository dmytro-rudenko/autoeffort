import { test, expect } from 'claude-code/testing'
import { createMarkerFilter, stripMarkers } from '../src/marker'

test('маркер на початку вирізається разом з переносом', () => {
  const f = createMarkerFilter()
  expect(f.push('⟦phase:plan⟧\nДалі читаю')).toBe('Далі читаю')
  expect(f.phase).toBe('plan')
})

test('маркер, розірваний на 3 шматки', () => {
  const f = createMarkerFilter()
  const out = f.push('Ок ⟦pha') + f.push('se:impl') + f.push('ement⟧ go') + f.flush()
  expect(out).toBe('Ок go')
  expect(f.phase).toBe('implement')
})

test('невалідний маркер вирізається, phase не змінюється', () => {
  const f = createMarkerFilter()
  expect(f.push('⟦phase:bogus⟧x')).toBe('x')
  expect(f.phase).toBe(undefined)
})

test('текст без маркера проходить без змін', () => {
  const f = createMarkerFilter()
  expect(f.push('звичайний текст')).toBe('звичайний текст')
  expect(f.push('a ⟦b⟧ c')).toBe('a ⟦b⟧ c')
  expect(f.push('хвіст ⟦b')).toBe('хвіст ⟦b')
  expect(f.flush()).toBe('')
})

test('незавершений префікс утримується до flush', () => {
  const f = createMarkerFilter()
  expect(f.push('кінець ⟦ph')).toBe('кінець ')
  expect(f.flush()).toBe('⟦ph')
  expect(f.flush()).toBe('')
})

test('два маркери — виграє другий', () => {
  const f = createMarkerFilter()
  expect(f.push('⟦phase:gather⟧\nа ⟦phase:verify⟧ б')).toBe('а б')
  expect(f.phase).toBe('verify')
})

test('перенос після маркера приходить наступним шматком', () => {
  const f = createMarkerFilter()
  expect(f.push('⟦phase:plan⟧')).toBe('')
  expect(f.push('\nтекст')).toBe('текст')
  expect(f.phase).toBe('plan')
})

test('маркер у кінці шматка, далі текст без переносу', () => {
  const f = createMarkerFilter()
  expect(f.push('⟦phase:plan⟧')).toBe('')
  expect(f.push('текст')).toBe('текст')
  expect(f.push('\nдалі')).toBe('\nдалі')
})

test('маркер, складений з уламків після вирізання, теж вирізається', () => {
  const f = createMarkerFilter()
  expect(f.push('⟦pha⟦phase:plan⟧se:verify⟧')).toBe('')
  expect(f.phase).toBe('verify')
  expect(stripMarkers('⟦pha⟦phase:plan⟧se:verify⟧')).toBe('')
})

test('stripMarkers прибирає маркер', () => {
  expect(stripMarkers('⟦phase:verify⟧\nok')).toBe('ok')
})
