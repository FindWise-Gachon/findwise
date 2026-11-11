import assert from 'node:assert/strict'
import test from 'node:test'
import { compareAbmRuns } from '../src/map/compare.ts'
import type { Timeline } from '../src/map/timeline.ts'

const common = {
  label: 'ABM', start: [-119.59, 37.76] as [number, number], lastSeenMs: 1000,
  synthetic: false, abmPreview: { samples: 512, seed: 2026 },
}
const baseline: Timeline = {
  ...common, maxMass: .5,
  frames: [{ elapsed_seconds: 1800, cells: [[0, .5]] }, { elapsed_seconds: 3600, cells: [[1, .25]] }],
}
const current: Timeline = {
  ...common, maxMass: 1,
  frames: [{ elapsed_seconds: 3600, cells: [[3, .75]] }, { elapsed_seconds: 7200, cells: [[4, 1]] }],
}

test('pairs common elapsed times and shares the scale across both displayed runs', () => {
  assert.deepEqual(compareAbmRuns(baseline, current), {
    pairs: [{ elapsed: 3600, baselineStep: 1, currentStep: 0 }], maxMass: .75,
  })
})

test('refuses mismatched cases, sampling settings or runs without common frames', () => {
  assert.equal(typeof compareAbmRuns(baseline, { ...current, lastSeenMs: 2000 }), 'string')
  assert.equal(typeof compareAbmRuns(baseline, { ...current, start: [-119.60, 37.76] }), 'string')
  assert.equal(typeof compareAbmRuns(baseline, { ...current, abmPreview: { samples: 512, seed: 1 } }), 'string')
  assert.equal(typeof compareAbmRuns(baseline, { ...current, frames: current.frames.slice(1) }), 'string')
  assert.equal(typeof compareAbmRuns(baseline, { ...current, synthetic: true }), 'string')
})
