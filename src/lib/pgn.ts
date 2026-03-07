import { parseGames } from '@mliebelt/pgn-parser'
import type { PgnMove } from '@mliebelt/pgn-types'
import { Chess } from 'chess.js'

export interface MoveNode {
  san: string
  fen: string
  comment?: string
  children: MoveNode[]
}

export interface Chapter {
  title: string
  startFen: string
  moves: MoveNode[]  // children of the start position
}

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

/**
 * Recursively builds a move tree from a flat pgn-parser move list.
 *
 * Each PgnMove's `variations` field holds alternative continuations from
 * the same parent position as that move. So both the main-line move and each
 * variation's first move are children of the parent position node.
 */
function buildLine(parentFen: string, moves: PgnMove[], chess: Chess): MoveNode[] {
  if (moves.length === 0) return []

  const [move, ...rest] = moves

  chess.load(parentFen)
  const result = chess.move(move.notation.notation)
  if (!result) return []
  const fen = chess.fen()

  const mainNode: MoveNode = {
    san: move.notation.notation,
    fen,
    comment: move.commentAfter,
    children: buildLine(fen, rest, chess),
  }

  // Each variation is an alternative to `move` played from `parentFen`
  const altNodes: MoveNode[] = move.variations.flatMap(varMoves => {
    if (varMoves.length === 0) return []
    const [varFirst, ...varRest] = varMoves
    chess.load(parentFen)
    const varResult = chess.move(varFirst.notation.notation)
    if (!varResult) return []
    const varFen = chess.fen()
    return [{
      san: varFirst.notation.notation,
      fen: varFen,
      comment: varFirst.commentAfter,
      children: buildLine(varFen, varRest, chess),
    } satisfies MoveNode]
  })

  return [mainNode, ...altNodes]
}

/**
 * Parses a Lichess study PGN string (which may contain multiple chapters)
 * into an array of Chapters, each with a full move tree.
 */
export function parseStudy(pgn: string): Chapter[] {
  const games = parseGames(pgn)
  const chess = new Chess()

  return games.map(game => {
    const tags = game.tags as Record<string, string> | undefined
    const title = tags?.Event ?? 'Untitled'
    const startFen = tags?.FEN ?? START_FEN

    chess.load(startFen)

    return {
      title,
      startFen,
      moves: buildLine(startFen, game.moves as PgnMove[], chess),
    }
  })
}
