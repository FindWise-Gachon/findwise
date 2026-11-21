import { reportLabels, type SearchRecord } from './searchRecord.ts'
import type { CaseInput } from './case.ts'
import type { MapPoint } from './measure.ts'
import { isGpsDetails, isUtc, type GpsDetails } from './gps.ts'

export const unassignedMarkerKey = 'unassigned'
export const markerLabels = { report: '제보', cctv: 'CCTV', gps: 'GPS 신호', search: '수색' } as const
export type MarkerKind = keyof typeof markerLabels
export type IncidentMarker = {
  id: string
  caseKey: string
  kind: MarkerKind
  point: MapPoint
  atUtc: string
  note: string
  completed: boolean
  gps?: GpsDetails
}
export type MarkerDraft = { point: MapPoint; marker?: IncidentMarker }

export function validMarkerPoint(point: unknown): point is MapPoint {
  return Array.isArray(point) && point.length === 2 && point.every(Number.isFinite) &&
    Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90
}

export function readIncidentMarker(value: unknown, caseKey: string): IncidentMarker {
  const marker = value as IncidentMarker
  if (!marker || typeof marker.id !== 'string' || !marker.id || marker.caseKey !== caseKey ||
      !Object.hasOwn(markerLabels, marker.kind) || !validMarkerPoint(marker.point) ||
      !isUtc(marker.atUtc) || typeof marker.note !== 'string' || marker.note.length > 1000 ||
      typeof marker.completed !== 'boolean' || (marker.completed && marker.kind !== 'search') ||
      (marker.gps !== undefined && (marker.kind !== 'gps' || !isGpsDetails(marker.gps)))) {
    throw new Error('저장된 지도 마커의 형식을 확인할 수 없습니다.')
  }
  return marker
}

export function orderedMarkers(markers: readonly IncidentMarker[]) {
  return [...markers].sort((a, b) => a.atUtc.localeCompare(b.atUtc) || a.id.localeCompare(b.id))
}

type IncidentEvent = { id: string; at: string; label: string; note: string } & (
  | { kind: 'start' | 'adoption'; point: MapPoint }
  | { kind: 'marker'; marker: IncidentMarker }
  | { kind: 'report'; report: SearchRecord }
)

export function incidentEvents(input: CaseInput, markers: readonly IncidentMarker[], reports: readonly SearchRecord[]): IncidentEvent[] {
  const events: IncidentEvent[] = []
  const firstAdoption = input.gpsAdoptions?.[0]
  const original = firstAdoption ? firstAdoption.previous :
    input.start && input.lastSeenUtc ? { point: input.start, atUtc: new Date(input.lastSeenUtc).toISOString() } : null
  if (original) {
    events.push({ id: 'start', kind: 'start', at: original.atUtc,
      label: firstAdoption ? '기존 마지막 확인 위치' : '마지막 확인 위치', note: '', point: original.point })
  }
  for (const [index, adoption] of (input.gpsAdoptions ?? []).entries()) {
    events.push({ id: `gps-adoption:${index}`, kind: 'adoption', at: adoption.adoptedAtUtc, point: adoption.point,
      label: 'GPS · 마지막 확인 위치 채택', note: `${adoption.review.reviewer} · ${adoption.review.reason}` })
  }
  const ordered = orderedMarkers(markers)
  for (const [index, marker] of ordered.entries()) {
    events.push({ id: `marker:${marker.id}`, kind: 'marker', at: marker.atUtc, marker,
      label: `${index + 1} · ${markerLabels[marker.kind]}${marker.completed ? ' · 완료 표기' : ''}`, note: marker.note })
  }
  for (const report of reports) {
    const marker = markers.find(item => item.id === report.sourceMarkerId)
    const label = reportLabels[report.kind]
    const sameObservation = marker?.kind === 'search' && report.kind === 'searched' &&
      marker.atUtc === report.searchedAtUtc && marker.note === report.rawText &&
      marker.point.every((coordinate, i) => coordinate === report.point[i])
    if (!sameObservation) {
      events.push({ id: `field:${report.id}`, kind: 'report', at: report.searchedAtUtc,
        label: `현장 확인 · ${label}`, note: report.rawText, report })
    }
    events.push({ id: `approval:${report.id}`, kind: 'report', at: report.approvedAtUtc,
      label: `승인 · ${label}`, note: `${report.reviewer} · ${report.reason}`, report })
  }
  return events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
}
