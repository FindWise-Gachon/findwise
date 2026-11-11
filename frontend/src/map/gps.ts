import type { MapPoint } from './measure.ts'

export type GpsReview = { status: 'approved' | 'rejected'; reviewer: string; reason: string; atUtc: string }
export type GpsDetails = { source: string; accuracyM: number | null; review?: GpsReview }
export type GpsPosition = { point: MapPoint; atUtc: string }
export type GpsAdoption = GpsPosition & {
  markerId: string
  previous: GpsPosition | null
  adoptedAtUtc: string
  source: string
  accuracyM: number | null
  review: GpsReview
}

export function isUtc(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}

function isText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max && Boolean(value.trim())
}

function isAccuracy(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value > 0)
}

export function isGpsReview(value: unknown): value is GpsReview {
  const review = value as GpsReview | undefined
  return Boolean(review && (review.status === 'approved' || review.status === 'rejected') &&
    isText(review.reviewer, 80) && isText(review.reason, 1000) && isUtc(review.atUtc))
}

export function isGpsDetails(value: unknown): value is GpsDetails {
  const details = value as GpsDetails | undefined
  return Boolean(details && typeof details.source === 'string' && details.source.length <= 200 &&
    isAccuracy(details.accuracyM) && (details.review === undefined ||
      (isText(details.source, 200) && isGpsReview(details.review))))
}

function isPosition(value: unknown): value is GpsPosition {
  const item = value as GpsPosition | undefined
  return Boolean(item && isUtc(item.atUtc) && Array.isArray(item.point) && item.point.length === 2 &&
    item.point.every(Number.isFinite) && Math.abs(item.point[0]) <= 180 && Math.abs(item.point[1]) <= 90)
}

export function isGpsAdoption(value: unknown): value is GpsAdoption {
  const item = value as GpsAdoption | undefined
  return Boolean(item && isPosition(item) && isText(item.markerId, 200) && isUtc(item.adoptedAtUtc) &&
    isText(item.source, 200) && isAccuracy(item.accuracyM) && isGpsReview(item.review) &&
    item.review.status === 'approved' && (item.previous === null || isPosition(item.previous)))
}
