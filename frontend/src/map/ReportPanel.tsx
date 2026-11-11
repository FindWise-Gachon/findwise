import { useEffect, useMemo, type ReactNode } from 'react'
import type { GeoJSONSource, Map } from 'maplibre-gl'
import type { FeatureCollection, Polygon } from 'geojson'
import { analysisGrid } from './config'
import { approvedFill, approvedLine, reportAreaSource, reportCircle } from './reportMap'
import type { MapPoint } from './measure'
import { findReportOverlaps, reviewWindowMinutes } from './reportOverlap'
import { reportLabels, reportRadii, type ReportKind, type ReportFields, type ReportRadius, type SearchRecord } from './searchRecord'
import { formatElapsed } from './timeline'

const formatDate = (utc: string) => new Date(utc).toLocaleString('ko-KR')

export type ReportView = 'flow' | 'entry' | 'records'

export function ReportPanel({ view, kind, available, point, radius, elapsed, radii, adjusted, pending, message, fields, records,
  selected, visible, storageError, flow, sourceNote, onSourceMarker, onPick, onRadius, onToggle, onApprove, onFields, onSelect, onFocus, onKind, onVisibility, onView, onAnalysis, onShowEffect }: {
  view: ReportView
  kind: ReportKind
  available: boolean
  point: MapPoint | null
  radius: ReportRadius
  elapsed: string
  radii: readonly ReportRadius[]
  adjusted: boolean
  pending: boolean
  message: string
  fields: ReportFields
  records: readonly SearchRecord[]
  selected: SearchRecord | undefined
  visible: boolean
  storageError: string
  flow: ReactNode
  sourceNote?: string
  onSourceMarker?: () => void
  onPick: () => void
  onRadius: (radius: ReportRadius) => void
  onToggle: () => void
  onApprove: (approvedAtUtc: string) => void
  onFields: (fields: ReportFields) => void
  onSelect: (id: string) => void
  onFocus: (record: SearchRecord) => void
  onKind: (kind: ReportKind) => void
  onVisibility: () => void
  onView: (view: ReportView) => void
  onAnalysis: (kind: ReportKind) => void
  onShowEffect?: () => void
}) {
  const overlaps = useMemo(() => findReportOverlaps(analysisGrid, records), [records])
  const searched = kind === 'searched'
  const requiresDev = searched && !import.meta.env.DEV
  return <section className="measure-panel">
    <div className="panel-switch incident-tabs" role="group" aria-label="현장 보고 화면">
      <button aria-pressed={view === 'flow'} onClick={() => onView('flow')}>사건 흐름</button>
      <button aria-pressed={view === 'entry'} onClick={() => onView('entry')}>보고 작성</button>
      <button aria-pressed={view === 'records'} onClick={() => onView('records')}>승인 기록</button>
    </div>
    {storageError && <p role="alert">{storageError}</p>}
    {message && <p className="workspace-next" role="status">{message}</p>}
    {view === 'flow' ? flow : view === 'records' ? <>
      {radii.length > 0 && <>
        <p className="field-help">이 시점에 반영한 보고 {radii.length}건</p>
        <label className="measure-visibility"><input type="checkbox" checked={adjusted} onChange={onToggle} />보고 반영 결과 표시</label>
      </>}
      {records.length ? <>
        <label className="measure-visibility"><input type="checkbox" checked={visible} onChange={onVisibility} />현장 보고 표시</label>
        <label className="measure-picker">승인 보고 선택
          <select value={selected?.id ?? ''} onChange={event => onSelect(event.target.value)}>
            {records.map(record => <option key={record.id} value={record.id}>{reportLabels[record.kind]} · {formatDate(record.searchedAtUtc)} · {record.rawText.trim().slice(0, 36)}</option>)}
          </select>
        </label>
        {selected && <article className="search-record-card" aria-label="승인 보고 상세">
          <strong>{reportLabels[selected.kind]} · 보고 원문</strong>
          <p className="search-record-original">{selected.rawText}</p>
          <dl>
            <div><dt>현장 시각</dt><dd>{formatDate(selected.searchedAtUtc)}</dd></div>
            <div><dt>보고 반경</dt><dd>{selected.radius} m</dd></div>
            <div><dt>승인</dt><dd>{selected.reviewer} · {formatDate(selected.approvedAtUtc)}</dd></div>
            <div><dt>승인 근거</dt><dd>{selected.reason}</dd></div>
            {selected.kind === 'searched'
              ? <div><dt>반영 시점</dt><dd>{formatElapsed(selected.stepSeconds)} 후 · {selected.changed ? '확률 갱신' : '확률 변화 없음'}</dd></div>
              : <div><dt>반영 범위</dt><dd>지도 기록</dd></div>}
          </dl>
          {onSourceMarker && <button className="secondary-action" onClick={onSourceMarker}>원본 지도 마커 보기</button>}
          {onShowEffect && <button className="secondary-action" onClick={onShowEffect}>후보 구역 변화 보기</button>}
        </article>}
      </> : !storageError && <p className="field-help">현재 확인 위치와 시각에 연결된 승인 기록이 없습니다.</p>}
      {overlaps.length > 0 && <section className="report-overlaps" aria-label="함께 검토할 보고">
        <h3>함께 검토할 보고 · {overlaps.length}쌍</h3>
        <p className="field-help">같은 지역에서 {reviewWindowMinutes}분 이내에 두 유형의 범위가 겹친 기록입니다. 원문과 시각을 함께 확인하세요.</p>
        {overlaps.map(({ searched: search, blocked, gapMinutes }) => <details key={search.id + blocked.id}>
          <summary>수색 완료 / 진입 불가 · {Math.round(gapMinutes)}분 차이</summary>
          <div className="report-overlap-pair">
            {[search, blocked].map(record => <article key={record.id} className="search-record-card">
              <strong>{reportLabels[record.kind]}</strong>
              <p className="field-help">{formatDate(record.searchedAtUtc)} · 반경 {record.radius} m</p>
              <p className="search-record-original">{record.rawText}</p>
              <button className="secondary-action" onClick={() => onFocus(record)}>{reportLabels[record.kind]} 구역 보기</button>
            </article>)}
          </div>
        </details>)}
      </section>}
    </> : <>
      <p className="field-help">보고 유형과 위치를 고른 뒤 원문과 승인 근거를 남기세요.</p>
      {sourceNote && <p className="workspace-next" role="status">{sourceNote}</p>}
      <label className="measure-picker">보고 유형
        <select value={kind} disabled={pending} onChange={event => onKind(event.target.value === 'blocked' ? 'blocked' : 'searched')}>
          <option value="searched">수색 완료</option><option value="blocked">진입 불가</option>
        </select>
      </label>
      {!available ? <div className="workspace-next">
        <p className="field-help">{requiresDev ? '수색 완료 보고의 확률 반영은 로컬 개발 서버에서 사용할 수 있습니다.' :
          searched ? '수색 완료 보고는 현재 ABM 결과의 시점에 반영합니다.' : '마지막 확인 위치와 시각을 먼저 설정해 주세요.'}</p>
        {!requiresDev && <button className="secondary-action" onClick={() => onAnalysis(kind)}>{searched ? 'ABM 실행 조건 열기' : '확인 위치 열기'}</button>}
      </div> : <>
        <p className="field-help">{searched ? `기준 시점 · ${elapsed} 후` : '지도에 보고를 기록합니다. 모델의 이동 제한은 통행 설정에서 관리합니다.'}</p>
        <button className="secondary-action" disabled={pending} onClick={onPick}>{point ? '중심 위치 변경' : searched ? '지도에서 수색 중심 지정' : '지도에서 진입 불가 구역 지정'}</button>
        {point && <form className="search-record-form" onSubmit={event => { event.preventDefault(); onApprove(new Date().toISOString()) }}>
          <fieldset disabled={pending}>
            <div className="report-text-field">
              <label htmlFor="field-report-original">보고 원문</label>
              <textarea id="field-report-original" required maxLength={4000} rows={3} value={fields.rawText}
                onChange={event => onFields({ ...fields, rawText: event.target.value })} />
            </div>
            <label>{searched ? '수색 시각' : '현장 확인 시각'}<input required type="datetime-local" value={fields.searchedAt} onChange={event => onFields({ ...fields, searchedAt: event.target.value })} /></label>
            <label>{searched ? '수색 반경' : '구역 반경'}<select value={radius} onChange={event => onRadius(Number(event.target.value) as ReportRadius)}>
              {reportRadii.map(value => <option key={value} value={value}>{value} m</option>)}
            </select></label>
            <label>검토자 이름<input required maxLength={80} value={fields.reviewer} onChange={event => onFields({ ...fields, reviewer: event.target.value })} /></label>
            <label>승인 근거<textarea required maxLength={1000} rows={2} value={fields.reason} onChange={event => onFields({ ...fields, reason: event.target.value })} /></label>
            <p className="field-help">{searched ? '지도에서 범위를 확인하세요. 이 개발 계산은 탐지 확률을 50%로 가정합니다.' : '지도에서 진입 불가 구역의 범위를 확인하세요.'}</p>
            <button className="primary-action" type="submit">{pending ? '저장 중…' : searched ? '수색 완료 승인 및 반영' : '진입 불가 승인 및 기록'}</button>
          </fieldset>
        </form>}
      </>}
    </>}
  </section>
}

