import assert from 'node:assert/strict'
import test from 'node:test'
import { readRingResult } from '../src/map/ring.ts'
import { paintRingOverlay } from '../src/map/ringOverlay.ts'
import type { GridSpec } from '../src/map/grid.ts'

const grid: GridSpec = { id: 'sample', crs: 'EPSG:32611', projection: 'test', origin: [0, 0], cellSizeM: 6, rows: 2, columns: 2 }
const payload = {
  grid_id: grid.id, model_version: 'isrid-ring-v1', profile_label: '등산객 (온대, 산악)',
  in_grid_mass: 0.4, palette: [0, 0.25, 0.5], cell_indices: btoa(String.fromCharCode(2, 1, 0, 1)),
}

test('keeps Ring cells in row-major order and separates grid coverage from normalized mass', () => {
  const result = readRingResult(payload, grid)
  assert.deepEqual(Array.from(result.indices, index => result.palette[index]), [0.5, 0.25, 0, 0.25])
  assert.equal(result.inGridMass, 0.4)
  assert.equal(result.maxMass, 0.5)
})

test('rejects the wrong grid, truncated cells and invalid palette indices', () => {
  assert.throws(() => readRingResult({ ...payload, grid_id: 'other' }, grid))
  assert.throws(() => readRingResult({ ...payload, cell_indices: 'AA==' }, grid))
  assert.throws(() => readRingResult({ ...payload, palette: [0, 0.25] }, grid))
  assert.throws(() => readRingResult({ ...payload, palette: [0, 0.1, 0.5] }, grid))
})

test('softens a Ring color boundary without painting zero-mass cells', () => {
  const row = { ...grid, rows: 1, columns: 9, cellSizeM: 85 }
  const result = readRingResult({
    ...payload, palette: [0, 0.01, 0.24],
    cell_indices: btoa(String.fromCharCode(2, 2, 2, 2, 1, 1, 1, 1, 0)),
  }, row)
  const pixels = new Uint8ClampedArray(4 * row.columns)
  paintRingOverlay(result, row, pixels)
  const alpha = (index: number) => pixels[index * 4 + 3]
  assert.ok(alpha(2) > alpha(3) && alpha(3) > alpha(4) && alpha(4) > alpha(5))
  assert.ok(alpha(0) > 200 && alpha(6) < 20)
  assert.equal(alpha(8), 0)
  assert.deepEqual(result.palette, [0, 0.01, 0.24])
})
