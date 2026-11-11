import { cellCenter, projectedToCell, toLngLat, toProjected, type GridSpec } from './grid.ts'
import { isAbmBehavior, type AbmBehavior } from './abmBehavior.ts'

type Mass = [cellIndex: number, probability: number]
type Frame = { elapsed_seconds: number; cells: Mass[] }
export type Timeline = {
  label: string
  start: [number, number]
  lastSeenMs: number
  frames: Frame[]
  maxMass: number
  terrainRevision?: string
  synthetic: boolean
  abmPreview?: {
    samples: number; seed: number
    behavior?: AbmBehavior
    accessMode?: 'allow-unknown' | 'known-only'
    demVersion?: string
    slopeLimit?: 35 | 45
    canDepart?: boolean
  }
}

export function formatElapsed(seconds: number) {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor(seconds % 3600 / 60)
  return [hours && `${hours}시간`, minutes && `${minutes}분`, seconds % 60 && `${seconds % 60}초`].filter(Boolean).join(' ') || '0분'
}

export function abmFrameMetrics(grid: GridSpec, timeline: Timeline, step: number) {
  const { cells } = timeline.frames[step]
  const [x, y] = toProjected(grid, timeline.start)
  const meanDistanceM = cells.reduce((sum, [index, mass]) => {
    const [east, north] = cellCenter(grid, Math.floor(index / grid.columns), index % grid.columns)
    return sum + mass * Math.hypot(east - x, north - y)
  }, 0)
  const previous = timeline.frames[step - 1]?.cells
  const previousMass = new Map(previous)
  const unchanged = previous?.length === cells.length &&
    cells.every(([index, mass]) => Math.abs((previousMass.get(index) ?? 0) - mass) <= 1e-12)
  return { meanDistanceM, unchanged }
}

export function abmTimelineBounds(grid: GridSpec, timeline: Timeline): [[number, number], [number, number]] {
  let [west, south] = toProjected(grid, timeline.start)
  let east = west, north = south
  const halfCell = grid.cellSizeM / 2
  for (const { cells } of timeline.frames) {
    for (const [index] of cells) {
      const [x, y] = cellCenter(grid, Math.floor(index / grid.columns), index % grid.columns)
      west = Math.min(west, x - halfCell)
      south = Math.min(south, y - halfCell)
      east = Math.max(east, x + halfCell)
      north = Math.max(north, y + halfCell)
    }
  }
  // The grid is projected; include all corners when making geographic bounds.
  const corners = [[west, south], [west, north], [east, south], [east, north]]
    .map(([x, y]) => toLngLat(grid, [x, y]))
  return [[Math.min(...corners.map(p => p[0])), Math.min(...corners.map(p => p[1]))],
    [Math.max(...corners.map(p => p[0])), Math.max(...corners.map(p => p[1]))]]
}

export function readTimeline(value: unknown, grid: GridSpec): Timeline {
  const fail = () => new Error('시간별 결과 JSON의 격자, LKP, 시각 또는 셀 값을 확인해 주세요.')
  if (!value || typeof value !== 'object') throw fail()
  const { schema_version, grid_id, model_version, lkp, last_seen_utc, frames, terrain_revision, result_kind, abm_preview } = value as Record<string, unknown>
  if (schema_version !== 1 || grid_id !== grid.id || typeof model_version !== 'string' ||
      !model_version.trim() || model_version.length > 100 ||
      !Array.isArray(lkp) || lkp.length !== 2 || !lkp.every(Number.isFinite) ||
      Math.abs(lkp[0]) > 180 || Math.abs(lkp[1]) > 90 ||
      !projectedToCell(grid, ...toProjected(grid, [lkp[0], lkp[1]])) ||
      typeof last_seen_utc !== 'string' || !Array.isArray(frames) || frames.length < 2) throw fail()
  if (terrain_revision !== undefined && (typeof terrain_revision !== 'string' || !terrain_revision)) throw fail()
  if (result_kind !== undefined && result_kind !== 'model' && result_kind !== 'synthetic') throw fail()
  let abmPreview: Timeline['abmPreview']
  if (abm_preview !== undefined) {
    if (result_kind !== 'model' || !abm_preview || typeof abm_preview !== 'object') throw fail()
    const { samples, seed, behavior, access_mode, dem_version, slope_limit_deg, can_depart } = abm_preview as Record<string, unknown>
    if (typeof samples !== 'number' || !Number.isSafeInteger(samples) || samples < 1 ||
        typeof seed !== 'number' || !Number.isSafeInteger(seed) || seed < 0 ||
        (can_depart !== undefined && typeof can_depart !== 'boolean') ||
        (behavior !== undefined && !isAbmBehavior(behavior))) throw fail()
    if ((terrain_revision !== undefined) !== (access_mode !== undefined || behavior === 'rt') ||
        (access_mode !== undefined && access_mode !== 'allow-unknown' && access_mode !== 'known-only') ||
        (dem_version !== undefined && (typeof dem_version !== 'string' || !dem_version)) ||
        (slope_limit_deg !== undefined && (!dem_version || (slope_limit_deg !== 35 && slope_limit_deg !== 45)))) throw fail()
    abmPreview = { samples, seed,
      ...(isAbmBehavior(behavior) ? { behavior } : {}),
      ...(access_mode ? { accessMode: access_mode } : {}),
      ...(dem_version ? { demVersion: dem_version } : {}),
      ...(slope_limit_deg ? { slopeLimit: slope_limit_deg } : {}),
      ...(typeof can_depart === 'boolean' ? { canDepart: can_depart } : {}),
    }
  }
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
    if (total > 1 + 1e-8 || (abmPreview && Math.abs(total - 1) > 1e-8)) throw fail()
  }
  return { label: model_version, start: [lkp[0], lkp[1]], lastSeenMs, frames, maxMass, terrainRevision: terrain_revision as string | undefined, synthetic: result_kind === 'synthetic', ...(abmPreview ? { abmPreview } : {}) }
}

export function demoTimeline(grid: GridSpec, lkp?: [number, number], lastSeenMs = Date.parse('2026-01-01T00:00:00.000Z')): Timeline {
  const [west, north] = grid.origin
  const start = lkp ?? toLngLat(grid, [west + grid.columns * grid.cellSizeM / 2, north - grid.rows * grid.cellSizeM / 2])
  const projected = toProjected(grid, start)
  const originCell = projectedToCell(grid, ...projected)!
  const frames = [1, 2, 4].map((hour, step) => {
    const radius = Math.max(1, Math.floor(Math.min(grid.rows, grid.columns) * (0.07 + 0.05 * step)))
    const row = originCell.row
    const column = Math.min(grid.columns - 1, originCell.column + Math.floor(grid.columns * 0.06 * step))
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
    lkp: start, last_seen_utc: new Date(lastSeenMs).toISOString(), frames, result_kind: 'synthetic',
  }, grid)
}
