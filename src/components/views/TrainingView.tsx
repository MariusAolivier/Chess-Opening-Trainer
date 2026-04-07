import { useEffect, useState } from 'react'
import Chessboard from '../Chessboard'
import type { Chapter } from '../../lib/pgn'
import type { StoredStudy } from '../../lib/storage'
import type { FlatMove, TrainingLine } from '../../lib/training'
import './TrainingView.css'

interface QueuePreviewItem {
  label: string
  chapterTitle: string
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
  isRetryingVariation: boolean
  isSideline: boolean
  activeLine: TrainingLine | null
  moveIndex: number
  currentFen?: string
  soundEnabled: boolean
  commentsVisible: boolean
  activePlayerColor: 'white' | 'black'
  boardResetKey: number
  queuePreview: QueuePreviewItem[]
  onBackHome: () => void
  onMove: (from: string, to: string) => boolean
  onRevealAnswer: () => void
  onSkipCurrentLine: () => void
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
  isRetryingVariation,
  isSideline,
  activeLine,
  moveIndex,
  currentFen,
  soundEnabled,
  commentsVisible,
  activePlayerColor,
  boardResetKey,
  queuePreview,
  onBackHome,
  onMove,
  onRevealAnswer,
  onSkipCurrentLine,
}: TrainingViewProps) {
  const [isBoardShaking, setIsBoardShaking] = useState(false)
  const study = storedStudies.find(item => item.id === selectedStudyId)
  const userColor = activePlayerColor === 'white' ? 'w' : 'b'
  const line = activeLine?.line ?? []
  const startFen = selectedChapter?.startFen ?? ''

  useEffect(() => {
    if (wrongGuessTick === 0) return

    setIsBoardShaking(true)
    const timeout = window.setTimeout(() => {
      setIsBoardShaking(false)
    }, 420)

    return () => window.clearTimeout(timeout)
  }, [wrongGuessTick])

  function countMovesForSide(
    sFen: string,
    moves: Array<{ fen: string }>,
    side: 'w' | 'b',
    upToIndex?: number,
  ): number {
    if (moves.length === 0) return 0
    const lastIndex = upToIndex === undefined ? moves.length - 1 : Math.min(upToIndex, moves.length - 1)
    if (lastIndex < 0) return 0

    let count = 0
    let fenBefore = sFen
    for (let index = 0; index <= lastIndex; index += 1) {
      const mover = fenBefore.split(' ')[1] as 'w' | 'b'
      if (mover === side) count += 1
      fenBefore = moves[index].fen
    }
    return count
  }

  function moveMoverSide(
    sFen: string,
    moves: Array<{ fen: string }>,
    moveAtIndex: number,
  ): 'w' | 'b' | null {
    if (moveAtIndex < 0 || moveAtIndex >= moves.length) return null
    const fenBeforeMove = moveAtIndex === 0 ? sFen : moves[moveAtIndex - 1]?.fen
    if (!fenBeforeMove) return null
    return fenBeforeMove.split(' ')[1] as 'w' | 'b'
  }

  const totalForUser = selectedChapter
    ? countMovesForSide(startFen, line, userColor)
    : 0
  const doneForUser = selectedChapter
    ? countMovesForSide(startFen, line, userColor, moveIndex)
    : 0

  const activeAnnotation = moveIndex >= 0 ? line[moveIndex]?.annotation : undefined

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

      {selectedChapter && activeLine && (
        <div className="tv-move-info">
          {isSideline && <span className="tv-inline-label">↪ Sideline</span>}
          <span className="tv-variation-name">{activeLine.label}</span>
          {moveIndex >= 0 && (
            <span className="tv-inline-san">
              {line[moveIndex]?.san}
              {line[moveIndex]?.annotation ? ` ${line[moveIndex]?.annotation}` : ''}
            </span>
          )}
          <span className="tv-progress-count">
            ({doneForUser}/{totalForUser})
          </span>
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

      {isRetryingVariation && (
        <div className="tv-retry-banner">
          <span className="tv-retry-label">↻ Retrying variation</span>
          <button type="button" onClick={onSkipCurrentLine} className="tv-retry-skip-btn">
            Skip
          </button>
        </div>
      )}

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

      {commentsVisible && selectedChapter && (() => {
        const comment = moveIndex === -1
          ? selectedChapter.startComment
          : (() => {
            const mover = moveMoverSide(startFen, line, moveIndex)
            if (mover === userColor) return null
            return line[moveIndex]?.comment
          })()
        if (!comment) return null
        return (
          <div className="tv-comment">
            {comment}
          </div>
        )
      })()}

      {selectedChapter && (
        <div className="tv-queue-root">
          <div className="tv-queue-title">Next in queue</div>
          {queuePreview.length === 0 ? (
            <div className="tv-queue-empty">No queued variations</div>
          ) : (
            <ol className="tv-queue-list">
              {queuePreview.map((item, index) => (
                <li key={`${item.label}-${index}`} className="tv-queue-item">
                  <span className="tv-queue-rank">{index + 1}.</span>
                  <span className="tv-queue-label">{item.label} <span className="tv-queue-meta">({item.chapterTitle})</span></span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  )
}
