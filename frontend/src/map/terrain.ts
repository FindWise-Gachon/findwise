import type { Feature, FeatureCollection, LineString, Polygon, MultiPolygon } from 'geojson'
export type Status = 'allowed' | 'blocked' | 'unknown'
export type TerrainFeature = Feature<LineString | Polygon | MultiPolygon, { id: string; name: string; kind: string; source: string; status: Status; reason: string }>
export const labels = { allowed: '이동 가능', blocked: '이동 불가', unknown: '미확인' }

export function readTerrain(value: unknown): TerrainFeature[] {
  const data = value as FeatureCollection
  if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error('GeoJSON FeatureCollection이 필요합니다.')
  const ids = new Set<string>()
  return data.features.map((feature, index) => {
    const g = feature.geometry
    const properties = feature.properties ?? {}
    if (!g || !['LineString', 'Polygon', 'MultiPolygon'].includes(g.type)) throw new Error('선과 폴리곤 지형만 지원합니다.')
    const polygons = g.type === 'MultiPolygon' ? g.coordinates : g.type === 'Polygon' ? [g.coordinates] : []
    if (g.type !== 'LineString' && (!polygons.length || polygons.some(polygon => !polygon.length))) throw new Error('빈 수역 경계입니다.')
    const paths = g.type === 'LineString' ? [g.coordinates] : polygons.flat()
    if (!paths.length) throw new Error('빈 지형 경계는 불러올 수 없습니다.')
    for (const path of paths) {
      if (path.length < (g.type !== 'LineString' ? 4 : 2) || path.some(p => p.length !== 2 || !p.every(Number.isFinite) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90)) throw new Error('경위도 좌표를 확인해 주세요.')
      if (g.type !== 'LineString' && JSON.stringify(path[0]) !== JSON.stringify(path.at(-1))) throw new Error('폴리곤 경계가 닫혀 있어야 합니다.')
    }
    const id = String(properties.id ?? feature.id ?? index)
    if (ids.has(id)) throw new Error('지형 ID가 중복되었습니다.')
    ids.add(id)
    const status: Status = Object.hasOwn(labels, properties.status) ? properties.status : 'unknown'
    return { type: 'Feature', geometry: g as LineString | Polygon | MultiPolygon, properties: {
      id, status, name: String(properties.name ?? id), kind: String(properties.kind ?? '미분류'),
      source: String(properties.source ?? '출처 미입력') + ((data as FeatureCollection & { source_timestamp?: string }).source_timestamp ? ` · ${(data as FeatureCollection & { source_timestamp: string }).source_timestamp}` : ''), reason: String(properties.reason ?? '원본 자료'),
    } }
  })
}
