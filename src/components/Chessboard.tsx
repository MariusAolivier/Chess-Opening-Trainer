import { useEffect, useRef } from 'react'
import { Chessground } from '@lichess-org/chessground'
import { Chess } from 'chess.js'
import type { Key } from '@lichess-org/chessground/types'
import '@lichess-org/chessground/assets/chessground.base.css'
import '@lichess-org/chessground/assets/chessground.brown.css'
import '@lichess-org/chessground/assets/chessground.cburnett.css'

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
}

export default function Chessboard({ fen, readonly = false }: ChessboardProps) {
  const boardRef = useRef<HTMLDivElement>(null)
  const groundRef = useRef<ReturnType<typeof Chessground> | null>(null)

  // Init chessground once (reinit if readonly mode changes)
  useEffect(() => {
    if (!boardRef.current) return
    const chess = new Chess(fen ?? undefined)

    const ground = Chessground(boardRef.current, {
      movable: readonly
        ? { color: undefined, free: false }
        : { color: 'white', free: false, dests: getLegalDests(chess) },
      events: readonly ? {} : {
        move(from, to) {
          chess.move({ from, to, promotion: 'q' })
          const nextColor = chess.turn() === 'w' ? 'white' : 'black'
          ground.set({
            turnColor: nextColor,
            movable: { color: nextColor, dests: getLegalDests(chess) },
          })
        },
      },
    })

    groundRef.current = ground
    return () => {
      ground.destroy()
      groundRef.current = null
    }
  }, [readonly])

  // Update board position when fen prop changes (without recreating ground)
  useEffect(() => {
    if (!groundRef.current) return
    groundRef.current.set({ fen: fen ?? 'start' })
  }, [fen])

  return (
    <div ref={boardRef} style={{ width: '400px', height: '400px' }} />
  )
}
