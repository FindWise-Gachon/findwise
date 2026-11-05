import { useState, type FormEvent } from 'react'
import { localDateTime, type CaseInput } from './case'

function ConfirmTime({ utc, onChange }: { utc: string; onChange: (utc: string) => void }) {
  const local = localDateTime(utc)
  const [date, setDate] = useState(local.slice(0, 10))
  const [time, setTime] = useState(local.slice(11, 16))
  function update(nextDate: string, nextTime: string) {
    setDate(nextDate); setTime(nextTime)
    onChange(nextDate && nextTime ? new Date(`${nextDate}T${nextTime}`).toISOString() : '')
  }
  return <div className="confirm-time">
    <label>확인 날짜<input type="date" required value={date} onChange={event => update(event.target.value, time)} /></label>
    <label>확인 시간<input type="time" required value={time} onChange={event => update(date, event.target.value)} /></label>
  </div>
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

export function DistancePanel({ input, hasPending, onInfo, onTime, onRun, onPick, message }: {
  input: CaseInput
  hasPending: boolean
  onInfo: () => void
  onTime: (utc: string) => void
  onRun: () => void
  onPick: () => void
  message: string
}) {
  return <section className="search-input">
    <div className="input-step"><span className="step-number">1</span><h3>마지막으로 본 위치</h3></div>
    <div className="location-summary">
      <strong>{hasPending ? '새 위치 확인이 필요합니다' : input.start ? '위치가 설정되었습니다' : '지도를 눌러 지정하세요'}</strong>
      <div className="compact-actions">
        <button className={input.start ? 'secondary-action' : 'primary-action'} onClick={onPick}>{input.start ? '위치 변경' : '지도에서 지정'}</button>
        {(input.start || hasPending) && <button className="secondary-action" onClick={onInfo}>지점 정보</button>}
      </div>
    </div>
    <form className="search-time" onSubmit={event => { event.preventDefault(); onRun() }}>
      <div className="input-step"><span className="step-number">2</span><h3>마지막으로 본 시각</h3></div>
      <ConfirmTime utc={input.lastSeenUtc} onChange={onTime} />
      <p className="field-help">기기에 설정된 현지 시각으로 입력</p>
      <button className="primary-action" type="submit" disabled={!input.start || !input.lastSeenUtc || hasPending}>분석 시작</button>
    </form>
    <p className="method-chip">거리 기준 분석</p>
    {message && <p role="status">{message}</p>}
  </section>
}
