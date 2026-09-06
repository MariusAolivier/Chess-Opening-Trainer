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
  lichessSyncing: boolean
  syncUser: { displayName: string | null; email: string | null } | null
  syncAuthLoading: boolean
  onTrainNow: () => void
  onOpenRepertoire: () => void
  onSyncWithLichess: () => void
  onSignInToSync: () => void
}

export default function HomeView({
  syncStatus,
  syncError,
  totalDue,
  estimatedMinutes,
  storedStudies,
  homeFen,
  soundEnabled,
  lichessSyncing,
  syncUser,
  syncAuthLoading,
  onTrainNow,
  onOpenRepertoire,
  onSyncWithLichess,
  onSignInToSync,
}: HomeViewProps) {
  const canTrain = storedStudies.length > 0

  return (
    <div className="home-root">
      <div className="home-header">
        <h1 className="home-title">Opening Trainer</h1>
        <p className="home-subtitle">Train your repertoire intelligently</p>
      </div>
      {syncStatus === 'error' && (
        <div className="home-sync-error" role="alert">
          ✗ Something went wrong: {syncError}
        </div>
      )}
      {syncUser && syncStatus === 'syncing' && (
        <div className="home-syncing">
          <span className="home-sync-spinner" />
          Syncing progress...
        </div>
      )}
      {syncUser && syncStatus === 'ok' && (
        <div className="home-sync-ok">✓ Progress synced</div>
      )}
      {!canTrain ? (
        <section className="home-onboarding" aria-labelledby="home-onboarding-title">
          <div className="home-onboarding-header">
            <h2 id="home-onboarding-title">Set up your trainer</h2>
            <p>Import your opening repertoire, then practise it with spaced repetition.</p>
          </div>

          <div className="home-onboarding-step">
            <span className="home-step-number" aria-hidden="true">1</span>
            <div className="home-step-content">
              <h3>Save your progress</h3>
              <p>Use Google to keep your studies and training history private and synced across devices.</p>
              {syncAuthLoading ? (
                <span className="home-step-status">Checking account...</span>
              ) : syncUser ? (
                <span className="home-step-status home-step-status-complete">
                  ✓ Signed in as {syncUser.displayName ?? syncUser.email ?? 'Google account'}
                </span>
              ) : (
                <>
                  <button type="button" onClick={onSignInToSync} className="home-google-btn">
                    Sign in with Google
                  </button>
                  <span className="home-step-note">Recommended, but you can train locally without it.</span>
                </>
              )}
            </div>
          </div>

          <div className="home-onboarding-step">
            <span className="home-step-number" aria-hidden="true">2</span>
            <div className="home-step-content">
              <h3>Add your repertoire</h3>
              <p>Connect Lichess to import your studies, or upload a PGN file.</p>
              <div className="home-import-actions">
                <button
                  type="button"
                  onClick={onSyncWithLichess}
                  disabled={lichessSyncing}
                  className="home-lichess-btn"
                >
                  {lichessSyncing ? 'Importing from Lichess...' : 'Connect Lichess & import'}
                </button>
                <button type="button" onClick={onOpenRepertoire} className="home-upload-btn">
                  Upload PGN instead
                </button>
              </div>
            </div>
          </div>

          <div className="home-onboarding-step home-onboarding-step-last">
            <span className="home-step-number home-step-number-muted" aria-hidden="true">3</span>
            <div className="home-step-content">
              <h3>Start training</h3>
              <p>Training becomes available as soon as your first study is imported.</p>
            </div>
          </div>
        </section>
      ) : (
        <>
          {!syncAuthLoading && !syncUser && (
            <div className="home-cloud-prompt">
              <span><strong>Keep your progress safe.</strong> Sync privately across devices.</span>
              <button type="button" onClick={onSignInToSync}>Sign in with Google</button>
            </div>
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
          <button onClick={onTrainNow} className="home-train-btn home-train-btn-enabled">
            ▶ Train Now
          </button>
          <button onClick={onOpenRepertoire} className="home-repertoire-btn">
            My Repertoire →
          </button>
        </>
      )}
    </div>
  )
}
