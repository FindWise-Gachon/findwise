import { validLocation, type CaseInput } from './case.ts'
import type { GridSpec } from './grid.ts'
import type { Timeline } from './timeline.ts'
import { isUtc } from './gps.ts'

export const reportRadii = [50, 100, 200, 300] as const
export type ReportRadius = typeof reportRadii[number]
export type ReportFields = { rawText: string; searchedAt: string; reviewer: string; reason: string }
export const emptyReportFields: ReportFields = { rawText: '', searchedAt: '', reviewer: '', reason: '' }

export type ReportKind = 'searched' | 'blocked'
export const reportLabels = { searched: '수색 완료', blocked: '진입 불가' } as const

type ApprovedReport = {
  version: 1
  id: string
  caseKey: string
  duplicateKey: string
  rawText: string
  searchedAtUtc: string
  approvedAtUtc: string
  reviewer: string
  reason: string
  point: [number, number]
  radius: ReportRadius
  sourceMarkerId?: string
}
export type SearchedRecord = ApprovedReport & {
  kind: 'searched'
  runKey: string
  stepSeconds: number
  sequence: number
  changed: boolean
  cells: Timeline['frames'][number]['cells']
}

export type BlockedRecord = ApprovedReport & { kind: 'blocked' }
export type SearchRecord = SearchedRecord | BlockedRecord
export type NewSearchRecord = Omit<SearchedRecord, 'sequence'> | BlockedRecord

export function searchCaseKey(gridId: string, input: CaseInput) {
  if (!input.start || !Number.isFinite(Date.parse(input.lastSeenUtc))) return ''
  const first = input.gpsAdoptions?.[0]
  const original = first?.previous ?? first
  return JSON.stringify([gridId, original?.point ?? input.start, original?.atUtc ?? new Date(input.lastSeenUtc).toISOString()])
}

export function reportDuplicateKey(searchedAtUtc: string, rawText: string) {
  return JSON.stringify([searchedAtUtc, rawText.normalize('NFC').trim().replace(/\s+/g, ' ')])
}

export function readReportFields(fields: ReportFields) {
  const searchedAt = new Date(fields.searchedAt)
  if (!fields.rawText.trim() || fields.rawText.length > 4000 || !fields.reviewer.trim() || fields.reviewer.length > 80 ||
      !fields.reason.trim() || fields.reason.length > 1000 || !Number.isFinite(searchedAt.getTime()) || searchedAt.getTime() > Date.now()) return null
  return { rawText: fields.rawText, searchedAtUtc: searchedAt.toISOString(), reviewer: fields.reviewer.trim(), reason: fields.reason.trim() }
}

export async function searchRunKey(gridId: string, timeline: Timeline) {
  const { abmPreview, frames, label, lastSeenMs, start, terrainRevision } = timeline
  const source = JSON.stringify([gridId, label, start, lastSeenMs, terrainRevision ?? null,
    abmPreview?.samples, abmPreview?.seed, abmPreview?.accessMode, abmPreview?.demVersion, abmPreview?.slopeLimit, frames])
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export function reportCells(value: unknown, count: number): SearchedRecord['cells'] | null {
  if (!Array.isArray(value) || !value.length || value.length > 512) return null
  let total = 0
  const indices = new Set<number>()
  for (const cell of value) {
    if (!Array.isArray(cell) || cell.length !== 2 || !Number.isSafeInteger(cell[0]) ||
        cell[0] < 0 || cell[0] >= count || indices.has(cell[0]) || !Number.isFinite(cell[1]) || cell[1] <= 0 || cell[1] > 1) return null
    indices.add(cell[0]); total += cell[1]
  }
  return Math.abs(total - 1) <= 1e-8 ? value : null
}

export function readSearchRecords(value: unknown[], grid: GridSpec, caseKey: string): SearchRecord[] {
  return value.map(item => {
    const record = item as SearchRecord
    if (!record || record.version !== 1 || record.caseKey !== caseKey || typeof record.id !== 'string' ||
        typeof record.rawText !== 'string' || !record.rawText.trim() || record.rawText.length > 4000 ||
        typeof record.reviewer !== 'string' || !record.reviewer.trim() || record.reviewer.length > 80 ||
        typeof record.reason !== 'string' || !record.reason.trim() || record.reason.length > 1000 ||
        (record.sourceMarkerId !== undefined && (typeof record.sourceMarkerId !== 'string' || !record.sourceMarkerId)) ||
        !isUtc(record.searchedAtUtc) || !isUtc(record.approvedAtUtc) || record.searchedAtUtc > record.approvedAtUtc ||
        record.duplicateKey !== reportDuplicateKey(record.searchedAtUtc, record.rawText) ||
        !Array.isArray(record.point) || !validLocation(grid, record.point) || !reportRadii.includes(record.radius)) {
      throw new Error('저장된 현장 보고의 형식을 확인할 수 없습니다.')
    }
    if (record.kind === 'blocked') return record
    // Previously stored approvals did not have a kind field.
    if ((record.kind !== undefined && record.kind !== 'searched') || !/^[a-f0-9]{64}$/.test(record.runKey) ||
        !Number.isSafeInteger(record.stepSeconds) || record.stepSeconds < 0 ||
        !Number.isSafeInteger(record.sequence) || record.sequence < 1 ||
        typeof record.changed !== 'boolean' || !reportCells(record.cells, grid.rows * grid.columns)) {
      throw new Error('저장된 수색 기록의 형식을 확인할 수 없습니다.')
    }
    return { ...record, kind: 'searched' as const }
  }).sort((a, b) => b.approvedAtUtc.localeCompare(a.approvedAtUtc) || b.id.localeCompare(a.id))
}

export function latestSearchRecord(records: readonly SearchRecord[], runKey: string, elapsed: number) {
  return records.reduce<SearchedRecord | undefined>((latest, record) =>
    record.kind === 'searched' && record.runKey === runKey && record.stepSeconds === elapsed &&
      (!latest || latest.sequence < record.sequence) ? record : latest, undefined)
}
