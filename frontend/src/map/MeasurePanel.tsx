import { useEffect } from 'react'
import { Marker, type FilterSpecification, type GeoJSONSource, type Map } from 'maplibre-gl'
import type { FeatureCollection, LineString, Point } from 'geojson'
import { formatMeasure, measureMeters, measureSegments, type Measurement } from './measure'

export function MeasurePanel({ measurements, selected, onSelect, onStart, onNew, onToggle, onUndo, onClear }: {
  measurements: readonly Measurement[]
  selected: Measurement | undefined
  onSelect: (id: number) => void
  onStart: () => void
  onNew: () => void
  onToggle: () => void
  onUndo: () => void
  onClear: () => void
}) {
  const points = selected?.points ?? []
  const segments = measureSegments(points)
  const total = segments.reduce((sum, distance) => sum + distance, 0)
  return <section className="measure-panel">
    <p>지도에 점을 찍으면 구간별 수평 거리와 합계를 보여줍니다.</p>
    <button className="primary-action" onClick={onNew}>새 측정 시작</button>
    {measurements.length > 0 && <label className="measure-picker">측정 선택
      <select value={selected?.id ?? ''} onChange={event => onSelect(Number(event.target.value))}>
        {measurements.map(item => <option key={item.id} value={item.id}>
          측정 {item.id}{item.points.length > 1 ? ` · ${formatMeasure(measureMeters(item.points))}` : ''}
        </option>)}
      </select>
    </label>}
    {selected && <>
      <div className="measure-total"><span>합계</span><strong>{segments.length ? formatMeasure(total) : '—'}</strong><small>{points.length}개 지점</small></div>
      {segments.length > 0 && <ol className="measure-segments" aria-label="구간별 거리">
        {segments.map((distance, index) => <li key={index}><span>{index + 1}번 점 → {index + 2}번 점</span><strong>{formatMeasure(distance)}</strong></li>)}
      </ol>}
      <div className="compact-actions">
        <button className="secondary-action" onClick={onStart}>이어서 측정</button>
        <button className="secondary-action" disabled={!points.length} onClick={onUndo}>마지막 점 취소</button>
        <button className="secondary-action" onClick={onClear}>이 측정 삭제</button>
      </div>
      <label className="measure-visibility"><input type="checkbox" checked={selected.visible} onChange={onToggle} />이 측정선 표시</label>
    </>}
    <p className="field-help">고도 차이와 실제 등산로 길이는 반영하지 않습니다.</p>
  </section>
}

const sourceId = 'distance-measurement'

export function MeasureLayer({ map, measurements, selectedId, visible }: {
  map: Map | null
  measurements: readonly Measurement[]
  selectedId: number | undefined
  visible: boolean
}) {
  useEffect(() => {
    if (!map) return
    const labels: Marker[] = []
    const clearLabels = () => { for (const label of labels.splice(0)) label.remove() }
    const update = () => {
      if (!map.getLayer('analysis-boundary')) return
      const shown = visible ? measurements.filter(item => item.visible && item.points.length) : []
      const data: FeatureCollection<LineString | Point> = { type: 'FeatureCollection', features: [] }
      for (const item of shown) {
        const properties = { selected: item.id === selectedId }
        if (item.points.length >= 2) data.features.push({ type: 'Feature', properties, geometry: { type: 'LineString', coordinates: item.points } })
        for (const point of item.points) data.features.push({ type: 'Feature', properties, geometry: { type: 'Point', coordinates: point } })
      }

      const source = map.getSource<GeoJSONSource>(sourceId)
      if (source) source.setData(data)
      else if (data.features.length) {
        map.addSource(sourceId, { type: 'geojson', data })
        const filter: FilterSpecification = ['==', ['geometry-type'], 'LineString']
        map.addLayer({ id: 'measure-casing', source: sourceId, type: 'line', filter,
          layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': 6, 'line-color': '#18242b' } })
        map.addLayer({ id: 'measure-line', source: sourceId, type: 'line', filter,
          layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': 3, 'line-color': ['case', ['get', 'selected'], '#fff5d6', '#a0bfc6'] } })
        map.addLayer({ id: 'measure-points', source: sourceId, type: 'circle', filter: ['==', ['geometry-type'], 'Point'],
          paint: { 'circle-radius': 5, 'circle-color': ['case', ['get', 'selected'], '#fff5d6', '#a0bfc6'], 'circle-stroke-color': '#18242b', 'circle-stroke-width': 2 } })
      }
      clearLabels()
      for (const item of shown) {
        if (item.points.length < 2) continue
        const element = document.createElement('span')
        element.className = 'measure-map-label'
        element.dataset.measureId = String(item.id)
        element.textContent = `측정 ${item.id} · ${formatMeasure(measureMeters(item.points))}`
        labels.push(new Marker({ element, anchor: 'bottom', offset: [0, -10] }).setLngLat(item.points.at(-1)!).addTo(map))
      }
    }
    update()
    map.on('style.load', update)
    return () => { map.off('style.load', update); clearLabels() }
  }, [map, measurements, selectedId, visible])
  return null
}
