import { projectedToCell, toProjected, type GridSpec } from './grid.ts'
export type CaseInput = { start: [number, number] | null; lastSeenUtc: string }

export function validLocation(grid: GridSpec, start: [number, number]): boolean {
  return start.length === 2 && start.every(Number.isFinite) &&
    Math.abs(start[0]) <= 180 && Math.abs(start[1]) <= 90 &&
    projectedToCell(grid, ...toProjected(grid, start)) !== null
}
export function readyCase(value: CaseInput, grid: GridSpec): boolean {
  return value.start !== null && validLocation(grid, value.start) &&
    value.lastSeenUtc !== '' && Number.isFinite(Date.parse(value.lastSeenUtc))
}
export function readCase(value: unknown, grid: GridSpec): CaseInput {
  const empty = { start: null, lastSeenUtc: '' }
  if (!value || typeof value !== 'object') return empty
  const data = value as CaseInput
  if (data.start !== null && (!Array.isArray(data.start) || !validLocation(grid, data.start))) return empty
  if (typeof data.lastSeenUtc !== 'string' || (data.lastSeenUtc !== '' && !Number.isFinite(Date.parse(data.lastSeenUtc)))) return empty
  return { start: data.start, lastSeenUtc: data.lastSeenUtc }
}
export function localDateTime(utc: string): string {
  if (!utc) return ''
  const date = new Date(utc)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 19)
}
