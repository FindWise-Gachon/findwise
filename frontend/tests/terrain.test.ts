import test from 'node:test'
import assert from 'node:assert/strict'
import { readTerrain } from '../src/map/terrain.ts'

const feature = { type: 'Feature', properties: { id: 'road', status: 'allowed' },
  geometry: { type: 'LineString', coordinates: [[-119.59, 37.745], [-119.58, 37.745]] } }
test('unclassified imports stay unknown and duplicate IDs fail', () => {
  const parse = (features: unknown[]) => readTerrain({ type: 'FeatureCollection', features })
  assert.equal(parse([feature])[0].properties.status, 'allowed')
  assert.equal(parse([{ ...feature, properties: { status: 'toString' } }])[0].properties.status, 'unknown')
  assert.throws(() => parse([feature, feature]))
  assert.throws(() => parse([{ ...feature, geometry: { type: 'Polygon', coordinates: [] } }]))
  assert.throws(() => parse([{ ...feature, geometry: { type: 'LineString', coordinates: [[999, 0], [0, 0]] } }]))
})

test('multipolygon preserves separate exteriors and island holes', () => {
  const outer = [[0,0],[4,0],[4,4],[0,4],[0,0]]
  const hole = [[1,1],[2,1],[2,2],[1,2],[1,1]]
  const geometry = { type: 'MultiPolygon', coordinates: [[outer, hole]] }
  const parsed = readTerrain({ type: 'FeatureCollection', features: [{ ...feature, geometry }] })
  assert.deepEqual(parsed[0].geometry, geometry)
  assert.throws(() => readTerrain({ type: 'FeatureCollection', features: [{ ...feature, geometry: { type: 'MultiPolygon', coordinates: [[]] } }] }))
})
