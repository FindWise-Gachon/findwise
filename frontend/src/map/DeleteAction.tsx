import { useState } from 'react'

export function DeleteAction({ label, question, onDelete, pending = false }: {
  label: string
  question: string
  onDelete: () => void
  pending?: boolean
}) {
  const [confirming, setConfirming] = useState(false)
  if (!confirming) return <button type="button" className="secondary-action delete-button" disabled={pending}
    onClick={() => setConfirming(true)}>{label}</button>
  return <div className="delete-confirm">
    <p>{question}</p>
    <div className="compact-actions">
      <button type="button" className="secondary-action" disabled={pending} onClick={() => setConfirming(false)}>취소</button>
      <button type="button" className="secondary-action delete-button" disabled={pending} onClick={onDelete}>
        {pending ? '삭제 중…' : '삭제 확인'}
      </button>
    </div>
  </div>
}
