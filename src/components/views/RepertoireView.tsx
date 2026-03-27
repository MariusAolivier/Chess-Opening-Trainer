import { useEffect, useRef, useState } from 'react'
import type { StoredStudy } from '../../lib/storage'
import type { ConflictInfo } from '../../lib/scores'
import RepertoirePanel from '../RepertoirePanel'
import './RepertoireView.css'

interface RepertoireViewProps {
  storedStudies: StoredStudy[]
  streak: { current: number; best: number; todayCount: number }
  selectionMode: boolean
  selectedChapterIds: Set<string>
  uploadColor: 'white' | 'black'
  soundEnabled: boolean
  repeatFailedVariationsEnabled: boolean
  spacedRepetitionIntensity: 1 | 2 | 3 | 4 | 5
  commentsVisible: boolean
  error: string | null
  conflictWarnings: ConflictInfo[]
  onGoHome: () => void
  onTrainChapter: (study: StoredStudy, chapterIndex: number) => void
  onDeleteStudy: (id: string) => void
  onDeleteChapter: (studyId: string, chapterIndex: number) => void
  onToggleChapter: (chapterId: string) => void
  onToggleStudy: (study: StoredStudy) => void
  onEnterSelectionMode: () => void
  onCancelSelection: () => void
  onTrainFromSelection: () => void
  onSetUploadColor: (color: 'white' | 'black') => void
  lichessSyncing: boolean
  lichessUsername: string | null
  onSyncWithLichess: () => void
  onOpenUpload: () => void
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onDismissConflicts: () => void
  onToggleSound: () => void
  onToggleRepeatFailedVariations: () => void
  onSetSpacedRepetitionIntensity: (value: number) => void
  onToggleCommentsVisible: () => void
  onRequestResetScores: () => void
  fileInputRef: React.RefObject<HTMLInputElement | null>
}

