import Chessboard from '../Chessboard'
import type { StoredStudy } from '../../lib/storage'
import './HomeView.css'

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
  const canTrain = storedStudies.length > 0

  return (
    <div className="home-root">
      <div className="home-header">
        <h1 className="home-title">Opening Trainer</h1>
        <p className="home-subtitle">Train your repertoire intelligently</p>
      </div>
      {syncStatus === 'error' && (
        <div className="home-sync-error">
          ✗ Sync error: {syncError}
        </div>
      )}
      {syncStatus === 'syncing' && (
        <div className="home-syncing">
          <span className="home-sync-spinner" />
          Syncing...
        </div>
      )}
      {syncStatus === 'ok' && (
        <div className="home-sync-ok">✓ Synced</div>
      )}
      <div className="home-stats-grid">
        <div className="home-stat-item">
          <div className="home-stat-label">Due today</div>
          <div className="home-stat-value">{totalDue}</div>
        </div>
        <div className="home-stat-item">
          <div className="home-stat-label">Repertoires</div>
          <div className="home-stat-value">{storedStudies.length}</div>
        </div>
        <div className="home-stat-item">
          <div className="home-stat-label">Estimated time</div>
          <div className="home-stat-value">{estimatedMinutes} min</div>
        </div>
      </div>
      <Chessboard fen={homeFen} readonly={true} soundEnabled={soundEnabled} />
      <button
        onClick={onTrainNow}
        disabled={!canTrain}
        className={`home-train-btn ${canTrain ? 'home-train-btn-enabled' : 'home-train-btn-disabled'}`}
      >
        ▶ Train Now
      </button>
      <button onClick={onOpenRepertoire} className="home-repertoire-btn">
        {storedStudies.length === 0 ? '+ Create Repertoire' : 'My Repertoire →'}
      </button>
    </div>
  )
}
