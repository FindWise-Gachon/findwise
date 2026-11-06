import test from 'node:test'
import assert from 'node:assert/strict'
import { readyCase, readCase, validLocation } from '../src/map/case.ts'
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
