import type { RunComparison } from './compare'
import { formatElapsed, type Timeline } from './timeline'

export function ComparisonCaption({ side, timeline, failed }: {
  side: string
  timeline: Timeline
  failed: boolean
}) {
  const settings = [
    timeline.terrainRevision ? `통행 ${timeline.terrainRevision.slice(0, 8)} · 미확인 ${timeline.abmPreview?.accessMode === 'known-only' ? '제외' : '허용'}` : '통행 조건 미적용',
    timeline.abmPreview?.demVersion ? timeline.abmPreview.slopeLimit ? `${timeline.abmPreview.slopeLimit}° 초과 제외` : 'DEM 적용' : '',
  ].filter(Boolean)
  return <div className="compare-caption">
    <strong>{side}</strong><span>{timeline.label}</span>
    <small>{settings.join(' · ')}</small>
    {failed && <small role="alert">배경 지도 연결 확인 필요</small>}
  </div>
}

export function ComparisonControls({ comparison, step, lastSeenMs, onStep, onClose }: {
  comparison: RunComparison
  step: number
  lastSeenMs: number
  onStep: (step: number) => void
  onClose: () => void
}) {
  const elapsed = comparison.pairs[step].elapsed
  return <>
    <header className="compare-header">
      <strong>ABM 분석 비교</strong>
      <span>모델 원본 · 두 지도 함께 이동</span>
      <button className="secondary-action" onClick={onClose}>비교 닫기</button>
    </header>
    <section className="compare-footer" aria-label="공통 비교 시점">
      <div className="compare-time">
        <div><strong>{formatElapsed(elapsed)} 후</strong><time>{new Date(lastSeenMs + elapsed * 1000).toLocaleString('ko-KR')}</time></div>
        <input aria-label="공통 비교 시점" type="range" min="0" max={comparison.pairs.length - 1}
          disabled={comparison.pairs.length === 1} value={step} aria-valuetext={formatElapsed(elapsed)}
          onChange={event => onStep(Number(event.target.value))} />
      </div>
      <div className="time-scale"><b>공통 셀 확률 · 번짐은 표시용</b><i /><span>0% – {(comparison.maxMass * 100).toPrecision(3)}%</span></div>
    </section>
  </>
}
