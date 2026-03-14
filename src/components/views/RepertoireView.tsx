import { useEffect, useRef, useState } from 'react'
import type { StoredStudy } from '../../lib/storage'
import type { ConflictInfo } from '../../lib/scores'
import RepertoirePanel from '../RepertoirePanel'

interface RepertoireViewProps {
  storedStudies: StoredStudy[]
  streak: { current: number; best: number; todayCount: number }
  selectionMode: boolean
  selectedChapterIds: Set<string>
  uploadColor: 'white' | 'black'
  soundEnabled: boolean
  error: string | null
  resetNotice: string | null
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
  onOpenUpload: () => void
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onDismissConflicts: () => void
  onToggleSound: () => void
  fileInputRef: React.RefObject<HTMLInputElement | null>
}

export default function RepertoireView({
  storedStudies,
  streak,
  selectionMode,
  selectedChapterIds,
  uploadColor,
  soundEnabled,
  error,
  resetNotice,
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
  onOpenUpload,
  onFileChange,
  onDismissConflicts,
  onToggleSound,
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

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#1a1a2a', zIndex: 100, display: 'flex', flexDirection: 'column', overflowY: 'auto', overflowX: 'hidden' }}>
      <div style={{ maxWidth: '640px', width: '100%', margin: '0 auto', padding: '20px 12px 40px', boxSizing: 'border-box', overflowX: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '24px', width: '100%', maxWidth: '440px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
            <button
              onClick={onGoHome}
              style={{ background: 'none', border: '1px solid #555', color: '#aaa', cursor: 'pointer', borderRadius: '4px', padding: '4px 12px', fontSize: '0.85rem', flexShrink: 0 }}
            >
              ← Home
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h2 style={{ margin: 0, color: '#e8e8e8', fontSize: '1.2rem', fontWeight: 'bold' }}>My Repertoire</h2>
              <div ref={streakPanelRef} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <button
                  onClick={() => setShowStreakPanel(open => !open)}
                  aria-label="Toggle streak details"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: 0,
                    border: 'none',
                    background: 'none',
                    color: '#ffd27a',
                    fontSize: '0.95rem',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                  }}
                >
                  <span aria-hidden="true" style={{ fontSize: '1rem', lineHeight: 1 }}>🔥</span>
                  <span>{streak.current}</span>
                </button>
                {showStreakPanel && (
                  <div style={{
                    minWidth: '190px',
                    padding: '12px',
                    borderRadius: '12px',
                    background: 'rgba(20, 24, 40, 0.75)',
                    backdropFilter: 'blur(12px)',
                    WebkitBackdropFilter: 'blur(12px)',
                    border: '1px solid rgba(60, 80, 130, 0.45)',
                    color: '#dbe6ff',
                    boxShadow: '0 14px 30px rgba(0, 0, 0, 0.4)',
                    position: 'absolute',
                    top: 'calc(100% + 8px)',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    zIndex: 31,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', marginBottom: '8px' }}>
                      <span style={{ fontSize: '0.78rem', color: '#8ea6d6' }}>Current</span>
                      <span style={{ fontWeight: 'bold', color: '#ffe28a' }}>{streak.current} day{streak.current === 1 ? '' : 's'}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', marginBottom: '8px' }}>
                      <span style={{ fontSize: '0.78rem', color: '#8ea6d6' }}>Today</span>
                      <span style={{ fontWeight: 'bold' }}>{streak.todayCount} review{streak.todayCount === 1 ? '' : 's'}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
                      <span style={{ fontSize: '0.78rem', color: '#8ea6d6' }}>Best</span>
                      <span style={{ fontWeight: 'bold' }}>{streak.best} day{streak.best === 1 ? '' : 's'}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div ref={settingsPanelRef} style={{ position: 'relative', flexShrink: 0 }}>
            <button
              onClick={() => setShowSettingsPanel(open => !open)}
              aria-label="Open settings"
              title="Settings"
              style={{
                border: 'none',
                background: 'none',
                color: '#d8deef',
                cursor: 'pointer',
                padding: '2px',
                lineHeight: 1,
                fontSize: '1.45rem',
              }}
            >
              ⚙
            </button>
            {showSettingsPanel && (
              <div style={{
                position: 'absolute',
                top: 'calc(100% + 8px)',
                right: 0,
                minWidth: '180px',
                borderRadius: '10px',
                border: '1px solid #3e4a6f',
                background: '#1f2438',
                boxShadow: '0 14px 30px rgba(0, 0, 0, 0.42)',
                padding: '12px',
                zIndex: 35,
              }}>
                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', color: '#d8deef', fontSize: '0.86rem' }}>
                  Sound effects
                  <button
                    type="button"
                    onClick={onToggleSound}
                    aria-pressed={soundEnabled}
                    style={{
                      width: '58px',
                      borderRadius: '999px',
                      border: `1px solid ${soundEnabled ? '#4f9f6a' : '#5a5f73'}`,
                      background: soundEnabled ? '#234431' : '#2c3144',
                      color: soundEnabled ? '#a7f0bf' : '#aeb4c9',
                      padding: '4px 8px',
                      cursor: 'pointer',
                      fontSize: '0.76rem',
                      fontWeight: 'bold',
                    }}
                  >
                    {soundEnabled ? 'ON' : 'OFF'}
                  </button>
                </label>
              </div>
            )}
          </div>
        </div>

        {storedStudies.length === 0 && (
          <p style={{ color: '#888', fontSize: '0.9rem', marginBottom: '16px' }}>No studies yet. Upload a PGN to get started.</p>
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
          <div style={{ marginTop: '16px', width: '100%', maxWidth: '440px' }}>
            {!selectionMode ? (
              <button
                onClick={onEnterSelectionMode}
                style={{ width: '100%', padding: '8px 16px', cursor: 'pointer', background: '#1e2e3e', color: '#7ab4e0', border: '1px solid #3a5a7a', borderRadius: '6px', fontSize: '0.88rem' }}
              >
                ☑ Select chapters to train
              </button>
            ) : (
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={onCancelSelection}
                  style={{ flex: 1, padding: '8px', cursor: 'pointer', background: '#2a2a3a', color: '#aaa', border: '1px solid #555', borderRadius: '6px', fontSize: '0.88rem' }}
                >
                  Cancel
                </button>
                <button
                  onClick={onTrainFromSelection}
                  disabled={selectedChapterIds.size === 0}
                  style={{
                    flex: 2,
                    padding: '8px',
                    cursor: selectedChapterIds.size > 0 ? 'pointer' : 'not-allowed',
                    background: selectedChapterIds.size > 0 ? '#2a5a2a' : '#222',
                    color: selectedChapterIds.size > 0 ? '#aaffaa' : '#555',
                    border: '1px solid',
                    borderColor: selectedChapterIds.size > 0 ? '#4a8a4a' : '#333',
                    borderRadius: '6px',
                    fontSize: '0.88rem',
                    fontWeight: 'bold',
                    opacity: selectedChapterIds.size > 0 ? 1 : 0.5,
                  }}
                >
                  ▶ Start Training{selectedChapterIds.size > 0 ? ` (${selectedChapterIds.size})` : ''}
                </button>
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: '28px', paddingTop: '20px', borderTop: '1px solid #2e2e3e', width: '100%', maxWidth: '440px' }}>
          <div style={{ fontWeight: 'bold', color: '#aaa', fontSize: '0.85rem', marginBottom: '10px' }}>Upload study</div>
          <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
            <button
              onClick={() => onSetUploadColor('white')}
              style={{ flex: 1, padding: '6px', cursor: 'pointer', fontSize: '0.8rem', borderRadius: '4px', border: '2px solid', borderColor: uploadColor === 'white' ? '#aaa' : 'transparent', background: '#f0f0f0', color: '#222', fontWeight: uploadColor === 'white' ? 'bold' : 'normal' }}
            >♔ White</button>
            <button
              onClick={() => onSetUploadColor('black')}
              style={{ flex: 1, padding: '6px', cursor: 'pointer', fontSize: '0.8rem', borderRadius: '4px', border: '2px solid', borderColor: uploadColor === 'black' ? '#aaa' : 'transparent', background: '#444', color: '#fff', fontWeight: uploadColor === 'black' ? 'bold' : 'normal' }}
            >♚ Black</button>
          </div>
          <button
            onClick={onOpenUpload}
            style={{ padding: '8px 16px', cursor: 'pointer', width: '100%', background: '#2a2a3a', color: '#ccc', border: '1px solid #444', borderRadius: '6px', fontSize: '0.9rem' }}
          >+ Upload PGN</button>
          <input ref={fileInputRef} type="file" accept=".pgn" style={{ display: 'none' }} onChange={onFileChange} />
          {error && <div style={{ color: '#e55', fontSize: '0.82rem', marginTop: '8px' }}>{error}</div>}
          {resetNotice && (
            <div style={{ fontSize: '0.78rem', color: '#f0c040', marginTop: '8px', padding: '6px 8px', background: '#2a2a10', borderRadius: '4px', border: '1px solid #555' }}>
              ↺ {resetNotice}
            </div>
          )}
          {conflictWarnings.length > 0 && (
            <div style={{ marginTop: '10px', background: '#3a1515', border: '1px solid #c44', borderRadius: '6px', padding: '10px', fontSize: '0.78rem', color: '#ffaaaa' }}>
              <div style={{ fontWeight: 'bold', marginBottom: '6px' }}>⚠ {conflictWarnings.length} conflicting position{conflictWarnings.length > 1 ? 's' : ''}</div>
              {conflictWarnings.map((conflict, conflictIndex) => (
                <div key={conflictIndex} style={{ marginBottom: '6px', paddingBottom: '6px', borderBottom: conflictIndex < conflictWarnings.length - 1 ? '1px solid #5a2020' : 'none' }}>
                  {conflict.recommendations.map(recommendation => (
                    <div key={recommendation.chapterId} style={{ marginBottom: '2px' }}>
                      <span style={{ color: '#ffcccc', fontWeight: 'bold' }}>{recommendation.mainlineSan}</span>
                      {' - '}
                      <span style={{ color: '#e08080', wordBreak: 'break-word' }}>{recommendation.chapterLabel}</span>
                    </div>
                  ))}
                </div>
              ))}
              <button
                onClick={onDismissConflicts}
                style={{ fontSize: '0.72rem', cursor: 'pointer', background: '#5a1515', border: '1px solid #c44', color: '#ffaaaa', borderRadius: '3px', padding: '3px 10px' }}
              >Dismiss</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
