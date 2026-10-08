// Streaming filter for the phase marker ⟦phase:…⟧: strips markers from text
// that arrives in chunks and remembers the last valid phase.

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

// Strips every complete marker; onPhase is called for each valid one in order.
// endsAtTail: whether the last marker ended at the very end of the text without a newline
// (the newline may then arrive in the next chunk).
// The pass repeats while the text keeps changing: stripping one marker can join
// the fragments around it into a new marker. Phases are reported in pass order.
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

// How many trailing characters to hold back as a possible start of a marker.
function holdLength(text: string): number {
  const i = text.lastIndexOf('⟦')
  if (i < 0) return 0
  const tail = text.slice(i)
  if (tail.length >= HOLD_LIMIT) return 0
  if (tail.includes('⟧')) return 0
  if (PREFIX.startsWith(tail)) return tail.length
  // A newline inside the value makes a marker impossible.
  if (tail.startsWith(PREFIX) && !tail.includes('\n')) return tail.length
  return 0
}

export function createMarkerFilter(): MarkerFilter {
  let buffer = ''
  let phase: Phase | undefined
  // The marker ended at the end of the previous chunk: strip the leading [ \t]*\n? of the next one.
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
