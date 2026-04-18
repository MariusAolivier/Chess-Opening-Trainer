import { useEffect, useRef, useState } from 'react'
import { Chessground } from '@lichess-org/chessground'
import { Chess } from 'chess.js'
import type { Key } from '@lichess-org/chessground/types'
import '@lichess-org/chessground/assets/chessground.base.css'
import '@lichess-org/chessground/assets/chessground.brown.css'
import '@lichess-org/chessground/assets/chessground.cburnett.css'
import './chessboard-overrides.css'

const MOVE_SOUND_FILES = ['move-check.mp3', 'castle.mp3', 'capture.mp3', 'move-self.mp3'] as const
const moveSoundCache = new Map<string, HTMLAudioElement>()
let moveSoundsUnlocked = false
let moveSoundsUnlocking = false

function getMoveSound(file: string): HTMLAudioElement {
  let audio = moveSoundCache.get(file)
  if (!audio) {
    audio = new Audio(import.meta.env.BASE_URL + file)
    audio.preload = 'auto'
    moveSoundCache.set(file, audio)
  }
  return audio
}

function preloadMoveSounds() {
  MOVE_SOUND_FILES.forEach(file => {
    getMoveSound(file)
  })
}

function unlockMoveSounds() {
  if (moveSoundsUnlocked || moveSoundsUnlocking) return
  moveSoundsUnlocking = true

  const unlocks = MOVE_SOUND_FILES.map(async file => {
    const audio = getMoveSound(file)
    audio.muted = true
    try {
      await audio.play()
      audio.pause()
      audio.currentTime = 0
    } catch {
      // Ignore unlock failures; playback will still work once browser allows it.
    } finally {
      audio.muted = false
    }
  })

  void Promise.allSettled(unlocks).finally(() => {
    moveSoundsUnlocked = true
    moveSoundsUnlocking = false
  })
}

function playMoveSound(from: string, to: string, preMoveChess: Chess) {
  const temp = new Chess(preMoveChess.fen())
  const move = temp.move({ from, to, promotion: 'q' })
  if (!move) return
  let file: string
  if (temp.inCheck()) {
    file = 'move-check.mp3'
  } else if (move.flags.includes('k') || move.flags.includes('q')) {
    file = 'castle.mp3'
  } else if (move.flags.includes('c') || move.flags.includes('e')) {
    file = 'capture.mp3'
  } else {
    file = 'move-self.mp3'
  }
  const audio = getMoveSound(file)
  audio.pause()
  audio.currentTime = 0
  audio.play().catch(() => {})
}

function getLegalDests(chess: Chess): Map<Key, Key[]> {
  const dests = new Map<Key, Key[]>()
  chess.moves({ verbose: true }).forEach(m => {
    const from = m.from as Key
    if (!dests.has(from)) dests.set(from, [])
    dests.get(from)!.push(m.to as Key)
  })
  return dests
}

function findMoveToReachFen(prevFen: string, nextFen: string): { from: string; to: string } | null {
  const chess = new Chess(prevFen)
  const match = chess.moves({ verbose: true }).find(mv => {
    const probe = new Chess(prevFen)
    probe.move(mv)
    return probe.fen() === nextFen
  })
  return match ? { from: match.from, to: match.to } : null
}

function squareCornerAnchor(square: string, orientation: 'white' | 'black', boardSize: number): { left: number; top: number } | null {
  if (!/^[a-h][1-8]$/.test(square)) return null
  const file = square.charCodeAt(0) - 97 // a=0 ... h=7
  const rank = Number(square[1])
  const squareSize = boardSize / 8

  const xIndex = orientation === 'white' ? file : 7 - file
  const yIndex = orientation === 'white' ? 8 - rank : rank - 1

  return {
    // Slight inset from the square's top-right corner keeps the glyph readable.
    left: (xIndex + 1) * squareSize - squareSize * 0.16,
    top: yIndex * squareSize + squareSize * 0.2,
  }
}

