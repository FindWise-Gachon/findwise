import { useEffect, useMemo, useState } from 'react'
import { labels } from './terrain'
import { analysisGrid } from './config'
import { elapsedSince, nearbyWays } from './pointDetails'
import { visibleTerrain, type TerrainDocument } from './terrainDocument'

export function PointInfo({ point, pending, lastSeenUtc, resultLabel, terrain, onClose, onConfirm, onEdit, onPick }: {
  point: [number, number]
  pending: boolean
  lastSeenUtc: string
  resultLabel: string
  terrain: TerrainDocument | null
  onClose: () => void
  onConfirm: () => void
  onEdit: () => void
  onPick: () => void
}) {
  const [now, setNow] = useState(Date.now)
  const [copyStatus, setCopyStatus] = useState('')
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer) }, [])
  const info = useMemo(() => nearbyWays(terrain ? visibleTerrain(terrain) : [], analysisGrid, point), [terrain, point])
  return <section className="point-card" aria-label="선택 지점 정보">
    <header><div><span className="point-kind">{pending ? '설정 전' : '마지막 확인 위치'}</span><h2>{pending ? '이 위치를 확인하세요' : '수색 기준 지점'}</h2></div>
      <button className="plain-close" onClick={onClose} aria-label="지점 정보 닫기">×</button></header>
    <dl className="point-facts">
      <div><dt>마지막 확인</dt><dd>{lastSeenUtc ? new Date(lastSeenUtc).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '시각을 입력해 주세요'}</dd></div>
      <div><dt>확인 후 경과</dt><dd>{elapsedSince(lastSeenUtc, now)}</dd></div>
      <div><dt>분석 상태</dt><dd>{resultLabel}</dd></div>
    </dl>
    <div className="nearby-heading">주변 접근 정보 <span>자료 기준 · 직선거리</span></div>
    <dl className="point-facts nearby-facts">
      {(['trail', 'road'] as const).map(kind => <div key={kind}><dt>{kind === 'trail' ? '등산로' : '도로'}</dt><dd>
        {info.nearby[kind] ? <>{Math.round(info.nearby[kind]!.distance)}m <small>{info.nearby[kind]!.name} · {labels[info.nearby[kind]!.status]}</small></> : terrain ? '1km 이내 연결 자료 없음' : '지형 자료 연결 중'}
      </dd></div>)}
    </dl>
    <details><summary>좌표·격자 정보</summary>
      <p className="point-coordinates">위도 {point[1].toFixed(5)}<br />경도 {point[0].toFixed(5)}</p>
      <button className="secondary-action" onClick={() => {
        if (!navigator.clipboard) { setCopyStatus('위 좌표를 선택해 복사하세요.'); return }
        void navigator.clipboard.writeText(`${point[1].toFixed(5)}, ${point[0].toFixed(5)}`).then(() => setCopyStatus('좌표를 복사했습니다.')).catch(() => setCopyStatus('복사하지 못했습니다. 위 좌표를 선택해 복사하세요.'))
      }}>좌표 복사</button>
      {copyStatus && <p role="status">{copyStatus}</p>}
      <p>{info.cell ? `격자 ${info.cell.row + 1}행 · ${info.cell.column + 1}열` : '분석 범위 밖'}</p>
    </details>
    {pending ? <button className="primary-action" onClick={onConfirm}>이 위치로 설정</button> :
      <button className="primary-action" onClick={onEdit}>{lastSeenUtc ? '확인 정보 수정' : '확인 시각 입력'}</button>}
    <button className="secondary-action" onClick={onPick}>다른 위치 선택</button>
  </section>
}
