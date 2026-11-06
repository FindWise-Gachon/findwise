import test from 'node:test'
import assert from 'node:assert/strict'
import { toLngLat, type GridSpec } from '../src/map/grid.ts'
import { demoTimeline, readTimeline } from '../src/map/timeline.ts'

const grid: GridSpec = {
  id: 'timeline', crs: 'EPSG:32611', projection: '+proj=utm +zone=11 +datum=WGS84 +units=m +no_defs',
  origin: [500000, 100], rows: 4, columns: 4, cellSizeM: 10,
}
const sample = {
  schema_version: 1, grid_id: grid.id, model_version: 'test',
  lkp: toLngLat(grid, [500015, 85]), last_seen_utc: '2026-01-01T00:00:00.000Z',
  frames: [{ elapsed_seconds: 3600, cells: [[0, .6]] }, { elapsed_seconds: 14400, cells: [[3, .2], [4, .3]] }],
}

test('preserves model timestamps and values with a common scale across all frames', () => {
  const timeline = readTimeline(sample, grid)
  assert.equal(timeline.maxMass, .6)
  assert.deepEqual(timeline.frames, sample.frames)
  assert.deepEqual(demoTimeline(grid).frames.map(frame => frame.elapsed_seconds), [3600, 7200, 14400])
})

test('rejects a different grid, ambiguous time and invalid snapshots', () => {
  for (const invalid of [
    { ...sample, grid_id: 'different' },
    { ...sample, last_seen_utc: '2026-01-01T00:00:00' },
    { ...sample, lkp: toLngLat(grid, [499900, 85]) },
    { ...sample, frames: [...sample.frames].reverse() },
    { ...sample, frames: [sample.frames[0], { elapsed_seconds: 7200, cells: [[16, .2]] }] },
    { ...sample, frames: [sample.frames[0], { elapsed_seconds: 7200, cells: [[1, .2], [1, .2]] }] },
    { ...sample, frames: [sample.frames[0], { elapsed_seconds: 7200, cells: [[1, .6], [2, .6]] }] },
  ]) assert.throws(() => readTimeline(invalid, grid))
})

test('model results retain terrain provenance while legacy results stay unverified', () => {
  assert.equal(readTimeline(sample, grid).terrainRevision, undefined)
  assert.equal(readTimeline({ ...sample, terrain_revision: 'r1' }, grid).terrainRevision, 'r1')
  const demo = demoTimeline(grid, sample.lkp, Date.parse(sample.last_seen_utc))
  assert.deepEqual(demo.start, sample.lkp)
  assert.equal(demo.lastSeenMs, Date.parse(sample.last_seen_utc))
  assert.equal(demo.synthetic, true)
  assert.throws(() => readTimeline({ ...sample, terrain_revision: '' }, grid))
})
