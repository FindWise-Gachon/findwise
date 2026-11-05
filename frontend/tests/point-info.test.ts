import test from 'node:test'
import assert from 'node:assert/strict'
import { nearbyWays, elapsedSince } from '../src/map/pointDetails.ts'
import { toLngLat, type GridSpec } from '../src/map/grid.ts'
import type { TerrainFeature } from '../src/map/terrain.ts'

const grid: GridSpec = { id: 'g', crs: 'EPSG:32611', projection: '+proj=utm +zone=11 +datum=WGS84 +units=m +no_defs',
  origin: [500000, 1000], cellSizeM: 10, rows: 100, columns: 100 }
test('nearby access information measures the line segment rather than only its endpoints', () => {
  const feature: TerrainFeature = { type: 'Feature',
    geometry: { type: 'LineString', coordinates: [toLngLat(grid, [500000, 900]), toLngLat(grid, [500100, 900])] },
    properties: { id: 'trail', name: 'trail 123', kind: 'trail', status: 'unknown', source: 'test', reason: 'test' } }
  const result = nearbyWays([feature], grid, toLngLat(grid, [500050, 860]))
  assert.ok(Math.abs(result.nearby.trail!.distance - 40) < .001)
  assert.equal(result.nearby.trail!.name, '이름 없는 등산로')
  assert.equal(result.nearby.trail!.status, 'unknown')
  assert.equal(result.nearby.road, undefined)
  assert.equal(nearbyWays([feature], grid, toLngLat(grid, [502000, 860])).nearby.trail, undefined)
})
test('elapsed time distinguishes missing, future and day-long intervals', () => {
  const now = Date.parse('2026-11-05T12:00:00Z')
  assert.equal(elapsedSince('', now), '시각 미입력')
  assert.equal(elapsedSince('2026-11-06T12:00:00Z', now), '미래 시각 · 확인 필요')
  assert.equal(elapsedSince('2026-11-05T10:30:00Z', now), '1시간 30분')
  assert.equal(elapsedSince('2026-11-03T09:00:00Z', now), '2일 3시간')
})
