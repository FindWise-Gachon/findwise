import test from 'node:test'
import assert from 'node:assert/strict'
import { validateGrid, gridExtent, projectedToCell, cellCenter, toLngLat, toProjected, boundary, visibleGrid, gridManifest } from '../src/map/grid.ts'
const grid = validateGrid({ id: 'test', crs: 'EPSG:32611', projection: '+proj=utm +zone=11 +datum=WGS84 +units=m +no_defs', origin: [268800, 4183680], cellSizeM: 6, rows: 1000, columns: 1000 })
test('UTM central meridian has known false easting and zero northing', () => {
  const [e, n] = toProjected(grid, [-117, 0])
  assert.ok(Math.abs(e - 500000) < 1e-6); assert.ok(Math.abs(n) < 1e-6)
})
test('fixed area has one million 36 square metre cells', () => {
  const [w,s,e,n] = gridExtent(grid)
  assert.equal((e-w)*(n-s), 36_000_000)
  assert.equal(grid.rows*grid.columns, 1_000_000)
  assert.deepEqual(gridManifest(grid).geo_transform, [268800,6,0,4183680,0,-6])
  assert.equal(gridManifest(grid).probabilities, null)
})
test('north-west origin and row-major indexing; outer boundaries are not clamped', () => {
  const [w,s,e,n] = gridExtent(grid)
  assert.deepEqual(projectedToCell(grid,w,n), {row:0,column:0,index:0})
  assert.deepEqual(projectedToCell(grid,w+6,n-6), {row:1,column:1,index:1001})
  assert.equal(projectedToCell(grid,e,n),null); assert.equal(projectedToCell(grid,w,s),null)
  assert.equal(projectedToCell(grid,w-1,n),null); assert.equal(projectedToCell(grid,w,n+1),null)
  assert.equal(projectedToCell(grid,NaN,n),null)
  assert.deepEqual(projectedToCell(grid,e-.001,s+.001), {row:999,column:999,index:999999})
})
test('cell centers round-trip across geographic coordinates without changing indices', () => {
  for(const [row,column] of [[0,0],[999,999],[400,550],[800,3]]) {
    const xy = cellCenter(grid,row,column)
    const restored = toProjected(grid,toLngLat(grid,xy))
    assert.ok(Math.hypot(restored[0]-xy[0],restored[1]-xy[1]) < .001)
    assert.equal(projectedToCell(grid,...restored)?.index,row*grid.columns+column)
  }
  assert.throws(()=>cellCenter(grid,1000,0),RangeError)
})
test('line geometry preserves 6m spacing and is limited to visible area', () => {
  const box: [number,number,number,number] = [-119.591,37.744,-119.589,37.746]
  assert.equal(visibleGrid(grid,box,15).features.length,0)
  assert.equal(visibleGrid(grid,[-118,38,-117.99,38.01],17).features.length,0)
  const lines=visibleGrid(grid,box,17).features
  assert.ok(lines.length>0 && lines.length<200)
  const a=toProjected(grid,lines[0].geometry.coordinates[0] as [number,number])
  const b=toProjected(grid,lines[1].geometry.coordinates[0] as [number,number])
  assert.ok(Math.abs(b[0]-a[0]-6)<.001)
  const ring=boundary(grid).geometry.coordinates[0]
  assert.deepEqual(ring[0],ring.at(-1))
})
test('invalid grid definitions fail explicitly', () => {
  for(const invalid of [{cellSizeM:0},{cellSizeM:NaN},{rows:1.5},{columns:-1},{origin:[NaN,0]}]) assert.throws(()=>validateGrid({...grid,...invalid} as typeof grid))
})
