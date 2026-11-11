import type { Timeline } from './timeline.ts'

export type RunComparison = {
  pairs: { elapsed: number; baselineStep: number; currentStep: number }[]
  maxMass: number
}

export function compareAbmRuns(baseline: Timeline, current: Timeline): RunComparison | string {
  if (!baseline.abmPreview || !current.abmPreview || baseline.synthetic || current.synthetic) return 'ABM 실행 결과만 비교할 수 있습니다.'
  if (baseline.start[0] !== current.start[0] || baseline.start[1] !== current.start[1] ||
      baseline.lastSeenMs !== current.lastSeenMs) return '마지막 확인 위치와 시각이 같은 결과를 실행해 주세요.'
  if (baseline.abmPreview.seed !== current.abmPreview.seed || baseline.abmPreview.samples !== current.abmPreview.samples) {
    return '시드와 경로 수가 같은 ABM 결과를 선택해 주세요.'
  }

  const baselineSteps = new Map(baseline.frames.map((frame, index) => [frame.elapsed_seconds, index]))
  const pairs: RunComparison['pairs'] = []
  let maxMass = 0
  current.frames.forEach((frame, currentStep) => {
    const baselineStep = baselineSteps.get(frame.elapsed_seconds)
    if (baselineStep === undefined) return
    pairs.push({ elapsed: frame.elapsed_seconds, baselineStep, currentStep })
    for (const [, mass] of baseline.frames[baselineStep].cells) maxMass = Math.max(maxMass, mass)
    for (const [, mass] of frame.cells) maxMass = Math.max(maxMass, mass)
  })
  return pairs.length ? { pairs, maxMass } : '두 결과에 공통으로 계산된 시점이 없습니다.'
}
