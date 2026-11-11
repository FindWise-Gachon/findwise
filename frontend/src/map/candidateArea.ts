import type { Cell, GridSpec } from './grid.ts'

export type CandidateArea = {
  id: number
  firstRow: number
  lastRow: number
  firstColumn: number
  lastColumn: number
}

export type AreaProbability =
  | { kind: 'palette'; indices: Uint8Array; palette: readonly number[] }
  | { kind: 'sparse'; cells: readonly (readonly [number, number])[] }

export function candidateArea(id: number, a: Cell, b: Cell): CandidateArea {
  return {
    id,
    firstRow: Math.min(a.row, b.row), lastRow: Math.max(a.row, b.row),
    firstColumn: Math.min(a.column, b.column), lastColumn: Math.max(a.column, b.column),
  }
}

export function candidateExtent(grid: GridSpec, area: CandidateArea): [number, number, number, number] {
  const [west, north] = grid.origin
  const { cellSizeM: size } = grid
  return [west + area.firstColumn * size, north - (area.lastRow + 1) * size,
    west + (area.lastColumn + 1) * size, north - area.firstRow * size]
}

export function candidateSize(grid: GridSpec, area: CandidateArea) {
  return (area.lastRow - area.firstRow + 1) * (area.lastColumn - area.firstColumn + 1) * grid.cellSizeM ** 2
}

export function candidateMass(grid: GridSpec, area: CandidateArea, probability: AreaProbability) {
  const { firstRow, lastRow, firstColumn, lastColumn } = area
  const { columns } = grid
  let mass = 0
  if (probability.kind === 'sparse') {
    for (const [index, value] of probability.cells) {
      const row = Math.floor(index / columns), column = index % columns
      if (row >= firstRow && row <= lastRow && column >= firstColumn && column <= lastColumn) mass += value
    }
  } else {
    const counts = new Uint32Array(probability.palette.length)
    for (let row = firstRow; row <= lastRow; row++) {
      const rowStart = row * columns
      for (let column = firstColumn; column <= lastColumn; column++) counts[probability.indices[rowStart + column]]++
    }
    for (let index = 0; index < counts.length; index++) mass += counts[index] * probability.palette[index]
  }
  return Math.min(1, mass)
}

export type CandidateOrder = 'mass' | 'size' | 'created'

export function orderCandidates<T extends { id: number; size: number; mass: number | null }>(
  candidates: readonly T[], order: CandidateOrder,
): T[] {
  return [...candidates].sort((a, b) => {
    if (order === 'mass') return (b.mass ?? -1) - (a.mass ?? -1) || a.id - b.id
    if (order === 'size') return a.size - b.size || a.id - b.id
    return a.id - b.id
  })
}
