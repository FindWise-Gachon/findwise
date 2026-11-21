import assert from 'node:assert/strict'
import test from 'node:test'
import { appendMeasurePoint, formatMeasure, measureMeters, type MapPoint } from '../src/map/measure.ts'

test('sums each clicked segment and formats short and long distances', () => {
  assert.equal(measureMeters([[0, 0]]), 0)
  const length = measureMeters([[0, 0], [0, 0.001], [0.001, 0.001]])
  assert.ok(length > 222 && length < 223)
  assert.equal(formatMeasure(length), '222 m')
  assert.equal(formatMeasure(1234), '1.23 km')
})

test('skips duplicate points and keeps the line continuous across wrapped map copies', () => {
  const points: MapPoint[] = [[179.9, 0]]
  assert.equal(appendMeasurePoint(points, [179.9, 0]), points)
  const next = appendMeasurePoint(points, [-179.9, 0])
  assert.ok(Math.abs(next[1][0] - 180.1) < 1e-10)
  assert.ok(measureMeters(next) < 23_000)
  assert.equal(points.length, 1)
})
