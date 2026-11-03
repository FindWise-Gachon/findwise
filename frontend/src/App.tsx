import { useCallback, useEffect, useRef, useState } from 'react'
import type { Map as MapInstance } from 'maplibre-gl'
import { Mountain, Folder, Layers, Network, FileText, History, Map as MapIcon, Satellite, ChevronDown, ChevronUp, X, Plus, Minus, LocateFixed, ArrowUpRight, Info, SlidersHorizontal, RotateCcw, Check, MapPin, ArrowUp } from 'lucide-react'
import { MapView } from './map/MapView'
import { defaults, readSettings, region } from './map/config'
import './App.css'

type Panel = 'region' | 'sources' | 'modules' | 'history' | null
function App() {
  const [settings, setSettings] = useState(readSettings)
  const [layersOpen, setLayersOpen] = useState(true)
  const [legendOpen, setLegendOpen] = useState(true)
  const [panel, setPanel] = useState<Panel>(null)
  const [status, setStatus] = useState('지형 자료 연결 중…')
  const [zoom, setZoom] = useState(region.zoom)
  const [reload, setReload] = useState(0)
  const map = useRef<MapInstance | null>(null)
  const onReady = useCallback((value: MapInstance | null) => { map.current = value }, [])
  useEffect(() => { try { localStorage.setItem('findwise.map.v1', JSON.stringify(settings)) } catch { /* Browser storage is optional. */ } }, [settings])
  useEffect(() => { const close = (e: KeyboardEvent) => { if (e.key === 'Escape') { setPanel(null); setLayersOpen(false) } }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close) }, [])
  const togglePanel = (value: Panel) => setPanel(previous => previous === value ? null : value)
  const home = () => map.current?.flyTo({ center: region.center, zoom: region.zoom, bearing: 0, pitch: 0, essential: true })
  const interval = zoom >= 14 ? 20 : zoom >= 12 ? 50 : 100
  const failed = status.includes('못')
  return <div className="workspace">
    <header className="topbar">
      <a className="brand" href="#" onClick={e => { e.preventDefault(); home() }} aria-label="FindWise 시작 위치"><Mountain size={30} strokeWidth={1.5} /><strong>FindWise</strong></a>
      <div className="project-title"><Folder size={19} /><span>요세미티 수색 작업 공간</span><span className="badge">개발 미리보기</span></div>
      <button className="region-button" onClick={() => togglePanel('region')}><MapPin size={15} /><span>{region.name}</span><ChevronDown size={14} /></button>
      <span className="connection"><i className={failed ? 'warning-dot' : ''} />{failed ? '연결 확인 필요' : status === '지도 연결됨' ? '지도 연결됨' : '자료 연결 중'}</span>
    </header>
    <nav className="rail" aria-label="작업 메뉴">
      {([{ id: 'region', icon: Folder, label: '지역 정보' }, { id: 'sources', icon: FileText, label: '데이터 출처' }, { id: 'modules', icon: Network, label: '분석 모듈' }, { id: 'history', icon: History, label: '작업 이력' }] as const).map(({ id, icon: Icon, label }) => <button key={id} title={label} aria-label={label} aria-pressed={panel === id} className={panel === id ? 'active' : ''} onClick={() => togglePanel(id)}><Icon size={21} strokeWidth={1.6} /><span className="nav-tooltip">{label}</span></button>)}
      <button className="rail-bottom" title="지도 표시 초기화" aria-label="지도 표시 초기화" onClick={() => { setSettings(defaults); home() }}><RotateCcw size={19} /></button>
    </nav>
    <main className={`map-area ${settings.base === 'satellite' ? 'satellite-mode' : ''}`}>
      <MapView key={reload} settings={settings} onReady={onReady} onStatus={setStatus} onZoom={setZoom} />
      <div className="map-toolbar">
        <div className="base-switch" aria-label="배경지도 선택">
          <button aria-pressed={settings.base === 'base'} className={settings.base === 'base' ? 'selected' : ''} onClick={() => setSettings(s => ({ ...s, base: 'base' }))}><MapIcon size={17} />기본</button>
          <button aria-pressed={settings.base === 'satellite'} className={settings.base === 'satellite' ? 'selected' : ''} onClick={() => setSettings(s => ({ ...s, base: 'satellite' }))}><Satellite size={17} />위성</button>
        </div>
        <div className="layer-control">
          <button className="layer-trigger" aria-expanded={layersOpen} aria-controls="layer-menu" onClick={() => setLayersOpen(!layersOpen)}><Layers size={18} />레이어<span className="count">{Number(settings.contours) + Number(settings.hillshade)}</span>{layersOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</button>
          {layersOpen && <section id="layer-menu" className="layer-menu" aria-label="지도 레이어">
            <div className="section-label">지형 레이어</div>
            {([{ key: 'contours', label: '등고선', detail: `${interval}m 간격 · 확대 수준에 따라 변경` }, { key: 'hillshade', label: '음영기복', detail: '능선과 계곡의 입체적인 형태' }] as const).map(({ key, label, detail }) => <label className="layer-row" key={key}><input type="checkbox" checked={settings[key]} onChange={e => setSettings(s => ({ ...s, [key]: e.target.checked }))} /><span className="checkbox"><Check size={13} /></span><span><b>{label}</b><small>{detail}</small></span></label>)}
            <div className="opacity-control"><label htmlFor="opacity">등고선 선명도<span>{settings.opacity}%</span></label><input id="opacity" type="range" min="0" max="100" value={settings.opacity} disabled={!settings.contours} onChange={e => setSettings(s => ({ ...s, opacity: Number(e.target.value) }))} /></div>
            <div className="section-label separator">추가 예정</div>
            <div className="unavailable"><span>등산로 · 하천</span><small>독립 자료 연결 전</small></div>
            <div className="unavailable"><span>수색 우선도</span><small>분석 모델 연결 전</small></div>
            <p className="layer-footnote">기본 지도에 포함된 길과 하천은 배경과 함께 표시됩니다.</p>
          </section>}
        </div>
      </div>
      <div className="place-label"><span>EXPLORING</span><h1>Yosemite Valley</h1><p>지형을 살피고, 수색의 기반을 준비합니다.</p></div>
      {failed && <div className="error-banner" role="alert"><Info size={17} /><span>{status}</span><button onClick={() => { setStatus('지형 자료 연결 중…'); setReload(n => n + 1) }}>다시 시도</button></div>}
      <div className="map-tools"><button title="북쪽 정렬" aria-label="북쪽 정렬" onClick={() => map.current?.resetNorth()}><ArrowUp size={19} /><small>N</small></button><div className="zoom-buttons"><button title="확대" aria-label="확대" onClick={() => map.current?.zoomIn()}><Plus size={22} /></button><button title="축소" aria-label="축소" onClick={() => map.current?.zoomOut()}><Minus size={22} /></button></div><button title="요세미티로 돌아가기" aria-label="요세미티로 돌아가기" onClick={home}><LocateFixed size={21} /></button></div>
      <section className="legend"><button className="legend-title" aria-expanded={legendOpen} onClick={() => setLegendOpen(!legendOpen)}><SlidersHorizontal size={15} />지도 범례{legendOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}</button>{legendOpen && <div className="legend-content">{settings.contours && <span><i className="line-sample" />등고선 · {interval}m</span>}{settings.hillshade && <span><i className="shade-sample" />음영기복</span>}{!settings.contours && !settings.hillshade && <span>배경지도만 표시 중</span>}<small>지형 표시용 자료 · 분석 격자와 별도</small></div>}</section>
      <div className="map-status"><span className="status-dot" />{settings.base === 'base' ? '기본 지도' : '위성 영상'}<span>2D</span><span>ZOOM {zoom.toFixed(1)}</span></div>
    </main>
    {panel && <aside className="detail-panel"><header><span className="accent-mark" /><h2>{{ region: '지역 정보', sources: '데이터 출처', modules: '분석 모듈', history: '작업 이력' }[panel]}</h2><button aria-label="상세 패널 닫기" onClick={() => setPanel(null)}><X size={20} /></button></header>
      {panel === 'region' && <><div className="panel-kicker">CURRENT WORKSPACE</div><h3>요세미티 국립공원</h3><p>Yosemite Valley, California</p><dl><div><dt>작업 단계</dt><dd>지도 기반 구축</dd></div><div><dt>지역</dt><dd>미국 · 캘리포니아</dd></div><div><dt>지도 표시</dt><dd>2D / 웹 메르카토르</dd></div><div><dt>분석 격자</dt><dd>미연결</dd></div></dl><div className="info-note"><Info size={17} /><p>표시된 고도 타일은 지형을 살피는 자료입니다. 6m 분석 격자나 실종자 위치 예측 결과가 아닙니다.</p></div><button className="outline-action" onClick={home}><LocateFixed size={16} />지도에서 보기</button></>}
      {panel === 'sources' && <><p className="panel-intro">현재 화면에 사용하는 공개 지도 서비스입니다.</p>{[{ title: '기본 지도', provider: 'OpenStreetMap', detail: '도로·지명 등 기본 정보', href: 'https://www.openstreetmap.org/copyright' }, { title: '위성 영상', provider: 'Esri World Imagery', detail: '촬영 시점은 지역에 따라 다릅니다.', href: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer' }, { title: '등고선 · 음영기복', provider: 'Mapzen / AWS Terrain Tiles', detail: '고도 타일에서 등고선을 생성합니다. 원본 해상도는 지역마다 다릅니다.', href: 'https://registry.opendata.aws/terrain-tiles/' }].map(s => <a className="source-card" key={s.title} href={s.href} target="_blank" rel="noreferrer"><span>{s.title}<ArrowUpRight size={16} /></span><b>{s.provider}</b><small>{s.detail}</small></a>)}</>}
      {panel === 'modules' && <><p className="panel-intro">하나의 지도에서 이어지는 분석 작업</p><div className="module-card"><MapIcon size={21} /><div><b>수색 분석</b><small>지도 기반 구축 중</small></div><span>준비 중</span></div><p className="muted-note">위치 확률 모델과 현장 보고 기능은 이후 연결됩니다. 현재 추천이나 예측을 생성하지 않습니다.</p></>}
      {panel === 'history' && <div className="empty-state"><History size={32} /><h3>아직 변경 이력이 없어요</h3><p>향후 승인된 현장 보고와 분석 지도 변경을 이곳에서 확인할 수 있습니다.</p></div>}
      <footer className="panel-footer"><Mountain size={16} /> FindWise <span>확장성과 직관성</span></footer>
    </aside>}
  </div>
}
export default App
