import { useEffect, useMemo } from 'react'
import { Marker, type GeoJSONSource, type Map } from 'maplibre-gl'
import type { FeatureCollection, Point, Polygon } from 'geojson'
import { candidateExtent, candidateMass, candidateSize, orderCandidates, type AreaProbability, type CandidateArea, type CandidateOrder } from './candidateArea'
import type { ReportEffect } from './reportEffect'
import { cellCenter, projectedRectangle, toLngLat, type Cell, type GridSpec } from './grid'

const areaFormat = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 })
const probabilityFormat = new Intl.NumberFormat('ko-KR', { style: 'percent', maximumFractionDigits: 2 })
const numberFormat = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 })
const formatSize = (size: number) => size < 1_000_000 ? `${areaFormat.format(size)} m²` : `${areaFormat.format(size / 1_000_000)} km²`
const formatMass = (mass: number) => mass > 0 && mass < 0.0001 ? '<0.01%' : probabilityFormat.format(mass)
function formatDifference(before: number, after: number) {
  const points = (after - before) * 100
  if (Math.abs(points) < 1e-8) return '변화 없음'
  const amount = Math.abs(points) < .01 ? '0.01%p 미만' : `${numberFormat.format(Math.abs(points))}%p`
  return `${amount} ${points > 0 ? '증가' : '감소'}`
}
export const candidateLimit = 10

export type CandidateSource = { label: string; explanation: string; probability: AreaProbability }

export function CandidatePanel({ grid, areas, source, unavailable, visible, selected, order, effects, effectId, navigation, onStart, onToggle, onDelete, onFocus, onOrder, onEffect, onReport, onAnalysis }: {
  grid: GridSpec
  areas: readonly CandidateArea[]
  source: CandidateSource | null
  unavailable: string
  visible: boolean
  selected: CandidateArea | undefined
  order: CandidateOrder
  effects: readonly ReportEffect[]
  effectId: string
  navigation?: { index: number; count: number; onStep: (step: number) => void }
  onEffect: (id: string) => void
  onReport: (id: string) => void
  onAnalysis: () => void
  onStart: () => void
  onToggle: () => void
  onDelete: (id: number) => void
  onFocus: (area: CandidateArea) => void
  onOrder: (order: CandidateOrder) => void
}) {
  const effect = effects.find(item => item.report.id === effectId) ?? effects.at(-1)
  const rows = useMemo(() => areas.map(area => ({
    area,
    id: area.id,
    size: candidateSize(grid, area),
    mass: source ? candidateMass(grid, area, source.probability) : null,
  })), [areas, grid, source])
  const visibleOrder = !source && order === 'mass' ? 'created' : order
  const ordered = orderCandidates(rows, visibleOrder)
  const before = effect && selected ? candidateMass(grid, selected, { kind: 'sparse', cells: effect.before }) : null
  const after = effect && selected ? candidateMass(grid, selected, { kind: 'sparse', cells: effect.report.cells }) : null
  const drawButton = <button className={areas.length ? 'secondary-action' : 'primary-action'}
    disabled={areas.length >= candidateLimit} onClick={onStart}>지도에서 구역 지정</button>
  return <section className="candidate-panel">
    {areas.length === 0 && <><p>지도에서 두 모서리를 선택해 수색 후보를 그리세요.</p>{drawButton}</>}
    {source ? <div className="candidate-source"><strong>{source.label}</strong><p className="field-help">{source.explanation}</p>
      {navigation && <div className="compact-actions candidate-time-actions">
        <button className="secondary-action" disabled={navigation.index === 0} onClick={() => navigation.onStep(navigation.index - 1)}>이전 시점</button>
        <button className="secondary-action" disabled={navigation.index + 1 >= navigation.count} onClick={() => navigation.onStep(navigation.index + 1)}>다음 시점</button>
      </div>}
    </div> : <div className="workspace-next">
      <p className="field-help" role="status">{unavailable}</p>
      <button className="secondary-action" onClick={onAnalysis}>분석 조건 열기</button>
    </div>}
    {effect && <div className="candidate-source candidate-effect-source">
      <strong>보고 반영 전후</strong>
      {effects.length > 1 && <label className="measure-picker">비교할 승인 보고
        <select value={effect.report.id} onChange={event => onEffect(event.target.value)}>
          {effects.map(({ report }) => <option key={report.id} value={report.id}>{report.sequence}번째 · {report.rawText.trim().slice(0, 36)}</option>)}
        </select>
      </label>}
      {effects.length === 1 && <p className="field-help">{effect.report.rawText.trim().slice(0, 72)}{effect.report.rawText.trim().length > 72 ? '…' : ''}</p>}
      {areas.length === 0 && <button className="secondary-action" onClick={() => onReport(effect.report.id)}>보고 원문 보기</button>}
    </div>}
    {ordered.length > 0 && <>
      <div className="candidate-table-tools">
        <h3 id="candidate-comparison-title">후보 비교 · {ordered.length}개</h3>
        <div className="candidate-sort">
          <label htmlFor="candidate-order">정렬</label>
          <select id="candidate-order" value={visibleOrder} onChange={event => {
            const value = event.target.value
            if (value === 'mass' || value === 'size' || value === 'created') onOrder(value)
          }}>
            <option value="mass" disabled={!source}>확률 높은 순</option>
            <option value="size">면적 작은 순</option>
            <option value="created">추가한 순</option>
          </select>
        </div>
      </div>
      <p className="field-help" id="candidate-comparison-help">행을 누르면 지도에서 해당 구역을 봅니다.</p>
      <table className="candidate-table" aria-labelledby="candidate-comparison-title" aria-describedby="candidate-comparison-help">
        <thead><tr><th scope="col">구역</th><th scope="col">모델 확률</th><th scope="col">면적</th></tr></thead>
        <tbody>
          {ordered.map(({ area, id, size, mass }) => <tr key={id} className={selected?.id === id ? 'selected' : ''}
            onClick={() => onFocus(area)}>
            <th scope="row"><button type="button" aria-label={`후보 ${id} 지도에서 보기`} aria-pressed={selected?.id === id}>후보 {id}</button></th>
            <td>{mass === null ? <span aria-label="확률 없음">—</span> : formatMass(mass)}</td>
            <td>{formatSize(size)}</td>
          </tr>)}
        </tbody>
      </table>
      {selected && <article className="candidate-selection" aria-label={`선택한 후보 ${selected.id}`}>
        <div><strong>후보 {selected.id} 선택됨</strong>
          <button className="secondary-action" aria-label={`후보 ${selected.id} 삭제`} onClick={() => onDelete(selected.id)}>삭제</button>
        </div>
        {effect && before !== null && after !== null && <button type="button" className="candidate-effect"
          aria-label={`후보 ${selected.id} 변화 근거 보기`} onClick={() => onReport(effect.report.id)}>
          <span>승인 전 {formatMass(before)} → 후 {formatMass(after)}</span>
          <strong>{formatDifference(before, after)}</strong><small>보고 원문 보기</small>
        </button>}
      </article>}
      {drawButton}
      {areas.length >= candidateLimit && <p className="field-help">후보는 {candidateLimit}개까지 비교할 수 있습니다.</p>}
      <label className="measure-visibility"><input type="checkbox" checked={visible} onChange={onToggle} />후보 구역 표시</label>
      <details><summary>확률 읽는 법</summary>
        <p>현재 결과 확률은 후보에 포함된 셀의 모델 확률을 합한 값입니다. 비슷한 면적끼리 비교하세요. 구역이 겹치면 같은 셀이 각 구역에 포함될 수 있습니다.</p>
        {effect && <p>승인 전후는 같은 시점에서 선택한 보고 한 건의 영향을 보여줍니다. 다른 구역의 확률이 줄면 이 구역의 비율이 올라갈 수 있습니다.</p>}
      </details>
    </>}
  </section>
}

