import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Marker, type Map } from 'maplibre-gl'
import { localDateTime, parseLastSeenTime, type CaseInput } from './case'
import { incidentEvents, markerLabels, orderedMarkers, type IncidentMarker, type MarkerDraft, type MarkerKind } from './incident'
import type { MapPoint } from './measure'
import type { SearchRecord } from './searchRecord'
import { GpsEvidence } from './GpsEvidence'
import type { GpsReview } from './gps'
import { DeleteAction } from './DeleteAction'

const markerSymbols = { report: '!', cctv: 'C', gps: 'GPS', search: 'S' }
const formatDay = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', year: 'numeric' })
const formatTime = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

type MarkerFields = Pick<IncidentMarker, 'kind' | 'atUtc' | 'note' | 'completed' | 'gps'>

function MarkerEditor({ draft, pending, onSave, onCancel }: {
  draft: MarkerDraft
  pending: boolean
  onSave: (fields: MarkerFields) => void
  onCancel: () => void
}) {
  const [local] = useState(() => localDateTime(draft.marker?.atUtc ?? new Date().toISOString()))
  const [kind, setKind] = useState<MarkerKind>(draft.marker?.kind ?? 'report')
  const [date, setDate] = useState(local.slice(0, 10))
  const [time, setTime] = useState(draft.marker ? local.slice(11, 16) : '')
  const [note, setNote] = useState(draft.marker?.note ?? '')
  const [source, setSource] = useState(draft.marker?.gps?.source ?? '')
  const [accuracy, setAccuracy] = useState(draft.marker?.gps?.accuracyM?.toString() ?? '')
  const [completed, setCompleted] = useState(draft.marker?.completed ?? false)
  const [error, setError] = useState('')
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const atUtc = parseLastSeenTime(date, time)
    if (!atUtc) {
      setError('현장 날짜와 시각을 확인해 주세요. 시각은 1430 또는 14:30처럼 입력하세요.')
      return
    }
    if (Date.parse(atUtc) > Date.now()) {
      setError('현장 시각은 현재보다 늦을 수 없습니다. 날짜와 시간대를 확인해 주세요.')
      return
    }
    const accuracyM = accuracy.trim() ? Number(accuracy) : null
    if (kind === 'gps' && accuracyM !== null && (!Number.isFinite(accuracyM) || accuracyM <= 0)) {
      setError('위치 오차는 0보다 큰 미터 단위 숫자로 입력해 주세요.')
      return
    }
    const previous = draft.marker?.gps
    const unchanged = previous?.source === source.trim() && previous.accuracyM === accuracyM && draft.marker?.atUtc === atUtc
    const gps = kind === 'gps' ? { source: source.trim(), accuracyM, ...(unchanged && previous?.review ? { review: previous.review } : {}) } : undefined
    setError('')
    onSave({ kind, atUtc, note: note.trim(), completed: kind === 'search' && completed, ...(gps ? { gps } : {}) })
  }
  return <form className="search-record-form incident-editor" onSubmit={submit}>
    <fieldset disabled={pending}>
      <h3>{draft.marker ? '마커 수정' : '지도 마커 추가'}</h3>
      <p className="field-help">위도 {draft.point[1].toFixed(5)} · 경도 {draft.point[0].toFixed(5)}</p>
      <label htmlFor="incident-kind">유형</label>
      <select id="incident-kind" value={kind} onChange={event => setKind(event.target.value as MarkerKind)}>
        {Object.entries(markerLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <div className="confirm-time">
        <label>현장 날짜<input inputMode="numeric" value={date} onChange={event => setDate(event.target.value)} /></label>
        <label>현장 시각<input inputMode="numeric" placeholder="1430" value={time} onChange={event => setTime(event.target.value)} /></label>
      </div>
      <div className="incident-time-help">
        <p className="field-help">24시간제 · {Intl.DateTimeFormat().resolvedOptions().timeZone}</p>
        <button className="secondary-action" type="button" onClick={() => {
          const now = localDateTime(new Date().toISOString())
          setDate(now.slice(0, 10))
          setTime(now.slice(11, 16))
          setError('')
        }}>현재 시각 입력</button>
      </div>
      <div className="report-text-field">
        <label htmlFor="incident-note">메모 (선택)</label>
        <textarea id="incident-note" rows={3} maxLength={1000} value={note} onChange={event => setNote(event.target.value)} />
      </div>
      {kind === 'gps' && <>
        <label>신호 출처<input maxLength={200} value={source} onChange={event => setSource(event.target.value)} /></label>
        <label>위치 오차 (m)<input type="number" step="any" min="0" placeholder="미확인" value={accuracy}
          onChange={event => setAccuracy(event.target.value)} /></label>
        {draft.marker?.gps?.review && <p className="field-help">시각·출처·오차를 바꾸면 다시 검토할 수 있습니다.</p>}
      </>}
      {kind === 'search' && <label className="incident-check"><input type="checkbox" checked={completed} onChange={event => setCompleted(event.target.checked)} />마커에 수색 완료 표시</label>}
      {error && <p role="alert">{error}</p>}
      <button className="primary-action" type="submit">{pending ? '저장 중…' : '마커 저장'}</button>
      <button className="secondary-action" type="button" onClick={onCancel}>취소</button>
    </fieldset>
  </form>
}

export function IncidentPanel({ input, markers, reports, selected, draft, ready, pending, error, visible, hasCase, unassignedCount, reportPointAvailable, alreadyAdopted, onGpsReview, onGpsAdopt,
  onAdd, onSave, onCancel, onEdit, onDelete, onMarker, onMap, onStart, onReport, onDraftReport, onAnalysis, onVisibility, onAttach, onRetry }: {
  input: CaseInput
  markers: readonly IncidentMarker[]
  reports: readonly SearchRecord[]
  selected: IncidentMarker | undefined
  draft: MarkerDraft | null
  ready: boolean
  pending: boolean
  error: string
  visible: boolean
  hasCase: boolean
  unassignedCount: number
  reportPointAvailable: boolean
  alreadyAdopted: boolean
  onGpsReview: (marker: IncidentMarker, review: GpsReview) => void
  onGpsAdopt: (marker: IncidentMarker) => void
  onAttach: () => void
  onRetry: () => void
  onAdd: () => void
  onSave: (fields: MarkerFields) => void
  onCancel: () => void
  onEdit: (marker: IncidentMarker) => void
  onDelete: (marker: IncidentMarker) => void
  onMarker: (marker: IncidentMarker) => void
  onMap: (marker: IncidentMarker) => void
  onStart: (point: MapPoint) => void
  onReport: (record: SearchRecord) => void
  onDraftReport: (marker: IncidentMarker) => void
  onAnalysis: () => void
  onVisibility: () => void
}) {
  const events = useMemo(() => incidentEvents(input, markers, reports), [input, markers, reports])
  const selectionRef = useRef<HTMLElement>(null)
  useEffect(() => { selectionRef.current?.scrollIntoView({ block: 'nearest' }) }, [selected?.id, draft])
  const linkedReports = selected ? reports.filter(report => report.sourceMarkerId === selected.id) : []
  return <>
    {error && <p role="alert" className="save-warning">{error}</p>}
    {!ready && error && <button className="secondary-action" onClick={onRetry}>마커 다시 불러오기</button>}
    {draft ? <MarkerEditor key={draft.marker?.id ?? draft.point.join(',')} draft={draft} pending={pending} onSave={onSave} onCancel={onCancel} /> : <>
      <button className="primary-action" disabled={!ready || pending} onClick={onAdd}>지도에 마커 추가</button>
      {!hasCase && <div className="workspace-next">
        <p className="field-help">먼저 마커를 저장하고, 마지막 확인 정보를 입력한 뒤 사건에 연결할 수 있습니다.</p>
        <button className="secondary-action" onClick={onAnalysis}>확인 정보 입력</button>
      </div>}
      {hasCase && unassignedCount > 0 && <div className="workspace-next">
        <p className="field-help">아직 사건에 연결하지 않은 마커 {unassignedCount}개</p>
        <button className="secondary-action" disabled={!ready || pending} onClick={onAttach}>임시 마커를 이 사건에 연결</button>
      </div>}
    </>}
    {selected && !draft && <article ref={selectionRef} className="search-record-card incident-selection" aria-label="선택한 지도 마커">
      <strong>{markerLabels[selected.kind]}{selected.completed ? ' · 수색 완료 표기' : ''}</strong>
      {selected.note && <p className="search-record-original">{selected.note}</p>}
      <p className="field-help">{formatDay.format(new Date(selected.atUtc))} {formatTime.format(new Date(selected.atUtc))} · 위도 {selected.point[1].toFixed(5)} · 경도 {selected.point[0].toFixed(5)}</p>
      <div className="compact-actions">
        <button className="secondary-action" onClick={() => onMap(selected)}>지도 보기</button>
        <button className="secondary-action" disabled={pending} onClick={() => onEdit(selected)}>수정</button>
      </div>
      {selected.kind === 'search' && hasCase && (reportPointAvailable ?
        <button className="secondary-action" disabled={pending} onClick={() => onDraftReport(selected)}>이 마커로 현장 보고 작성</button> :
        <p className="field-help">분석 범위 밖의 마커입니다. 수색 보고는 분석 범위 안에서 작성할 수 있습니다.</p>)}
      {linkedReports.map(record => <button key={record.id} className="secondary-action" onClick={() => onReport(record)}>
        승인 보고 보기 · {formatTime.format(new Date(record.approvedAtUtc))}
      </button>)}
      {selected.kind === 'gps' && <GpsEvidence key={`gps-${selected.id}`} marker={selected} pending={pending}
        canAdopt={reportPointAvailable} alreadyAdopted={alreadyAdopted}
        onReview={review => onGpsReview(selected, review)} onAdopt={() => onGpsAdopt(selected)} />}
      <DeleteAction key={`delete-${selected.id}`} label="마커 삭제" question="이 지도 마커를 삭제할까요?"
        pending={pending} onDelete={() => onDelete(selected)} />
    </article>}
    {events.length > 0 && <ol className="incident-timeline" aria-label="사건 시간순 기록">
      {events.map((event, index) => {
        const time = new Date(event.at)
        const day = formatDay.format(time)
        const previous = events[index - 1]
        const showDay = !previous || formatDay.format(new Date(previous.at)) !== day
        const colorKind = event.kind === 'marker' ? `marker-${event.marker.kind}` : event.kind
        const activate = () => {
          if (event.kind === 'marker') onMarker(event.marker)
          else if (event.kind === 'report') onReport(event.report)
          else onStart(event.point)
        }
        return <li key={event.id} data-kind={colorKind}>
          {showDay && <p className="incident-day">{day}</p>}
          <button type="button" className="incident-event" onClick={activate}
            aria-current={event.kind === 'marker' && event.marker.id === selected?.id ? 'true' : undefined}>
            <time dateTime={event.at}>{formatTime.format(time)}</time>
            <span><strong>{event.label}</strong>{event.note && <small>{event.note}</small>}</span>
          </button>
        </li>
      })}
    </ol>}
    {markers.length > 0 && <label className="measure-visibility"><input type="checkbox" checked={visible} onChange={onVisibility} />지도 마커 표시</label>}
  </>
}

export function IncidentMarkerLayer({ map, markers, selected, visible, interactive, onSelect }: {
  map: Map | null
  markers: readonly IncidentMarker[]
  selected: string | undefined
  visible: boolean
  interactive: boolean
  onSelect: (id: string) => void
}) {
  useEffect(() => {
    if (!map || !visible) return
    const items = orderedMarkers(markers)
      .map((item, index) => {
        const element = document.createElement('button')
        element.type = 'button'
        element.className = item.id === selected ? 'incident-marker selected' : 'incident-marker'
        element.dataset.kind = item.kind
        element.disabled = !interactive
        if (!interactive) element.style.pointerEvents = 'none'
        element.textContent = `${item.completed ? '✓' : markerSymbols[item.kind]} ${index + 1}`
        element.setAttribute('aria-label', `지도 마커 ${index + 1} · ${markerLabels[item.kind]}`)
        element.addEventListener('click', event => {
          event.stopPropagation()
          onSelect(item.id)
        })
        return new Marker({ element, anchor: 'bottom', offset: [0, -3] }).setLngLat(item.point).addTo(map)
      })
    return () => { for (const item of items) item.remove() }
  }, [map, markers, selected, visible, interactive, onSelect])
  return null
}
