import assert from 'node:assert/strict'
import test from 'node:test'
import { toLngLat, type GridSpec } from '../src/map/grid.ts'
import { findReportOverlaps } from '../src/map/reportOverlap.ts'
import { latestSearchRecord, readSearchRecords, reportDuplicateKey, type BlockedRecord, type SearchedRecord } from '../src/map/searchRecord.ts'

const grid: GridSpec = {
  id: 'reports', crs: 'EPSG:32611', projection: '+proj=utm +zone=11 +datum=WGS84 +units=m +no_defs',
  origin: [500000, 4100600], cellSizeM: 6, rows: 100, columns: 100,
}
const base = {
  version: 1 as const, caseKey: 'case', reviewer: '검토자', reason: '현장 확인', radius: 50 as const,
  point: toLngLat(grid, [500100, 4100300]), approvedAtUtc: '2026-10-02T00:00:00.000Z',
}
const searchedAtUtc = '2026-10-01T10:00:00.000Z'
const blockedAtUtc = '2026-10-01T11:00:00.000Z'
const searched: SearchedRecord = {
  ...base, id: 'search', kind: 'searched', rawText: '수색 완료', searchedAtUtc, runKey: 'a'.repeat(64),
  duplicateKey: reportDuplicateKey(searchedAtUtc, '수색 완료'), sequence: 1, stepSeconds: 1800, changed: true, cells: [[0, 1]],
}
const blocked: BlockedRecord = {
  ...base, id: 'block', kind: 'blocked', rawText: '낙석으로 진입 불가', searchedAtUtc: blockedAtUtc,
  duplicateKey: reportDuplicateKey(blockedAtUtc, '낙석으로 진입 불가'), point: toLngLat(grid, [500170, 4100300]),
}

test('pairs only overlapping records of different types in the same case and review window', () => {
  const outside = { ...blocked, id: 'outside', point: toLngLat(grid, [500201, 4100300]) }
  const older = { ...blocked, id: 'later', searchedAtUtc: '2026-10-01T11:00:01.000Z' }
  assert.deepEqual(findReportOverlaps(grid, [outside, older, searched, blocked, { ...blocked, caseKey: 'other' }]), [
    { searched, blocked, gapMinutes: 60 },
  ])
})

test('keeps existing approvals readable and keeps map-only reports out of probability replay', () => {
  const stored = readSearchRecords([{ ...searched, kind: undefined }, blocked], grid, base.caseKey)
  assert.deepEqual(stored.find(record => record.id === 'search'), searched)
  assert.equal(stored.find(record => record.id === 'block')?.kind, 'blocked')
  assert.deepEqual(latestSearchRecord(stored, searched.runKey, searched.stepSeconds), searched)
  assert.throws(() => readSearchRecords([{ ...searched, kind: 'other' }], grid, base.caseKey))
})
