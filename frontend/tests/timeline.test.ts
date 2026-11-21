import test from 'node:test'
import assert from 'node:assert/strict'
import { toLngLat, type GridSpec } from '../src/map/grid.ts'
import { abmFrameMetrics, abmTimelineBounds, demoTimeline, readTimeline } from '../src/map/timeline.ts'
import { paintTimelineFrame } from '../src/map/timelineOverlay.ts'

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

test('recognizes ABM preview metadata and requires complete snapshot mass', () => {
  const preview = { ...sample, result_kind: 'model', abm_preview: { samples: 512, seed: 2026 },
    frames: [{ elapsed_seconds: 1800, cells: [[1, 1]] }, { elapsed_seconds: 3600, cells: [[2, .5], [3, .5]] }] }
  assert.deepEqual(readTimeline(preview, grid).abmPreview, preview.abm_preview)
  assert.equal(readTimeline({ ...preview, abm_preview: { ...preview.abm_preview, can_depart: false } }, grid).abmPreview?.canDepart, false)
  assert.throws(() => readTimeline({ ...preview, abm_preview: { ...preview.abm_preview, can_depart: 'false' } }, grid))
  assert.throws(() => readTimeline({ ...preview, frames: sample.frames }, grid))
  assert.throws(() => readTimeline({ ...preview, terrain_revision: 'r1' }, grid))
  const route = { ...preview, terrain_revision: 'r1', abm_preview: { ...preview.abm_preview, behavior: 'rt' } }
  assert.equal(readTimeline(route, grid).abmPreview?.behavior, 'rt')
  assert.equal(readTimeline(route, grid).abmPreview?.accessMode, undefined)
  assert.throws(() => readTimeline({ ...route, terrain_revision: undefined }, grid))
})

test('summarizes displacement and detects an unchanged distribution regardless of cell order', () => {
  const timeline = readTimeline({
    ...sample, result_kind: 'model', abm_preview: { samples: 10, seed: 2026 },
    frames: [
      { elapsed_seconds: 1800, cells: [[5, 1]] },
      { elapsed_seconds: 3600, cells: [[5, .25], [7, .75]] },
      { elapsed_seconds: 5400, cells: [[7, .75], [5, .25]] },
      { elapsed_seconds: 7200, cells: [[5, .5], [7, .5]] },
    ],
  }, grid)
  assert.ok(abmFrameMetrics(grid, timeline, 0).meanDistanceM < 1e-6)
  const second = abmFrameMetrics(grid, timeline, 1)
  assert.ok(Math.abs(second.meanDistanceM - 15) < 1e-6)
  assert.equal(second.unchanged, false)
  assert.equal(abmFrameMetrics(grid, timeline, 2).unchanged, true)
  assert.equal(abmFrameMetrics(grid, timeline, 3).unchanged, false)
})

test('fits the last known point and occupied cells across all snapshots', () => {
  const timeline = readTimeline(sample, grid)
  const [[west, south], [east, north]] = abmTimelineBounds(grid, timeline)
  for (const [lng, lat] of [sample.lkp, toLngLat(grid, [500005, 85]), toLngLat(grid, [500035, 95])]) {
    assert.ok(lng > west && lng < east && lat > south && lat < north)
  }
})

test('fades ABM display pixels without changing occupied cells or their probabilities', () => {
  const timeline = readTimeline({
    ...sample, result_kind: 'model', abm_preview: { samples: 10, seed: 2026 },
    frames: [
      { elapsed_seconds: 1800, cells: [[0, 1]] },
      { elapsed_seconds: 3600, cells: [[1, 1]] },
    ],
  }, grid)
  const pixels = new Uint8ClampedArray(4 * grid.rows * grid.columns)
  paintTimelineFrame(grid, timeline, 0, timeline.maxMass, pixels)
  const alpha = (i: number) => pixels[i * 4 + 3]
  assert.ok(alpha(0) > alpha(1) && alpha(1) > alpha(2) && alpha(2) > 0)
  assert.equal(alpha(15), 0)
  assert.deepEqual(timeline.frames[0].cells, [[0, 1]])
})
