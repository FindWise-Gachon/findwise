import { projectedToCell, toProjected, type GridSpec } from './grid.ts'
import { isGpsAdoption, type GpsAdoption } from './gps.ts'
export type CaseInput = { start: [number, number] | null; lastSeenUtc: string; gpsAdoptions?: GpsAdoption[] }

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
  const gpsAdoptions = Array.isArray(data.gpsAdoptions)
    ? data.gpsAdoptions.filter(item => isGpsAdoption(item) && validLocation(grid, item.point) &&
      (!item.previous || validLocation(grid, item.previous.point)))
    : []
  return { start: data.start, lastSeenUtc: data.lastSeenUtc, ...(gpsAdoptions.length ? { gpsAdoptions } : {}) }
}
export function localDateTime(utc: string): string {
  if (!utc) return ''
  const date = new Date(utc)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 19)
}

export function parseLastSeenTime(dateInput: string, timeInput: string): string | null {
  const date = dateInput.trim()
  const time = timeInput.trim()
  if (!/^(?:\d{4}-\d{2}-\d{2}|\d{8})$/.test(date) || !/^(?:\d{1,2}:\d{2}|\d{3,4})$/.test(time)) return null

  const day = date.replaceAll('-', '')
  const clock = time.replace(':', '').padStart(4, '0')
  const local = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)}T${clock.slice(0, 2)}:${clock.slice(2)}:00`
  const parsed = new Date(local)
  if (!Number.isFinite(parsed.getTime())) return null
  const utc = parsed.toISOString()
  // Reject calendar rollovers and local times skipped by daylight saving changes.
  return localDateTime(utc) === local ? utc : null
}
