import test from 'node:test'
import assert from 'node:assert/strict'
import { readTerrainDocument, visibleTerrain, changeTerrain, undoTerrain, exportTerrain } from '../src/map/terrainDocument.ts'
import type { GridSpec } from '../src/map/grid.ts'

const grid: GridSpec = { id: 'g', crs: 'EPSG:32611', projection: '+proj=utm +zone=11 +datum=WGS84 +units=m +no_defs',
  origin: [500000, 100], cellSizeM: 10, rows: 4, columns: 4 }
const feature = { type: 'Feature', properties: { id: 'road', status: 'unknown', kind: 'road' },
  geometry: { type: 'LineString', coordinates: [[-117, 0], [-117, .001]] } }
const initial = () => readTerrainDocument({ type: 'FeatureCollection', features: [feature] }, grid)

test('applied changes, restore and undo survive JSON backup round-trip', () => {
  const base = initial()
  const changedFeature = { ...base.base[0], properties: { ...base.base[0].properties, status: 'blocked' as const, reason: '낙석' } }
  const changed = changeTerrain(base, { id: 'road', feature: changedFeature, reason: '낙석', at: new Date().toISOString() })
  assert.equal(visibleTerrain(changed)[0].properties.status, 'blocked')
  const restored = changeTerrain(changed, { id: 'road', feature: null, reason: '복원', at: new Date().toISOString() })
  assert.equal(visibleTerrain(restored)[0].properties.status, 'unknown')
  const undone = undoTerrain(restored)
  assert.notEqual(undone.revision, changed.revision)
  assert.equal(visibleTerrain(undone)[0].properties.status, 'blocked')
  const decoded = readTerrainDocument(JSON.parse(JSON.stringify(exportTerrain(undone))), grid)
  assert.deepEqual(decoded, undone)
  assert.equal(exportTerrain(restored).features.length, 1)
})

test('custom regions can be added and removed without changing the original dataset', () => {
  const base = initial()
  const custom = { ...base.base[0], properties: { ...base.base[0].properties, id: 'custom' } }
  const added = changeTerrain(base, { id: 'custom', feature: custom, reason: '사용자 지정', at: new Date().toISOString() })
  assert.equal(exportTerrain(added).base_feature_count, 1)
  assert.equal(exportTerrain(added).features.length, 2)
  const removed = changeTerrain(added, { id: 'custom', feature: null, reason: '복원', at: new Date().toISOString() })
  assert.equal(visibleTerrain(removed).length, 1)
  assert.equal(base.base.length, 1)
})

test('older saved editor packages migrate without losing applied edits', () => {
  const base = initial()
  const saved = { schema_version: 1, grid: base.grid, revision: 'legacy', type: 'FeatureCollection',
    base_feature_count: 1, features: [base.base[0], { ...base.base[0], properties: { ...base.base[0].properties, status: 'allowed' } }] }
  assert.equal(visibleTerrain(readTerrainDocument(saved, grid))[0].properties.status, 'allowed')
  const reordered = Object.fromEntries(Object.entries(saved.grid).reverse())
  assert.equal(visibleTerrain(readTerrainDocument({ ...saved, grid: reordered }, grid))[0].properties.status, 'allowed')
  assert.throws(() => readTerrainDocument({ ...saved, grid: { ...base.grid, columns: 99 } }, grid))
  assert.throws(() => readTerrainDocument({ ...base, changes: [{ id: 'different', feature: base.base[0], reason: 'x', at: new Date().toISOString() }] }, grid))
})
