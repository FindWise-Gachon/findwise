import assert from 'node:assert/strict'
import test from 'node:test'
import { rankByDistance } from '../src/map/distance.ts'
import { type GridSpec } from '../src/map/grid.ts'

const grid: GridSpec = {
  id: 'test', crs: 'EPSG:32611', projection: '+proj=utm +zone=11 +datum=WGS84 +units=m +no_defs',
  origin: [100, 200], rows: 2, columns: 3, cellSizeM: 10,
}

test('ranks cell centers by distance and breaks equal distances by row-major index', () => {
  const start: [number, number] = [110, 190]
  const expected = [0, 1, 3, 4, 2, 5]
  assert.deepEqual(Array.from(rankByDistance(grid, start)), expected)
  assert.deepEqual(Array.from(rankByDistance(grid, start)), expected)
})

test('uses the actual start coordinate within a cell and respects grid edges', () => {
  assert.deepEqual(Array.from(rankByDistance(grid, [119, 199])).slice(0, 3), [1, 2, 0])
  assert.equal(rankByDistance(grid, [100, 200])[0], 0)
  for (const start of [[130, 200], [100, 180], [NaN, 200]] as [number, number][]) {
    assert.throws(() => rankByDistance(grid, start), RangeError)
  }
})
