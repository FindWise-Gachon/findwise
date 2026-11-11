import { toProjected, type GridSpec } from './grid.ts'
import type { BlockedRecord, SearchedRecord, SearchRecord } from './searchRecord.ts'

export const reviewWindowMinutes = 60
const windowMs = reviewWindowMinutes * 60_000

export type ReportOverlap = {
  searched: SearchedRecord
  blocked: BlockedRecord
  gapMinutes: number
}

export function findReportOverlaps(grid: GridSpec, records: readonly SearchRecord[]): ReportOverlap[] {
  if (!records.some(record => record.kind === 'searched') || !records.some(record => record.kind === 'blocked')) return []
  const entries = records.map(record => ({
    record, at: Date.parse(record.searchedAtUtc), point: toProjected(grid, record.point),
  })).sort((a, b) => a.at - b.at)
  const pairs: ReportOverlap[] = []
  for (let later = entries.length - 1; later >= 0; later--) {
    const a = entries[later]
    for (let earlier = later - 1; earlier >= 0; earlier--) {
      const b = entries[earlier]
      const delta = a.at - b.at
      if (delta > windowMs) break
      if (a.record.caseKey !== b.record.caseKey || a.record.kind === b.record.kind) continue
      if (Math.hypot(a.point[0] - b.point[0], a.point[1] - b.point[1]) >= a.record.radius + b.record.radius) continue
      if (a.record.kind === 'searched' && b.record.kind === 'blocked') {
        pairs.push({ searched: a.record, blocked: b.record, gapMinutes: delta / 60_000 })
      } else if (a.record.kind === 'blocked' && b.record.kind === 'searched') {
        pairs.push({ searched: b.record, blocked: a.record, gapMinutes: delta / 60_000 })
      }
    }
  }
  return pairs
}
