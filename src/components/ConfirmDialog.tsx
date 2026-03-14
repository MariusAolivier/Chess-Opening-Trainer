import './ConfirmDialog.css'

export type ConfirmDialogState = {
  title: string
  message: string
  confirmLabel?: string
  action: () => void
}

interface ConfirmDialogProps {
  state: ConfirmDialogState | null
  onCancel: () => void
  onConfirm: () => void
}

export default function ConfirmDialog({ state, onCancel, onConfirm }: ConfirmDialogProps) {
  if (!state) return null

  return (
    <div onClick={onCancel} className="confirm-overlay">
      <div onClick={e => e.stopPropagation()} className="confirm-card">
        <div className="confirm-title">{state.title}</div>
        <div className="confirm-message">{state.message}</div>
        <div className="confirm-actions">
          <button onClick={onCancel} className="confirm-cancel-btn">
            Cancel
          </button>
          <button onClick={onConfirm} className="confirm-delete-btn">
            {state.confirmLabel ?? 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}
