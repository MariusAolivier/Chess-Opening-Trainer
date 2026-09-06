import { useEffect, useId, useRef } from 'react'
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
  const cardRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const onCancelRef = useRef(onCancel)
  const titleId = useId()
  const messageId = useId()
  useEffect(() => { onCancelRef.current = onCancel }, [onCancel])

  useEffect(() => {
    if (!state) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    cancelRef.current?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancelRef.current()
        return
      }
      if (event.key !== 'Tab' || !cardRef.current) return

      const controls = [...cardRef.current.querySelectorAll<HTMLElement>('button:not(:disabled)')]
      if (controls.length === 0) return
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus()
    }
  }, [state])

  if (!state) return null

  return (
    <div onClick={onCancel} className="confirm-overlay">
      <div
        ref={cardRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        onClick={event => event.stopPropagation()}
        className="confirm-card"
      >
        <div id={titleId} className="confirm-title">{state.title}</div>
        <div id={messageId} className="confirm-message">{state.message}</div>
        <div className="confirm-actions">
          <button ref={cancelRef} onClick={onCancel} className="confirm-cancel-btn">
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
