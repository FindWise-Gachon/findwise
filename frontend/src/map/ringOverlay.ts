import type { GridSpec } from './grid.ts'
import type { RingResult } from './ring.ts'

// Relative display intensity, followed by RGBA.
const stops = [
  [0, 82, 70, 172, 0],
  [0.06, 103, 99, 204, 15],
  [0.22, 66, 162, 198, 58],
  [0.55, 238, 164, 100, 140],
  [1, 255, 221, 146, 215],
] as const

export const ringGradient = `linear-gradient(to right, ${stops.map(([position, r, g, b]) =>
  `rgb(${r} ${g} ${b}) ${position * 100}%`).join(', ')})`

const colors = Array.from({ length: 256 }, (_, index) => {
  const intensity = index / 255
  const end = stops.findIndex(stop => stop[0] >= intensity)
  const lower = stops[Math.max(end - 1, 0)]
  const upper = stops[end]
  const fraction = end === 0 ? 0 : (intensity - lower[0]) / (upper[0] - lower[0])
  return lower.slice(1).map((value, channel) => value + (upper[channel + 1] - value) * fraction)
})

function blurLines(source: Float32Array, target: Float32Array, length: number, count: number,
  stride: number, lineStride: number, radius: number) {
  const reach = Math.min(radius, length - 1)
  const width = 2 * reach + 1
  for (let line = 0; line < count; line++) {
    const start = line * lineStride
    // Extend the edge value so a constant field stays constant at the boundary.
    let sum = source[start] * reach
    for (let offset = 0; offset <= reach; offset++) sum += source[start + offset * stride]
    for (let offset = 0; offset < length; offset++) {
      target[start + offset * stride] = sum / width
      sum += source[start + Math.min(length - 1, offset + reach + 1) * stride] -
        source[start + Math.max(0, offset - reach) * stride]
    }
  }
}

export function paintRingOverlay(ring: RingResult, grid: GridSpec, pixels: Uint8ClampedArray) {
  const { columns, rows } = grid
  const relativeMass = ring.palette.map(value => value / ring.maxMass)
  const field = Float32Array.from(ring.indices, index => relativeMass[index])
  const scratch = new Float32Array(field.length)
  const radius = Math.round(85 / grid.cellSizeM)

  // Two small separable passes soften the display without changing model probabilities.
  if (radius > 0) {
    for (let pass = 0; pass < 2; pass++) {
      blurLines(field, scratch, columns, rows, 1, columns, radius)
      blurLines(scratch, field, rows, columns, columns, 1, radius)
    }
  }
  for (let index = 0; index < field.length; index++) {
    const level = relativeMass[ring.indices[index]] === 0 ? 0 : Math.round(255 * Math.min(1, Math.max(0, field[index])))
    pixels.set(colors[level], index * 4)
  }
}