export default function RepertoireView({
  storedStudies,
  streak,
  selectionMode,
  selectedChapterIds,
  uploadColor,
  soundEnabled,
  repeatFailedVariationsEnabled,
  spacedRepetitionIntensity,
  commentsVisible,
  error,
  conflictWarnings,
  onGoHome,
  onTrainChapter,
  onDeleteStudy,
  onDeleteChapter,
  onToggleChapter,
  onToggleStudy,
  onEnterSelectionMode,
  onCancelSelection,
  onTrainFromSelection,
  onSetUploadColor,
  lichessSyncing,
  lichessUsername,
  onSyncWithLichess,
  onOpenUpload,
  onFileChange,
  onDismissConflicts,
  onToggleSound,
  onToggleRepeatFailedVariations,
  onSetSpacedRepetitionIntensity,
  onToggleCommentsVisible,
  onRequestResetScores,
  fileInputRef,
}: RepertoireViewProps) {
  const [showStreakPanel, setShowStreakPanel] = useState(false)
  const [showSettingsPanel, setShowSettingsPanel] = useState(false)
  const streakPanelRef = useRef<HTMLDivElement>(null)
  const settingsPanelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showStreakPanel) return

    function handlePointerDown(event: PointerEvent) {
      if (!streakPanelRef.current?.contains(event.target as Node)) {
        setShowStreakPanel(false)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [showStreakPanel])

  useEffect(() => {
    if (!showSettingsPanel) return

    function handlePointerDown(event: PointerEvent) {
      if (!settingsPanelRef.current?.contains(event.target as Node)) {
        setShowSettingsPanel(false)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [showSettingsPanel])

  const canStartSelection = selectedChapterIds.size > 0

  return (
    <div className="rv-overlay">
      <div className="rv-container">
        <div className="rv-topbar">
          <div className="rv-left">
            <button onClick={onGoHome} className="rv-home-btn">← Home</button>
            <div className="rv-title-wrap">
              <h2 className="rv-title">My Repertoire</h2>
            </div>
          </div>

          <div className="rv-actions">
            <div ref={streakPanelRef} className="rv-streak-wrap">
              <button onClick={() => setShowStreakPanel(open => !open)} aria-label="Toggle streak details" className="rv-streak-btn">
                <img src={import.meta.env.BASE_URL + 'streak-icon.png'} alt="" aria-hidden="true" className="rv-streak-icon" />
                <span>{streak.current}</span>
              </button>
              {showStreakPanel && (
                <div className="rv-streak-panel">
                  <div className="rv-streak-row rv-streak-row-gap">
                    <span className="rv-streak-label">Current</span>
                    <span className="rv-streak-value rv-streak-current">{streak.current} day{streak.current === 1 ? '' : 's'}</span>
                  </div>
                  <div className="rv-streak-row rv-streak-row-gap">
                    <span className="rv-streak-label">Today</span>
                    <span className="rv-streak-value">{streak.todayCount} review{streak.todayCount === 1 ? '' : 's'}</span>
                  </div>
                  <div className="rv-streak-row">
                    <span className="rv-streak-label">Best</span>
                    <span className="rv-streak-value">{streak.best} day{streak.best === 1 ? '' : 's'}</span>
                  </div>
                </div>
              )}
            </div>

            <div ref={settingsPanelRef} className="rv-settings-wrap">
              <button
                onClick={() => setShowSettingsPanel(open => !open)}
                aria-label="Open settings"
                title="Settings"
                className="rv-settings-btn"
              >
                <img src={import.meta.env.BASE_URL + 'settings-icon.png'} alt="" aria-hidden="true" className="rv-settings-icon" />
              </button>
              {showSettingsPanel && (
                <div className="rv-settings-panel">
                  <label className="rv-sound-label">
                    <span className="rv-setting-text">Sound effects</span>
                    <button
                      type="button"
                      onClick={onToggleSound}
                      aria-pressed={soundEnabled}
                      aria-label={`Sound effects ${soundEnabled ? 'on' : 'off'}`}
                      className={`rv-sound-toggle ${soundEnabled ? 'rv-sound-toggle-on' : 'rv-sound-toggle-off'}`}
                    >
                      <span className="rv-sound-toggle-thumb" />
                    </button>
                  </label>
                  <label className="rv-sound-label">
                    <span className="rv-setting-text">Repeat failed variations</span>
                    <button
                      type="button"
                      onClick={onToggleRepeatFailedVariations}
                      aria-pressed={repeatFailedVariationsEnabled}
                      aria-label={`Repeat failed variations ${repeatFailedVariationsEnabled ? 'on' : 'off'}`}
                      className={`rv-sound-toggle ${repeatFailedVariationsEnabled ? 'rv-sound-toggle-on' : 'rv-sound-toggle-off'}`}
                    >
                      <span className="rv-sound-toggle-thumb" />
                    </button>
                  </label>
                  <label className="rv-sound-label">
                    <span className="rv-setting-text">Show comments</span>
                    <button
                      type="button"
                      onClick={onToggleCommentsVisible}
                      aria-pressed={commentsVisible}
                      aria-label={`Show comments ${commentsVisible ? 'on' : 'off'}`}
                      className={`rv-sound-toggle ${commentsVisible ? 'rv-sound-toggle-on' : 'rv-sound-toggle-off'}`}
                    >
                      <span className="rv-sound-toggle-thumb" />
                    </button>
                  </label>
                  <div className="rv-intensity-setting">
                    <div className="rv-intensity-row">
                      <span className="rv-setting-text">Spaced repetition intensity</span>
                      <span className="rv-intensity-value">{spacedRepetitionIntensity}/5</span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={5}
                      step={1}
                      value={spacedRepetitionIntensity}
                      onChange={event => onSetSpacedRepetitionIntensity(Number(event.target.value))}
                      className="rv-intensity-slider"
                      aria-label="Spaced repetition intensity"
                    />
                    <div className="rv-intensity-scale">
                      <span>Calm</span>
                      <span>Balanced</span>
                      <span>Intense</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={onRequestResetScores}
                    className="rv-reset-scores-btn"
                  >
                    Reset scores
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {storedStudies.length === 0 && (
          <p className="rv-empty-note">No studies yet. Upload a PGN to get started.</p>
        )}

        <RepertoirePanel
          studies={storedStudies}
          onTrainChapter={onTrainChapter}
          onDeleteStudy={onDeleteStudy}
          onDeleteChapter={onDeleteChapter}
          selectionMode={selectionMode}
          selectedChapterIds={selectedChapterIds}
          onToggleChapter={onToggleChapter}
          onToggleStudy={onToggleStudy}
        />

        {storedStudies.length > 0 && (
          <div className="rv-select-wrap">
            {!selectionMode ? (
              <button onClick={onEnterSelectionMode} className="rv-select-open-btn">
                ☑ Select chapters to train
              </button>
            ) : (
              <div className="rv-select-actions">
                <button onClick={onCancelSelection} className="rv-select-cancel-btn">Cancel</button>
                <button
                  onClick={onTrainFromSelection}
                  disabled={!canStartSelection}
                  className={`rv-select-start-btn ${canStartSelection ? 'rv-select-start-btn-enabled' : 'rv-select-start-btn-disabled'}`}
                >
                  ▶ Start Training{canStartSelection ? ` (${selectedChapterIds.size})` : ''}
                </button>
              </div>
            )}
          </div>
        )}

        <div className="rv-upload-wrap">
          <div className="rv-upload-title">Upload study</div>
          <button
            type="button"
            onClick={onSyncWithLichess}
            disabled={lichessSyncing}
            className={`rv-lichess-sync-btn ${lichessSyncing ? 'rv-lichess-sync-btn-disabled' : ''}`}
          >
            <img
              src={import.meta.env.BASE_URL + 'lichess.png'}
              alt=""
              aria-hidden="true"
              className="rv-lichess-icon"
            />
            <span>{lichessSyncing ? 'Syncing Lichess...' : 'Sync with Lichess'}</span>
          </button>
          {lichessUsername && (
            <div className="rv-lichess-user">Connected: {lichessUsername}</div>
          )}
          <div className="rv-color-toggle-wrap">
            <button
              onClick={() => onSetUploadColor('white')}
              className={`rv-color-btn rv-color-btn-white ${uploadColor === 'white' ? 'rv-color-btn-active' : ''}`}
            >
              ♔ White
            </button>
            <button
              onClick={() => onSetUploadColor('black')}
              className={`rv-color-btn rv-color-btn-black ${uploadColor === 'black' ? 'rv-color-btn-active' : ''}`}
            >
              ♚ Black
            </button>
          </div>
          <button onClick={onOpenUpload} className="rv-upload-btn">+ Upload PGN</button>
          <input ref={fileInputRef} type="file" accept=".pgn" className="rv-hidden-input" onChange={onFileChange} />

          {error && <div className="rv-error">{error}</div>}

          {conflictWarnings.length > 0 && (
            <div className="rv-conflicts">
              <div className="rv-conflicts-title">
                ⚠ {conflictWarnings.length} conflicting position{conflictWarnings.length > 1 ? 's' : ''}
              </div>
              {conflictWarnings.map((conflict, conflictIndex) => (
                <div
                  key={conflictIndex}
                  className={`rv-conflict-item ${conflictIndex < conflictWarnings.length - 1 ? 'rv-conflict-item-divider' : ''}`}
                >
                  {conflict.recommendations.map(recommendation => (
                    <div key={recommendation.chapterId} className="rv-conflict-rec">
                      <span className="rv-conflict-san">{recommendation.mainlineSan}</span>
                      {' - '}
                      <span className="rv-conflict-label">{recommendation.chapterLabel}</span>
                    </div>
                  ))}
                </div>
              ))}
              <button onClick={onDismissConflicts} className="rv-conflict-dismiss">Dismiss</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
