import type { FormEvent } from 'react'
import type { DistanceRun } from './distance'

export function DistancePanel({ run, message, onRun, onPick, onClear, onExport }: {
  run: DistanceRun | null
  message: string
  onRun: (start: [number, number]) => void
  onPick: () => void
  onClear: () => void
  onExport: () => void
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    onRun([Number(data.get('longitude')), Number(data.get('latitude'))])
  }

  return <>
    <h3>거리 기준 히트맵</h3>
    <p className="panel-intro">개발 격자 안에서 시작점을 지정합니다. 셀 중심이 시작점에 가까울수록 높은 순위를 매깁니다.</p>
    <form key={run?.start.join(',')} className="distance-form" onSubmit={submit}>
      <label>경도 <input name="longitude" type="number" step="any" min="-180" max="180" required defaultValue={run?.start[0]} /></label>
      <label>위도 <input name="latitude" type="number" step="any" min="-90" max="90" required defaultValue={run?.start[1]} /></label>
      <button className="outline-action" type="submit">거리 순위 계산</button>
      <button className="secondary-action" type="button" onClick={onPick}>지도에서 시작점 선택</button>
    </form>
    <p className="muted-note" role="status">{message || (run ? `${run.order.length.toLocaleString('ko-KR')}개 셀 계산 완료` : '')}</p>
    {run && <>
      <button className="secondary-action" onClick={onExport}>실행 조건 내려받기 · JSON</button>
      <button className="secondary-action" onClick={onClear}>히트맵 지우기</button>
    </>}
    <p className="muted-note">색은 거리 순위를 나타냅니다. 확률 추정과 현장 판단에는 별도 검증이 필요합니다.</p>
  </>
}
