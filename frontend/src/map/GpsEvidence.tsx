import { useState, type FormEvent } from 'react'
import type { GpsDetails, GpsReview } from './gps'
import type { IncidentMarker } from './incident'

export function GpsEvidence({ marker, pending, canAdopt, alreadyAdopted, onReview, onAdopt }: {
  marker: IncidentMarker
  pending: boolean
  canAdopt: boolean
  alreadyAdopted: boolean
  onReview: (review: GpsReview) => void
  onAdopt: () => void
}) {
  const details: GpsDetails = marker.gps ?? { source: '', accuracyM: null }
  const review = details.review
  const [reviewing, setReviewing] = useState(false)
  const [adopting, setAdopting] = useState(false)
  const [reviewer, setReviewer] = useState('')
  const [reason, setReason] = useState('')
  const [status, setStatus] = useState<GpsReview['status']>('approved')
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!reviewer.trim() || !reason.trim()) return
    onReview({ status, reviewer: reviewer.trim(), reason: reason.trim(), atUtc: new Date().toISOString() })
    setReviewing(false)
  }
  return <div className="gps-evidence">
    <dl>
      <div><dt>출처</dt><dd>{details.source || '미입력'}</dd></div>
      <div><dt>위치 오차</dt><dd>{details.accuracyM === null ? '미확인' : `${details.accuracyM} m`}</dd></div>
      <div><dt>검토</dt><dd>{review ? `${review.status === 'approved' ? '승인' : '보류'} · ${review.reviewer}` : '검토 대기'}</dd></div>
      {review && <div><dt>검토 근거</dt><dd>{review.reason}</dd></div>}
    </dl>
    {reviewing ? <form className="search-record-form" onSubmit={submit}>
      <fieldset disabled={pending}>
        <label htmlFor="gps-review-status">검토 결과</label>
        <select id="gps-review-status" value={status} onChange={event => setStatus(event.target.value === 'approved' ? 'approved' : 'rejected')}>
          <option value="approved">승인</option><option value="rejected">보류</option>
        </select>
        <label>검토자 이름<input required maxLength={80} value={reviewer} onChange={event => setReviewer(event.target.value)} /></label>
        <label>검토 근거<input required maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></label>
        <div className="compact-actions">
          <button type="button" className="secondary-action" onClick={() => setReviewing(false)}>취소</button>
          <button type="submit" className="secondary-action">검토 저장</button>
        </div>
      </fieldset>
    </form> : details.source ?
      <button type="button" className="secondary-action" disabled={pending} onClick={() => {
        setAdopting(false)
        setReviewing(true)
      }}>{review ? 'GPS 다시 검토' : 'GPS 검토'}</button> :
      <p className="field-help">수정에서 신호 출처를 입력하면 검토할 수 있습니다.</p>}
    {review?.status === 'approved' && !reviewing && (alreadyAdopted ?
      <p className="field-help">현재 마지막 확인 위치로 사용 중</p> : canAdopt ? adopting ?
        <div className="workspace-next">
          <p className="field-help">이 신호의 위치와 시각으로 마지막 확인 정보를 바꿉니다.</p>
          <button type="button" className="primary-action" onClick={onAdopt}>위치·시각 채택 확인</button>
          <button type="button" className="secondary-action" onClick={() => setAdopting(false)}>취소</button>
        </div> : <button type="button" className="primary-action" disabled={pending} onClick={() => setAdopting(true)}>마지막 확인 위치로 채택</button> :
        <p className="field-help">이 신호는 현재 작업 지역의 분석 범위 밖에 있습니다.</p>)}
  </div>
}
