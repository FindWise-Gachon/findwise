import assert from 'node:assert/strict'
import test from 'node:test'
import { candidateArea, candidateExtent, candidateMass, candidateSize, orderCandidates } from '../src/map/candidateArea.ts'
import type { GridSpec } from '../src/map/grid.ts'

const grid: GridSpec = { id: 'test', crs: 'EPSG:32611', projection: 'test', origin: [100, 200], cellSizeM: 6, rows: 3, columns: 4 }
const a = { row: 2, column: 1, index: 9 }
const b = { row: 1, column: 2, index: 6 }
const area = candidateArea(1, a, b)

test('snaps reversed corners to the same footprint and includes both edge cells', () => {
  assert.deepEqual(candidateArea(1, b, a), area)
  assert.deepEqual(candidateExtent(grid, area), [106, 182, 118, 194])
  assert.equal(candidateSize(grid, area), 4 * 36)
  assert.equal(candidateSize(grid, candidateArea(2, a, a)), 36)
})

test('aggregates identical Ring and sparse ABM masses without counting cells outside the rectangle', () => {
  const palette = [0, .125, .25, .5]
  const indices = Uint8Array.of(0, 0, 0, 0, 0, 2, 1, 3, 0, 0, 1, 0)
  const cells = [[5, .25], [6, .125], [7, .5], [10, .125]] as const
  assert.equal(candidateMass(grid, area, { kind: 'palette', indices, palette }), .5)
  assert.equal(candidateMass(grid, area, { kind: 'sparse', cells }), .5)
  assert.equal(candidateMass(grid, candidateArea(2, a, a), { kind: 'sparse', cells }), 0)
})

test('sorts by exact model probability, area, or creation without treating missing mass as zero', () => {
  const candidates = [
    { id: 4, size: 36, mass: null }, { id: 3, size: 72, mass: .01231 },
    { id: 2, size: 72, mass: .01231 }, { id: 1, size: 108, mass: 0 },
    { id: 5, size: 108, mass: .01234 },
  ]
  const ids = (order: Parameters<typeof orderCandidates>[1]) => orderCandidates(candidates, order).map(area => area.id)
  assert.deepEqual(ids('mass'), [5, 2, 3, 1, 4])
  assert.deepEqual(ids('size'), [4, 2, 3, 1, 5])
  assert.deepEqual(ids('created'), [1, 2, 3, 4, 5])
  assert.deepEqual(candidates.map(area => area.id), [4, 3, 2, 1, 5])
})
