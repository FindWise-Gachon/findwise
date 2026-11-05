import { projectedToCell, toProjected, type GridSpec } from './grid.ts'
import type { TerrainFeature } from './terrain.ts'

export function nearbyWays(features: TerrainFeature[], grid: GridSpec, point: [number, number]) {
  const [x, y] = toProjected(grid, point)
  const best: Partial<Record<'trail' | 'road', { name: string; distance: number; status: TerrainFeature['properties']['status'] }>> = {}
  for (const feature of features) {
    const kind = feature.properties.kind
    if ((kind !== 'trail' && kind !== 'road') || feature.geometry.type !== 'LineString') continue
    const points = feature.geometry.coordinates.map(p => toProjected(grid, p as [number, number]))
    for (let i = 1; i < points.length; i++) {
      const [a, b] = [points[i - 1], points[i]]
      const dx = b[0] - a[0], dy = b[1] - a[1]
      const length = dx * dx + dy * dy
      const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / length))
      const distance = Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy)
      if (distance <= 1000 && (!best[kind] || distance < best[kind]!.distance)) {
        const name = /^(trail|road) \d+$/.test(feature.properties.name) ? (kind === 'trail' ? '이름 없는 등산로' : '이름 없는 도로') : feature.properties.name
        best[kind] = { name, distance, status: feature.properties.status }
      }
    }
  }
  return { nearby: best, cell: projectedToCell(grid, x, y) }
}

export function elapsedSince(utc: string, now: number): string {
  if (!utc) return '시각 미입력'
  const delta = now - Date.parse(utc)
  if (!Number.isFinite(delta)) return '시각 확인 필요'
  if (delta < 0) return '미래 시각 · 확인 필요'
  const minutes = Math.floor(delta / 60000)
  const hours = Math.floor(minutes / 60)
  return hours >= 24 ? `${Math.floor(hours / 24)}일 ${hours % 24}시간` : hours ? `${hours}시간 ${minutes % 60}분` : `${minutes}분`
}