function annotationColorClass(annotation: string): string {
  const token = annotation.trim()
  switch (token) {
    case '!':
      return 'cg-annotation-good'
    case '?':
      return 'cg-annotation-inaccuracy'
    case '??':
      return 'cg-annotation-blunder'
    case '!!':
      return 'cg-annotation-brilliant'
    case '?!':
      return 'cg-annotation-questionable'
    case '!?':
      return 'cg-annotation-interesting'
    case '□':
      return 'cg-annotation-only-move'
    case '=':
      return 'cg-annotation-equal'
    default:
      return 'cg-annotation-default'
  }
}

interface ChessboardProps {
  fen?: string
  annotation?: string
  readonly?: boolean
  soundEnabled?: boolean
  className?: string
  /** Quiz mode: the color the user controls */
  playerColor?: 'white' | 'black'
  /** Board orientation (defaults to white at bottom) */
  orientation?: 'white' | 'black'
  /** Called when the user drags a piece in quiz mode. Return false to reject the move (snaps back instantly). */
  onMove?: (from: string, to: string) => boolean | void
  /** Increment to force-reset the board to current fen (e.g. after a wrong guess) */
  resetKey?: number
}

export default function Chessboard({ fen, annotation, readonly = false, soundEnabled = true, className, playerColor, orientation = 'white', onMove, resetKey }: ChessboardProps) {
  const [boardSize, setBoardSize] = useState(() => Math.min(400, window.innerWidth - 32))
  const [lastMoveTo, setLastMoveTo] = useState<string | null>(null)

  useEffect(() => {
    preloadMoveSounds()

    const unlock = () => {
      unlockMoveSounds()
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('touchstart', unlock)
      window.removeEventListener('keydown', unlock)
    }

    window.addEventListener('pointerdown', unlock, { passive: true })
    window.addEventListener('touchstart', unlock, { passive: true })
    window.addEventListener('keydown', unlock)

    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('touchstart', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])

  useEffect(() => {
    const onResize = () => setBoardSize(Math.min(400, window.innerWidth - 32))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const boardRef = useRef<HTMLDivElement>(null)
  const groundRef = useRef<ReturnType<typeof Chessground> | null>(null)
  const onMoveRef = useRef(onMove)
  useEffect(() => { onMoveRef.current = onMove }, [onMove])
  const fenRef = useRef(fen)
  useEffect(() => { fenRef.current = fen }, [fen])
  const prevFenRef = useRef(fen)
  const prevResetKeyRef = useRef(resetKey)

  // Init (or reinit) when interaction mode or board size changes
  useEffect(() => {
    if (!boardRef.current) return
    const chess = new Chess(fen ?? undefined)
    const isQuiz = !readonly && !!playerColor
    const fenColor = chess.turn() === 'w' ? 'white' as const : 'black' as const
    const isPlayerTurn = fenColor === playerColor

    const ground = Chessground(boardRef.current, {
      fen: fen ?? 'start',
      orientation,
      turnColor: fenColor,
      movable: readonly
        ? { color: undefined, free: false }
        : isQuiz
          ? { color: isPlayerTurn ? playerColor : undefined, free: false, dests: isPlayerTurn ? getLegalDests(chess) : new Map() }
          : { color: 'white', free: false, dests: getLegalDests(chess) },
      events: {
        move(from: Key, to: Key) {
          if (isQuiz) {
            const accepted = onMoveRef.current?.(from, to)
            if (accepted !== false && soundEnabled) {
              playMoveSound(from, to, new Chess(fenRef.current ?? undefined))
            }
            if (accepted !== false) {
              setLastMoveTo(to)
            }
            if (accepted === false) {
              // Wrong move — snap back instantly without animation
              const currentFen = fenRef.current
              const c = new Chess(currentFen ?? undefined)
              const fc = c.turn() === 'w' ? 'white' as const : 'black' as const
              const ipt = fc === playerColor
              ground.set({
                animation: { enabled: false },
                fen: currentFen ?? 'start',
                turnColor: fc,
                lastMove: [],
                movable: {
                  color: ipt ? playerColor : undefined,
                  free: false,
                  dests: ipt ? getLegalDests(c) : new Map(),
                },
              })
              requestAnimationFrame(() => { ground.set({ animation: { enabled: true } }) })
            }
          } else if (!readonly) {
            if (soundEnabled) {
              playMoveSound(from, to, chess)
            }
            setLastMoveTo(to)
            chess.move({ from, to, promotion: 'q' })
            const nextColor = chess.turn() === 'w' ? 'white' as const : 'black' as const
            ground.set({
              turnColor: nextColor,
              movable: { color: nextColor, dests: getLegalDests(chess) },
            })
          }
        },
      },
    })

    groundRef.current = ground
    return () => {
      ground.destroy()
      groundRef.current = null
    }
  }, [readonly, playerColor, orientation, boardSize, soundEnabled]) // eslint-disable-line react-hooks/exhaustive-deps

  // Invalidate chessground's cached board bounds after every render.
  // Elements above the board (move-info bar, chapter title, etc.) can appear or
  // change height between renders, shifting the board's viewport position without
  // triggering a chessground resize. Clearing the memo is O(1); the next user
  // interaction will recompute getBoundingClientRect() with the correct position.
  useEffect(() => {
    groundRef.current?.state.dom.bounds.clear()
  })

  // Update position + dests when fen or resetKey changes
  useEffect(() => {
    const g = groundRef.current
    if (!g) return
    const isReset = resetKey !== prevResetKeyRef.current
    prevResetKeyRef.current = resetKey
    const prevFen = prevFenRef.current
    prevFenRef.current = fen
    if (isReset) {
      setLastMoveTo(null)
    }
    if (!readonly && playerColor) {
      const chess = new Chess(fen ?? undefined)
      const fenColor = chess.turn() === 'w' ? 'white' as const : 'black' as const
      const isPlayerTurn = fenColor === playerColor
      g.set({
        fen: fen ?? 'start',
        turnColor: fenColor,
        lastMove: isReset ? [] : undefined,
        movable: {
          color: isPlayerTurn ? playerColor : undefined,
          free: false,
          dests: isPlayerTurn ? getLegalDests(chess) : new Map(),
        },
      })
      // Play sound for opponent's auto-moves: fen changed and it's now the player's turn
      if (!isReset && isPlayerTurn && prevFen && prevFen !== fen) {
        const prevChess = new Chess(prevFen)
        const m = findMoveToReachFen(prevFen, fen ?? '')
        if (m && soundEnabled) playMoveSound(m.from, m.to, prevChess)
      }
      if (!isReset && prevFen && fen && prevFen !== fen) {
        const m = findMoveToReachFen(prevFen, fen)
        setLastMoveTo(m?.to ?? null)
      }
    } else {
      g.set({ fen: fen ?? 'start', lastMove: isReset ? [] : undefined })
      if (!isReset && prevFen && fen && prevFen !== fen) {
        const m = findMoveToReachFen(prevFen, fen)
        setLastMoveTo(m?.to ?? null)
      }
    }
  }, [fen, resetKey, readonly, playerColor])

  const annotationPosition = annotation && lastMoveTo
    ? squareCornerAnchor(lastMoveTo, orientation, boardSize)
    : null
  const annotationClass = annotation ? annotationColorClass(annotation) : 'cg-annotation-default'

  return (
    <div className={className}>
      <div className="cg-board-shell" style={{ width: `${boardSize}px`, height: `${boardSize}px` }}>
        <div ref={boardRef} style={{ width: `${boardSize}px`, height: `${boardSize}px` }} />
        {annotation && annotationPosition && (
          <div
            className={`cg-annotation-glyph ${annotationClass}`}
            style={{ left: `${annotationPosition.left}px`, top: `${annotationPosition.top}px` }}
          >
            {annotation}
          </div>
        )}
      </div>
    </div>
  )
}
