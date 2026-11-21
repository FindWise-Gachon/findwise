import type { Map, Point } from 'maplibre-gl'
import type { Feature, Polygon } from 'geojson'
import { toLngLat, toProjected, type GridSpec } from './grid'
import type { MapPoint } from './measure'
import type { ReportKind, ReportRadius } from './searchRecord'

export const reportAreaSource = 'search-report-areas'
export const approvedFill = reportAreaSource + '-approved'
export const approvedLine = reportAreaSource + '-approved-outline'

export function searchRecordAtPoint(map: Map, point: Point) {
  const layers = [approvedFill, approvedLine].filter(id => map.getLayer(id))
  if (!layers.length) return undefined
  const id = map.queryRenderedFeatures(point, { layers })[0]?.properties?.record
  return typeof id === 'string' ? id : undefined
}

export function reportCircle(grid: GridSpec, point: MapPoint, radius: ReportRadius, record: string | null, selected: boolean, kind: ReportKind = 'searched'): Feature<Polygon> {
  const [x, y] = toProjected(grid, point)
  const ring = Array.from({ length: 48 }, (_, index) => {
    const angle = index * Math.PI / 24
    return toLngLat(grid, [x + radius * Math.cos(angle), y + radius * Math.sin(angle)])
  })
  ring.push(ring[0])
  return { type: 'Feature', properties: { record, kind, approved: record !== null, selected }, geometry: { type: 'Polygon', coordinates: [ring] } }
}
