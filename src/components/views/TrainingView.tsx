import Chessboard from '../Chessboard'
import type { Chapter, MoveNode } from '../../lib/pgn'
import type { StoredStudy } from '../../lib/storage'
import type { InlineDetour, MainlineMove } from '../../lib/training'

interface BranchFork {
  moveNumber: number
  side: 'w' | 'b'
  mainSan: string
  alts: MoveNode[]
}

interface TrainingViewProps {
  selectedChapter: Chapter | null
  storedStudies: StoredStudy[]
  selectedStudyId: string | null
  quizMode: boolean
  quizDone: boolean
  quizWrong: string | null
  revealedAnswer: boolean
  inlineDetour: InlineDetour | null
  moveIndex: number
  mainline: MainlineMove[]
  currentFen?: string
  soundEnabled: boolean
  activePlayerColor: 'white' | 'black'
  boardResetKey: number
  branchForks: BranchFork[]
  showBranches: boolean
  onBackHome: () => void
  onMove: (from: string, to: string) => boolean
  onToggleBranches: () => void
  onRevealAnswer: () => void
}

export default function TrainingView({
  selectedChapter,
  storedStudies,
  selectedStudyId,
  quizMode,
  quizDone,
  quizWrong,
  revealedAnswer,
  inlineDetour,
  moveIndex,
  mainline,
  currentFen,
  soundEnabled,
  activePlayerColor,
  boardResetKey,
  branchForks,
  showBranches,
  onBackHome,
  onMove,
  onToggleBranches,
  onRevealAnswer,
}: TrainingViewProps) {
  const study = storedStudies.find(item => item.id === selectedStudyId)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
      <button
        onClick={onBackHome}
        style={{ alignSelf: 'flex-start', background: 'none', border: '1px solid #555', color: '#aaa', cursor: 'pointer', borderRadius: '4px', padding: '4px 12px', fontSize: '0.85rem' }}
      >
        ← Home
      </button>

      {selectedChapter && (
        <div style={{ alignSelf: 'flex-start', display: 'flex', flexDirection: 'column', gap: '1px' }}>
          {study && <span style={{ fontSize: '0.72rem', color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '340px' }}>{study.name}</span>}
          <span style={{ fontSize: '0.88rem', color: '#bbb', fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '340px' }}>{selectedChapter.title}</span>
        </div>
      )}

      {selectedChapter && (
        <div style={{ fontSize: '0.9rem', color: '#555', minHeight: '1.2em' }}>
          {inlineDetour ? (
            <>
              <span style={{ color: '#f0c040' }}>↪ Sideline</span>
              {inlineDetour.detourIndex >= 0 && (
                <span style={{ marginLeft: '6px' }}>{inlineDetour.detourLine[inlineDetour.detourIndex]?.san}</span>
              )}
              <span style={{ marginLeft: '8px', color: '#aaa' }}>
                ({Math.max(0, inlineDetour.detourIndex + 1)}/{inlineDetour.detourLine.length})
              </span>
            </>
          ) : (
            <>
              {moveIndex === -1
                ? 'Start position'
                : `${Math.ceil((moveIndex + 1) / 2)}${mainline[moveIndex] ? (moveIndex % 2 === 0 ? '.' : '...') : ''} ${mainline[moveIndex]?.san ?? ''}`}
              {moveIndex >= 0 && (() => {
                const alts = mainline[moveIndex]?.alternatives ?? []
                const inlineCount = alts.filter(alt => !alt.independent).length
                const independentCount = alts.filter(alt => alt.independent).length
                if (!inlineCount && !independentCount) return null
                return (
                  <span style={{ marginLeft: '6px', fontSize: '0.75rem' }}>
                    {inlineCount > 0 && (
                      <span title={`${inlineCount} inline sideline(s)`} style={{ color: '#f0c040' }}>{'●'.repeat(inlineCount)}</span>
                    )}
                    {independentCount > 0 && (
                      <span title={`${independentCount} independent variation(s)`} style={{ color: '#60adf0', marginLeft: inlineCount > 0 ? '3px' : undefined }}>{'●'.repeat(independentCount)}</span>
                    )}
                  </span>
                )
              })()}
              <span style={{ marginLeft: '8px', color: '#aaa' }}>
                ({moveIndex + 1} / {mainline.length})
              </span>
            </>
          )}
        </div>
      )}

      <Chessboard
        fen={currentFen}
        readonly={!quizMode && !!selectedChapter}
        soundEnabled={soundEnabled}
        playerColor={quizMode ? activePlayerColor : undefined}
        orientation={activePlayerColor}
        onMove={quizMode ? onMove : undefined}
        resetKey={boardResetKey}
      />

      <div style={{ maxWidth: '400px', width: '100%', padding: '8px 12px', borderRadius: '6px', textAlign: 'center', fontSize: '0.9rem', minHeight: '36px' }}>
        {quizMode && quizDone && <span style={{ color: '#5c5', fontWeight: 'bold' }}>✓ Line complete!</span>}
        {quizMode && quizWrong && !revealedAnswer && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
            <span style={{ color: '#e55' }}>✗ Wrong move</span>
            <button
              onClick={onRevealAnswer}
              style={{ padding: '4px 16px', cursor: 'pointer', background: '#3a2020', color: '#ffaaaa', border: '1px solid #7a3030', borderRadius: '4px', fontSize: '0.82rem' }}
            >
              Reveal answer
            </button>
          </div>
        )}
        {quizMode && quizWrong && revealedAnswer && (
          <span style={{ color: '#e55' }}>✗ Wrong - expected <strong>{quizWrong}</strong></span>
        )}
      </div>

      {selectedChapter && (() => {
        const comment = inlineDetour && inlineDetour.detourIndex >= 0
          ? inlineDetour.detourLine[inlineDetour.detourIndex]?.comment
          : moveIndex === -1
            ? selectedChapter.startComment
            : mainline[moveIndex]?.comment
        if (!comment) return null
        return (
          <div
            style={{
              maxWidth: '400px',
              width: '100%',
              maxHeight: '120px',
              padding: '8px 12px',
              borderRadius: '6px',
              boxSizing: 'border-box',
              overflowY: 'auto',
              background: '#f0ede4',
              color: '#444',
              fontSize: '0.875rem',
              fontStyle: 'italic',
              lineHeight: '1.5',
            }}
          >
            {comment}
          </div>
        )
      })()}

      {selectedChapter && branchForks.length > 0 && (
        <div style={{ maxWidth: '400px', width: '100%' }}>
          <button
            onClick={onToggleBranches}
            style={{ fontSize: '0.8rem', padding: '4px 10px', cursor: 'pointer', width: '100%', background: '#2b2b2b', color: '#ccc', border: '1px solid #444', borderRadius: '4px' }}
          >
            {showBranches ? '▲' : '▼'} See all variations in chapter
          </button>
          {showBranches && (
            <div style={{ background: '#1e1e1e', border: '1px solid #fa8c8c', borderTop: 'none', borderRadius: '0 0 4px 4px', padding: '8px', fontSize: '0.8rem', color: '#ccc' }}>
              {branchForks.map((fork, index) => (
                <div key={index} style={{ marginBottom: '8px', paddingBottom: '8px', borderBottom: index < branchForks.length - 1 ? '1px solid #333' : 'none' }}>
                  <span style={{ color: '#888' }}>
                    {fork.moveNumber}{fork.side === 'w' ? '.' : '...'}
                  </span>{' '}
                  <strong style={{ color: '#fff' }}>{fork.mainSan}</strong>
                  <span style={{ color: '#888' }}> (mainline)</span>
                  {fork.alts.map((alt, altIndex) => (
                    <div key={altIndex} style={{ marginTop: '3px', paddingLeft: '12px' }}>
                      <span style={{ color: alt.independent ? '#60adf0' : '#f0c040' }}>●</span>{' '}
                      <strong>{alt.san}</strong>{' '}
                      <span style={{ color: '#888' }}>({alt.independent ? 'independent' : 'inline'})</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
