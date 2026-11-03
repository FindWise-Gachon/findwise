import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { Map as MapInstance } from 'maplibre-gl'
import { Mountain, Folder, Layers, Network, FileText, History, Map as MapIcon, Satellite, ChevronDown, ChevronUp, X, Plus, Minus, LocateFixed, ArrowUpRight, Info, SlidersHorizontal, RotateCcw, Check, MapPin, ArrowUp } from 'lucide-react'
import { DistancePanel } from './map/DistancePanel'
import { distanceBands, distanceModelVersion, rankByDistance, type DistanceRun } from './map/distance'
import { MapView } from './map/MapView'
import { analysisGrid, defaults, readSettings, region } from './map/config'
import { boundary, gridManifest, gridMinZoom, projectedToCell, toLngLat, toProjected } from './map/grid'
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

type Panel = 'region' | 'sources' | 'modules' | 'history' | null
function App() {
  const [settings, setSettings] = useState(readSettings)
  const [layersOpen, setLayersOpen] = useState(true)
  const [legendOpen, setLegendOpen] = useState(true)
  const [panel, setPanel] = useState<Panel>(null)
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
  const map = useRef<MapInstance | null>(null)
  const onReady = useCallback((value: MapInstance | null) => { map.current = value }, [])
  useEffect(() => { try { localStorage.setItem('findwise.map.v1', JSON.stringify(settings)) } catch { /* Browser storage is optional. */ } }, [settings])
  useEffect(() => { const close = (e: KeyboardEvent) => { if (e.key === 'Escape') { setPanel(null); setLayersOpen(false); setPicking(false); setDistanceMessage('') } }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close) }, [])
  const togglePanel = (value: Panel) => setPanel(previous => previous === value ? null : value)
  const home = () => map.current?.flyTo({ center: region.center, zoom: region.zoom, bearing: 0, pitch: 0, essential: true })
  const showArea = () => {
    setSettings(s => ({ ...s, area: true }))
    const ring = boundary(analysisGrid).geometry.coordinates[0]
    map.current?.fitBounds([[Math.min(...ring.map(p => p[0])), Math.min(...ring.map(p => p[1]))], [Math.max(...ring.map(p => p[0])), Math.max(...ring.map(p => p[1]))]], { padding: 60, duration: 800 })
  }
  const inspectGrid = () => { setSettings(s => ({ ...s, area: true, grid: true })); map.current?.flyTo({ center: gridCenter, zoom: gridMinZoom + .8, bearing: 0, pitch: 0, essential: true }) }
  const exportGrid = () => downloadJson(`${analysisGrid.id}.json`, gridDefinition)
  const runDistance = useCallback((start: [number, number]) => {
    const projected = toProjected(analysisGrid, start)
    if (!projectedToCell(analysisGrid, ...projected)) {
      setDistanceMessage('개발 격자 안에서 시작점을 선택해 주세요.')
      return
    }
    timelineLoad.current++
    setTimeline(null)
    setTimelineError('')
    setDistanceRun({ start, order: rankByDistance(analysisGrid, projected) })
    setDistanceMessage('')
    setPicking(false)
    setPanel('modules')
  }, [])
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
    setTimeline(next)
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
      result: 'ascending projected distance to cell center',
      tie_break: 'row-major cell index',
    })
  }
  const interval = zoom >= 14 ? 20 : zoom >= 12 ? 50 : 100
  const failed = status === 'data-error' || status === 'startup-error'
  const dotClass = failed ? 'warning-dot' : status === 'loading' ? 'loading-dot' : ''
  return <div className="workspace">
    <header className="topbar">
      <a className="brand" href="#" onClick={e => { e.preventDefault(); home() }} aria-label="FindWise 시작 위치"><Mountain size={30} strokeWidth={1.5} /><strong>FindWise</strong></a>
      <div className="project-title"><Folder size={19} /><span>{region.shortName} 수색 작업 공간</span><span className="badge">개발 미리보기</span></div>
      <button className="region-button" onClick={() => togglePanel('region')}><MapPin size={15} /><span>{region.name}</span><ChevronDown size={14} /></button>
      <span className="connection" role="status"><i className={dotClass} />{connectionLabels[status]}</span>
    </header>
    <nav className="rail" aria-label="작업 메뉴">
      {([{ id: 'region', icon: Folder, label: '지역 정보' }, { id: 'sources', icon: FileText, label: '데이터 출처' }, { id: 'modules', icon: Network, label: '분석 모듈' }, { id: 'history', icon: History, label: '작업 이력' }] as const).map(({ id, icon: Icon, label }) => <button key={id} title={label} aria-label={label} aria-pressed={panel === id} className={panel === id ? 'active' : ''} onClick={() => togglePanel(id)}><Icon size={21} strokeWidth={1.6} /><span className="nav-tooltip">{label}</span></button>)}
      <button className="rail-bottom" title="지도 표시 초기화" aria-label="지도 표시 초기화" onClick={() => { setSettings(defaults); clearDistance(); clearTimeline(); setPicking(false); home() }}><RotateCcw size={19} /></button>
    </nav>
    <main className={`map-area ${settings.base === 'satellite' ? 'satellite-mode' : ''}`}>
      <MapView key={reload} settings={settings} onReady={onReady} onStatus={dispatchStatus} onZoom={setZoom} distanceRun={distanceRun} timeline={timeline} timelineStep={timelineStep} picking={picking} onPick={runDistance} />
      <div className="map-toolbar">
        <div className="base-switch" aria-label="배경지도 선택">
          <button aria-pressed={settings.base === 'base'} className={settings.base === 'base' ? 'selected' : ''} onClick={() => setSettings(s => ({ ...s, base: 'base' }))}><MapIcon size={17} />기본</button>
          <button aria-pressed={settings.base === 'satellite'} className={settings.base === 'satellite' ? 'selected' : ''} onClick={() => setSettings(s => ({ ...s, base: 'satellite' }))}><Satellite size={17} />위성</button>
        </div>
        <div className="layer-control">
          <button className="layer-trigger" aria-expanded={layersOpen} aria-controls="layer-menu" onClick={() => setLayersOpen(!layersOpen)}><Layers size={18} />레이어<span className="count">{Number(settings.contours) + Number(settings.hillshade) + Number(settings.area) + Number(settings.grid)}</span>{layersOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</button>
          <section id="layer-menu" className="layer-menu" aria-label="지도 레이어" hidden={!layersOpen} inert={!layersOpen}>
            <div className="section-label">지형 레이어</div>
            {([{ key: 'contours', label: '등고선', detail: `${interval}m 간격 · 확대 수준에 따라 변경` }, { key: 'hillshade', label: '음영기복', detail: '능선과 계곡의 입체적인 형태' }] as const).map(({ key, label, detail }) => <label className="layer-row" key={key}><input type="checkbox" checked={settings[key]} onChange={e => setSettings(s => ({ ...s, [key]: e.target.checked }))} /><span className="checkbox"><Check size={13} /></span><span><b>{label}</b><small>{detail}</small></span></label>)}
            <div className="opacity-control"><label htmlFor="opacity">등고선 선명도<span>{settings.opacity}%</span></label><input id="opacity" type="range" min="0" max="100" value={settings.opacity} disabled={!settings.contours} onChange={e => setSettings(s => ({ ...s, opacity: Number(e.target.value) }))} /></div>
            <div className="section-label separator">분석 기반</div>
            {([{ key: 'area', label: '분석 범위', detail: `${areaSize} · 개발용 영역` }, { key: 'grid', label: `${cellSize} 격자선`, detail: zoom < gridMinZoom ? `확대 수준 ${gridMinZoom} 이상에서 표시` : '화면에 보이는 구간만 표시' }] as const).map(({ key, label, detail }) => <label className="layer-row" key={key}><input type="checkbox" checked={settings[key]} onChange={e => setSettings(s => ({ ...s, [key]: e.target.checked }))} /><span className="checkbox"><Check size={13} /></span><span><b>{label}</b><small>{detail}</small></span></label>)}
            <button className="grid-action" onClick={inspectGrid}>격자 확인을 위해 확대 <ArrowUpRight size={13} /></button>
            <div className="section-label separator">추가 예정</div>
            <div className="unavailable"><span>등산로 · 하천</span><small>독립 자료 연결 전</small></div>
            <p className="layer-footnote">기본 지도에 포함된 길과 하천은 배경과 함께 표시됩니다.</p>
          </section>
        </div>
      </div>
      <div className="place-label"><span>EXPLORING</span><h1>{region.placeName}</h1><p>지형을 살피고, 수색의 기반을 준비합니다.</p></div>
      {picking && <div className="distance-prompt">
        <span role="status">{distanceMessage || '분석 범위 안에서 시작점을 선택하세요.'}</span>
        <button onClick={cancelPicking}>취소</button>
      </div>}
      {failed && <div className="error-banner" role="alert"><Info size={17} /><span>{errorMessages[status]}</span><button onClick={() => { dispatchStatus('retry'); setZoom(region.zoom); setReload(n => n + 1) }}>다시 시도</button></div>}
      <div className="map-tools"><button title="북쪽 정렬" aria-label="북쪽 정렬" onClick={() => map.current?.resetNorth()}><ArrowUp size={19} /><small>N</small></button><div className="zoom-buttons"><button title="확대" aria-label="확대" onClick={() => map.current?.zoomIn()}><Plus size={22} /></button><button title="축소" aria-label="축소" onClick={() => map.current?.zoomOut()}><Minus size={22} /></button></div><button title={`${region.shortName} 시작 위치로 돌아가기`} aria-label={`${region.shortName} 시작 위치로 돌아가기`} onClick={home}><LocateFixed size={21} /></button></div>
      <section className="legend"><button className="legend-title" aria-expanded={legendOpen} aria-controls="legend-content" onClick={() => setLegendOpen(!legendOpen)}><SlidersHorizontal size={15} />지도 범례{legendOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}</button><div id="legend-content" className="legend-content" hidden={!legendOpen} inert={!legendOpen}>{settings.contours && <span><i className="line-sample" />등고선 · {interval}m</span>}{settings.hillshade && <span><i className="shade-sample" />음영기복</span>}{settings.area && <span><i className="area-sample" />분석 범위 · {areaSize}</span>}{settings.grid && <span><i className="grid-sample" />{cellSize} 격자 {zoom < gridMinZoom ? '· 확대 시 표시' : ''}</span>}{distanceRun && <div className="distance-legend"><b>거리 기준 순위</b>{distanceBands.map(({ color, label }) => <span key={label}><i style={{ backgroundColor: `rgb(${color.slice(0, 3).join(' ')})` }} />{label}</span>)}</div>}{timeline && <div className="time-scale"><b>셀 확률 · 시점 공통</b><i /><span>0% – {(timeline.maxMass * 100).toPrecision(3)}%</span></div>}{!settings.contours && !settings.hillshade && !settings.area && !settings.grid && !distanceRun && !timeline && <span>배경지도만 표시 중</span>}<small>지형 표시용 자료 · 분석 격자와 별도</small></div></section>
      {timeline && frame && <section className="time-slider" aria-label="시간별 모델 결과">
        <div><strong>{elapsed} 후</strong><time>{new Date(timeline.lastSeenMs + frame.elapsed_seconds * 1000).toLocaleString('ko-KR')}</time></div>
        <input aria-label="계산된 시점" aria-valuetext={elapsed} type="range" min="0" max={timeline.frames.length - 1}
          value={timelineStep} onChange={event => setTimelineStep(Number(event.target.value))} />
        <small>{timeline.label} · {timelineStep + 1}/{timeline.frames.length} 시점</small>
      </section>}
      <div className="map-status"><span className={`status-dot ${dotClass}`} />{settings.base === 'base' ? '기본 지도' : '위성 영상'}<span>2D</span><span>ZOOM {zoom.toFixed(1)}</span></div>
    </main>
    {panel && <aside className="detail-panel"><header><span className="accent-mark" /><h2>{{ region: '지역 정보', sources: '데이터 출처', modules: '분석 모듈', history: '작업 이력' }[panel]}</h2><button aria-label="상세 패널 닫기" onClick={() => setPanel(null)}><X size={20} /></button></header>
      {panel === 'region' && <><div className="panel-kicker">CURRENT WORKSPACE</div><h3>{region.name}</h3><p>{region.placeName}, {region.placeContext}</p><dl><div><dt>작업 단계</dt><dd>지도 기반 구축</dd></div><div><dt>지역</dt><dd>{region.location}</dd></div><div><dt>지도 표시</dt><dd>2D / 웹 메르카토르</dd></div><div><dt>분석 범위</dt><dd>{areaSize} · 개발용</dd></div><div><dt>분석 격자</dt><dd>{cellSize} × {cellSize}</dd></div><div><dt>전체 칸 수</dt><dd>{gridDefinition.cell_count.toLocaleString('ko-KR')}</dd></div><div><dt>계산 좌표계</dt><dd>{gridDefinition.crs} · 미터</dd></div></dl><div className="info-note"><Info size={17} /><p>{cellSize} 격자는 위치와 범위를 정의합니다. 표시용 고도 타일의 해상도는 격자 간격과 별개입니다.</p></div><button className="outline-action" onClick={showArea}><LocateFixed size={16} />분석 범위 보기</button><button className="secondary-action" onClick={exportGrid}>격자 정의 내려받기 · JSON</button></>}
      {panel === 'sources' && <><p className="panel-intro">현재 화면에 사용하는 공개 지도 서비스입니다.</p>{[{ title: '기본 지도', provider: 'OpenStreetMap', detail: '도로·지명 등 기본 정보', href: 'https://www.openstreetmap.org/copyright' }, { title: '위성 영상', provider: 'Esri World Imagery', detail: '촬영 시점은 지역에 따라 다릅니다.', href: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer' }, { title: '등고선 · 음영기복', provider: 'Mapzen / AWS Terrain Tiles', detail: '고도 타일에서 등고선을 생성합니다. 원본 해상도는 지역마다 다릅니다.', href: 'https://registry.opendata.aws/terrain-tiles/' }].map(s => <a className="source-card" key={s.title} href={s.href} target="_blank" rel="noreferrer"><span>{s.title}<ArrowUpRight size={16} /></span><b>{s.provider}</b><small>{s.detail}</small></a>)}</>}
      {panel === 'modules' && <>
        <section className="timeline-panel">
          <h3>시간별 히트맵</h3>
          <label>모델 결과 JSON <input type="file" accept=".json,application/json" onChange={event => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (file) void loadTimeline(file)
          }} /></label>
          <button className="secondary-action" onClick={() => showTimeline(demoTimeline(analysisGrid))}>합성 예제 보기</button>
          {timelineError && <p role="alert">{timelineError}</p>}
          {timeline && <>
            <p>마지막 확인 시각 {new Date(timeline.lastSeenMs).toLocaleString('ko-KR')}<br />
              LKP 위도 {timeline.start[1].toFixed(5)} · 경도 {timeline.start[0].toFixed(5)}</p>
            <button className="secondary-action" onClick={clearTimeline}>시간별 결과 지우기</button>
          </>}
        </section>
        <DistancePanel run={distanceRun} message={distanceMessage} onRun={runDistance} onPick={() => { setDistanceMessage(''); setPanel(null); setPicking(true); showArea() }} onClear={clearDistance} onExport={exportDistance} />
      </>}
      {panel === 'history' && <div className="empty-state"><History size={32} /><h3>아직 변경 이력이 없어요</h3><p>향후 승인된 현장 보고와 분석 지도 변경을 이곳에서 확인할 수 있습니다.</p></div>}
      <footer className="panel-footer"><Mountain size={16} /> FindWise <span>확장성과 직관성</span></footer>
    </aside>}
  </div>
}
export default App