export function CandidateLayer({ map, grid, areas, visible, corner, selectedId }: {
  map: Map | null
  grid: GridSpec
  areas: readonly CandidateArea[]
  visible: boolean
  corner: Cell | null
  selectedId: number | undefined
}) {
  useEffect(() => {
    if (!map) return
    const id = 'search-candidates'
    const labels: Marker[] = []
    const clearLabels = () => { for (const label of labels.splice(0)) label.remove() }
    const update = () => {
      if (!map.getLayer('analysis-boundary')) return
      const data: FeatureCollection<Polygon | Point> = { type: 'FeatureCollection', features: [] }
      clearLabels()
      if (visible) {
        for (const area of areas) {
          const bounds = candidateExtent(grid, area)
          const selected = area.id === selectedId
          const feature = projectedRectangle(grid, bounds)
          data.features.push({ ...feature, properties: { ...feature.properties, selected } })
          const [west, south, east, north] = bounds
          const element = document.createElement('span')
          element.className = selected ? 'candidate-map-label selected' : 'candidate-map-label'
          element.textContent = `후보 ${area.id}`
          labels.push(new Marker({ element, anchor: selected ? 'bottom' : 'center' })
            .setLngLat(toLngLat(grid, [(west + east) / 2, (south + north) / 2])).addTo(map))
        }
      }
      if (corner) data.features.push({
        type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: toLngLat(grid, cellCenter(grid, corner.row, corner.column)) },
      })
      const source = map.getSource<GeoJSONSource>(id)
      if (source) source.setData(data)
      else if (data.features.length) {
        map.addSource(id, { type: 'geojson', data })
        map.addLayer({ id, source: id, type: 'fill', paint: { 'fill-color': '#8bd7ff',
          'fill-opacity': ['case', ['==', ['get', 'selected'], true], .26, .12] } })
        map.addLayer({ id: id + '-outline', source: id, type: 'line', filter: ['==', ['geometry-type'], 'Polygon'],
          paint: { 'line-color': ['case', ['==', ['get', 'selected'], true], '#a6eaff', '#16618b'],
            'line-width': ['case', ['==', ['get', 'selected'], true], 4, 3] } })
        map.addLayer({ id: id + '-corner', source: id, type: 'circle', filter: ['==', ['geometry-type'], 'Point'],
          paint: { 'circle-radius': 5, 'circle-color': '#8bd7ff', 'circle-stroke-color': '#143c53', 'circle-stroke-width': 2 } })
      }
    }
    update()
    map.on('style.load', update)
    return () => { map.off('style.load', update); clearLabels() }
  }, [map, grid, areas, visible, corner, selectedId])
  return null
}
