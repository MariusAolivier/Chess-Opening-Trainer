import { useEffect, useState } from 'react'
import Chessboard from '../Chessboard'
import type { Chapter, MoveNode } from '../../lib/pgn'
import type { StoredStudy } from '../../lib/storage'
import type { InlineDetour, MainlineMove } from '../../lib/training'
import './TrainingView.css'

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
  wrongGuessTick: number
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
  wrongGuessTick,
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
  const [isBoardShaking, setIsBoardShaking] = useState(false)
  const study = storedStudies.find(item => item.id === selectedStudyId)
  const userColor = activePlayerColor === 'white' ? 'w' : 'b'

  useEffect(() => {
    if (wrongGuessTick === 0) return

    setIsBoardShaking(true)
    const timeout = window.setTimeout(() => {
      setIsBoardShaking(false)
    }, 420)

    return () => window.clearTimeout(timeout)
  }, [wrongGuessTick])

  function countMovesForSide(
    startFen: string,
    line: Array<{ fen: string }>,
    side: 'w' | 'b',
    upToIndex?: number,
  ): number {
    if (line.length === 0) return 0
    const lastIndex = upToIndex === undefined ? line.length - 1 : Math.min(upToIndex, line.length - 1)
    if (lastIndex < 0) return 0

    let count = 0
    let fenBefore = startFen
    for (let index = 0; index <= lastIndex; index += 1) {
      const mover = fenBefore.split(' ')[1] as 'w' | 'b'
      if (mover === side) count += 1
      fenBefore = line[index].fen
    }
    return count
  }

  const mainlineTotalForUser = selectedChapter
    ? countMovesForSide(selectedChapter.startFen, mainline, userColor)
    : 0
  const mainlineDoneForUser = selectedChapter
    ? countMovesForSide(selectedChapter.startFen, mainline, userColor, moveIndex)
    : 0

  const detourTotalForUser = inlineDetour
    ? countMovesForSide(inlineDetour.forkFen, inlineDetour.detourLine, userColor)
    : 0
  const detourDoneForUser = inlineDetour
    ? countMovesForSide(inlineDetour.forkFen, inlineDetour.detourLine, userColor, inlineDetour.detourIndex)
    : 0

  const activeAnnotation = inlineDetour && inlineDetour.detourIndex >= 0
    ? inlineDetour.detourLine[inlineDetour.detourIndex]?.annotation
    : moveIndex === -1
      ? undefined
      : mainline[moveIndex]?.annotation

  return (
    <div className="tv-root">
      <button onClick={onBackHome} className="tv-home-btn">
        ← Home
      </button>

      {selectedChapter && (
        <div className="tv-chapter-meta">
          {study && <span className="tv-study-name">{study.name}</span>}
          <span className="tv-chapter-name">{selectedChapter.title}</span>
        </div>
      )}

      {selectedChapter && (
        <div className="tv-move-info">
          {inlineDetour ? (
            <>
              <span className="tv-inline-label">↪ Sideline</span>
              {inlineDetour.detourIndex >= 0 && (
                <span className="tv-inline-san">
                  {inlineDetour.detourLine[inlineDetour.detourIndex]?.san}
                  {inlineDetour.detourLine[inlineDetour.detourIndex]?.annotation ? ` ${inlineDetour.detourLine[inlineDetour.detourIndex]?.annotation}` : ''}
                </span>
              )}
              <span className="tv-progress-count">
                ({detourDoneForUser}/{detourTotalForUser})
              </span>
            </>
          ) : (
            <>
              {moveIndex === -1
                ? 'Start position'
                : `${Math.ceil((moveIndex + 1) / 2)}${mainline[moveIndex] ? (moveIndex % 2 === 0 ? '.' : '...') : ''} ${mainline[moveIndex]?.san ?? ''}${mainline[moveIndex]?.annotation ? ` ${mainline[moveIndex]?.annotation}` : ''}`}
              {moveIndex >= 0 && (() => {
                const alts = mainline[moveIndex]?.alternatives ?? []
                const inlineCount = alts.filter(alt => !alt.independent).length
                const independentCount = alts.filter(alt => alt.independent).length
                if (!inlineCount && !independentCount) return null
                return (
                  <span className="tv-branch-dots">
                    {inlineCount > 0 && (
                      <span title={`${inlineCount} inline sideline(s)`} className="tv-inline-dot">{'●'.repeat(inlineCount)}</span>
                    )}
                    {independentCount > 0 && (
                      <span
                        title={`${independentCount} independent variation(s)`}
                        className={`tv-indep-dot ${inlineCount > 0 ? 'tv-indep-dot-with-inline' : ''}`}
                      >
                        {'●'.repeat(independentCount)}
                      </span>
                    )}
                  </span>
                )
              })()}
              <span className="tv-progress-count">
                ({mainlineDoneForUser} / {mainlineTotalForUser})
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
        annotation={activeAnnotation}
        className={isBoardShaking ? 'tv-board-shake' : undefined}
      />

      <div className="tv-feedback">
        {quizMode && quizDone && <span className="tv-line-complete">✓ Line complete!</span>}
        {quizMode && quizWrong && !revealedAnswer && (
          <div className="tv-wrong-wrap">
            <span className="tv-wrong">✗ Wrong move</span>
            <button onClick={onRevealAnswer} className="tv-reveal-btn">
              Reveal answer
            </button>
          </div>
        )}
        {quizMode && quizWrong && revealedAnswer && (
          <span className="tv-wrong">✗ Wrong - expected <strong>{quizWrong}</strong></span>
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
          <div className="tv-comment">
            {comment}
          </div>
        )
      })()}

      {selectedChapter && branchForks.length > 0 && (
        <div className="tv-variations-root">
          <button onClick={onToggleBranches} className="tv-variations-toggle">
            {showBranches ? '▲' : '▼'} See all variations in chapter
          </button>
          {showBranches && (
            <div className="tv-variations-list">
              {branchForks.map((fork, index) => (
                <div key={index} className={`tv-variation-item ${index < branchForks.length - 1 ? 'tv-variation-item-divider' : ''}`}>
                  <span className="tv-move-prefix">
                    {fork.moveNumber}{fork.side === 'w' ? '.' : '...'}
                  </span>{' '}
                  <strong className="tv-main-san">{fork.mainSan}</strong>
                  <span className="tv-mainline-label"> (mainline)</span>
                  {fork.alts.map((alt, altIndex) => (
                    <div key={altIndex} className="tv-alt-line">
                      <span className={alt.independent ? 'tv-alt-dot-independent' : 'tv-alt-dot-inline'}>●</span>{' '}
                      <strong>{alt.san}</strong>{' '}
                      <span className="tv-alt-type">({alt.independent ? 'independent' : 'inline'})</span>
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
