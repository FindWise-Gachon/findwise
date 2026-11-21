import type { GridSpec } from './grid.ts'

export type RingResult = {
  modelVersion: string
  profileLabel: string
  inGridMass: number
  palette: number[]
  indices: Uint8Array
  maxMass: number
}

export function readRingResult(value: unknown, grid: GridSpec): RingResult {
  const fail = () => new Error('Ring 결과의 격자 또는 확률 데이터를 확인해 주세요.')
  if (!value || typeof value !== 'object') throw fail()
  const { grid_id, model_version, profile_label, in_grid_mass, palette, cell_indices } = value as Record<string, unknown>
  const count = grid.rows * grid.columns
  if (grid_id !== grid.id || typeof model_version !== 'string' || !model_version ||
      typeof profile_label !== 'string' || !profile_label ||
      typeof in_grid_mass !== 'number' || !Number.isFinite(in_grid_mass) || in_grid_mass <= 0 ||
      !Array.isArray(palette) || palette.length < 1 || palette.length > 6 ||
      palette.some(value => !Number.isFinite(value) || value < 0 || value > 1) ||
      typeof cell_indices !== 'string' || cell_indices.length !== 4 * Math.ceil(count / 3)) throw fail()

  let indices: Uint8Array
  try { indices = Uint8Array.from(atob(cell_indices), char => char.charCodeAt(0)) }
  catch { throw fail() }
  if (indices.length !== count) throw fail()
  const occurrences = new Uint32Array(palette.length)
  for (const index of indices) {
    if (index >= palette.length) throw fail()
    occurrences[index]++
  }
  const total = palette.reduce((sum, mass, index) => sum + mass * occurrences[index], 0)
  if (Math.abs(total - 1) > 1e-8) throw fail()
  const maxMass = Math.max(...palette)
  if (maxMass <= 0) throw fail()
  return { modelVersion: model_version, profileLabel: profile_label, inGridMass: in_grid_mass, palette, indices, maxMass }
}
