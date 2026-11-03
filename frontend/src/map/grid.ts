import proj4 from 'proj4'
import type { Feature, FeatureCollection, LineString, Polygon } from 'geojson'

export type GridSpec = {
  id: string; crs: string; projection: string; origin: [number, number]
  cellSizeM: number; rows: number; columns: number
}
export type Cell = { row: number; column: number; index: number }
// North-west origin. Row-major: east across each row, then south.
export function validateGrid(g: GridSpec) {
  if (!g.id || !g.crs || !g.projection || g.origin.length !== 2 || !g.origin.every(Number.isFinite) || !Number.isFinite(g.cellSizeM) || g.cellSizeM <= 0 || !Number.isSafeInteger(g.rows) || g.rows <= 0 || !Number.isSafeInteger(g.columns) || g.columns <= 0 || !Number.isSafeInteger(g.rows * g.columns)) throw new Error('Invalid grid specification')
  return g
}
export function gridExtent(g: GridSpec): [number, number, number, number] {
  return [g.origin[0], g.origin[1] - g.rows * g.cellSizeM, g.origin[0] + g.columns * g.cellSizeM, g.origin[1]]
}
export function toLngLat(g: GridSpec, point: [number, number]): [number, number] {
  return proj4(g.projection, 'EPSG:4326', point) as [number, number]
}
export function toProjected(g: GridSpec, point: [number, number]): [number, number] {
  return proj4('EPSG:4326', g.projection, point) as [number, number]
}
export function projectedToCell(g: GridSpec, x: number, y: number): Cell | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  const column = Math.floor((x - g.origin[0]) / g.cellSizeM)
  const row = Math.floor((g.origin[1] - y) / g.cellSizeM)
  // West/north included; east/south excluded. Never clamp an outside observation.
  if (column < 0 || column >= g.columns || row < 0 || row >= g.rows) return null
  return { row, column, index: row * g.columns + column }
}
export function cellCenter(g: GridSpec, row: number, column: number): [number, number] {
  if (!Number.isInteger(row) || !Number.isInteger(column) || row < 0 || row >= g.rows || column < 0 || column >= g.columns) throw new RangeError('Cell is outside grid')
  return [g.origin[0] + (column + .5) * g.cellSizeM, g.origin[1] - (row + .5) * g.cellSizeM]
}
function segment(g: GridSpec, a: [number, number], b: [number, number]) {
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 250))
  return Array.from({ length: n + 1 }, (_, i) => toLngLat(g, [a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]))
}
export function boundary(g: GridSpec): Feature<Polygon> {
  const [w, s, e, n] = gridExtent(g)
  const corners: [number, number][] = [[w, n], [e, n], [e, s], [w, s], [w, n]]
  const ring = corners.slice(0, 4).flatMap((p, i) => segment(g, p, corners[i + 1]).slice(0, -1))
  ring.push(ring[0])
  return { type: 'Feature', properties: { grid_id: g.id }, geometry: { type: 'Polygon', coordinates: [ring] } }
}
export const gridMinZoom = 16
export const emptyGrid: FeatureCollection<LineString> = { type: 'FeatureCollection', features: [] }
// Render only the visible part. Do not allocate one feature or probability per cell.
export function visibleGrid(g: GridSpec, geographicBounds: [number, number, number, number], zoom: number): FeatureCollection<LineString> {
  if (zoom < gridMinZoom || !geographicBounds.every(Number.isFinite)) return emptyGrid
  const [west, south, east, north] = geographicBounds
  const samples: [number, number][] = [[west, north], [east, north], [east, south], [west, south], [(west + east) / 2, north], [(west + east) / 2, south], [west, (south + north) / 2], [east, (south + north) / 2]]
  const points = samples.map(p => toProjected(g, p))
  const [gw, gs, ge, gn] = gridExtent(g)
  const pad = g.cellSizeM * 2
  const w = Math.max(gw, Math.min(...points.map(p => p[0])) - pad)
  const e = Math.min(ge, Math.max(...points.map(p => p[0])) + pad)
  const s = Math.max(gs, Math.min(...points.map(p => p[1])) - pad)
  const n = Math.min(gn, Math.max(...points.map(p => p[1])) + pad)
  if (w >= e || s >= n) return emptyGrid
  const firstCol = Math.max(0, Math.ceil((w - gw) / g.cellSizeM))
  const lastCol = Math.min(g.columns, Math.floor((e - gw) / g.cellSizeM))
  const firstRow = Math.max(0, Math.ceil((gn - n) / g.cellSizeM))
  const lastRow = Math.min(g.rows, Math.floor((gn - s) / g.cellSizeM))
  // Guard unusually large configurations without silently changing cell spacing.
  if (lastCol - firstCol + lastRow - firstRow + 2 > 2500) return emptyGrid
  const features: Feature<LineString>[] = []
  for (let c = firstCol; c <= lastCol; c++) {
    const x = gw + c * g.cellSizeM
    features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: segment(g, [x, s], [x, n]) } })
  }
  for (let row = firstRow; row <= lastRow; row++) {
    const y = gn - row * g.cellSizeM
    features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: segment(g, [w, y], [e, y]) } })
  }
  return { type: 'FeatureCollection', features }
}
export function gridManifest(g: GridSpec) {
  validateGrid(g)
  return { schema_version: 1, grid_id: g.id, crs: g.crs, proj4: g.projection, origin_north_west: g.origin, cell_size_m: g.cellSizeM, rows: g.rows, columns: g.columns, cell_count: g.rows * g.columns, projected_extent: gridExtent(g), geo_transform: [g.origin[0], g.cellSizeM, 0, g.origin[1], 0, -g.cellSizeM], array_order: 'row-major; west to east, north to south', coordinate_order: 'longitude, latitude', boundary_policy: 'west/north included; east/south excluded', status: 'geometry-only', elevation_resampled: false, validity_mask: null, probabilities: null, purpose: 'development area; not a validated incident search boundary' }
}
