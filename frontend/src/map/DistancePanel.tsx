import { useState, type FormEvent } from 'react'
import { localDateTime, parseLastSeenTime, type CaseInput } from './case'

function ConfirmTime({ utc, onConfirm, onCancel }: { utc: string; onConfirm: (utc: string) => void; onCancel?: () => void }) {
  const local = localDateTime(utc)
  const [date, setDate] = useState(local.slice(0, 10))
  const [time, setTime] = useState(local.slice(11, 16))
  const [invalid, setInvalid] = useState(false)
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  function chooseDay(daysAgo: number) {
    const day = new Date()
    day.setDate(day.getDate() - daysAgo)
    setDate(localDateTime(day.toISOString()).slice(0, 10))
    setInvalid(false)
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = parseLastSeenTime(date, time)
    if (value) onConfirm(localDateTime(value).slice(0, 16) === local.slice(0, 16) ? utc : value)
    else setInvalid(true)
  }
  return <form className="search-time" onSubmit={submit}>
    <div className="confirm-time">
      <label>확인 날짜<input type="text" inputMode="numeric" autoComplete="off" placeholder="20261109"
        aria-describedby="last-seen-help" value={date} onChange={event => { setDate(event.target.value); setInvalid(false) }} /></label>
      <label>확인 시간<input type="text" inputMode="numeric" autoComplete="off" placeholder="1430"
        aria-describedby="last-seen-help" value={time} onChange={event => { setTime(event.target.value); setInvalid(false) }} /></label>
    </div>
    <div className="compact-actions time-shortcuts" role="group" aria-label="날짜 빠르게 선택">
      <button type="button" className="secondary-action" onClick={() => chooseDay(0)}>오늘</button>
      <button type="button" className="secondary-action" onClick={() => chooseDay(1)}>어제</button>
    </div>
    <p className="field-help" id="last-seen-help">24시간제 · 오후 2시 30분은 1430 또는 14:30 · {zone}</p>
    {invalid && <p className="save-warning" role="alert">날짜와 시각을 확인해 주세요. 예: 2026-11-09, 14:30</p>}
    <div className="compact-actions">
      <button type="submit" className="primary-action">시각 확정</button>
      {onCancel && <button type="button" className="secondary-action" onClick={onCancel}>변경 취소</button>}
    </div>
  </form>
}

export function CoordinateEntry({ point, onSelect }: { point: [number, number] | null; onSelect: (point: [number, number]) => void }) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    onSelect([Number(data.get('longitude')), Number(data.get('latitude'))])
  }
  return <form key={point?.join(',')} className="distance-form" onSubmit={submit}>
    <label>위도<input name="latitude" type="number" step="any" min="-90" max="90" required defaultValue={point?.[1].toFixed(5)} /></label>
    <label>경도<input name="longitude" type="number" step="any" min="-180" max="180" required defaultValue={point?.[0].toFixed(5)} /></label>
    <button type="submit" className="secondary-action">지도에서 이 좌표 확인</button>
  </form>
}

export type PreviewModel = 'ring' | 'abm'
export type AbmOptions = { applyAccess: boolean; allowUnknown: boolean; behavior: 'rw' | 've'; slopeLimit: 35 | 45 | null }

export type AnalysisSettings = { model: PreviewModel; hours: 1 | 2; abm: AbmOptions }

