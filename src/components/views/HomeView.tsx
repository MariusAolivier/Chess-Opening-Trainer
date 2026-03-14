import Chessboard from '../Chessboard'
import type { StoredStudy } from '../../lib/storage'

interface HomeViewProps {
  syncStatus: 'idle' | 'syncing' | 'ok' | 'error'
  syncError: string | null
  totalDue: number
  estimatedMinutes: number
  storedStudies: StoredStudy[]
  homeFen: string
  soundEnabled: boolean
  onTrainNow: () => void
  onOpenRepertoire: () => void
}

export default function HomeView({
  syncStatus,
  syncError,
  totalDue,
  estimatedMinutes,
  storedStudies,
  homeFen,
  soundEnabled,
  onTrainNow,
  onOpenRepertoire,
}: HomeViewProps) {
  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px', paddingBottom: '32px', width: '100%', maxWidth: '400px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', marginTop: '28px', textAlign: 'center' }}>
        <h1 style={{ margin: 0, fontSize: '2rem', lineHeight: 1.05, color: '#f3efe6', fontWeight: 800 }}>Opening Trainer</h1>
        <p style={{ margin: 0, fontSize: '0.95rem', color: '#9aa7bd' }}>Train your repertoire intelligently</p>
      </div>
      {syncStatus === 'error' && (
        <div style={{ fontSize: '0.75rem', color: '#ff8888', background: '#2a1010', border: '1px solid #8a3030', borderRadius: '6px', padding: '6px 12px', maxWidth: '340px', wordBreak: 'break-word' }}>
          ✗ Sync error: {syncError}
        </div>
      )}
      {syncStatus === 'syncing' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: '#aaa' }}>
          <span
            style={{
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              border: '2px solid #555',
              borderTopColor: '#aaa',
              display: 'inline-block',
              animation: 'spin 0.7s linear infinite',
            }}
          />
          Syncing...
        </div>
      )}
      {syncStatus === 'ok' && (
        <div style={{ fontSize: '0.75rem', color: '#5a9a5a' }}>✓ Synced</div>
      )}
      <div
        style={{
          width: '100%',
          maxWidth: '340px',
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: '8px',
        }}
      >
        <div style={{ padding: '4px 2px', textAlign: 'center' }}>
          <div style={{ fontSize: '0.68rem', color: '#fff' }}>Due today</div>
          <div style={{ fontSize: '1rem', fontWeight: 700, color: '#888' }}>{totalDue}</div>
        </div>
        <div style={{ padding: '4px 2px', textAlign: 'center' }}>
          <div style={{ fontSize: '0.68rem', color: '#fff' }}>Repertoires</div>
          <div style={{ fontSize: '1rem', fontWeight: 700, color: '#888' }}>{storedStudies.length}</div>
        </div>
        <div style={{ padding: '4px 2px', textAlign: 'center' }}>
          <div style={{ fontSize: '0.68rem', color: '#fff' }}>Estimated time</div>
          <div style={{ fontSize: '1rem', fontWeight: 700, color: '#888' }}>{estimatedMinutes} min</div>
        </div>
      </div>
      <Chessboard fen={homeFen} readonly={true} soundEnabled={soundEnabled} />
      <button
        onClick={onTrainNow}
        disabled={storedStudies.length === 0}
        style={{
          padding: '14px 52px',
          fontSize: '1.25rem',
          fontWeight: 'bold',
          cursor: storedStudies.length > 0 ? 'pointer' : 'not-allowed',
          background: storedStudies.length > 0 ? '#4a7a4a' : '#333',
          color: '#fff',
          border: 'none',
          borderRadius: '8px',
          opacity: storedStudies.length > 0 ? 1 : 0.5,
        }}
      >
        ▶ Train Now
      </button>
      <button
        onClick={onOpenRepertoire}
        style={{
          background: 'none',
          border: '1px solid #444',
          color: '#aaa',
          cursor: 'pointer',
          borderRadius: '6px',
          padding: '7px 20px',
          fontSize: '0.9rem',
        }}
      >
        {storedStudies.length === 0 ? '+ Create Repertoire' : 'My Repertoire →'}
      </button>
    </div>
  )
}
