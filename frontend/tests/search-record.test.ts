import test from 'node:test'
import assert from 'node:assert/strict'
import { readReportFields, reportCells, reportDuplicateKey, searchCaseKey, searchRunKey } from '../src/map/searchRecord.ts'
import type { Timeline } from '../src/map/timeline.ts'

test('preserves original report text while detecting duplicate formatting in the same search time', () => {
  const rawText = ' 북쪽 갈림길\n수색 완료 '
  const fields = readReportFields({ rawText, searchedAt: '2026-10-01T10:00', reviewer: ' 검토자 ', reason: ' 보고 확인 ' })
  assert.ok(fields)
  assert.equal(fields.rawText, rawText)
  assert.equal(fields.reviewer, '검토자')
  assert.equal(reportDuplicateKey(fields.searchedAtUtc, rawText), reportDuplicateKey(fields.searchedAtUtc, '북쪽 갈림길 수색 완료'))
  assert.equal(readReportFields({ ...fields, searchedAt: '9999-01-01T00:00' }), null)
})

test('isolates records by case and only restores the identical simulation run', async () => {
  const start: [number, number] = [-119.59, 37.76]
  const input = { start, lastSeenUtc: '2026-10-01T10:00:00Z' }
  assert.equal(searchCaseKey('grid', input), searchCaseKey('grid', { ...input, lastSeenUtc: '2026-10-01T10:00:00.000Z' }))
  assert.notEqual(searchCaseKey('grid', input), searchCaseKey('other', input))
  const timeline: Timeline = { label: 'ABM', start, lastSeenMs: Date.parse(input.lastSeenUtc), synthetic: false, maxMass: 1,
    abmPreview: { samples: 512, seed: 2026 }, frames: [{ elapsed_seconds: 1800, cells: [[0, 1]] }] }
  const key = await searchRunKey('grid', timeline)
  assert.equal(key, await searchRunKey('grid', { ...timeline }))
  assert.notEqual(key, await searchRunKey('grid', { ...timeline, terrainRevision: 'changed' }))
  assert.notEqual(key, await searchRunKey('grid', { ...timeline, frames: [{ elapsed_seconds: 1800, cells: [[1, 1]] }] }))
})

test('rejects stored snapshots with duplicate or out-of-grid cells or incomplete mass', () => {
  assert.deepEqual(reportCells([[0, .4], [1, .6]], 2), [[0, .4], [1, .6]])
  assert.equal(reportCells([[0, .5], [0, .5]], 2), null)
  assert.equal(reportCells([[2, 1]], 2), null)
  assert.equal(reportCells([[0, .5]], 2), null)
})
