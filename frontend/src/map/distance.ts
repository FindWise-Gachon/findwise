import { projectedToCell, type GridSpec } from './grid.ts'

export type DistanceRun = { start: [number, number]; order: Uint32Array }

export const distanceModelVersion = 'projected-cell-center-distance-v1'

export function rankByDistance(grid: GridSpec, start: [number, number]): Uint32Array {
  if (!projectedToCell(grid, ...start)) throw new RangeError('Start is outside the grid')

  const { columns, rows, cellSizeM, origin: [west, north] } = grid
  const squaredX = Float64Array.from({ length: columns }, (_, column) => (
    (west + (column + 0.5) * cellSizeM - start[0]) ** 2
  ))
  const squaredY = Float64Array.from({ length: rows }, (_, row) => (
    (north - (row + 0.5) * cellSizeM - start[1]) ** 2
  ))
  const indices = Uint32Array.from({ length: rows * columns }, (_, index) => index)
  return indices.sort((a, b) => {
    const distanceA = squaredX[a % columns] + squaredY[Math.floor(a / columns)]
    const distanceB = squaredX[b % columns] + squaredY[Math.floor(b / columns)]
    return distanceA - distanceB || a - b
  })
}

export const distanceBands = [
  { end: 0.05, color: [255, 222, 150, 210], label: '상위 5%' },
  { end: 0.2, color: [237, 162, 231, 180], label: '5–20%' },
  { end: 0.5, color: [169, 109, 221, 145], label: '20–50%' },
  { end: 1, color: [100, 62, 151, 75], label: '50–100%' },
] as const
