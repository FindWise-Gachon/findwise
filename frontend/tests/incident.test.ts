import assert from 'node:assert/strict'
import test from 'node:test'
import { incidentEvents, readIncidentMarker, type IncidentMarker } from '../src/map/incident.ts'
import { toLngLat, type GridSpec } from '../src/map/grid.ts'
import type { SearchedRecord } from '../src/map/searchRecord.ts'

const grid: GridSpec = {
  id: 'test', crs: 'EPSG:32611', projection: '+proj=utm +zone=11 +datum=WGS84 +units=m +no_defs',
  origin: [500000, 4100600], cellSizeM: 6, rows: 100, columns: 100,
}
const point = toLngLat(grid, [500100, 4100300])
const start = { start: point, lastSeenUtc: '2026-11-01T10:00:00.000Z' }
const search: IncidentMarker = { caseKey: 'case', id: 'search', kind: 'search', point, atUtc: '2026-11-01T11:00:00.000Z', completed: true, note: '갈림길 수색' }
const cctv: IncidentMarker = { ...search, id: 'cctv', kind: 'cctv', completed: false, atUtc: '2026-11-01T10:30:00.000Z' }
const record: SearchedRecord = {
  version: 1, id: 'approval', caseKey: 'case', duplicateKey: 'key', kind: 'searched', rawText: search.note, point, radius: 50,
  runKey: 'a'.repeat(64), stepSeconds: 3600, sequence: 1, changed: true, cells: [[0, 1]],
  searchedAtUtc: search.atUtc, approvedAtUtc: '2026-11-01T12:00:00.000Z', reviewer: '검토자', reason: '범위 확인', sourceMarkerId: search.id,
}

test('orders field events and approvals by time and avoids repeating the same linked observation', () => {
  const events = incidentEvents(start, [search, cctv], [record])
  assert.deepEqual(events.map(event => event.id), ['start', 'marker:cctv', 'marker:search', 'approval:approval'])
  assert.match(events[2].label, /^2 · 수색/)
  assert.deepEqual(incidentEvents(start, [search], [{ ...record, searchedAtUtc: cctv.atUtc }]).map(event => event.id),
    ['start', 'field:approval', 'marker:search', 'approval:approval'])
  assert.deepEqual(incidentEvents(start, [{ ...search, note: '메모 수정' }], [record]).map(event => event.id),
    ['start', 'marker:search', 'field:approval', 'approval:approval'])
  assert.deepEqual(incidentEvents(start, [], [record]).map(event => event.id), ['start', 'field:approval', 'approval:approval'])
})

test('rejects markers from another case, an invalid time, or a misplaced completion flag', () => {
  assert.equal(readIncidentMarker(search, 'case'), search)
  assert.throws(() => readIncidentMarker(search, 'other'))
  assert.throws(() => readIncidentMarker({ ...search, atUtc: '2026-11-01T11:00' }, 'case'))
  assert.throws(() => readIncidentMarker({ ...cctv, completed: true }, 'case'))
})

test('accepts observations outside the analysis grid and an empty note', () => {
  const marker: IncidentMarker = { ...search, point: [126.98, 37.66], note: '' }
  assert.equal(readIncidentMarker(marker, 'case'), marker)
  assert.throws(() => readIncidentMarker({ ...marker, point: [181, 37.66] }, 'case'))
})

test('includes GPS signals as independently recorded timeline events', () => {
  const gps: IncidentMarker = { ...cctv, kind: 'gps', note: '마지막 GPS 신호' }
  const [event] = incidentEvents({ start: null, lastSeenUtc: '' }, [readIncidentMarker(gps, 'case')], [])
  assert.equal(event.label, '1 · GPS 신호')
  assert.equal(event.note, gps.note)
})

test('reads GPS details, keeps unknown accuracy, and requires a source for a saved review', () => {
  const review = { status: 'approved' as const, reviewer: '검토자', reason: '기기 식별 확인', atUtc: cctv.atUtc }
  const marker: IncidentMarker = { ...cctv, kind: 'gps', gps: { source: '현장 단말', accuracyM: null, review } }
  assert.equal(readIncidentMarker(marker, 'case'), marker)
  assert.throws(() => readIncidentMarker({ ...marker, gps: { ...marker.gps, source: '' } }, 'case'))
  assert.throws(() => readIncidentMarker({ ...marker, gps: { ...marker.gps, accuracyM: -20 } }, 'case'))
})
