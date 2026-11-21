import { useEffect, useMemo, useState } from 'react'
import type { Map as MapInstance, MapMouseEvent, GeoJSONSource, FilterSpecification } from 'maplibre-gl'
import { labels, type Status, type TerrainFeature } from './terrain'
import { changeTerrain, exportTerrain, undoTerrain, visibleTerrain } from './terrainDocument'
import type { useTerrain } from './useTerrain'

export type TerrainLayers = { trail: boolean; road: boolean; river: boolean; water: boolean; access: boolean }
const kinds: Record<string, string> = { trail: '등산로', road: '도로', river: '하천', water: '수역', override: '사용자 구역' }
const accessLayerIds = ['terrain-fill', 'terrain-blocked', 'terrain-lines', 'terrain-unknown']
const hitLayerIds = ['terrain-lines', 'terrain-paths', 'terrain-water', 'terrain-fill']

export function TerrainPanel({ map, open, onOpen, onClose, mapToolBusy, drawing, onDrawingChange, onInspectOverlay, layers, terrain }: {
  map: MapInstance | null
  open: boolean
  onOpen: () => void
  onClose: () => void
  mapToolBusy: boolean
  drawing: boolean
  onDrawingChange: (drawing: boolean) => void
  onInspectOverlay?: (event: MapMouseEvent) => boolean
  layers: TerrainLayers
  terrain: ReturnType<typeof useTerrain>
}) {
  const { document, setDocument } = terrain
  const features = useMemo(() => document ? visibleTerrain(document) : [], [document])
  const [selected, setSelected] = useState('')
  const [draft, setDraft] = useState<Status | null>(null)
  const [reason, setReason] = useState('')
  const [customReason, setCustomReason] = useState('')
  const [message, setMessage] = useState('')
  const [corner, setCorner] = useState<[number, number] | null>(null)
  const [pending, setPending] = useState<TerrainFeature | null>(null)
  const current = pending ?? features.find(feature => feature.properties.id === selected)
  const status = draft ?? current?.properties.status ?? 'unknown'

  function close() {
    onDrawingChange(false); setCorner(null); setPending(null); setDraft(null); onClose()
  }
  function select(id: string) {
    setSelected(id); setPending(null); setDraft(null); setReason(''); setCustomReason(''); setMessage('')
  }

  useEffect(() => {
    if (!map) return
    const update = () => {
      if (!map.getLayer('analysis-boundary')) return
      if (!map.getSource('terrain-access')) {
        map.addSource('terrain-access', { type: 'geojson', data: { type: 'FeatureCollection', features: [] },
          attribution: 'Terrain © OpenStreetMap contributors' })
        const tile = new Uint8Array(8 * 8 * 4)
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
          tile.set([215, 135, 125, (x + y) % 8 < 2 ? 180 : 20], (y * 8 + x) * 4)
        }
        if (!map.hasImage('terrain-hatch')) map.addImage('terrain-hatch', { width: 8, height: 8, data: tile })
        map.addLayer({ id: 'terrain-water', type: 'fill', source: 'terrain-access',
          filter: ['==', ['get', 'kind'], 'water'], paint: { 'fill-color': '#609fc4', 'fill-opacity': .25 } })
        map.addLayer({ id: 'terrain-paths', type: 'line', source: 'terrain-access', paint: {
          'line-color': ['match', ['get', 'kind'], 'trail', '#6ebc89', 'road', '#f2dfb2', '#6baed2'],
          'line-width': ['match', ['get', 'kind'], 'road', 2.5, 1.7],
        } })
        map.addLayer({ id: 'terrain-fill', type: 'fill', source: 'terrain-access',
          filter: ['==', ['geometry-type'], 'Polygon'], paint: {
            'fill-color': ['match', ['get', 'status'], 'allowed', '#85e5d9', 'blocked', '#d7877d', '#9da9b0'], 'fill-opacity': .16,
          } })
        map.addLayer({ id: 'terrain-blocked', type: 'fill', source: 'terrain-access',
          filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['==', ['get', 'status'], 'blocked']],
          paint: { 'fill-pattern': 'terrain-hatch' } })
        map.addLayer({ id: 'terrain-lines', type: 'line', source: 'terrain-access', paint: {
          'line-color': ['match', ['get', 'status'], 'allowed', '#69d4c4', 'blocked', '#e29a8e', '#aab8c1'], 'line-width': 2,
        } })
        map.addLayer({ id: 'terrain-unknown', type: 'line', source: 'terrain-access', filter: ['==', ['get', 'status'], 'unknown'],
          paint: { 'line-color': '#28343b', 'line-width': 2, 'line-dasharray': [2, 3] } })
        map.addLayer({ id: 'terrain-selected', type: 'line', source: 'terrain-access',
          paint: { 'line-color': '#fff4be', 'line-width': 4 } })
      }
      const visible = new Map(features.map(feature => [feature.properties.id, feature]))
      if (pending && open) visible.set(pending.properties.id, pending)
      const feature = visible.get(pending?.properties.id ?? selected)
      if (feature && open && draft) visible.set(feature.properties.id, {
        ...feature, properties: { ...feature.properties, status: draft },
      })
      map.getSource<GeoJSONSource>('terrain-access')!.setData({ type: 'FeatureCollection', features: [...visible.values()] })
      const lineKinds = Object.entries(layers).filter(([kind, shown]) => shown && ['trail', 'road', 'river'].includes(kind)).map(([kind]) => kind)
      map.setFilter('terrain-paths', ['in', ['get', 'kind'], ['literal', lineKinds]] as FilterSpecification)
      map.setLayoutProperty('terrain-water', 'visibility', layers.water ? 'visible' : 'none')
      for (const id of accessLayerIds) map.setLayoutProperty(id, 'visibility', layers.access || open ? 'visible' : 'none')
      map.setFilter('terrain-selected', ['==', ['get', 'id'], open ? pending?.properties.id ?? selected : ''])
    }
    update()
    map.on('style.load', update)
    return () => { map.off('style.load', update) }
  }, [map, features, layers, open, selected, draft, pending])

  useEffect(() => {
    if (!map || mapToolBusy) return
    const canvas = map.getCanvas()
    if (drawing && open) canvas.style.cursor = 'crosshair'
    const click = (event: MapMouseEvent) => {
      if (drawing && open && document) {
        const point: [number, number] = [event.lngLat.wrap().lng, event.lngLat.lat]
        if (!corner) { setCorner(point); return }
        if (Math.abs(point[0] - corner[0]) < .00001 || Math.abs(point[1] - corner[1]) < .00001) return
        const id = crypto.randomUUID()
        setPending({ type: 'Feature', geometry: { type: 'Polygon',
          coordinates: [[corner, [point[0], corner[1]], point, [corner[0], point[1]], corner]] },
          properties: { id, name: '사용자 지정 구역', kind: 'override', source: '사용자 지정', status: 'unknown', reason: '검토 대기' } })
        setSelected(id); setDraft('blocked'); setReason(''); setCustomReason('')
        onDrawingChange(false); setCorner(null)
        return
      }
      if (onInspectOverlay?.(event)) return
      const rendered = hitLayerIds.filter(id => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none')
      if (!rendered.length) return
      const id = map.queryRenderedFeatures([[event.point.x - 5, event.point.y - 5], [event.point.x + 5, event.point.y + 5]], { layers: rendered })[0]?.properties?.id as string | undefined
      if (!id || !features.some(feature => feature.properties.id === id)) return
      setSelected(id); setPending(null); setDraft(null); setReason(''); setCustomReason(''); setMessage('')
      onOpen()
    }
    map.on('click', click)
    return () => { map.off('click', click); if (drawing) canvas.style.cursor = '' }
  }, [map, mapToolBusy, drawing, open, document, corner, features, onOpen, onDrawingChange, onInspectOverlay])

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setCorner(null); setPending(null); setDraft(null) }
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [])

  function apply() {
    const explanation = reason === '직접 입력' ? customReason.trim() : reason
    if (!document || !current || !explanation) { setMessage('변경 이유를 선택해 주세요.'); return }
    setDocument(previous => previous ? changeTerrain(previous, {
      id: current.properties.id, reason: explanation, at: new Date().toISOString(),
      feature: { ...current, properties: { ...current.properties, status, reason: explanation } },
    }) : previous)
    setPending(null); setDraft(null); setMessage('통행 조건을 적용했습니다.')
  }
  function backup() {
    if (!document) return
    const url = URL.createObjectURL(new Blob([JSON.stringify(exportTerrain(document))], { type: 'application/geo+json' }))
    const link = window.document.createElement('a')
    link.href = url; link.download = 'findwise-terrain-access.geojson'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return <>
    {drawing && open && <div className="terrain-drawing" role="status">
      {corner ? '구역의 반대쪽 모서리를 클릭하세요.' : '구역의 첫 모서리를 클릭하세요.'}
      <button onClick={() => { onDrawingChange(false); setCorner(null) }}>취소</button>
    </div>}
    <aside className="terrain-panel" hidden={!open || drawing}>
      <header><h2>통행 설정</h2><button onClick={close} aria-label="통행 설정 닫기">닫기</button></header>
      <p className={terrain.saveError ? 'save-warning' : ''} role="status">{document ? terrain.saveLabel : terrain.status === 'error' ? '기본 지형 연결 필요' : '기본 지형 준비 중'}</p>
      {(message || terrain.message) && <p role="status">{message || terrain.message}</p>}
      {terrain.status === 'error' && <button onClick={terrain.retry}>지형 다시 불러오기</button>}
      <p>지도에서 길이나 수역을 누른 뒤 통행 상태를 정하세요.</p>
      <div className="terrain-actions">
        <button disabled={!document} onClick={() => { onDrawingChange(true); setCorner(null); setPending(null); setDraft(null) }}>구역 지정</button>
        <button disabled={!document?.changes.length} onClick={() => {
          setDocument(previous => previous ? undoTerrain(previous) : previous)
          setPending(null); setDraft(null); setMessage('직전 변경을 되돌렸습니다.')
        }}>직전 변경 되돌리기</button>
      </div>
      {current && <>
        <h3>{current.properties.name}</h3>
        <p>{Object.hasOwn(kinds, current.properties.kind) ? kinds[current.properties.kind] : '지형'} · 현재 {labels[current.properties.status]}</p>
        <p>선택한 지형 전체에 적용합니다. 부분 변경은 구역 지정으로 표시하세요.</p>
        <div className="terrain-actions" role="group" aria-label="통행 상태">
          <button aria-pressed={draft === 'blocked'} onClick={() => setDraft('blocked')}>통행 막기</button>
          <button aria-pressed={draft === 'allowed'} onClick={() => setDraft('allowed')}>통행 허용</button>
          <button onClick={() => {
            if (!document) return
            if (pending) { setPending(null); setDraft(null); return }
            setDocument(previous => previous ? changeTerrain(previous, {
              id: current.properties.id, feature: null, reason: '자료 기준 복원', at: new Date().toISOString(),
            }) : previous)
            setDraft(null); setMessage('자료 기준으로 복원했습니다.')
          }}>자료 기준으로 복원</button>
        </div>
        {(draft || pending) && <>
          <p>미리보기 · {labels[status]}</p>
          <label>변경 이유<select aria-label="변경 이유" value={reason} onChange={event => setReason(event.target.value)}>
            <option value="">이유 선택</option>
            {['다리 확인', '낙석', '침수', '현장 확인', '직접 입력'].map(value => <option key={value}>{value}</option>)}
          </select></label>
          {reason === '직접 입력' && <label>상세 이유<input value={customReason} onChange={event => setCustomReason(event.target.value)} /></label>}
          <button className="apply-terrain" onClick={apply}>이 변경 적용</button>
          <button onClick={() => { setDraft(null); setPending(null) }}>변경 취소</button>
        </>}
        <details><summary>판단 근거·출처</summary><p>{current.properties.reason}</p><p>{current.properties.source}</p></details>
      </>}
      <details>
        <summary>고급 설정 · 자료와 백업</summary>
        <label>사용자 지형 자료 추가<input type="file" accept=".json,.geojson" onChange={event => {
          const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''
          if (file && (!document?.changes.length || window.confirm('현재 수정본을 다른 자료로 바꿉니다. 백업이 필요하면 먼저 취소하세요.'))) void terrain.importFile(file)
        }} /></label>
        <label>지형 목록<select aria-label="지형 목록" value={selected} onChange={event => select(event.target.value)}>
          <option value="">지도 또는 목록에서 선택</option>
          {features.map(feature => <option key={feature.properties.id} value={feature.properties.id}>{feature.properties.name}</option>)}
        </select></label>
        <button disabled={!document} onClick={backup}>백업·모델 입력 저장</button>
      </details>
    </aside>
  </>
}
