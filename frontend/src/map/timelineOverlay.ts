import type { GridSpec } from './grid.ts'
import type { Timeline } from './timeline.ts'

const abmGlowRadiusM = 36

function probabilityColor(mass: number, maxMass: number, minAlpha: number) {
  const intensity = Math.sqrt(mass / maxMass)
  return [138 + 117 * intensity, 84 + 137 * intensity, 208 - 61 * intensity, minAlpha + (210 - minAlpha) * intensity]
}

export function paintTimelineFrame(grid: GridSpec, timeline: Timeline, step: number, maxMass: number, pixels: Uint8ClampedArray) {
  const cells = timeline.frames[step].cells
  if (!timeline.abmPreview) {
    for (const [index, mass] of cells) pixels.set(probabilityColor(mass, maxMass, 80), index * 4)
    return
  }
  const colors = cells.map(([index, mass]) => ({ index, color: probabilityColor(mass, maxMass, 145) }))

  if (grid.cellSizeM < abmGlowRadiusM) {
    const radius = abmGlowRadiusM / grid.cellSizeM
    const reach = Math.floor(radius)
    // Draw a fixed-distance display glow. Overlapping glows never add up.
    for (const { index, color: [red, green, blue, alpha] } of colors) {
      const column = index % grid.columns, row = Math.floor(index / grid.columns)
      for (let r = Math.max(0, row - reach); r <= Math.min(grid.rows - 1, row + reach); r++) {
        for (let c = Math.max(0, column - reach); c <= Math.min(grid.columns - 1, column + reach); c++) {
          const fade = 1 - Math.hypot(r - row, c - column) / radius
          const opacity = Math.round(alpha * .76 * fade)
          const offset = (r * grid.columns + c) * 4
          if (opacity > pixels[offset + 3]) pixels.set([red, green, blue, opacity], offset)
        }
      }
    }
  }

  // The occupied cells retain their own colors even underneath another cell's glow.
  for (const { index, color } of colors) pixels.set(color, index * 4)
}
