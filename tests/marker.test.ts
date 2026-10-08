import { test, expect } from 'claude-code/testing'
import { createMarkerFilter, stripMarkers } from '../src/marker'

test('a leading marker is stripped together with its newline', () => {
  const f = createMarkerFilter()
  expect(f.push('⟦phase:plan⟧\nReading on')).toBe('Reading on')
  expect(f.phase).toBe('plan')
})

test('a marker split across 3 chunks', () => {
  const f = createMarkerFilter()
  const out = f.push('Ok ⟦pha') + f.push('se:impl') + f.push('ement⟧ go') + f.flush()
  expect(out).toBe('Ok go')
  expect(f.phase).toBe('implement')
})

test('an invalid marker is stripped, phase does not change', () => {
  const f = createMarkerFilter()
  expect(f.push('⟦phase:bogus⟧x')).toBe('x')
  expect(f.phase).toBe(undefined)
})

test('text without a marker passes through unchanged', () => {
  const f = createMarkerFilter()
  expect(f.push('plain text')).toBe('plain text')
  expect(f.push('a ⟦b⟧ c')).toBe('a ⟦b⟧ c')
  expect(f.push('tail ⟦b')).toBe('tail ⟦b')
  expect(f.flush()).toBe('')
})

test('an incomplete prefix is held back until flush', () => {
  const f = createMarkerFilter()
  expect(f.push('end ⟦ph')).toBe('end ')
  expect(f.flush()).toBe('⟦ph')
  expect(f.flush()).toBe('')
})

test('two markers: the second wins', () => {
  const f = createMarkerFilter()
  expect(f.push('⟦phase:gather⟧\na ⟦phase:verify⟧ b')).toBe('a b')
  expect(f.phase).toBe('verify')
})

test('the newline after a marker arrives in the next chunk', () => {
  const f = createMarkerFilter()
  expect(f.push('⟦phase:plan⟧')).toBe('')
  expect(f.push('\ntext')).toBe('text')
  expect(f.phase).toBe('plan')
})

test('a marker at the end of a chunk, then text without a newline', () => {
  const f = createMarkerFilter()
  expect(f.push('⟦phase:plan⟧')).toBe('')
  expect(f.push('text')).toBe('text')
  expect(f.push('\nmore')).toBe('\nmore')
})

test('a marker assembled from fragments after stripping is stripped too', () => {
  const f = createMarkerFilter()
  expect(f.push('⟦pha⟦phase:plan⟧se:verify⟧')).toBe('')
  expect(f.phase).toBe('verify')
  expect(stripMarkers('⟦pha⟦phase:plan⟧se:verify⟧')).toBe('')
})

test('stripMarkers removes a marker', () => {
  expect(stripMarkers('⟦phase:verify⟧\nok')).toBe('ok')
})
