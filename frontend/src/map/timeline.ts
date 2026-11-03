import { projectedToCell, toLngLat, toProjected, type GridSpec } from './grid.ts'

type Mass = [cellIndex: number, probability: number]
type Frame = { elapsed_seconds: number; cells: Mass[] }
export type Timeline = {
  label: string
  start: [number, number]
  lastSeenMs: number
  frames: Frame[]
  maxMass: number
}

export function readTimeline(value: unknown, grid: GridSpec): Timeline {
  const fail = () => new Error('시간별 결과 JSON의 격자, LKP, 시각 또는 셀 값을 확인해 주세요.')
  if (!value || typeof value !== 'object') throw fail()
  const { schema_version, grid_id, model_version, lkp, last_seen_utc, frames } = value as Record<string, unknown>
  if (schema_version !== 1 || grid_id !== grid.id || typeof model_version !== 'string' ||
      !model_version.trim() || model_version.length > 100 ||
      !Array.isArray(lkp) || lkp.length !== 2 || !lkp.every(Number.isFinite) ||
      Math.abs(lkp[0]) > 180 || Math.abs(lkp[1]) > 90 ||
      !projectedToCell(grid, ...toProjected(grid, [lkp[0], lkp[1]])) ||
      typeof last_seen_utc !== 'string' || !Array.isArray(frames) || frames.length < 2) throw fail()
  const lastSeenMs = Date.parse(last_seen_utc)
  if (!Number.isFinite(lastSeenMs) || new Date(lastSeenMs).toISOString() !== last_seen_utc) throw fail()

  let maxMass = 0
  let previous = -1
  for (const frame of frames) {
    if (!frame || !Number.isSafeInteger(frame.elapsed_seconds) || frame.elapsed_seconds <= previous ||
        !Number.isFinite(new Date(lastSeenMs + 1000 * frame.elapsed_seconds).getTime()) ||
        !Array.isArray(frame.cells)) throw fail()
    previous = frame.elapsed_seconds
    const seen = new Set<number>()
    let total = 0
    for (const cell of frame.cells) {
      if (!Array.isArray(cell) || cell.length !== 2) throw fail()
      const [index, mass] = cell
      if (!Number.isSafeInteger(index) || index < 0 || index >= grid.rows * grid.columns ||
          seen.has(index) || !Number.isFinite(mass) || mass <= 0 || mass > 1) throw fail()
      seen.add(index)
      total += mass
      maxMass = Math.max(maxMass, mass)
    }
    if (total > 1 + 1e-8) throw fail()
  }
  return { label: model_version, start: [lkp[0], lkp[1]], lastSeenMs, frames, maxMass }
}

export function demoTimeline(grid: GridSpec): Timeline {
  const [west, north] = grid.origin
  const start = toLngLat(grid, [west + grid.columns * grid.cellSizeM / 2, north - grid.rows * grid.cellSizeM / 2])
  const frames = [1, 2, 4].map((hour, step) => {
    const radius = Math.max(1, Math.floor(Math.min(grid.rows, grid.columns) * (0.07 + 0.05 * step)))
    const row = Math.floor(grid.rows / 2)
    const column = Math.floor(grid.columns * (0.5 + 0.06 * step))
    const cells: Mass[] = []
    for (let r = Math.max(0, row - radius); r <= Math.min(grid.rows - 1, row + radius); r++) {
      for (let c = Math.max(0, column - radius); c <= Math.min(grid.columns - 1, column + radius); c++) {
        if (Math.hypot(r - row, c - column) <= radius) cells.push([r * grid.columns + c, 0])
      }
    }
    for (const cell of cells) cell[1] = 1 / cells.length
    return { elapsed_seconds: hour * 3600, cells }
  })
  return readTimeline({
    schema_version: 1, grid_id: grid.id, model_version: '합성 예제 · 모형 검증 전',
    lkp: start, last_seen_utc: '2026-01-01T00:00:00.000Z', frames,
  }, grid)
}
