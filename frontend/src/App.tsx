import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { Map as MapInstance, MapMouseEvent } from 'maplibre-gl'
import { Mountain, Folder, Layers, History, Map as MapIcon, Satellite, ChevronDown, ChevronUp, X, Plus, Minus, LocateFixed, ArrowUpRight, Info, SlidersHorizontal, RotateCcw, Check, MapPin, ArrowUp, Ruler, ClipboardCheck, Scan, Play, Pause } from 'lucide-react'
import { exportTerrain } from './map/terrainDocument'
import { useTerrain } from './map/useTerrain'
import { localDateTime, readCase, readyCase, validLocation, type CaseInput } from './map/case'
import { TerrainPanel } from './map/TerrainPanel'
import { PointInfo } from './map/PointInfo'
import { DistancePanel, CoordinateEntry, type AbmOptions, type AnalysisSettings, type PreviewModel } from './map/DistancePanel'
import { distanceBands, distanceModelVersion, rankByDistance, type DistanceRun } from './map/distance'
import { MeasureLayer, MeasurePanel } from './map/MeasurePanel'
import { appendMeasurePoint, formatMeasure, measureMeters, type MapPoint, type Measurement } from './map/measure'
import { candidateArea, candidateExtent, type CandidateArea, type CandidateOrder } from './map/candidateArea'
import { CandidateLayer, CandidatePanel, candidateLimit, type CandidateSource } from './map/CandidatePanel'
import { compareAbmRuns } from './map/compare'
import { ComparisonCaption, ComparisonControls } from './map/ComparisonControls'
import { MapView } from './map/MapView'
import { analysisGrid, defaults, readSettings, region } from './map/config'
import { defaultRegionId, regions } from './map/regions'
import { boundary, gridManifest, gridMinZoom, projectedRectangle, projectedToCell, toLngLat, toProjected, type Cell } from './map/grid'
import { abmFrameMetrics, abmTimelineBounds, demoTimeline, formatElapsed, readTimeline, type Timeline } from './map/timeline'
import { ringGradient } from './map/ringOverlay'
import { readRingResult, type RingResult } from './map/ring'
import { ReportArea, ReportPanel, type ReportView } from './map/ReportPanel'
import { reportEffects } from './map/reportEffect'
import { searchRecordAtPoint } from './map/reportMap'
import { emptyReportFields, latestSearchRecord, readReportFields, reportCells, reportDuplicateKey, searchCaseKey, searchRunKey, type NewSearchRecord, type ReportFields, type ReportKind, type ReportRadius, type SearchRecord, type SearchedRecord } from './map/searchRecord'
import { appendSearchRecord, useIncidentMarkers, useSearchRecords } from './map/searchRecordStorage'
import { IncidentMarkerLayer, IncidentPanel } from './map/IncidentPanel'
import type { GpsAdoption } from './map/gps'
import { unassignedMarkerKey, validMarkerPoint, type IncidentMarker, type MarkerDraft } from './map/incident'
import { mapStatusReducer } from './map/status'
import './App.css'

const caseStorageKey = region.id === defaultRegionId ? 'findwise.case.v1' : `findwise.case.v1:${region.id}`
const pendingMarkerKey = region.id === defaultRegionId ? unassignedMarkerKey : `${unassignedMarkerKey}:${region.id}`
const modelEndpoint = (model: string) => `${import.meta.env.BASE_URL}api/${model}?region=${region.id}`
const gridDefinition = gridManifest(analysisGrid)
const [west, south, east, north] = gridDefinition.projected_extent
const formatKm = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 6 })
const areaSize = `${formatKm.format((east - west) / 1000)} × ${formatKm.format((north - south) / 1000)}km`
const cellSize = `${gridDefinition.cell_size_m}m`
const gridCenter = toLngLat(analysisGrid, [(west + east) / 2, (south + north) / 2])
const compareTerrainLayers = { trail: false, road: false, river: false, water: false, access: false }
const ignoreZoom = () => {}
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
  try { return readCase(JSON.parse(localStorage.getItem(caseStorageKey) || 'null'), analysisGrid) }
  catch { return { start: null, lastSeenUtc: '' } }
}

