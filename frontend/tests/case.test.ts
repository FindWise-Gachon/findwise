import test from 'node:test'
import assert from 'node:assert/strict'
import { parseLastSeenTime, readyCase, readCase, validLocation } from '../src/map/case.ts'
import { searchCaseKey } from '../src/map/searchRecord.ts'
import type { GpsAdoption } from '../src/map/gps.ts'
import { toLngLat, type GridSpec } from '../src/map/grid.ts'

const grid: GridSpec = { id: 'g', crs: 'EPSG:32611', projection: '+proj=utm +zone=11 +datum=WGS84 +units=m +no_defs',
  origin: [500000, 100], cellSizeM: 10, rows: 4, columns: 4 }
const point = toLngLat(grid, [500015, 85])

test('analysis requires both an in-grid LKP and a valid last-seen time', () => {
  assert.ok(validLocation(grid, point))
  assert.ok(readyCase({ start: point, lastSeenUtc: '2026-11-05T00:00:00.000Z' }, grid))
  assert.equal(readyCase({ start: point, lastSeenUtc: '' }, grid), false)
  assert.equal(readyCase({ start: null, lastSeenUtc: '2026-11-05T00:00:00.000Z' }, grid), false)
  assert.equal(validLocation(grid, [NaN, 0]), false)
  assert.equal(validLocation(grid, [190, 0]), false)
  assert.deepEqual(readCase({ start: point, lastSeenUtc: 'invalid' }, grid), { start: null, lastSeenUtc: '' })
})

test('accepts typed and pasted dates and 24-hour times in the device timezone', () => {
  const expected = new Date(2026, 10, 9, 14, 30).toISOString()
  assert.equal(parseLastSeenTime('20261109', '1430'), expected)
  assert.equal(parseLastSeenTime('2026-11-09', '14:30'), expected)
  assert.equal(parseLastSeenTime('2026-11-09', '930'), new Date(2026, 10, 9, 9, 30).toISOString())
  assert.equal(parseLastSeenTime('2024-02-29', '00:00'), new Date(2024, 1, 29, 0, 0).toISOString())
})

test('rejects incomplete input, calendar rollovers and out-of-range times', () => {
  assert.equal(parseLastSeenTime('2026-02-29', '14:30'), null)
  assert.equal(parseLastSeenTime('2026-11-09', '2400'), null)
  assert.equal(parseLastSeenTime('2026-11-09', '14:60'), null)
  assert.equal(parseLastSeenTime('202611', '14:30'), null)
  assert.equal(parseLastSeenTime('2026-11-09', '14'), null)
  assert.equal(parseLastSeenTime('', ''), null)
})

test('keeps the original case key and audit after adopting a GPS signal', () => {
  const initial = { start: point, lastSeenUtc: '2026-11-05T00:00:00.000Z' }
  const updatedPoint = toLngLat(grid, [500025, 75])
  const adoption: GpsAdoption = {
    markerId: 'gps', previous: { point, atUtc: initial.lastSeenUtc }, point: updatedPoint,
    atUtc: '2026-11-05T00:10:00.000Z', adoptedAtUtc: '2026-11-05T00:30:00.000Z',
    source: '현장 단말', accuracyM: null,
    review: { status: 'approved', reviewer: '검토자', reason: '기기 식별 확인', atUtc: '2026-11-05T00:20:00.000Z' },
  }
  const adopted = readCase({ start: updatedPoint, lastSeenUtc: adoption.atUtc, gpsAdoptions: [adoption] }, grid)
  assert.deepEqual(adopted.gpsAdoptions, [adoption])
  assert.equal(searchCaseKey(grid.id, adopted), searchCaseKey(grid.id, initial))
  const first = { ...adopted, gpsAdoptions: [{ ...adoption, previous: null }] }
  assert.equal(searchCaseKey(grid.id, first), searchCaseKey(grid.id, { start: updatedPoint, lastSeenUtc: adoption.atUtc }))
})
