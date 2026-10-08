// Потоковий фільтр маркера фази ⟦phase:…⟧: вирізає маркери з тексту,
// що стрімиться шматками, і запам'ятовує останню валідну фазу.

export type Phase = 'gather' | 'plan' | 'implement' | 'verify'

export type MarkerFilter = {
  push(text: string): string
  flush(): string
  readonly phase: Phase | undefined
}

const MARKER_SRC = '⟦phase:([^⟧\\n]{0,24})⟧[ \\t]*\\n?'
const PREFIX = '⟦phase:'
const HOLD_LIMIT = 32

function isPhase(v: string): v is Phase {
  return v === 'gather' || v === 'plan' || v === 'implement' || v === 'verify'
}

// Вирізає всі повні маркери; onPhase викликається для кожного валідного по черзі.
// endsAtTail — чи останній маркер закінчився в самому кінці тексту без переносу
// (тоді перенос може прийти наступним шматком).
// Прохід повторюється, доки текст змінюється: вирізання одного маркера може
// склеїти уламки навколо нього в новий маркер. Фази пишуться в порядку проходів.
function cut(text: string, onPhase?: (p: Phase) => void): { text: string; endsAtTail: boolean } {
  let endsAtTail = false
  let cur = text
  for (;;) {
    const src = cur
    const out = src.replace(new RegExp(MARKER_SRC, 'g'), (m: string, value: string, offset: number) => {
      if (onPhase && isPhase(value)) onPhase(value)
      endsAtTail = offset + m.length === src.length && !m.endsWith('\n')
      return ''
    })
    if (out === src) break
    cur = out
  }
  return { text: cur, endsAtTail }
}

// Скільки символів з кінця треба утримати як можливий початок маркера.
function holdLength(text: string): number {
  const i = text.lastIndexOf('⟦')
  if (i < 0) return 0
  const tail = text.slice(i)
  if (tail.length >= HOLD_LIMIT) return 0
  if (tail.includes('⟧')) return 0
  if (PREFIX.startsWith(tail)) return tail.length
  // Перенос рядка всередині значення робить маркер неможливим.
  if (tail.startsWith(PREFIX) && !tail.includes('\n')) return tail.length
  return 0
}

export function createMarkerFilter(): MarkerFilter {
  let buffer = ''
  let phase: Phase | undefined
  // Маркер закінчився в кінці попереднього шматка: зняти провідні [ \t]*\n? наступного.
  let pending = false
  return {
    push(text: string): string {
      if (pending && text !== '') {
        text = text.replace(/^[ \t]*\n?/, '')
        pending = false
      }
      const res = cut(buffer + text, (p) => { phase = p })
      if (res.endsAtTail) pending = true
      const cleaned = res.text
      const hold = holdLength(cleaned)
      buffer = cleaned.slice(cleaned.length - hold)
      return cleaned.slice(0, cleaned.length - hold)
    },
    flush(): string {
      const out = buffer
      buffer = ''
      pending = false
      return out
    },
    get phase() {
      return phase
    },
  }
}

export function stripMarkers(text: string): string {
  return cut(text).text
}
