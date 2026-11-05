import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { Map as MapInstance } from 'maplibre-gl'
import { Mountain, Folder, Layers, History, Map as MapIcon, Satellite, ChevronDown, ChevronUp, X, Plus, Minus, LocateFixed, ArrowUpRight, Info, SlidersHorizontal, RotateCcw, Check, MapPin, ArrowUp } from 'lucide-react'
import { useTerrain } from './map/useTerrain'
import { readCase, readyCase, validLocation, type CaseInput } from './map/case'
import { TerrainPanel } from './map/TerrainPanel'
import { PointInfo } from './map/PointInfo'
import { DistancePanel, CoordinateEntry } from './map/DistancePanel'
import { distanceBands, distanceModelVersion, rankByDistance, type DistanceRun } from './map/distance'
import { MapView } from './map/MapView'
import { analysisGrid, defaults, readSettings, region } from './map/config'
import { boundary, gridManifest, gridMinZoom, toLngLat, toProjected } from './map/grid'
import { demoTimeline, readTimeline, type Timeline } from './map/timeline'
import { mapStatusReducer } from './map/status'
import './App.css'

const gridDefinition = gridManifest(analysisGrid)
const [west, south, east, north] = gridDefinition.projected_extent
const formatKm = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 6 })
const areaSize = `${formatKm.format((east - west) / 1000)} × ${formatKm.format((north - south) / 1000)}km`
const cellSize = `${gridDefinition.cell_size_m}m`
const gridCenter = toLngLat(analysisGrid, [(west + east) / 2, (south + north) / 2])
const connectionLabels = {
  loading: '자료 연결 중',
  connected: '지도 연결됨',
  'data-error': '연결 확인 필요',
  'startup-error': '연결 확인 필요',
}
const errorMessages = {
  'data-error': '일부 지도 자료를 불러오지 못했습니다. 연결을 확인하고 다시 시도해 주세요.',
  'startup-error': '지도를 시작하지 못했습니다. WebGL 지원과 브라우저 설정을 확인해 주세요.',
}