export function DistancePanel({ input, hasPending, onInfo, onTime, onRun, onRunModel, modelSettings, onModelSettings, terrainReady, running, onPick, message }: {
  input: CaseInput
  hasPending: boolean
  onInfo: () => void
  onTime: (utc: string) => void
  onRun: () => void
  onRunModel?: (model: PreviewModel, hours: 1 | 2, options: AbmOptions) => void
  modelSettings: AnalysisSettings
  onModelSettings: (value: AnalysisSettings) => void
  terrainReady: boolean
  running: PreviewModel | null
  onPick: () => void
  message: string
}) {
  const [editingTime, setEditingTime] = useState(false)
  const timeConfirmed = Boolean(input.lastSeenUtc) && !editingTime
  const lastSeen = localDateTime(input.lastSeenUtc)
  const { model, hours, abm } = modelSettings
  const setAbm = (options: Partial<AbmOptions>) => onModelSettings({ ...modelSettings, abm: { ...abm, ...options } })
  const modelName = model === 'ring' ? 'Ring 모델' : abm.behavior === 've' ? 'ABM 높은 곳으로 이동' : 'ABM 무작위 보행'
  const canRun = Boolean(input.start && timeConfirmed && !hasPending && !running && (model !== 'abm' || !abm.applyAccess || terrainReady))
  return <section className="search-input">
    {!input.start && <div className="workspace-next"><h3>어디를 먼저 살펴볼까요?</h3>
      <p className="field-help">마지막 확인 위치와 시각을 입력하면 모델이 계산한 가능성 분포를 지도에서 볼 수 있어요.</p>
    </div>}
    <div className="input-step"><span className="step-number">1</span><h3>마지막으로 본 위치</h3></div>
    <div className="location-summary">
      <strong>{hasPending ? '새 위치 확인이 필요합니다' : input.start ? '위치가 설정되었습니다' : '지도를 눌러 지정하세요'}</strong>
      <div className="compact-actions">
        <button className={input.start ? 'secondary-action' : 'primary-action'} onClick={onPick}>{input.start ? '위치 변경' : '지도에서 지정'}</button>
        {(input.start || hasPending) && <button className="secondary-action" onClick={onInfo}>지점 정보</button>}
      </div>
    </div>
    {input.start && <>
      <div className="input-step"><span className="step-number">2</span><h3>마지막으로 본 시각</h3></div>
      {timeConfirmed ? <div className="time-confirmed">
        <time dateTime={input.lastSeenUtc}>{lastSeen.slice(0, 10)} · {lastSeen.slice(11, 16)}</time>
        <button type="button" className="secondary-action" onClick={() => setEditingTime(true)}>시각 변경</button>
      </div> : <ConfirmTime utc={input.lastSeenUtc}
        onConfirm={utc => {
          if (utc !== input.lastSeenUtc) onTime(utc)
          setEditingTime(false)
        }}
        onCancel={input.lastSeenUtc ? () => setEditingTime(false) : undefined} />}
      {timeConfirmed && <form className="search-time" onSubmit={event => { event.preventDefault(); if (canRun) onRunModel?.(model, hours, abm) }}>
        <div className="input-step"><span className="step-number">3</span><h3>분석 실행</h3></div>
        {onRunModel && <>
          <label className="measure-picker">분석 모델
            <select value={model} onChange={event => onModelSettings({ ...modelSettings, model: event.target.value === 'abm' ? 'abm' : 'ring' })} disabled={Boolean(running)}>
              <option value="ring">Ring · 거리 기반</option>
              <option value="abm">ABM · 행동 시뮬레이션</option>
            </select>
          </label>
          {model === 'abm' ? <>
            <label className="measure-picker">행동
              <select value={abm.behavior} disabled={Boolean(running)}
                onChange={event => setAbm({ behavior: event.target.value === 've' ? 've' : 'rw' })}>
                <option value="rw">무작위 보행</option><option value="ve">높은 곳으로 이동</option>
              </select>
            </label>
            <label className="measure-picker">계산 시간
              <select value={hours} onChange={event => onModelSettings({ ...modelSettings, hours: event.target.value === '2' ? 2 : 1 })} disabled={Boolean(running)}>
                <option value="1">1시간</option><option value="2">2시간</option>
              </select>
            </label>
            <details className="analysis-options" open={abm.applyAccess && !terrainReady ? true : undefined}>
              <summary>통행·경사 설정</summary>
              <label className="measure-visibility"><input type="checkbox" checked={abm.applyAccess} disabled={Boolean(running)}
                onChange={event => setAbm({ applyAccess: event.target.checked })} />지도 통행 조건 적용</label>
              {abm.applyAccess && <label className="measure-visibility"><input type="checkbox" checked={abm.allowUnknown} disabled={Boolean(running)}
                onChange={event => setAbm({ allowUnknown: event.target.checked })} />미확인 셀 이동 허용</label>}
              <label className="measure-picker">경사 제한 (실험)
                <select value={abm.slopeLimit ?? ''} disabled={Boolean(running)}
                  onChange={event => setAbm({ slopeLimit: event.target.value === '35' ? 35 : event.target.value === '45' ? 45 : null })}>
                  <option value="">제한 없음</option><option value="35">35° 초과 제외</option><option value="45">45° 초과 제외</option>
                </select>
              </label>
              {(abm.behavior === 've' || abm.slopeLimit !== null) && <p className="field-help">현재 격자에 맞춘 분석용 DEM이 필요합니다.</p>}
            </details>
            {abm.applyAccess && !terrainReady && <div className="workspace-next">
              <p className="field-help">지도 통행 자료를 연결하면 이 조건으로 계산할 수 있습니다.</p>
              <button type="button" className="secondary-action" onClick={() => setAbm({ applyAccess: false })}>통행 조건 적용 해제</button>
            </div>}
          </> : <p className="field-help">거리 기반 확률 지도 한 장 · 시간별 이동은 ABM을 선택하세요.</p>}
          <button className="primary-action" type="submit" disabled={!canRun}>{running ? `${modelName} 계산 중…` : `${modelName} 실행`}</button>
        </>}
        {onRunModel ? <details><summary>다른 분석 도구</summary>
          <button className="secondary-action" type="button" onClick={onRun} disabled={hasPending || Boolean(running)}>거리 순위 보기</button>
        </details> : <button className="primary-action" type="button" onClick={onRun} disabled={hasPending || Boolean(running)}>거리 순위 보기</button>}
      </form>}
    </>}
    {message && <p role="status">{message}</p>}
  </section>
}