type Panel = 'sources' | 'modules' | 'results' | 'measure' | 'candidate' | 'report' | 'history' | null
type ReportTarget = { timeline: Timeline | null; step: number; point: MapPoint; caseKey: string; kind: ReportKind; sourceMarkerId?: string }
type MapInteraction = 'locate' | 'measure' | 'report-point' | 'marker-point' | 'candidate-area' | 'terrain-area' | null
function App() {
  const [settings, setSettings] = useState(readSettings)
  const terrain = useTerrain()
  const [caseInput, setCaseInput] = useState(initialCase)
  const [pendingLocation, setPendingLocation] = useState<[number, number] | null>(null)
  const [caseSaveError, setCaseSaveError] = useState('')
  const [resultCase, setResultCase] = useState('')
  const [distanceMessage, setDistanceMessage] = useState('')
  const [ring, setRing] = useState<RingResult | null>(null)
  const [modelSettings, setModelSettings] = useState<AnalysisSettings>({
    model: 'ring', hours: 1, abm: { applyAccess: true, allowUnknown: true, behavior: 'rw', slopeLimit: null },
  })
  const [previewRunning, setPreviewRunning] = useState<PreviewModel | null>(null)
  const previewRequest = useRef<AbortController | null>(null)
  const cancelPreview = useCallback(() => {
    if (previewRequest.current) {
      previewRequest.current.abort()
      setDistanceMessage('')
    }
    previewRequest.current = null
    setPreviewRunning(null)
  }, [])
  const caseKey = JSON.stringify(caseInput)
  const reportCaseKey = searchCaseKey(analysisGrid.id, caseInput)
  const searchRecords = useSearchRecords(reportCaseKey, analysisGrid)
  const markerCaseKey = reportCaseKey || pendingMarkerKey
  const incident = useIncidentMarkers(markerCaseKey)
  const unassigned = useIncidentMarkers(reportCaseKey ? pendingMarkerKey : '')
  const [markerDraft, setMarkerDraft] = useState<(MarkerDraft & { caseKey: string }) | null>(null)
  const [selectedMarkerId, setSelectedMarkerId] = useState('')
  const [markersVisible, setMarkersVisible] = useState(true)
  const [markerPending, setMarkerPending] = useState(false)
  const [markerError, setMarkerError] = useState<{ caseKey: string; message: string } | null>(null)
  const markerRequest = useRef(false)
  const activeMarkerDraft = markerDraft?.caseKey === markerCaseKey ? markerDraft : null
  const selectedMarker = incident.markers.find(marker => marker.id === selectedMarkerId)
  const terrainLayers = useMemo(() => ({
    trail: settings.trail, road: settings.road, river: settings.river, water: settings.water, access: settings.access,
  }), [settings.trail, settings.road, settings.river, settings.water, settings.access])
  const updateCase = (next: CaseInput, requireSave = false) => {
    try {
      localStorage.setItem(caseStorageKey, JSON.stringify(next))
      setCaseSaveError('')
    } catch {
      setCaseSaveError('마지막 확인 정보를 저장하지 못했습니다. 브라우저 저장소를 확인해 주세요.')
      if (requireSave) return false
    }
    cancelPreview()
    setCaseInput(next)
    return true
  }
  const [pointOpen, setPointOpen] = useState(false)
  const [layersOpen, setLayersOpen] = useState(false)
  const [legendOpen, setLegendOpen] = useState(false)
  const [panel, setPanel] = useState<Panel>('modules')
  const [status, dispatchStatus] = useReducer(mapStatusReducer, 'loading')
  const [zoom, setZoom] = useState<number>(region.zoom)
  const [reload, setReload] = useState(0)
  const [distanceRun, setDistanceRun] = useState<DistanceRun | null>(null)
  const [timeline, setTimeline] = useState<Timeline | null>(null)
  const [baseline, setBaseline] = useState<Timeline | null>(null)
  const [compareOpen, setCompareOpen] = useState(false)
  const [compareIndex, setCompareIndex] = useState(0)
  const [baselineMap, setBaselineMap] = useState<MapInstance | null>(null)
  const [baselineStatus, dispatchBaselineStatus] = useReducer(mapStatusReducer, 'loading')
  const [timelineStep, setTimelineStep] = useState(0)
  const [playingTimeline, setPlayingTimeline] = useState(false)
  useEffect(() => {
    if (!playingTimeline || !timeline || !settings.heatmap || compareOpen) return
    const next = timelineStep + 1
    if (next >= timeline.frames.length) return
    const timer = window.setTimeout(() => {
      setTimelineStep(next)
      if (next === timeline.frames.length - 1) setPlayingTimeline(false)
    }, 1200)
    return () => window.clearTimeout(timer)
  }, [playingTimeline, timeline, timelineStep, settings.heatmap, compareOpen])
  const [timelineError, setTimelineError] = useState('')
  const [reportView, setReportView] = useState<ReportView>('flow')
  const [effectId, setEffectId] = useState('')
  const [reportKind, setReportKind] = useState<ReportKind>('searched')
  const [reportDraft, setReportDraft] = useState<ReportTarget | null>(null)
  const [reportRadius, setReportRadius] = useState<ReportRadius>(100)
  const [reportRun, setReportRun] = useState<{ timeline: Timeline; key: string } | null>(null)
  const [reportFields, setReportFields] = useState<ReportFields>(emptyReportFields)
  const [selectedReportId, setSelectedReportId] = useState('')
  const [reportRecordsVisible, setReportRecordsVisible] = useState(true)
  useEffect(() => {
    if (!timeline?.abmPreview) return
    let active = true
    void searchRunKey(analysisGrid.id, timeline).then(key => {
      if (active) setReportRun({ timeline, key })
    }, () => {
      if (active) setReportRun({ timeline, key: '' })
    })
    return () => { active = false }
  }, [timeline])
  const [showAdjusted, setShowAdjusted] = useState(true)
  const [reportPending, setReportPending] = useState(false)
  const [reportMessage, setReportMessage] = useState('')
  const reportRequest = useRef(false)
  const timelineLoad = useRef(0)
  const [terrainOpen, setTerrainOpen] = useState(false)
  const [interaction, setInteraction] = useState<MapInteraction>(null)
  const [candidates, setCandidates] = useState<CandidateArea[]>([])
  const [selectedCandidateId, setSelectedCandidateId] = useState<number | null>(null)
  const [candidateOrder, setCandidateOrder] = useState<CandidateOrder>('mass')
  const [candidateMapView, setCandidateMapView] = useState(false)
  const selectedCandidate = candidates.find(area => area.id === selectedCandidateId) ?? candidates[0]
  const [candidateCorner, setCandidateCorner] = useState<Cell | null>(null)
  const [candidateVisible, setCandidateVisible] = useState(true)
  const [candidateMessage, setCandidateMessage] = useState('')
  const candidateSequence = useRef(0)
  const startCandidate = () => {
    if (candidates.length >= candidateLimit) return
    setCompareOpen(false); setPointOpen(false); setTerrainOpen(false); setLayersOpen(false); setPanel(null)
    setCandidateMapView(false); setCandidateCorner(null); setCandidateMessage(''); setCandidateVisible(true); setInteraction('candidate-area')
  }
  const cancelCandidate = () => {
    setInteraction(null); setCandidateCorner(null); setCandidateMessage(''); setPanel('candidate')
  }
  const chooseCandidateCorner = useCallback((point: MapPoint) => {
    const corner = projectedToCell(analysisGrid, ...toProjected(analysisGrid, point))
    if (!corner) {
      setCandidateMessage('분석 범위 안의 모서리를 선택해 주세요.')
      return
    }
    setCandidateMessage('')
    if (!candidateCorner) { setCandidateCorner(corner); return }
    const area = candidateArea(++candidateSequence.current, candidateCorner, corner)
    setCandidates(previous => previous.length < candidateLimit ? [...previous, area] : previous)
    setSelectedCandidateId(area.id)
    setCandidateCorner(null); setInteraction(null); setPanel('candidate')
  }, [candidateCorner])
  const [measurements, setMeasurements] = useState<Measurement[]>([])
  const [selectedMeasure, setSelectedMeasure] = useState<number | null>(null)
  const [measureVisible, setMeasureVisible] = useState(true)
  const measureSequence = useRef(0)
  const measurement = measurements.find(item => item.id === selectedMeasure) ?? measurements.at(-1)
  const measureId = measurement?.id
  const measurePoints = measurement?.points ?? []
  const measureTotal = measureMeters(measurePoints)
  const hasMeasurements = measurements.some(item => item.points.length > 0)
  const hasVisibleMeasurements = measureVisible && measurements.some(item => item.visible && item.points.length > 0)
  const addMeasurePoint = useCallback((point: MapPoint) => {
    setMeasurements(previous => {
      const active = previous.find(item => item.id === selectedMeasure) ?? previous.at(-1)
      return previous.map(item => item === active ? { ...item, points: appendMeasurePoint(item.points, point) } : item)
    })
  }, [selectedMeasure])
  const undoMeasure = () => setMeasurements(previous => previous.map(item => item.id === measureId
    ? { ...item, points: item.points.slice(0, -1) } : item))
  const startMeasure = (fresh: boolean) => {
    timelineLoad.current++
    setPointOpen(false); setTerrainOpen(false); setLayersOpen(false); setPanel(null)
    if (fresh || !measurement) {
      const id = ++measureSequence.current
      setMeasurements(previous => [...previous.filter(item => item.points.length), { id, points: [], visible: true }])
      setSelectedMeasure(id)
    } else {
      setMeasurements(previous => previous.map(item => item.id === measureId ? { ...item, visible: true } : item))
    }
    setMeasureVisible(true); setInteraction('measure')
  }
  const finishMeasure = () => { setInteraction(null); setPanel('measure') }
  const toggleMeasure = () => {
    setMeasureVisible(previous => !previous)
    if (interaction === 'measure') finishMeasure()
  }
  const setTerrainDrawing = useCallback((drawing: boolean) => {
    setInteraction(previous => drawing ? 'terrain-area' : previous === 'terrain-area' ? null : previous)
  }, [])
  const closeTerrain = () => { setTerrainOpen(false); setTerrainDrawing(false) }
  const [mapInstance, setMapInstance] = useState<MapInstance | null>(null)
  const map = useRef<MapInstance | null>(null)
  const onReady = useCallback((value: MapInstance | null) => { map.current = value; setMapInstance(value) }, [])
  useEffect(() => { try { localStorage.setItem('findwise.map.v1', JSON.stringify(settings)) } catch { /* Browser storage is optional. */ } }, [settings])
  useEffect(() => { const close = (e: KeyboardEvent) => { if (e.key === 'Escape') { setPlayingTimeline(false); setCompareOpen(false); cancelPreview(); setPanel(null); setPointOpen(false); setTerrainOpen(false); setLayersOpen(false); setInteraction(null); setCandidateCorner(null); setPendingLocation(null); setDistanceMessage('') } }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close) }, [cancelPreview])
  const openPanel = (value: Panel) => {
    setCandidateMapView(false)
    setPlayingTimeline(false)
    setCompareOpen(false); setPointOpen(false); setInteraction(null); setTerrainOpen(false); setLayersOpen(false)
    setPanel(value)
  }
  const togglePanel = (value: Panel) => openPanel(panel === value ? null : value)
  const openAnalysis = (model?: PreviewModel) => {
    if (model) setModelSettings(previous => ({ ...previous, model }))
    openPanel('modules')
  }
  const openTerrain = useCallback(() => {
    setPlayingTimeline(false)
    setCompareOpen(false)
    setPanel(null); setPointOpen(false); setInteraction(null); setPendingLocation(null); setLayersOpen(false); setTerrainOpen(true)
  }, [])
  const inspectPoint = useCallback(() => {
    setPlayingTimeline(false)
    setInteraction(null); setPointOpen(true); setPanel(null); setTerrainOpen(false); setLayersOpen(false)
  }, [])
  const pickLocation = () => {
    cancelPreview()
    setPointOpen(false); setTerrainOpen(false); setLayersOpen(false); setDistanceMessage('')
    setPendingLocation(null); setPanel(null); setInteraction('locate'); showArea()
  }
  const confirmLocation = () => {
    if (!pendingLocation) return
    updateCase({ ...caseInput, start: pendingLocation })
    setPendingLocation(null)
    openPanel('modules')
  }
  const home = () => map.current?.flyTo({ center: region.center, zoom: region.zoom, bearing: 0, pitch: 0, essential: true })
  const showArea = () => {
    setSettings(s => ({ ...s, area: true }))
    const ring = boundary(analysisGrid).geometry.coordinates[0]
    map.current?.fitBounds([[Math.min(...ring.map(p => p[0])), Math.min(...ring.map(p => p[1]))], [Math.max(...ring.map(p => p[0])), Math.max(...ring.map(p => p[1]))]], { padding: 60, duration: 800 })
  }
  const focusCandidate = (area: CandidateArea) => {
    setSelectedCandidateId(area.id)
    setCandidateVisible(true)
    if (window.matchMedia('(max-width: 760px)').matches) {
      openPanel(null)
      setCandidateMapView(true)
    }
    const corners = projectedRectangle(analysisGrid, candidateExtent(analysisGrid, area)).geometry.coordinates[0]
    const bounds: [[number, number], [number, number]] = [
      [Math.min(...corners.map(point => point[0])), Math.min(...corners.map(point => point[1]))],
      [Math.max(...corners.map(point => point[0])), Math.max(...corners.map(point => point[1]))],
    ]
    map.current?.fitBounds(bounds, { padding: { top: 125, bottom: 135, left: 26, right: 26 }, maxZoom: 16.5, duration: 400 })
  }
  const inspectGrid = () => { setSettings(s => ({ ...s, area: true, grid: true })); map.current?.flyTo({ center: gridCenter, zoom: gridMinZoom + .8, bearing: 0, pitch: 0, essential: true }) }
  const exportGrid = () => downloadJson(`${analysisGrid.id}.json`, gridDefinition)
  const chooseLocation = useCallback((start: [number, number]) => {
    if (!validLocation(analysisGrid, start)) {
      setDistanceMessage('분석 범위 안에서 위치를 선택해 주세요.')
      return
    }
    cancelPreview()
    setPendingLocation(start); setInteraction(null); setTerrainOpen(false); setPointOpen(true); setPanel(null); setDistanceMessage('')
  }, [cancelPreview])
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
    cancelPreview()
    timelineLoad.current++
    setRing(null)
    setTimeline(null); setTimelineError('')
    setDistanceRun({ start: caseInput.start, lastSeenUtc: caseInput.lastSeenUtc, order: rankByDistance(analysisGrid, toProjected(analysisGrid, caseInput.start)) })
    setResultCase(caseKey)
    setSettings(previous => ({ ...previous, heatmap: true }))
    setPointOpen(false); setPanel(window.matchMedia('(max-width: 760px)').matches ? null : 'results'); setLayersOpen(false)
    setDistanceMessage('거리 기준 결과를 계산했습니다.')
  }
  const cancelPicking = () => {
    setInteraction(null)
    setDistanceMessage('')
    setPanel('modules')
  }
  const clearDistance = () => {
    setDistanceRun(null)
    setDistanceMessage('')
  }
  const clearTimeline = () => {
    setPlayingTimeline(false)
    setCompareOpen(false)
    timelineLoad.current++
    setTimeline(null)
    setTimelineError('')
  }
  const focusAbm = (result: Timeline) => {
    map.current?.fitBounds(abmTimelineBounds(analysisGrid, result), {
      padding: { top: 115, bottom: 130, left: 24, right: 24 },
      maxZoom: 15.5, duration: 500,
    })
  }
  const removeLocation = () => {
    if (pendingLocation) {
      setPendingLocation(null)
    } else if (caseInput.start) {
      updateCase({ ...caseInput, start: null })
      clearTimeline()
      clearDistance()
      setRing(null)
      setBaseline(null)
      setTimelineStep(0)
      setResultCase('')
      setReportDraft(null)
      setReportFields(emptyReportFields)
      setReportMessage('')
    }
    openPanel('modules')
  }
  const runPreview = async (model: PreviewModel, hours: 1 | 2, options: AbmOptions) => {
    if (previewRequest.current || pendingLocation || !caseInput.start || !readyCase(caseInput, analysisGrid)) return
    let accessInput = null
    if (model === 'abm' && options.applyAccess) {
      if (!terrain.document) {
        setDistanceMessage('통행 자료를 연결한 뒤 다시 실행해 주세요.')
        return
      }
      const { schema_version, revision, base_feature_count, features } = exportTerrain(terrain.document)
      accessInput = { schema_version, revision, base_feature_count, features }
    }
    const request = new AbortController()
    previewRequest.current = request
    timelineLoad.current++
    setPreviewRunning(model)
    const label = model === 'ring' ? 'Ring 모델' : options.behavior === 've' ? 'ABM 높은 곳으로 이동' : 'ABM 무작위 보행'
    setDistanceMessage(`${label}을 계산하고 있습니다.`)
    try {
      const response = await fetch(modelEndpoint(model), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(model === 'ring' ? toProjected(analysisGrid, caseInput.start)
          : { lkp: caseInput.start, last_seen_utc: caseInput.lastSeenUtc, hours, terrain: accessInput,
            behavior: options.behavior, allow_unknown: options.allowUnknown, slope_limit: options.slopeLimit }),
        signal: request.signal,
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : '모델을 실행하지 못했습니다.')
      const nextRing = model === 'ring' ? readRingResult(payload, analysisGrid) : null
      const nextTimeline = model === 'abm' ? readTimeline(payload, analysisGrid) : null
      if (nextTimeline && !nextTimeline.abmPreview) throw new Error('ABM 결과 정보가 없습니다.')
      if (request.signal.aborted) return
      clearTimeline()
      clearDistance()
      setRing(nextRing)
      setTimeline(nextTimeline)
      setTimelineStep(nextTimeline ? nextTimeline.frames.length - 1 : 0)
      if (nextTimeline) focusAbm(nextTimeline)
      setResultCase(caseKey)
      setSettings(previous => ({ ...previous, heatmap: true }))
      setPointOpen(false)
      setPanel(previous => previous === 'modules' ? (window.matchMedia('(max-width: 760px)').matches ? null : 'results') : previous)
    } catch (error) {
      if (!request.signal.aborted) setDistanceMessage(error instanceof Error && !(error instanceof SyntaxError) && !(error instanceof TypeError)
        ? error.message : '모델에 연결하지 못했습니다. 개발 서버가 실행 중인지 확인해 주세요.')
    } finally {
      if (previewRequest.current === request) {
        previewRequest.current = null
        setPreviewRunning(null)
      }
    }
  }
  const showTimeline = (next: Timeline) => {
    setRing(null)
    clearTimeline()
    clearDistance()
    setInteraction(null)
    setTimelineStep(next.abmPreview ? next.frames.length - 1 : 0)
    const input: CaseInput = { start: next.start, lastSeenUtc: new Date(next.lastSeenMs).toISOString() }
    updateCase(input); setPendingLocation(null); setResultCase(JSON.stringify(input))
    setSettings(previous => ({ ...previous, heatmap: true }))
    setTimeline(next); setPanel(window.matchMedia('(max-width: 760px)').matches ? null : 'results'); setPointOpen(false)
    if (next.abmPreview) focusAbm(next)
  }
  const loadTimeline = async (file: File) => {
    cancelPreview()
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
  const elapsed = frame ? formatElapsed(frame.elapsed_seconds) : ''
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
  const candidateReturn = candidateMapView && candidateVisible && !panel && !interaction && !pointOpen && !terrainOpen
    ? selectedCandidate : undefined
  const hasResult = Boolean(distanceRun || ring || timeline)
  const caseChanged = hasResult && resultCase !== caseKey
  const terrainChanged = Boolean(timeline && !timeline.synthetic && timeline.terrainRevision &&
    terrain.document && timeline.terrainRevision !== terrain.document.revision)
  const resultNotice = caseChanged ? '마지막 확인 정보가 변경됨 · 이전 입력의 결과입니다.' :
    terrainChanged ? '이동 조건이 변경됨 · 변경 전 조건으로 계산된 결과입니다.' :
    timeline && !timeline.synthetic && timeline.terrainRevision && !terrain.document ? '결과의 이동 조건을 확인하려면 지형 자료를 연결해 주세요.' :
    timeline && !timeline.synthetic && !timeline.abmPreview && !timeline.terrainRevision ? '이 결과에는 적용한 이동 조건 버전이 없습니다.' : ''
  const reportRunKey = reportRun?.timeline === timeline ? reportRun?.key ?? '' : ''
  const reportAvailable = searchRecords.ready && Boolean(reportCaseKey) && (reportKind === 'blocked' ||
    Boolean(timeline?.abmPreview && frame && !resultNotice && reportRunKey && import.meta.env.DEV))
  const activeDraft = reportDraft && reportDraft.caseKey === reportCaseKey && reportDraft.kind === reportKind &&
    (reportKind === 'blocked' || reportDraft.sourceMarkerId || (reportDraft.timeline === timeline && reportDraft.step === timelineStep)) ? reportDraft : null
  const reportsForStep = reportRunKey && frame ? searchRecords.records.filter((report): report is SearchedRecord =>
    report.kind === 'searched' && report.runKey === reportRunKey && report.stepSeconds === frame.elapsed_seconds) : []
  const selectedRecord = searchRecords.records.find(record => record.id === selectedReportId) ?? searchRecords.records[0]
  const sourceMarker = incident.markers.find(marker => marker.id === selectedRecord?.sourceMarkerId)
  const displayTimeline = useMemo(() => {
    if (!timeline || !reportRunKey || !searchRecords.records.some(record => record.kind === 'searched' && record.runKey === reportRunKey)) return timeline
    const frames = timeline.frames.map(item => {
      const report = latestSearchRecord(searchRecords.records, reportRunKey, item.elapsed_seconds)
      return report ? { ...item, cells: report.cells } : item
    })
    const maxMass = frames.reduce((maximum, item) => item.cells.reduce((max, [, mass]) => Math.max(max, mass), maximum), timeline.maxMass)
    return { ...timeline, frames: showAdjusted ? frames : timeline.frames, maxMass }
  }, [timeline, reportRunKey, searchRecords.records, showAdjusted])
  const movement = useMemo(() => displayTimeline?.abmPreview ? abmFrameMetrics(analysisGrid, displayTimeline, timelineStep) : null,
    [displayTimeline, timelineStep])
  const cannotDepart = timeline?.abmPreview?.canDepart === false
  const meanDistance = movement ? `${(cannotDepart ? 0 : Math.round(movement.meanDistanceM)).toLocaleString('ko-KR')}m` : ''
  const selectTimelineStep = (step: number) => {
    setPlayingTimeline(false)
    setTimelineStep(step)
  }
  const toggleTimelinePlayback = () => {
    if (!timeline) return
    if (playingTimeline) {
      setPlayingTimeline(false)
      return
    }
    if (timelineStep === timeline.frames.length - 1) setTimelineStep(0)
    setPlayingTimeline(true)
  }
  const replayTimeline = () => {
    openPanel(null)
    setSettings(previous => ({ ...previous, heatmap: true }))
    setTimelineStep(0)
    setPlayingTimeline(true)
  }
  const candidateStale = caseChanged || terrainChanged || Boolean(timeline?.terrainRevision && !terrain.document)
  const candidateEffects = useMemo(() => candidateStale || !frame || !reportRunKey ? [] :
    reportEffects(searchRecords.records, reportRunKey, frame.elapsed_seconds, frame.cells),
  [candidateStale, frame, reportRunKey, searchRecords.records])
  const effectStep = !candidateStale && reportRunKey && selectedRecord?.kind === 'searched' && selectedRecord.runKey === reportRunKey
    ? timeline?.frames.findIndex(item => item.elapsed_seconds === selectedRecord.stepSeconds) ?? -1 : -1
  const effectFrame = effectStep === timelineStep ? frame : timeline?.frames[effectStep]
  const hasSelectedEffect = useMemo(() => Boolean(selectedRecord && effectFrame &&
    (effectFrame === frame ? candidateEffects :
      reportEffects(searchRecords.records, reportRunKey, effectFrame.elapsed_seconds, effectFrame.cells))
      .some(effect => effect.report.id === selectedRecord.id)),
  [selectedRecord, effectFrame, frame, candidateEffects, reportRunKey, searchRecords.records])
  const showRecordEffect = () => {
    if (!selectedRecord || !hasSelectedEffect) return
    setTimelineStep(effectStep)
    setEffectId(selectedRecord.id)
    openPanel('candidate')
  }
  const openEffectRecord = (id: string) => {
    setSelectedReportId(id)
    setReportView('records')
    setReportMessage('')
    openPanel('report')
  }
  const candidateAdjusted = showAdjusted && reportsForStep.length > 0
  const candidateSource = useMemo<CandidateSource | null>(() => {
    if (candidateStale) return null
    if (ring) return {
      label: 'Ring · 분석 격자 안에서의 확률',
      explanation: '구역에 포함된 셀의 확률을 합칩니다. 전체 모델에서 격자 밖의 확률은 제외된 값입니다.',
      probability: { kind: 'palette', indices: ring.indices, palette: ring.palette },
    }
    const current = displayTimeline?.frames[timelineStep]
    if (!displayTimeline?.abmPreview || !current) return null
    return {
      label: `${displayTimeline.label} · ${elapsed} 후${candidateAdjusted ? ' · 최종 보고 반영' : ''}`,
      explanation: candidateAdjusted ? '이 시점에 승인된 보고를 모두 반영한 결과입니다.' : '선택한 시점에 구역 안에 있는 경로의 비율을 표시합니다.',
      probability: { kind: 'sparse', cells: current.cells },
    }
  }, [candidateStale, ring, displayTimeline, timelineStep, elapsed, candidateAdjusted])
  const chooseReportPoint = useCallback((point: MapPoint) => {
    if (!reportCaseKey || !validLocation(analysisGrid, point)) {
      setReportMessage('분석 범위 안에서 중심을 선택해 주세요.')
      return
    }
    setReportDraft(previous => ({
      timeline, step: timelineStep, point, caseKey: reportCaseKey, kind: reportKind,
      sourceMarkerId: previous?.caseKey === reportCaseKey && previous.kind === reportKind ? previous.sourceMarkerId : undefined,
    }))
    setReportMessage('')
    setReportView('entry')
    setInteraction(null)
    setPanel('report')
  }, [timeline, timelineStep, reportCaseKey, reportKind])
  const startReport = () => {
    if (!reportAvailable) return
    setReportMessage('')
    setPointOpen(false); setTerrainOpen(false); setPanel(null); setLayersOpen(false)
    setInteraction('report-point')
  }
  const approveReport = async (approvedAtUtc: string) => {
    if (!reportAvailable || !activeDraft || reportRequest.current) return
    const fields = readReportFields(reportFields)
    if (!fields) { setReportMessage('보고 원문, 현장 시각, 검토자와 승인 근거를 확인해 주세요.'); return }
    const target = activeDraft
    if (reportKind === 'searched' && (!frame || !timeline ||
        Date.parse(fields.searchedAtUtc) > timeline.lastSeenMs + frame.elapsed_seconds * 1000)) {
      setReportMessage('수색 시각 이후의 ABM 시점을 선택해 주세요.')
      return
    }
    const duplicateKey = reportDuplicateKey(fields.searchedAtUtc, fields.rawText)
    if (searchRecords.records.some(record => record.duplicateKey === duplicateKey)) {
      setReportMessage('같은 시각과 원문의 보고가 이미 승인됐습니다.')
      return
    }
    const id = crypto.randomUUID()
    const radius = reportRadius
    const base = { version: 1 as const, id, caseKey: reportCaseKey, duplicateKey,
      ...fields, approvedAtUtc, point: target.point, radius,
      ...(target.sourceMarkerId ? { sourceMarkerId: target.sourceMarkerId } : {}) }
    reportRequest.current = true
    setReportPending(true)
    setReportMessage('')
    try {
      let record: NewSearchRecord
      let expectedHead: string | undefined
      let message: string
      if (reportKind === 'blocked') {
        record = { ...base, kind: 'blocked' }
        message = '승인된 진입 불가 보고를 기록에 저장했습니다.'
      } else {
        if (!frame) return
        const latest = latestSearchRecord(reportsForStep, reportRunKey, frame.elapsed_seconds)
        const cells = latest?.cells ?? frame.cells
        const response = await fetch(modelEndpoint('report'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event_id: id, status: '승인', point: toProjected(analysisGrid, target.point),
            radius_m: radius, cells, applied_ids: reportsForStep.map(report => report.id) }),
        })
        const payload = await response.json()
        if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : '현장 보고를 반영하지 못했습니다.')
        const adjusted = reportCells(payload?.cells, analysisGrid.rows * analysisGrid.columns)
        if (payload?.event_id !== id || typeof payload?.changed !== 'boolean' || !adjusted || adjusted.length !== cells.length ||
            adjusted.some((cell, index) => cell[0] !== cells[index][0])) throw new Error('보고 반영 결과를 확인해 주세요.')
        record = { ...base, kind: 'searched', runKey: reportRunKey, stepSeconds: frame.elapsed_seconds, changed: payload.changed, cells: adjusted }
        expectedHead = latest?.id
        message = payload.changed ? '승인된 수색 기록을 저장하고 지도에 반영했습니다.' : '승인된 수색 기록을 저장했습니다. 이 시점의 확률은 그대로입니다.'
      }
      const saved = await appendSearchRecord(record, expectedHead, analysisGrid)
      searchRecords.acceptSaved(reportCaseKey, saved)
      setSelectedReportId(id)
      setReportView('records')
      setReportFields(emptyReportFields)
      setReportDraft(previous => previous === target ? null : previous)
      setReportRecordsVisible(true)
      if (reportKind === 'searched') setShowAdjusted(true)
      setReportMessage(message)
    } catch (error) {
      searchRecords.refresh()
      setReportMessage(error instanceof Error ? error.message : '현장 보고를 반영하지 못했습니다.')
    } finally {
      reportRequest.current = false
      setReportPending(false)
    }
  }
  const focusReport = (record: SearchRecord) => {
    setSelectedReportId(record.id)
    setReportRecordsVisible(true)
    map.current?.easeTo({ center: record.point, zoom: Math.max(zoom, 15.5), duration: 350 })
  }
  const inspectSearchRecord = useCallback((event: MapMouseEvent) => {
    if (!reportRecordsVisible) return false
    const id = searchRecordAtPoint(event.target, event.point)
    if (!id) return false
    setSelectedReportId(id); setReportView('records'); setReportMessage(''); setPointOpen(false); setTerrainOpen(false); setPanel('report'); setLayersOpen(false)
    return true
  }, [reportRecordsVisible])
  const selectIncidentMarker = useCallback((id: string) => {
    setMarkerDraft(null)
    setMarkerError(null)
    setSelectedMarkerId(id)
    setReportMessage('')
    setReportView('flow')
    setPlayingTimeline(false)
    setPointOpen(false)
    setTerrainOpen(false)
    setLayersOpen(false)
    setPanel('report')
  }, [])
  const focusIncidentPoint = (point: MapPoint) => {
    map.current?.easeTo({ center: point, zoom: Math.max(zoom, 15.5), duration: 350 })
  }
  const chooseMarkerPoint = useCallback((point: MapPoint) => {
    if (!validMarkerPoint(point)) {
      setMarkerError({ caseKey: markerCaseKey, message: '지도에서 유효한 위치를 선택해 주세요.' })
      return
    }
    setMarkerDraft({ caseKey: markerCaseKey, point })
    setMarkerError(null)
    setInteraction(null)
    setReportView('flow')
    setPanel('report')
  }, [markerCaseKey])
  const startMarker = () => {
    if (!incident.ready || markerRequest.current) return
    openPanel(null)
    setMarkerError(null)
    setInteraction('marker-point')
  }
  const persistMarker = async (marker: IncidentMarker, action: 'add' | 'edit' | 'delete') => {
    if (!incident.ready || markerRequest.current) return
    markerRequest.current = true
    setMarkerPending(true)
    setMarkerError(null)
    try {
      await incident.save({ id: marker.id, marker: action === 'delete' ? undefined : marker, existing: action !== 'add' })
      setSelectedMarkerId(previous => action === 'delete' ? previous === marker.id ? '' : previous : marker.id)
      setMarkerDraft(previous => previous === activeMarkerDraft ? null : previous)
      if (action !== 'delete') setMarkersVisible(true)
    } catch (error) {
      setMarkerError({ caseKey: marker.caseKey, message: error instanceof Error ? error.message : '지도 마커를 저장하지 못했습니다.' })
    } finally {
      markerRequest.current = false
      setMarkerPending(false)
    }
  }
  const attachUnassignedMarkers = async () => {
    if (!reportCaseKey || !incident.ready || !unassigned.markers.length || markerRequest.current) return
    markerRequest.current = true
    setMarkerPending(true)
    setMarkerError(null)
    try {
      await incident.save({ attachUnassigned: pendingMarkerKey })
      unassigned.refresh()
      setMarkersVisible(true)
    } catch (error) {
      setMarkerError({ caseKey: markerCaseKey, message: error instanceof Error ? error.message : '임시 마커를 연결하지 못했습니다.' })
    } finally {
      markerRequest.current = false
      setMarkerPending(false)
    }
  }
  const adoptGps = (marker: IncidentMarker) => {
    const details = marker.gps
    const review = details?.review
    if (marker.kind !== 'gps' || !details || review?.status !== 'approved' || !validLocation(analysisGrid, marker.point)) return
    const previous = caseInput.start && caseInput.lastSeenUtc
      ? { point: caseInput.start, atUtc: new Date(caseInput.lastSeenUtc).toISOString() } : null
    const adoption: GpsAdoption = {
      markerId: marker.id, point: marker.point, atUtc: marker.atUtc, previous, adoptedAtUtc: new Date().toISOString(),
      source: details.source, accuracyM: details.accuracyM, review,
    }
    if (!updateCase({ start: marker.point, lastSeenUtc: marker.atUtc, gpsAdoptions: [...(caseInput.gpsAdoptions ?? []), adoption] }, true)) {
      setMarkerError({ caseKey: markerCaseKey, message: 'GPS 채택을 저장하지 못했습니다. 브라우저 저장소를 확인해 주세요.' })
      return
    }
    setPendingLocation(null)
    setReportDraft(null)
    setReportFields(emptyReportFields)
    setBaseline(null)
    openAnalysis('abm')
    map.current?.easeTo({ center: marker.point, zoom: 14, duration: 400 })
  }
  const startReportFromMarker = (marker: IncidentMarker) => {
    if (reportRequest.current || !reportCaseKey || !validLocation(analysisGrid, marker.point)) return
    setReportKind('searched')
    setReportDraft({ timeline, step: timelineStep, point: marker.point, caseKey: marker.caseKey, kind: 'searched', sourceMarkerId: marker.id })
    setReportFields({ ...emptyReportFields, rawText: marker.note, searchedAt: localDateTime(marker.atUtc).slice(0, 16) })
    setReportMessage('')
    setReportView('entry')
  }
  const openIncidentReport = (record: SearchRecord) => {
    openEffectRecord(record.id)
    focusReport(record)
  }
  const comparisonCandidate = useMemo(() => {
    if (!baseline) return '현재 ABM 결과를 기준으로 저장해 주세요.'
    if (!timeline?.abmPreview || baseline === timeline) return '같은 확인 위치와 시각으로 ABM을 한 번 더 실행해 주세요.'
    return compareAbmRuns(baseline, timeline)
  }, [baseline, timeline])
  const comparison = compareOpen && typeof comparisonCandidate !== 'string' ? comparisonCandidate : null
  const compareStep = comparison ? Math.min(compareIndex, comparison.pairs.length - 1) : 0
  const pairedFrame = comparison?.pairs[compareStep]
  const compareSettings = useMemo(() => ({ ...settings, heatmap: true }), [settings])
  const startComparison = () => {
    if (typeof comparisonCandidate === 'string') return
    const selected = comparisonCandidate.pairs.findIndex(pair => pair.currentStep === timelineStep)
    setCompareIndex(Math.max(0, selected))
    dispatchBaselineStatus('retry')
    setInteraction(null); setPointOpen(false); setTerrainOpen(false); setLayersOpen(false); setPanel(null)
    setCompareOpen(true)
  }
  const closeComparison = () => {
    if (pairedFrame) setTimelineStep(pairedFrame.currentStep)
    setCompareOpen(false)
    setPanel('results')
  }
  useEffect(() => {
    if (!comparison || !baselineMap || !mapInstance) return
    let syncing = false
    const copy = (from: MapInstance, to: MapInstance) => {
      if (syncing) return
      syncing = true
      try {
        to.jumpTo({ center: from.getCenter(), zoom: from.getZoom(), bearing: from.getBearing(), pitch: from.getPitch() })
      } finally { syncing = false }
    }
    const fromBaseline = () => copy(baselineMap, mapInstance)
    const fromCurrent = () => copy(mapInstance, baselineMap)
    fromCurrent()
    baselineMap.on('move', fromBaseline)
    mapInstance.on('move', fromCurrent)
    return () => {
      baselineMap.off('move', fromBaseline)
      mapInstance.off('move', fromCurrent)
    }
  }, [baselineMap, mapInstance, comparison])
  const mapPoint = interaction === 'locate' ? chooseLocation :
    interaction === 'measure' ? addMeasurePoint :
    interaction === 'report-point' ? chooseReportPoint :
    interaction === 'marker-point' ? chooseMarkerPoint :
    interaction === 'candidate-area' ? chooseCandidateCorner : undefined
  const interval = zoom >= 14 ? 20 : zoom >= 12 ? 50 : 100
  const failed = status === 'data-error' || status === 'startup-error'
  const dotClass = failed ? 'warning-dot' : status === 'loading' ? 'loading-dot' : ''
  return <div className="workspace">
    <header className="topbar">
      <a className="brand" href="#" onClick={e => { e.preventDefault(); home() }} aria-label="FindWise 시작 위치"><Mountain size={30} strokeWidth={1.5} /><strong>FindWise</strong></a>
      <div className="project-title"><Folder size={19} /><span>{region.shortName} 수색 작업 공간</span><span className="badge">개발 미리보기</span></div>
      <label className="region-picker"><MapPin size={15} aria-hidden="true" />
        <select aria-label="작업 지역" value={region.id} onChange={event => {
          const next = new URL(window.location.href)
          next.searchParams.set('region', event.target.value)
          window.location.assign(next.href)
        }}>
          {Object.values(regions).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <span className="connection" role="status"><i className={dotClass} />{connectionLabels[status]}</span>
    </header>
    <nav className="rail" aria-label="작업 메뉴">
      <button aria-label="확인 위치" title="확인 위치" aria-pressed={panel === 'modules'} className={panel === 'modules' ? 'active' : ''} onClick={() => togglePanel('modules')}><MapPin size={22} /><span className="rail-label">확인 위치</span></button>
      <button aria-label="분석 결과" title="분석 결과" aria-pressed={panel === 'results'} className={panel === 'results' ? 'active' : ''} onClick={() => togglePanel('results')}><MapIcon size={22} /><span className="rail-label">분석 결과</span></button>
      <button aria-label="후보 구역" title="후보 구역" aria-pressed={panel === 'candidate' || interaction === 'candidate-area'}
        className={panel === 'candidate' || interaction === 'candidate-area' ? 'active' : ''}
        onClick={() => togglePanel('candidate')}><Scan size={22} /><span className="rail-label">후보 구역</span></button>
      <button aria-label="현장 보고" title="현장 보고"
        aria-pressed={panel === 'report' || interaction === 'report-point' || interaction === 'marker-point'} className={panel === 'report' || interaction === 'report-point' || interaction === 'marker-point' ? 'active' : ''}
        onClick={() => togglePanel('report')}><ClipboardCheck size={22} /><span className="rail-label">현장 보고</span></button>
      <span className="rail-divider" aria-hidden="true" />
      <button aria-label="통행 설정" title="통행 설정" aria-pressed={terrainOpen} className={terrainOpen ? 'active' : ''} onClick={() => terrainOpen ? closeTerrain() : openTerrain()}><Layers size={22} /><span className="rail-label">통행 설정</span></button>
      <button aria-label="거리 측정" title="거리 측정" aria-pressed={panel === 'measure' || interaction === 'measure'}
        className={panel === 'measure' || interaction === 'measure' ? 'active' : ''} onClick={() => togglePanel('measure')}>
        <Ruler size={22} /><span className="rail-label">거리 측정</span>
        {hasVisibleMeasurements && <i className="tool-layer-dot" aria-hidden="true" />}
      </button>
      <button aria-label="통행 이력" title="통행 이력" aria-pressed={panel === 'history'} className={panel === 'history' ? 'active' : ''} onClick={() => togglePanel('history')}><History size={22} /><span className="rail-label">통행 이력</span></button>
      <button className="rail-settings" aria-label="자료·설정" title="자료·설정" aria-pressed={panel === 'sources'} onClick={() => togglePanel('sources')}><SlidersHorizontal size={22} /><span className="rail-label">자료·설정</span></button>
      <button className="rail-reset" title="지도 표시 초기화" aria-label="지도 표시 초기화" onClick={() => { setSettings(defaults); home() }}><RotateCcw size={19} /></button>
    </nav>
    <main className={`map-area ${comparison ? 'compare-active' : ''} ${settings.base === 'satellite' ? 'satellite-mode' : ''}`}>
      <div className="map-views">
        {comparison && baseline && pairedFrame && <div className="map-view-pane" key="baseline">
          <MapView settings={compareSettings} onReady={setBaselineMap} onStatus={dispatchBaselineStatus} onZoom={ignoreZoom}
            label="기준 A 지도" distanceRun={null} ring={null} timeline={baseline} timelineStep={pairedFrame.baselineStep}
            colorMax={comparison.maxMass} casePoint={baseline.start} pointPending={false} />
          <ComparisonCaption side="기준 A" timeline={baseline} failed={baselineStatus === 'data-error' || baselineStatus === 'startup-error'} />
        </div>}
        <div className="map-view-pane" key="current">
          <MapView key={reload} settings={comparison ? compareSettings : settings} onReady={onReady} onStatus={dispatchStatus} onZoom={setZoom}
            label={comparison ? '현재 B 지도' : undefined} distanceRun={distanceRun} ring={ring} timeline={comparison ? timeline : displayTimeline}
            timelineStep={pairedFrame?.currentStep ?? timelineStep} colorMax={comparison?.maxMass}
            onMapPoint={mapPoint}
            casePoint={comparison && timeline ? timeline.start : pendingLocation ?? caseInput.start} pointPending={!comparison && Boolean(pendingLocation)}
            onPointInfo={comparison || interaction === 'terrain-area' ? undefined : inspectPoint} />
          {comparison && timeline && <ComparisonCaption side="현재 B" timeline={timeline} failed={failed} />}
        </div>
      </div>
      {comparison && timeline && <ComparisonControls comparison={comparison} step={compareStep} lastSeenMs={timeline.lastSeenMs}
        onStep={setCompareIndex} onClose={closeComparison} />}
      <div className="map-toolbar">
        <div className="base-switch" aria-label="배경지도 선택">
          <button aria-pressed={settings.base === 'base'} className={settings.base === 'base' ? 'selected' : ''} onClick={() => setSettings(s => ({ ...s, base: 'base' }))}><MapIcon size={17} />기본</button>
          <button aria-pressed={settings.base === 'satellite'} className={settings.base === 'satellite' ? 'selected' : ''} onClick={() => setSettings(s => ({ ...s, base: 'satellite' }))}><Satellite size={17} />위성</button>
        </div>
        <div className="layer-control">
          <button className="layer-trigger" aria-expanded={layersOpen} aria-controls="layer-menu" onClick={() => setLayersOpen(!layersOpen)}><Layers size={18} />레이어<span className="count">{['contours','hillshade','area','grid','trail','road','river','water','access','heatmap'].filter(key => settings[key as keyof typeof settings] === true).length + Number(hasVisibleMeasurements) + Number(candidateVisible && candidates.length > 0) + Number(reportRecordsVisible && searchRecords.records.length > 0)}</span>{layersOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</button>
          <section id="layer-menu" className="layer-menu" aria-label="지도 레이어" hidden={!layersOpen} inert={!layersOpen}>
            <div className="section-label">지형 레이어</div>
            {([{ key: 'contours', label: '등고선', detail: `${interval}m 간격 · 확대 수준에 따라 변경` }, { key: 'hillshade', label: '음영기복', detail: '능선과 계곡의 입체적인 형태' }] as const).map(({ key, label, detail }) => <label className="layer-row" key={key}><input type="checkbox" checked={settings[key]} onChange={e => setSettings(s => ({ ...s, [key]: e.target.checked }))} /><span className="checkbox"><Check size={13} /></span><span><b>{label}</b><small>{detail}</small></span></label>)}
            <div className="opacity-control"><label htmlFor="opacity">등고선 선명도<span>{settings.opacity}%</span></label><input id="opacity" type="range" min="0" max="100" value={settings.opacity} disabled={!settings.contours} onChange={e => setSettings(s => ({ ...s, opacity: Number(e.target.value) }))} /></div>
            <div className="section-label separator">분석 기반</div>
            {([{ key: 'area', label: '분석 범위', detail: `${areaSize} · 개발용 영역` }, { key: 'grid', label: `${cellSize} 격자선`, detail: zoom < gridMinZoom ? `확대 수준 ${gridMinZoom} 이상에서 표시` : '화면에 보이는 구간만 표시' }] as const).map(({ key, label, detail }) => <label className="layer-row" key={key}><input type="checkbox" checked={settings[key]} onChange={e => setSettings(s => ({ ...s, [key]: e.target.checked }))} /><span className="checkbox"><Check size={13} /></span><span><b>{label}</b><small>{detail}</small></span></label>)}
            <button className="grid-action" onClick={inspectGrid}>격자 확인을 위해 확대 <ArrowUpRight size={13} /></button>
            <div className="section-label separator">지형 자료 <span className="terrain-load-state">{terrain.status === 'loading' ? '불러오는 중' : terrain.status === 'error' ? '연결 확인 필요' : '준비됨'}</span></div>
            {region.terrainImages && <label className="measure-picker">지역 지형 이미지
              <select value={settings.terrainImage} onChange={event => {
                const value = event.target.value
                if (value === 'none' || value === 'elevation' || value === 'slope') {
                  setSettings(previous => ({ ...previous, terrainImage: value }))
                }
              }}>
                <option value="none">숨김</option><option value="elevation">고도 · 표시용</option><option value="slope">경사 · 표시용</option>
              </select>
            </label>}
            {([{ key: 'trail', label: '등산로' }, { key: 'road', label: '도로' }, { key: 'river', label: '하천' }, { key: 'water', label: '호수·수역' }] as const).map(({ key, label }) => <label className="layer-row" key={key}>
              <input type="checkbox" checked={settings[key]} onChange={event => setSettings(previous => ({ ...previous, [key]: event.target.checked }))} />
              <span className="checkbox"><Check size={13} /></span><span><b>{label}</b></span>
            </label>)}
            {terrain.status === 'error' && <button className="secondary-action" onClick={terrain.retry}>지형 다시 불러오기</button>}
            {([{ key: 'access', label: '통행 상태 표시' }, { key: 'heatmap', label: '히트맵 표시' }] as const).map(({ key, label }) => <label className="layer-row" key={key}>
              <input type="checkbox" checked={settings[key]} onChange={event => {
                if (key === 'heatmap') setPlayingTimeline(false)
                setSettings(previous => ({ ...previous, [key]: event.target.checked }))
              }} />
              <span className="checkbox"><Check size={13} /></span><span><b>{label}</b></span>
            </label>)}
            {hasMeasurements && <label className="layer-row">
              <input type="checkbox" checked={measureVisible} onChange={toggleMeasure} />
              <span className="checkbox"><Check size={13} /></span><span><b>전체 측정선 표시</b></span>
            </label>}
            {candidates.length > 0 && <label className="layer-row">
              <input type="checkbox" checked={candidateVisible} onChange={event => setCandidateVisible(event.target.checked)} />
              <span className="checkbox"><Check size={13} /></span><span><b>후보 구역 표시</b></span>
            </label>}
            {searchRecords.records.length > 0 && <label className="layer-row">
              <input type="checkbox" checked={reportRecordsVisible} onChange={event => setReportRecordsVisible(event.target.checked)} />
              <span className="checkbox"><Check size={13} /></span><span><b>현장 보고 표시</b></span>
            </label>}
            <p className="layer-footnote">표시를 꺼도 분석에 적용한 이동 조건은 유지됩니다.</p>
          </section>
        </div>
      </div>
      {interaction === 'locate' && <div className="distance-prompt">
        <span role="status">{distanceMessage || '마지막 확인 위치를 클릭하세요. 위치를 확인한 뒤 설정합니다.'}</span>
        <button onClick={cancelPicking}>취소</button>
      </div>}
      {interaction === 'measure' && <div className="distance-prompt measure-prompt" aria-label="지도 거리 측정">
        <span role="status">{measurePoints.length === 0 ? '첫 지점을 누르세요' : measurePoints.length === 1
          ? '다음 지점을 누르세요' : `${formatMeasure(measureTotal)} · 지점을 더 추가할 수 있어요`}</span>
        <div>
          <button onClick={undoMeasure} disabled={!measurePoints.length}>점 취소</button>
          <button onClick={finishMeasure}>{measurePoints.length >= 2 ? '완료' : '닫기'}</button>
        </div>
      </div>}
      {interaction === 'candidate-area' && <div className="distance-prompt measure-prompt">
        <span role="status">{candidateMessage || (candidateCorner ? '반대쪽 모서리를 클릭하세요.' : '분석 범위 안에서 첫 모서리를 클릭하세요.')}</span>
        <button onClick={cancelCandidate}>취소</button>
      </div>}
      {interaction === 'marker-point' && <div className="distance-prompt measure-prompt">
        <span role="status">{markerError?.message || '지도에서 마커를 남길 위치를 클릭하세요.'}</span>
        <button onClick={() => openPanel('report')}>취소</button>
      </div>}
      {interaction === 'report-point' && <div className="distance-prompt measure-prompt">
        <span role="status">{reportMessage || (reportKind === 'searched' ? '수색을 완료한 구역의 중심을 클릭하세요.' : '진입이 어려운 구역의 중심을 클릭하세요.')}</span>
        <button onClick={() => { setInteraction(null); setPanel('report') }}>취소</button>
      </div>}
      {pointOpen && (pendingLocation || caseInput.start) && <PointInfo
        point={(pendingLocation ?? caseInput.start)!} pending={Boolean(pendingLocation)}
        lastSeenUtc={caseInput.lastSeenUtc} terrain={terrain.document}
        resultLabel={resultNotice ? '입력·설정 변경 · 결과 확인 필요' : timeline ? timeline.synthetic ? '합성 예제 표시 중' : timeline.abmPreview ? 'ABM 결과 표시 중' : '시간별 결과 표시 중' : ring ? 'Ring 모델 결과 표시 중' : distanceRun ? '거리 기준 결과 표시 중' : '분석 전'}
        onClose={() => setPointOpen(false)} onConfirm={confirmLocation} onRemove={removeLocation}
        onEdit={() => { setPointOpen(false); setPanel('modules') }} onPick={pickLocation} />}
      {candidateReturn ? <div className="result-state candidate-map-return">
        <span role="status">후보 {candidateReturn.id} · 지도에서 보는 중</span>
        <button onClick={() => openPanel('candidate')}>후보 비교로 돌아가기</button>
        {resultNotice && <small>{resultNotice}</small>}
      </div> : hasResult && <div className={resultNotice || cannotDepart ? 'result-state needs-review' : 'result-state'} role="status">
        <span>{resultNotice || (cannotDepart ? '출발 불가 · 주변 통행 조건 확인' : timeline ? timeline.synthetic ? '합성 예제 · 화면 확인용' : timeline.abmPreview ? `${timeline.label} · 개발 시뮬레이션` : '시간별 위치 확률 결과' : ring ? 'Ring 모델 · 거리 기반 확률' : '거리 기준 결과 · 지형·시간 이동 미반영')}</span>
        {resultNotice ? <button onClick={() => openAnalysis()}>분석 설정 확인</button> :
          !panel && !interaction && !pointOpen && !terrainOpen && !comparison && <button onClick={() => openPanel('results')}>결과 보기</button>}
      </div>}
      {failed && <div className="error-banner" role="alert"><Info size={17} /><span>{errorMessages[status]}</span><button onClick={() => { dispatchStatus('retry'); setZoom(region.zoom); setReload(n => n + 1) }}>다시 시도</button></div>}
      <div className="map-tools"><button title="북쪽 정렬" aria-label="북쪽 정렬" onClick={() => map.current?.resetNorth()}><ArrowUp size={19} /><small>N</small></button><div className="zoom-buttons"><button title="확대" aria-label="확대" onClick={() => map.current?.zoomIn()}><Plus size={22} /></button><button title="축소" aria-label="축소" onClick={() => map.current?.zoomOut()}><Minus size={22} /></button></div><button title={`${region.shortName} 시작 위치로 돌아가기`} aria-label={`${region.shortName} 시작 위치로 돌아가기`} onClick={home}><LocateFixed size={21} /></button></div>
      <section className="legend"><button className="legend-title" aria-expanded={legendOpen} aria-controls="legend-content" onClick={() => setLegendOpen(!legendOpen)}><SlidersHorizontal size={15} />지도 범례{legendOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}</button><div id="legend-content" className="legend-content" hidden={!legendOpen} inert={!legendOpen}>{settings.contours && <span><i className="line-sample" />등고선 · {interval}m</span>}{settings.hillshade && <span><i className="shade-sample" />음영기복</span>}{settings.area && <span><i className="area-sample" />분석 범위 · {areaSize}</span>}{settings.grid && <span><i className="grid-sample" />{cellSize} 격자 {zoom < gridMinZoom ? '· 확대 시 표시' : ''}</span>}{distanceRun && settings.heatmap && <div className="distance-legend"><b>거리 기준 순위</b>{distanceBands.map(({ color, label }) => <span key={label}><i style={{ backgroundColor: `rgb(${color.slice(0, 3).join(' ')})` }} />{label}</span>)}</div>}{ring && settings.heatmap && <div className="time-scale"><b>Ring · 상대 확률</b><i style={{ background: ringGradient }} /><span>낮음 → 높음 · 표시 보간</span></div>}{timeline && settings.heatmap && <div className="time-scale"><b>셀 확률 · 시점 공통</b>{timeline.abmPreview && <span>부드러운 번짐은 표시용</span>}<i /><span>0% – {((displayTimeline?.maxMass ?? timeline.maxMass) * 100).toPrecision(3)}%</span></div>}{!settings.contours && !settings.hillshade && !settings.area && !settings.grid && !(hasResult && settings.heatmap) && !settings.trail && !settings.road && !settings.river && !settings.water && !settings.access && <span>배경지도만 표시 중</span>}{settings.trail && <span><i className="trail-sample" />등산로</span>}{settings.road && <span><i className="road-sample" />도로</span>}{settings.river && <span><i className="river-sample" />하천</span>}{settings.water && <span><i className="water-sample" />호수·수역</span>}{settings.access && <span>사선 · 통행 불가 / 점선 · 확인 필요</span>}<small>표시 레이어 · 통행 조건은 지형 편집에서 변경</small></div></section>
      {!comparison && timeline && frame && settings.heatmap && <section className="time-slider" aria-label="시간별 모델 결과">
        <div><strong>{elapsed} 후</strong><time>{new Date(timeline.lastSeenMs + frame.elapsed_seconds * 1000).toLocaleString('ko-KR')}</time></div>
        <div className="timeline-scrubber">
          <button type="button" title={playingTimeline ? '일시정지' : '시간 변화 재생'} aria-label={playingTimeline ? '일시정지' : '시간 변화 재생'}
            onClick={toggleTimelinePlayback}>{playingTimeline ? <Pause size={16} /> : <Play size={16} />}</button>
          <input aria-label="계산된 시점" aria-valuetext={`${elapsed} 후`} type="range" min="0" max={timeline.frames.length - 1}
            value={timelineStep} onChange={event => selectTimelineStep(Number(event.target.value))} />
        </div>
        <small>{movement ? `평균 직선거리 ${meanDistance}${movement.unchanged ? ' · 이전 시점과 같은 분포' : ''}` : timeline.label}
          {showAdjusted && reportsForStep.length ? ' · 보고 반영' : ''}</small>
      </section>}
      <div className="map-status"><span className={`status-dot ${dotClass}`} />{settings.base === 'base' ? '기본 지도' : '위성 영상'}<span>2D</span><span>ZOOM {zoom.toFixed(1)}</span></div>
    </main>
    <TerrainPanel map={mapInstance} open={terrainOpen} onOpen={openTerrain} onClose={closeTerrain} mapToolBusy={Boolean(comparison) || (interaction !== null && interaction !== 'terrain-area')}
      drawing={interaction === 'terrain-area'} onDrawingChange={setTerrainDrawing} onInspectOverlay={inspectSearchRecord} layers={comparison ? compareTerrainLayers : terrainLayers} terrain={terrain} />
    <MeasureLayer map={mapInstance} measurements={measurements} selectedId={measureId} visible={measureVisible} />
    {comparison && <MeasureLayer map={baselineMap} measurements={measurements} selectedId={measureId} visible={measureVisible} />}
    <CandidateLayer map={mapInstance} grid={analysisGrid} areas={candidates} visible={candidateVisible} selectedId={selectedCandidate?.id}
      corner={interaction === 'candidate-area' ? candidateCorner : null} />
    {comparison && <CandidateLayer map={baselineMap} grid={analysisGrid} areas={candidates} visible={candidateVisible} selectedId={selectedCandidate?.id} corner={null} />}
    <IncidentMarkerLayer map={mapInstance} markers={incident.markers} selected={selectedMarker?.id}
      visible={markersVisible} interactive={!interaction && !comparison} onSelect={selectIncidentMarker} />
    <ReportArea map={mapInstance} point={panel === 'report' && reportView === 'entry' && reportAvailable ? activeDraft?.point ?? null : null}
      radius={reportRadius} records={searchRecords.records} selectedId={panel === 'report' ? selectedRecord?.id : undefined} visible={reportRecordsVisible} />
    {comparison && <ReportArea map={baselineMap} point={null} radius={reportRadius} records={searchRecords.records} visible={reportRecordsVisible} />}
    {panel && <aside className="detail-panel"><header><span className="accent-mark" /><h2>{{ sources: '자료·설정', modules: '마지막 확인 정보', results: '분석 결과', measure: '거리 측정', candidate: '후보 구역', report: '현장 보고', history: '통행 수정 이력' }[panel]}</h2><button aria-label="상세 패널 닫기" onClick={() => setPanel(null)}><X size={20} /></button></header>
      {panel === 'modules' && <>
        {caseSaveError && <p role="alert">{caseSaveError}</p>}
        <DistancePanel input={caseInput} hasPending={Boolean(pendingLocation)} onInfo={inspectPoint}
          onTime={lastSeenUtc => updateCase({ ...caseInput, lastSeenUtc })}
          onRun={runDistance} onRunModel={import.meta.env.DEV ? runPreview : undefined} modelSettings={modelSettings} onModelSettings={setModelSettings} terrainReady={Boolean(terrain.document)} running={previewRunning} onPick={pickLocation} message={distanceMessage} />
      </>}
      {panel === 'measure' && <MeasurePanel measurements={measurements} selected={measurement} onSelect={setSelectedMeasure}
        onStart={() => startMeasure(false)} onNew={() => startMeasure(true)} onUndo={undoMeasure}
        onToggle={() => setMeasurements(previous => previous.map(item => item.id === measureId ? { ...item, visible: !item.visible } : item))}
        onClear={() => setMeasurements(previous => previous.filter(item => item.id !== measureId))} />}
      {panel === 'candidate' && <CandidatePanel grid={analysisGrid} areas={candidates} source={candidateSource}
        selected={selectedCandidate} order={candidateOrder} onOrder={setCandidateOrder} onFocus={focusCandidate}
        unavailable={candidateStale ? '현재 위치와 통행 조건으로 분석을 다시 실행해 주세요.' : 'Ring 또는 ABM을 실행하면 구역의 모델 확률이 표시됩니다.'}
        effects={candidateEffects} effectId={effectId} onEffect={setEffectId} onReport={openEffectRecord} onAnalysis={() => openAnalysis()}
        navigation={candidateSource && timeline?.abmPreview ? { index: timelineStep, count: timeline.frames.length, onStep: selectTimelineStep } : undefined}
        visible={candidateVisible} onStart={startCandidate} onToggle={() => setCandidateVisible(previous => !previous)}
        onDelete={id => setCandidates(previous => previous.filter(area => area.id !== id))} />}
      {panel === 'report' && <ReportPanel view={reportView}
        sourceNote={activeDraft?.sourceMarkerId ? '지도 마커의 위치·시각·메모를 가져왔습니다. 수색 내용·반경·승인 근거를 확인하세요.' : undefined}
        onSourceMarker={sourceMarker ? () => selectIncidentMarker(sourceMarker.id) : undefined}
        flow={<IncidentPanel input={caseInput} markers={incident.markers} reports={searchRecords.records} selected={selectedMarker}
          draft={activeMarkerDraft} ready={incident.ready} pending={markerPending} visible={markersVisible}
          hasCase={Boolean(reportCaseKey)} unassignedCount={unassigned.markers.length}
          reportPointAvailable={Boolean(selectedMarker && validLocation(analysisGrid, selectedMarker.point))}
          alreadyAdopted={Boolean(selectedMarker && caseInput.gpsAdoptions?.at(-1)?.markerId === selectedMarker.id &&
            caseInput.lastSeenUtc === selectedMarker.atUtc && caseInput.start?.every((value, i) => value === selectedMarker.point[i]))}
          onGpsReview={(marker, review) => {
            if (marker.gps?.source) void persistMarker({ ...marker, gps: { ...marker.gps, review } }, 'edit')
          }}
          onGpsAdopt={adoptGps}
          error={incident.error || (markerError?.caseKey === markerCaseKey ? markerError.message : '')}
          onAttach={() => { void attachUnassignedMarkers() }} onRetry={incident.refresh}
          onAdd={startMarker} onCancel={() => { setMarkerDraft(null); setMarkerError(null) }}
          onSave={fields => {
            if (!activeMarkerDraft) return
            const id = activeMarkerDraft.marker?.id ?? (crypto.randomUUID?.() ?? crypto.getRandomValues(new Uint32Array(4)).join('-'))
            void persistMarker({ ...fields, point: activeMarkerDraft.point, caseKey: markerCaseKey, id },
              activeMarkerDraft.marker ? 'edit' : 'add')
          }}
          onEdit={marker => { setMarkerError(null); setMarkerDraft({ caseKey: marker.caseKey, point: marker.point, marker }) }}
          onDelete={marker => { void persistMarker(marker, 'delete') }}
          onMarker={marker => { selectIncidentMarker(marker.id); setMarkersVisible(true); focusIncidentPoint(marker.point) }}
          onMap={marker => { openPanel(null); setMarkersVisible(true); focusIncidentPoint(marker.point) }}
          onStart={point => {
            if (caseInput.start?.every((value, i) => value === point[i])) inspectPoint()
            else openPanel(null)
            focusIncidentPoint(point)
          }}
          onReport={openIncidentReport} onDraftReport={startReportFromMarker} onAnalysis={() => openAnalysis()}
          onVisibility={() => setMarkersVisible(previous => !previous)} />}
        kind={reportKind} available={reportAvailable} point={activeDraft?.point ?? null} radius={reportRadius}
        elapsed={elapsed} radii={reportsForStep.map(report => report.radius)} adjusted={showAdjusted} pending={reportPending} message={reportMessage}
        fields={reportFields} records={searchRecords.records} selected={selectedRecord} visible={reportRecordsVisible}
        storageError={searchRecords.error || (reportRun?.timeline === timeline && reportRun?.key === '' ? '분석 실행을 식별하지 못했습니다.' : '')}
        onView={view => { setReportView(view); setReportMessage('') }} onAnalysis={kind => openAnalysis(kind === 'searched' ? 'abm' : undefined)}
        onShowEffect={hasSelectedEffect ? showRecordEffect : undefined} onFields={setReportFields} onSelect={setSelectedReportId} onFocus={focusReport}
        onKind={kind => { setReportKind(kind); setReportDraft(null); setReportMessage('') }} onVisibility={() => setReportRecordsVisible(previous => !previous)}
        onPick={startReport} onRadius={setReportRadius} onToggle={() => setShowAdjusted(previous => !previous)} onApprove={approveReport} />}
      {panel === 'results' && <section className="results-panel">
        {hasResult ? <>
          <span className="method-chip">{timeline ? timeline.synthetic ? '동작 확인용 예제' : timeline.abmPreview ? timeline.label : '시간별 모델 결과' : ring ? 'Ring 모델 · 거리 기반 확률' : '거리 기준'}</span>
          <h3>{timeline ? `${elapsed} 후 위치 분포` : ring ? 'Ring 확률 지도가 표시됐습니다' : '거리 순위가 표시됐습니다'}</h3>
          {cannotDepart && <div className="workspace-next">
            <p className="save-warning" role="status">현재 조건에서 마지막 확인 위치 주변에 이동할 수 있는 셀이 없어 출발점에 머물렀습니다.</p>
            <button className="secondary-action" onClick={() => openAnalysis('abm')}>이동 조건 확인</button>
          </div>}
          {timeline && <div className="workspace-next timeline-summary">
            {movement && <>
              <span>마지막 확인점에서 평균 직선거리</span>
              <strong>{meanDistance}</strong>
              {movement.unchanged && <p className="field-help">이전 시점과 같은 분포입니다.</p>}
            </>}
            <div className="compact-actions">
              <button className="secondary-action" disabled={timelineStep === 0} onClick={() => selectTimelineStep(timelineStep - 1)}>이전 시점</button>
              <button className="secondary-action" disabled={timelineStep === timeline.frames.length - 1} onClick={() => selectTimelineStep(timelineStep + 1)}>다음 시점</button>
            </div>
            <button className="primary-action" onClick={replayTimeline}>시간 변화 재생</button>
          </div>}
          {timeline?.abmPreview && <div className="field-help">
            <p>{timeline.abmPreview.samples}개 경로 · 30분 간격</p>
            <p>{timeline.terrainRevision
              ? `통행 조건 적용 · 미확인 셀 ${timeline.abmPreview.accessMode === 'known-only' ? '제외' : '허용'} · 버전 ${timeline.terrainRevision.slice(0, 8)}`
              : '지도 통행 조건 미적용'}</p>
            {timeline.abmPreview.demVersion && <p>분석용 DEM 사용{timeline.abmPreview.slopeLimit ? ` · ${timeline.abmPreview.slopeLimit}° 초과 제외` : ''}</p>}
          </div>}
          {ring && <>
            <p>{ring.profileLabel} · 격자 안에 포함된 모델 확률 {(ring.inGridMass * 100).toFixed(1)}%</p>
            <p className="field-help">Ring은 마지막 확인점 기준으로 확률 지도 한 장을 계산합니다. 시간에 따른 변화는 ABM에서 볼 수 있습니다.</p>
            {import.meta.env.DEV && <button className="secondary-action" onClick={() => openAnalysis('abm')}>시간별 이동 계산 설정</button>}
          </>}
          {resultNotice && <p className="save-warning">{resultNotice}</p>}
          {!resultNotice && (ring || timeline?.abmPreview) && <div className="workspace-next">
            <strong>다음 작업</strong>
            <p className="field-help">후보 구역을 그려 지도 색을 구역별 확률로 확인하세요.</p>
            <button className="primary-action" onClick={() => openPanel('candidate')}>후보 구역 열기</button>
            {timeline?.abmPreview && import.meta.env.DEV && <button className="secondary-action" onClick={() => { setReportView('entry'); openPanel('report') }}>현장 보고 작성</button>}
          </div>}
          {!ring && <p>{caseInput.lastSeenUtc && new Date(caseInput.lastSeenUtc).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })} 확인 정보 기준</p>}
          <div className="compact-actions"><button className="secondary-action" onClick={inspectPoint}>기준 지점 정보</button>
            <button className="secondary-action" onClick={() => { cancelPreview(); clearDistance(); clearTimeline(); setRing(null) }}>결과 닫기</button></div>
          <details><summary>계산 방식 확인</summary><p>{timeline ? timeline.abmPreview ? '각 시점에 해당 셀에 도달한 시뮬레이션의 비율을 표시합니다. 개발 격자 경계 안에서만 이동을 계산합니다. 색의 번짐은 화면 표시용입니다.' : '불러온 시점별 셀 값을 공통 색상 척도로 표시합니다.' : ring ? `마지막 확인 위치로부터의 거리에 따라 확률을 배분합니다. 지형·통행 조건·경과 시간은 반영하지 않습니다. (${ring.modelVersion})` : '시작점에 가까운 셀부터 순위를 표시합니다. 지형·시간에 따른 이동은 반영하지 않습니다.'}</p></details>
          {distanceRun && <button className="secondary-action" onClick={runDistance}>다시 계산</button>}
        </> : <>
          <h3>아직 분석 결과가 없습니다</h3>
          <p>마지막 확인 위치와 시각을 정하면 분석할 수 있습니다.</p>
          <button className="primary-action" onClick={() => setPanel('modules')}>확인 정보 입력</button>
        </>}
        {(timeline?.abmPreview || baseline) && <section className="comparison-panel" aria-label="분석 비교">
          <h3>분석 비교</h3>
          {baseline && <p className="field-help">기준 A 저장됨 · {baseline.label}{baseline.terrainRevision ? ` · 통행 ${baseline.terrainRevision.slice(0, 8)}` : ''}</p>}
          {typeof comparisonCandidate === 'string' && <p className="field-help">{comparisonCandidate}</p>}
          <div className="compact-actions">
            {timeline?.abmPreview && baseline !== timeline &&
              <button className="secondary-action" onClick={() => setBaseline(timeline)}>{baseline ? '현재 결과로 기준 교체' : '현재 결과를 기준으로 저장'}</button>}
            {baseline && <button className="secondary-action" onClick={() => setBaseline(null)}>기준 지우기</button>}
          </div>
          {typeof comparisonCandidate !== 'string' && <button className="primary-action" onClick={startComparison}>기준과 현재 비교</button>}
          <p className="field-help">기준은 새로고침 전까지 유지합니다. 현장 보고 반영 전의 모델 결과를 비교합니다.</p>
        </section>}
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
