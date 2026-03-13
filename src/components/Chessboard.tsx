import { useEffect, useRef, useState } from 'react'
import { Chessground } from '@lichess-org/chessground'
import { Chess } from 'chess.js'
import type { Key } from '@lichess-org/chessground/types'
import '@lichess-org/chessground/assets/chessground.base.css'
import '@lichess-org/chessground/assets/chessground.brown.css'
import '@lichess-org/chessground/assets/chessground.cburnett.css'
import './chessboard-overrides.css'

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
  new Audio(import.meta.env.BASE_URL + file).play().catch(() => {})
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

interface ChessboardProps {
  fen?: string
  readonly?: boolean
  /** Quiz mode: the color the user controls */
  playerColor?: 'white' | 'black'
  /** Board orientation (defaults to white at bottom) */
  orientation?: 'white' | 'black'
  /** Called when the user drags a piece in quiz mode. Return false to reject the move (snaps back instantly). */
  onMove?: (from: string, to: string) => boolean | void
  /** Increment to force-reset the board to current fen (e.g. after a wrong guess) */
  resetKey?: number
}

export default function Chessboard({ fen, readonly = false, playerColor, orientation = 'white', onMove, resetKey }: ChessboardProps) {
  const [boardSize, setBoardSize] = useState(() => Math.min(400, window.innerWidth - 32))
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
            if (accepted !== false) {
              playMoveSound(from, to, new Chess(fenRef.current ?? undefined))
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
            playMoveSound(from, to, chess)
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
  }, [readonly, playerColor, orientation, boardSize]) // eslint-disable-line react-hooks/exhaustive-deps

  // Update position + dests when fen or resetKey changes
  useEffect(() => {
    const g = groundRef.current
    if (!g) return
    const isReset = resetKey !== prevResetKeyRef.current
    prevResetKeyRef.current = resetKey
    const prevFen = prevFenRef.current
    prevFenRef.current = fen
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
        const m = prevChess.moves({ verbose: true }).find(mv => {
          const t = new Chess(prevFen)
          t.move(mv)
          return t.fen() === fen
        })
        if (m) playMoveSound(m.from, m.to, prevChess)
      }
    } else {
      g.set({ fen: fen ?? 'start', lastMove: isReset ? [] : undefined })
    }
  }, [fen, resetKey, readonly, playerColor])

  return (
    <div ref={boardRef} style={{ width: `${boardSize}px`, height: `${boardSize}px` }} />
  )
}