const emptyRecords: SearchRecord[] = []

export function ReportArea({ map, point, radius, records = emptyRecords, selectedId, visible }: {
  map: Map | null
  point: MapPoint | null
  radius: ReportRadius
  records?: readonly SearchRecord[]
  selectedId?: string
  visible: boolean
}) {
  useEffect(() => {
    if (!map) return
    const update = () => {
      if (!map.getLayer('analysis-boundary')) return
      const features = visible ? records.map(record => reportCircle(analysisGrid, record.point, record.radius, record.id, record.id === selectedId, record.kind)) : []
      if (point) features.push(reportCircle(analysisGrid, point, radius, null, false))
      const data: FeatureCollection<Polygon> = { type: 'FeatureCollection', features }
      const source = map.getSource<GeoJSONSource>(reportAreaSource)
      if (source) source.setData(data)
      else if (features.length) {
        map.addSource(reportAreaSource, { type: 'geojson', data })
        map.addLayer({ id: approvedFill, source: reportAreaSource, type: 'fill', filter: ['==', ['get', 'approved'], true],
          paint: { 'fill-color': ['match', ['get', 'kind'], 'blocked', '#f4bd70', '#54d5c2'], 'fill-opacity': ['case', ['get', 'selected'], .25, .10] } })
        map.addLayer({ id: approvedLine, source: reportAreaSource, type: 'line', filter: ['==', ['get', 'approved'], true],
          paint: { 'line-color': ['match', ['get', 'kind'], 'blocked', '#ad6929', '#166a5e'], 'line-width': ['case', ['get', 'selected'], 4, 2] } })
        map.addLayer({ id: reportAreaSource + '-draft', source: reportAreaSource, type: 'line', filter: ['==', ['get', 'approved'], false],
          paint: { 'line-color': '#83e9dc', 'line-width': 3, 'line-dasharray': [2, 2] } })
      }
    }
    map.on('style.load', update)
    update()
    return () => { map.off('style.load', update) }
  }, [map, point, radius, records, selectedId, visible])
  return null
}
