// Effort levels the mod works with; `low` is always raised to `medium` (the floor).
export type Level = 'medium' | 'high' | 'xhigh' | 'max'
export type AnyLevel = 'low' | Level
export const LEVELS: readonly Level[] = ['medium', 'high', 'xhigh', 'max']
const RANK: Record<AnyLevel, number> = { low: 0, medium: 1, high: 2, xhigh: 3, max: 4 }
export const isLevel = (x: unknown): x is AnyLevel => typeof x === 'string' && Object.hasOwn(RANK, x)
export const rank = (l: AnyLevel): number => RANK[l]
export const applyFloor = (l: AnyLevel): Level => (l === 'low' ? 'medium' : l)
export const maxLevel = (a: AnyLevel, b: AnyLevel): Level => applyFloor(RANK[a] >= RANK[b] ? a : b)
