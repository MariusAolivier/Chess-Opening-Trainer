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
    <div
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.6)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        boxSizing: 'border-box',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '360px',
          background: '#1f2030',
          border: '1px solid #3a3f58',
          borderRadius: '10px',
          padding: '16px',
          boxSizing: 'border-box',
          color: '#d8deef',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        <div style={{ fontSize: '1rem', fontWeight: 'bold' }}>{state.title}</div>
        <div style={{ fontSize: '0.9rem', color: '#b3bdd7', lineHeight: 1.45 }}>{state.message}</div>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '7px 14px',
              borderRadius: '6px',
              border: '1px solid #58607c',
              background: '#2c3348',
              color: '#d4def7',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: '7px 14px',
              borderRadius: '6px',
              border: '1px solid #8f3a3a',
              background: '#5a2424',
              color: '#ffd0d0',
              fontWeight: 'bold',
              cursor: 'pointer',
            }}
          >
            {state.confirmLabel ?? 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}
