import { useEffect, useState } from 'react'
import Chessboard from '../Chessboard'
import type { Chapter } from '../../lib/pgn'
import type { StoredStudy } from '../../lib/storage'
import type { InlineDetour, MainlineMove } from '../../lib/training'
import './TrainingView.css'

interface QueuePreviewItem {
  label: string
  forkMainlineIndex: number
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
  isRetryingVariation: boolean
  moveIndex: number
  mainline: MainlineMove[]
  currentFen?: string
  soundEnabled: boolean
  commentsVisible: boolean
  activePlayerColor: 'white' | 'black'
  boardResetKey: number
  queuePreview: QueuePreviewItem[]
  onBackHome: () => void
  onMove: (from: string, to: string) => boolean
  onRevealAnswer: () => void
  onSkipCurrentVariation: () => void
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
  isRetryingVariation,
  moveIndex,
  mainline,
  currentFen,
  soundEnabled,
  commentsVisible,
  activePlayerColor,
  boardResetKey,
  queuePreview,
  onBackHome,
  onMove,
  onRevealAnswer,
  onSkipCurrentVariation,
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

  function moveMoverSide(
    startFen: string,
    line: Array<{ fen: string }>,
    moveAtIndex: number,
  ): 'w' | 'b' | null {
    if (moveAtIndex < 0 || moveAtIndex >= line.length) return null
    const fenBeforeMove = moveAtIndex === 0 ? startFen : line[moveAtIndex - 1]?.fen
    if (!fenBeforeMove) return null
    return fenBeforeMove.split(' ')[1] as 'w' | 'b'
  }

  function formatBranchLabel(parentFen: string, san: string): string {
    const parts = parentFen.split(' ')
    const sideToMove = parts[1] as 'w' | 'b' | undefined
    const fullmove = Number.parseInt(parts[5] ?? '', 10)
    if (!Number.isFinite(fullmove) || fullmove <= 0) return san
    return sideToMove === 'b' ? `${fullmove}... ${san}` : `${fullmove}. ${san}`
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

  const variationName = inlineDetour?.detourLine[0]?.san
    ? `Variation ${formatBranchLabel(inlineDetour.forkFen, inlineDetour.detourLine[0].san)}`
    : null

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
              {!inlineDetour.isIndependent && <span className="tv-inline-label">↪ Sideline</span>}
              {inlineDetour.detourIndex >= 0 && (
                <span className="tv-inline-san">
                  {inlineDetour.detourLine[inlineDetour.detourIndex]?.san}
                  {inlineDetour.detourLine[inlineDetour.detourIndex]?.annotation ? ` ${inlineDetour.detourLine[inlineDetour.detourIndex]?.annotation}` : ''}
                </span>
              )}
              <span className="tv-progress-count">
                ({detourDoneForUser}/{detourTotalForUser})
              </span>
              {variationName && (
                <div className="tv-variation-name">{variationName}</div>
              )}
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

      {isRetryingVariation && (
        <div className="tv-retry-banner">
          <span className="tv-retry-label">↻ Retrying variation</span>
          <button type="button" onClick={onSkipCurrentVariation} className="tv-retry-skip-btn">
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
        const comment = inlineDetour && inlineDetour.detourIndex >= 0
          ? (() => {
            const mover = moveMoverSide(inlineDetour.forkFen, inlineDetour.detourLine, inlineDetour.detourIndex)
            if (mover === userColor) return null
            return inlineDetour.detourLine[inlineDetour.detourIndex]?.comment
          })()
          : moveIndex === -1
            ? selectedChapter.startComment
            : (() => {
              const mover = moveMoverSide(selectedChapter.startFen, mainline, moveIndex)
              if (mover === userColor) return null
              return mainline[moveIndex]?.comment
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
                <li key={`${item.forkMainlineIndex}-${item.label}-${index}`} className="tv-queue-item">
                  <span className="tv-queue-rank">{index + 1}.</span>
                  <span className="tv-queue-label">{item.label}</span>
                  <span className="tv-queue-meta">@ ply {item.forkMainlineIndex + 1}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  )
}
