import { LngLat } from 'maplibre-gl'

export type MapPoint = [longitude: number, latitude: number]

export type Measurement = { id: number; points: MapPoint[]; visible: boolean }

export function measureSegments(points: readonly MapPoint[]) {
  return points.slice(1).map((point, index) =>
    LngLat.convert(points[index]).distanceTo(LngLat.convert(point)))
}

export function measureMeters(points: readonly MapPoint[]) {
  return measureSegments(points).reduce((total, distance) => total + distance, 0)
}

export function appendMeasurePoint(points: MapPoint[], point: MapPoint): MapPoint[] {
  const previous = points.at(-1)
  if (!previous) return [point]
  const longitude = point[0] + 360 * Math.round((previous[0] - point[0]) / 360)
  const next: MapPoint = [longitude, point[1]]
  return measureMeters([previous, next]) < 0.5 ? points : [...points, next]
}

const format = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 })
export function formatMeasure(meters: number) {
  return meters < 1000 ? `${format.format(Math.round(meters))} m` : `${format.format(meters / 1000)} km`
}