function downloadJson(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function initialCase(): CaseInput {
  try { return readCase(JSON.parse(localStorage.getItem('findwise.case.v1') || 'null'), analysisGrid) }
  catch { return { start: null, lastSeenUtc: '' } }
}

type Panel = 'sources' | 'modules' | 'results' | 'history' | null
function App() {
  const [settings, setSettings] = useState(readSettings)
  const terrain = useTerrain()
  const [caseInput, setCaseInput] = useState(initialCase)
  const [pendingLocation, setPendingLocation] = useState<[number, number] | null>(null)
  const [caseSaveError, setCaseSaveError] = useState('')
  const [resultCase, setResultCase] = useState('')
  const caseKey = JSON.stringify(caseInput)
  const terrainLayers = useMemo(() => ({
    trail: settings.trail, road: settings.road, river: settings.river, water: settings.water, access: settings.access,
  }), [settings.trail, settings.road, settings.river, settings.water, settings.access])
  const updateCase = (next: CaseInput) => {
    setCaseInput(next)
    try { localStorage.setItem('findwise.case.v1', JSON.stringify(next)); setCaseSaveError('') }
    catch { setCaseSaveError('마지막 확인 정보를 저장하지 못했습니다. 실행 조건을 백업해 주세요.') }
  }
  const [pointOpen, setPointOpen] = useState(false)
  const [layersOpen, setLayersOpen] = useState(false)
  const [legendOpen, setLegendOpen] = useState(false)
  const [panel, setPanel] = useState<Panel>('modules')
  const [status, dispatchStatus] = useReducer(mapStatusReducer, 'loading')
  const [zoom, setZoom] = useState(region.zoom)
  const [reload, setReload] = useState(0)
  const [distanceRun, setDistanceRun] = useState<DistanceRun | null>(null)
  const [timeline, setTimeline] = useState<Timeline | null>(null)
  const [timelineStep, setTimelineStep] = useState(0)
  const [timelineError, setTimelineError] = useState('')
  const timelineLoad = useRef(0)
  const [picking, setPicking] = useState(false)
  const [distanceMessage, setDistanceMessage] = useState('')
  const [terrainOpen, setTerrainOpen] = useState(false)
  const [mapInstance, setMapInstance] = useState<MapInstance | null>(null)
  const map = useRef<MapInstance | null>(null)
  const onReady = useCallback((value: MapInstance | null) => { map.current = value; setMapInstance(value) }, [])
  useEffect(() => { try { localStorage.setItem('findwise.map.v1', JSON.stringify(settings)) } catch { /* Browser storage is optional. */ } }, [settings])
  useEffect(() => { const close = (e: KeyboardEvent) => { if (e.key === 'Escape') { setPanel(null); setPointOpen(false); setTerrainOpen(false); setLayersOpen(false); setPicking(false); setPendingLocation(null); setDistanceMessage('') } }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close) }, [])
  const togglePanel = (value: Panel) => { setPointOpen(false); setPicking(false); setTerrainOpen(false); setPanel(previous => previous === value ? null : value) }
  const openTerrain = useCallback(() => {
    setPanel(null); setPointOpen(false); setPicking(false); setPendingLocation(null); setLayersOpen(false); setTerrainOpen(true)
  }, [])
  const inspectPoint = useCallback(() => {
    setPointOpen(true); setPanel(null); setTerrainOpen(false); setLayersOpen(false)
  }, [])
  const pickLocation = () => {
    setPointOpen(false); setTerrainOpen(false); setLayersOpen(false); setDistanceMessage('')
    setPendingLocation(null); setPanel(null); setPicking(true); showArea()
  }
  const confirmLocation = () => {
    if (pendingLocation) { updateCase({ ...caseInput, start: pendingLocation }); setPendingLocation(null) }
  }
  const home = () => map.current?.flyTo({ center: region.center, zoom: region.zoom, bearing: 0, pitch: 0, essential: true })
  const showArea = () => {
    setSettings(s => ({ ...s, area: true }))
    const ring = boundary(analysisGrid).geometry.coordinates[0]
    map.current?.fitBounds([[Math.min(...ring.map(p => p[0])), Math.min(...ring.map(p => p[1]))], [Math.max(...ring.map(p => p[0])), Math.max(...ring.map(p => p[1]))]], { padding: 60, duration: 800 })
  }
  const inspectGrid = () => { setSettings(s => ({ ...s, area: true, grid: true })); map.current?.flyTo({ center: gridCenter, zoom: gridMinZoom + .8, bearing: 0, pitch: 0, essential: true }) }
  const exportGrid = () => downloadJson(`${analysisGrid.id}.json`, gridDefinition)
  const chooseLocation = useCallback((start: [number, number]) => {
    if (!validLocation(analysisGrid, start)) {
      setDistanceMessage('분석 범위 안에서 위치를 선택해 주세요.')
      return
    }
    setPendingLocation(start); setPicking(false); setTerrainOpen(false); setPointOpen(true); setPanel(null); setDistanceMessage('')
  }, [])
  const runDistance = () => {
    if (pendingLocation) {
      setDistanceMessage('새로 선택한 위치를 먼저 확정해 주세요.')
      setPointOpen(true); setPanel(null)
      return
    }
    if (!readyCase(caseInput, analysisGrid) || !caseInput.start) {
      setDistanceMessage('마지막 확인 위치와 시각을 먼저 정해 주세요.')
      return
    }
    timelineLoad.current++
    setTimeline(null); setTimelineError('')
    setDistanceRun({ start: caseInput.start, lastSeenUtc: caseInput.lastSeenUtc, order: rankByDistance(analysisGrid, toProjected(analysisGrid, caseInput.start)) })
    setResultCase(caseKey)
    setSettings(previous => ({ ...previous, heatmap: true }))
    setPointOpen(false); setPanel(window.matchMedia('(max-width: 760px)').matches ? null : 'results'); setLayersOpen(false)
    setDistanceMessage('거리 기준 결과를 계산했습니다.')
  }
  const cancelPicking = () => {
    setPicking(false)
    setDistanceMessage('')
    setPanel('modules')
  }
  const clearDistance = () => {
    setDistanceRun(null)
    setDistanceMessage('')
  }
  const clearTimeline = () => {
    timelineLoad.current++
    setTimeline(null)
    setTimelineError('')
  }
  const showTimeline = (next: Timeline) => {
    clearTimeline()
    clearDistance()
    setPicking(false)
    setTimelineStep(0)
    const input: CaseInput = { start: next.start, lastSeenUtc: new Date(next.lastSeenMs).toISOString() }
    updateCase(input); setPendingLocation(null); setResultCase(JSON.stringify(input))
    setSettings(previous => ({ ...previous, heatmap: true }))
    setTimeline(next); setPanel(window.matchMedia('(max-width: 760px)').matches ? null : 'results'); setPointOpen(false)
  }
  const loadTimeline = async (file: File) => {
    const request = ++timelineLoad.current
    try {
      if (file.size > 32 * 1024 * 1024) throw new Error('32MB 이하의 JSON을 선택해 주세요.')
      const next = readTimeline(JSON.parse(await file.text()), analysisGrid)
      if (request === timelineLoad.current) showTimeline(next)
    } catch (error) {
      if (request === timelineLoad.current) setTimelineError(
        error instanceof SyntaxError ? '올바른 JSON 파일을 선택해 주세요.' : (error as Error).message,
      )
    }
  }
  const frame = timeline?.frames[timelineStep]
  const elapsed = frame ? `${Math.floor(frame.elapsed_seconds / 3600)}시간 ${Math.floor(frame.elapsed_seconds % 3600 / 60)}분 ${frame.elapsed_seconds % 60}초` : ''
  const exportDistance = () => {
    if (!distanceRun) return
    downloadJson(`${analysisGrid.id}-distance.json`, {
      schema_version: 1,
      model_version: distanceModelVersion,
      grid: gridDefinition,
      start_lng_lat: distanceRun.start,
      last_seen_utc: distanceRun.lastSeenUtc,
      result: 'ascending projected distance to cell center',
      tie_break: 'row-major cell index',
    })
  }
  const hasResult = Boolean(distanceRun || timeline)
  const caseChanged = hasResult && resultCase !== caseKey
  const terrainChanged = Boolean(timeline && !timeline.synthetic && timeline.terrainRevision &&
    terrain.document && timeline.terrainRevision !== terrain.document.revision)
  const resultNotice = caseChanged ? '마지막 확인 정보가 변경됨 · 이전 입력의 결과입니다.' :
    terrainChanged ? '이동 조건이 변경됨 · 변경 전 조건으로 계산된 결과입니다.' :
    timeline && !timeline.synthetic && timeline.terrainRevision && !terrain.document ? '결과의 이동 조건을 확인하려면 지형 자료를 연결해 주세요.' :
    timeline && !timeline.synthetic && !timeline.terrainRevision ? '이 결과에는 적용한 이동 조건 버전이 없습니다.' : ''
  const interval = zoom >= 14 ? 20 : zoom >= 12 ? 50 : 100
  const failed = status === 'data-error' || status === 'startup-error'
  const dotClass = failed ? 'warning-dot' : status === 'loading' ? 'loading-dot' : ''
  return <div className="workspace">
    <header className="topbar">
      <a className="brand" href="#" onClick={e => { e.preventDefault(); home() }} aria-label="FindWise 시작 위치"><Mountain size={30} strokeWidth={1.5} /><strong>FindWise</strong></a>
      <div className="project-title"><Folder size={19} /><span>{region.shortName} 수색 작업 공간</span><span className="badge">개발 미리보기</span></div>
      <button className="region-button" onClick={() => togglePanel('sources')}><MapPin size={15} /><span>{region.name}</span><ChevronDown size={14} /></button>
      <span className="connection" role="status"><i className={dotClass} />{connectionLabels[status]}</span>
    </header>
    <nav className="rail" aria-label="작업 메뉴">
      <button aria-label="확인 위치" title="확인 위치" aria-pressed={panel === 'modules'} className={panel === 'modules' ? 'active' : ''} onClick={() => togglePanel('modules')}><MapPin size={22} /><span className="rail-label">확인 위치</span></button>
      <button aria-label="분석 결과" title="분석 결과" aria-pressed={panel === 'results'} className={panel === 'results' ? 'active' : ''} onClick={() => togglePanel('results')}><MapIcon size={22} /><span className="rail-label">분석 결과</span></button>
      <button aria-label="통행 설정" title="통행 설정" aria-pressed={terrainOpen} className={terrainOpen ? 'active' : ''} onClick={() => terrainOpen ? setTerrainOpen(false) : openTerrain()}><Layers size={22} /><span className="rail-label">통행 설정</span></button>
      <button aria-label="수정 이력" title="수정 이력" aria-pressed={panel === 'history'} className={panel === 'history' ? 'active' : ''} onClick={() => togglePanel('history')}><History size={22} /><span className="rail-label">수정 이력</span></button>
      <button className="rail-settings" aria-label="자료·설정" title="자료·설정" aria-pressed={panel === 'sources'} onClick={() => togglePanel('sources')}><SlidersHorizontal size={22} /><span className="rail-label">자료·설정</span></button>
      <button className="rail-reset" title="지도 표시 초기화" aria-label="지도 표시 초기화" onClick={() => { setSettings(defaults); home() }}><RotateCcw size={19} /></button>
    </nav>
    <main className={`map-area ${settings.base === 'satellite' ? 'satellite-mode' : ''}`}>
      <MapView key={reload} settings={settings} onReady={onReady} onStatus={dispatchStatus} onZoom={setZoom} distanceRun={distanceRun} timeline={timeline} timelineStep={timelineStep} picking={picking} onPick={chooseLocation} casePoint={pendingLocation ?? caseInput.start} pointPending={Boolean(pendingLocation)} onPointInfo={inspectPoint} />
      <div className="map-toolbar">
        <div className="base-switch" aria-label="배경지도 선택">
          <button aria-pressed={settings.base === 'base'} className={settings.base === 'base' ? 'selected' : ''} onClick={() => setSettings(s => ({ ...s, base: 'base' }))}><MapIcon size={17} />기본</button>
          <button aria-pressed={settings.base === 'satellite'} className={settings.base === 'satellite' ? 'selected' : ''} onClick={() => setSettings(s => ({ ...s, base: 'satellite' }))}><Satellite size={17} />위성</button>
        </div>
        <div className="layer-control">
          <button className="layer-trigger" aria-expanded={layersOpen} aria-controls="layer-menu" onClick={() => setLayersOpen(!layersOpen)}><Layers size={18} />레이어<span className="count">{['contours','hillshade','area','grid','trail','road','river','water','access','heatmap'].filter(key => settings[key as keyof typeof settings] === true).length}</span>{layersOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</button>
          <section id="layer-menu" className="layer-menu" aria-label="지도 레이어" hidden={!layersOpen} inert={!layersOpen}>
            <div className="section-label">지형 레이어</div>
            {([{ key: 'contours', label: '등고선', detail: `${interval}m 간격 · 확대 수준에 따라 변경` }, { key: 'hillshade', label: '음영기복', detail: '능선과 계곡의 입체적인 형태' }] as const).map(({ key, label, detail }) => <label className="layer-row" key={key}><input type="checkbox" checked={settings[key]} onChange={e => setSettings(s => ({ ...s, [key]: e.target.checked }))} /><span className="checkbox"><Check size={13} /></span><span><b>{label}</b><small>{detail}</small></span></label>)}
            <div className="opacity-control"><label htmlFor="opacity">등고선 선명도<span>{settings.opacity}%</span></label><input id="opacity" type="range" min="0" max="100" value={settings.opacity} disabled={!settings.contours} onChange={e => setSettings(s => ({ ...s, opacity: Number(e.target.value) }))} /></div>
            <div className="section-label separator">분석 기반</div>
            {([{ key: 'area', label: '분석 범위', detail: `${areaSize} · 개발용 영역` }, { key: 'grid', label: `${cellSize} 격자선`, detail: zoom < gridMinZoom ? `확대 수준 ${gridMinZoom} 이상에서 표시` : '화면에 보이는 구간만 표시' }] as const).map(({ key, label, detail }) => <label className="layer-row" key={key}><input type="checkbox" checked={settings[key]} onChange={e => setSettings(s => ({ ...s, [key]: e.target.checked }))} /><span className="checkbox"><Check size={13} /></span><span><b>{label}</b><small>{detail}</small></span></label>)}
            <button className="grid-action" onClick={inspectGrid}>격자 확인을 위해 확대 <ArrowUpRight size={13} /></button>
            <div className="section-label separator">지형 자료 <span className="terrain-load-state">{terrain.status === 'loading' ? '불러오는 중' : terrain.status === 'error' ? '연결 확인 필요' : '준비됨'}</span></div>
            {([{ key: 'trail', label: '등산로' }, { key: 'road', label: '도로' }, { key: 'river', label: '하천' }, { key: 'water', label: '호수·수역' }] as const).map(({ key, label }) => <label className="layer-row" key={key}>
              <input type="checkbox" checked={settings[key]} onChange={event => setSettings(previous => ({ ...previous, [key]: event.target.checked }))} />
              <span className="checkbox"><Check size={13} /></span><span><b>{label}</b></span>
            </label>)}
            {terrain.status === 'error' && <button className="secondary-action" onClick={terrain.retry}>지형 다시 불러오기</button>}
            {([{ key: 'access', label: '통행 상태 표시' }, { key: 'heatmap', label: '히트맵 표시' }] as const).map(({ key, label }) => <label className="layer-row" key={key}>
              <input type="checkbox" checked={settings[key]} onChange={event => setSettings(previous => ({ ...previous, [key]: event.target.checked }))} />
              <span className="checkbox"><Check size={13} /></span><span><b>{label}</b></span>
            </label>)}
            <p className="layer-footnote">표시를 꺼도 분석에 적용한 이동 조건은 유지됩니다.</p>
          </section>
        </div>
      </div>
      {picking && <div className="distance-prompt">
        <span role="status">{distanceMessage || '마지막 확인 위치를 클릭하세요. 위치를 확인한 뒤 설정합니다.'}</span>
        <button onClick={cancelPicking}>취소</button>
      </div>}
      {pointOpen && (pendingLocation || caseInput.start) && <PointInfo
        point={(pendingLocation ?? caseInput.start)!} pending={Boolean(pendingLocation)}
        lastSeenUtc={caseInput.lastSeenUtc} terrain={terrain.document}
        resultLabel={resultNotice ? '입력·설정 변경 · 결과 확인 필요' : timeline ? timeline.synthetic ? '합성 예제 표시 중' : '시간별 결과 표시 중' : distanceRun ? '거리 기준 결과 표시 중' : '분석 전'}
        onClose={() => setPointOpen(false)} onConfirm={confirmLocation}
        onEdit={() => { setPointOpen(false); setPanel('modules') }} onPick={pickLocation} />}
      {hasResult && <div className={resultNotice ? 'result-state needs-review' : 'result-state'} role="status">
        <span>{resultNotice || (timeline ? timeline.synthetic ? '합성 예제 · 화면 확인용' : '시간별 위치 확률 결과' : '거리 기준 결과 · 지형·시간 이동 미반영')}</span>
        {resultNotice && <button onClick={() => { setTerrainOpen(false); setPanel('modules') }}>분석 설정 확인</button>}
      </div>}
      {failed && <div className="error-banner" role="alert"><Info size={17} /><span>{errorMessages[status]}</span><button onClick={() => { dispatchStatus('retry'); setZoom(region.zoom); setReload(n => n + 1) }}>다시 시도</button></div>}
      <div className="map-tools"><button title="북쪽 정렬" aria-label="북쪽 정렬" onClick={() => map.current?.resetNorth()}><ArrowUp size={19} /><small>N</small></button><div className="zoom-buttons"><button title="확대" aria-label="확대" onClick={() => map.current?.zoomIn()}><Plus size={22} /></button><button title="축소" aria-label="축소" onClick={() => map.current?.zoomOut()}><Minus size={22} /></button></div><button title={`${region.shortName} 시작 위치로 돌아가기`} aria-label={`${region.shortName} 시작 위치로 돌아가기`} onClick={home}><LocateFixed size={21} /></button></div>
      <section className="legend"><button className="legend-title" aria-expanded={legendOpen} aria-controls="legend-content" onClick={() => setLegendOpen(!legendOpen)}><SlidersHorizontal size={15} />지도 범례{legendOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}</button><div id="legend-content" className="legend-content" hidden={!legendOpen} inert={!legendOpen}>{settings.contours && <span><i className="line-sample" />등고선 · {interval}m</span>}{settings.hillshade && <span><i className="shade-sample" />음영기복</span>}{settings.area && <span><i className="area-sample" />분석 범위 · {areaSize}</span>}{settings.grid && <span><i className="grid-sample" />{cellSize} 격자 {zoom < gridMinZoom ? '· 확대 시 표시' : ''}</span>}{distanceRun && settings.heatmap && <div className="distance-legend"><b>거리 기준 순위</b>{distanceBands.map(({ color, label }) => <span key={label}><i style={{ backgroundColor: `rgb(${color.slice(0, 3).join(' ')})` }} />{label}</span>)}</div>}{timeline && settings.heatmap && <div className="time-scale"><b>셀 확률 · 시점 공통</b><i /><span>0% – {(timeline.maxMass * 100).toPrecision(3)}%</span></div>}{!settings.contours && !settings.hillshade && !settings.area && !settings.grid && !(hasResult && settings.heatmap) && !settings.trail && !settings.road && !settings.river && !settings.water && !settings.access && <span>배경지도만 표시 중</span>}{settings.trail && <span><i className="trail-sample" />등산로</span>}{settings.road && <span><i className="road-sample" />도로</span>}{settings.river && <span><i className="river-sample" />하천</span>}{settings.water && <span><i className="water-sample" />호수·수역</span>}{settings.access && <span>사선 · 통행 불가 / 점선 · 확인 필요</span>}<small>표시 레이어 · 통행 조건은 지형 편집에서 변경</small></div></section>
      {timeline && frame && settings.heatmap && <section className="time-slider" aria-label="시간별 모델 결과">
        <div><strong>{elapsed} 후</strong><time>{new Date(timeline.lastSeenMs + frame.elapsed_seconds * 1000).toLocaleString('ko-KR')}</time></div>
        <input aria-label="계산된 시점" aria-valuetext={elapsed} type="range" min="0" max={timeline.frames.length - 1}
          value={timelineStep} onChange={event => setTimelineStep(Number(event.target.value))} />
        <small>{timeline.label} · {timelineStep + 1}/{timeline.frames.length} 시점</small>
      </section>}
      <div className="map-status"><span className={`status-dot ${dotClass}`} />{settings.base === 'base' ? '기본 지도' : '위성 영상'}<span>2D</span><span>ZOOM {zoom.toFixed(1)}</span></div>
    </main>
    <TerrainPanel map={mapInstance} open={terrainOpen} onOpen={openTerrain} onClose={() => setTerrainOpen(false)} picking={picking} layers={terrainLayers} terrain={terrain} />
    {panel && <aside className="detail-panel"><header><span className="accent-mark" /><h2>{{ sources: '자료·설정', modules: '마지막 확인 정보', results: '분석 결과', history: '수정 이력' }[panel]}</h2><button aria-label="상세 패널 닫기" onClick={() => setPanel(null)}><X size={20} /></button></header>
      {panel === 'modules' && <>
        {caseSaveError && <p role="alert">{caseSaveError}</p>}
        <DistancePanel input={caseInput} hasPending={Boolean(pendingLocation)} onInfo={inspectPoint}
          onTime={lastSeenUtc => updateCase({ ...caseInput, lastSeenUtc })}
          onRun={runDistance} onPick={pickLocation} message={distanceMessage} />
      </>}
      {panel === 'results' && <section className="results-panel">
        {hasResult ? <>
          <span className="method-chip">{timeline ? timeline.synthetic ? '동작 확인용 예제' : '시간별 모델 결과' : '거리 기준'}</span>
          <h3>{timeline ? '시간을 옮겨 비교하세요' : '거리 순위가 표시됐습니다'}</h3>
          {resultNotice && <p className="save-warning">{resultNotice}</p>}
          <p>{caseInput.lastSeenUtc && new Date(caseInput.lastSeenUtc).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })} 확인 정보 기준</p>
          <div className="compact-actions"><button className="secondary-action" onClick={inspectPoint}>기준 지점 정보</button>
            <button className="secondary-action" onClick={() => { clearDistance(); clearTimeline() }}>결과 닫기</button></div>
          <details><summary>계산 방식 확인</summary><p>{timeline ? '불러온 시점별 셀 값을 공통 색상 척도로 표시합니다.' : '시작점에 가까운 셀부터 순위를 표시합니다. 지형·시간에 따른 이동은 반영하지 않습니다.'}</p></details>
          {distanceRun && <button className="secondary-action" onClick={runDistance}>다시 계산</button>}
        </> : <>
          <h3>아직 분석 결과가 없습니다</h3>
          <p>마지막 확인 위치와 시각을 정하면 분석할 수 있습니다.</p>
          <button className="primary-action" onClick={() => setPanel('modules')}>확인 정보 입력</button>
        </>}
        <div className="example-action">
          <button className="secondary-action" disabled={!readyCase(caseInput, analysisGrid)} onClick={() => {
            if (caseInput.start) showTimeline(demoTimeline(analysisGrid, caseInput.start, Date.parse(caseInput.lastSeenUtc)))
          }}>시간 변화 예제 보기</button>
          <span className="field-help">합성 자료로 화면 동작 확인</span>
        </div>
      </section>}
      {panel === 'sources' && <section className="workspace-settings">
        <div className="settings-section"><h3>좌표로 위치 지정</h3><CoordinateEntry point={caseInput.start} onSelect={chooseLocation} /></div>
        <div className="settings-section"><h3>모델 결과 가져오기</h3>
          <label className="file-picker">결과 파일 선택<input aria-label="모델 결과 가져오기" type="file" accept=".json,application/json" onChange={event => {
            const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void loadTimeline(file)
          }} /></label>
          {timelineError && <p role="alert">{timelineError}</p>}
          {distanceRun && <button className="secondary-action" onClick={exportDistance}>현재 실행 조건 저장</button>}
        </div>
        <details><summary>작업 지역·격자</summary><p>{region.name} · {areaSize}</p><p>{cellSize} 격자 · {gridDefinition.crs}</p>
          <button className="secondary-action" onClick={showArea}>분석 범위 보기</button><button className="secondary-action" onClick={exportGrid}>격자 정의 저장</button></details>
        <details><summary>자료 출처</summary>
          {[{ label: '기본 지도 · OpenStreetMap', href: 'https://www.openstreetmap.org/copyright' },
            { label: '위성 영상 · Esri', href: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer' },
            { label: '고도 타일 · Mapzen / AWS', href: 'https://registry.opendata.aws/terrain-tiles/' }].map(source => <a className="source-card" key={source.label} href={source.href} target="_blank" rel="noreferrer">{source.label}</a>)}
        </details>
      </section>}
      {panel === 'history' && <>
        <p className="panel-intro">현재 적용 이력 · {terrain.document ? terrain.saveLabel : '자료 준비 중'}</p>
        {terrain.document?.changes.length ? <>
          <button className="secondary-action" onClick={() => openTerrain()}>지형 편집·되돌리기</button>
          <ol className="change-history">{terrain.document.changes.slice().reverse().map((change, index) => <li key={index}>
            <strong>{change.feature?.properties.name ?? '자료 기준 복원'}</strong>
            <span>{change.reason} · {new Date(change.at).toLocaleString('ko-KR')}</span>
          </li>)}</ol>
        </> : <p>아직 적용한 지형 변경이 없습니다.</p>}
      </>}
    </aside>}
  </div>
}
export default App
