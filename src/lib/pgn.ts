import { parseGames } from '@mliebelt/pgn-parser'
import type { PgnMove } from '@mliebelt/pgn-types'
import { Chess } from 'chess.js'

export interface MoveNode {
  san: string
  fen: string
  comment?: string
  children: MoveNode[]
  /** Only set on variation roots (non-mainline children). true = own session, false = inline detour */
  independent?: boolean
}

/** Depth of the mainline of a node list (following children[0] at each step) */
function lineDepth(nodes: MoveNode[]): number {
  let depth = 0
  let current = nodes
  while (current.length > 0) {
    depth++
    current = current[0].children
  }
  return depth
}

/** Variations longer than this many moves get their own session; shorter ones are inlined */
const INLINE_MAX_DEPTH = 4

export interface Chapter {
  title: string
  startFen: string
  startComment?: string
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
    comment: [move.commentMove, move.commentAfter].filter(Boolean).join(' ') || undefined,
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
    const altChildren = buildLine(varFen, varRest, chess)
    const depth = 1 + lineDepth(altChildren)
    return [{
      san: varFirst.notation.notation,
      fen: varFen,
      comment: [varFirst.commentMove, varFirst.commentAfter].filter(Boolean).join(' ') || undefined,
      children: altChildren,
      independent: depth > INLINE_MAX_DEPTH,
    } satisfies MoveNode]
  })

  return [mainNode, ...altNodes]
}

/**
 * Returns all leaf lines in a chapter — one entry per end-to-end path through the tree.
 * The lineId is the leaf node's FEN (unique per line); lastMoveSan is for display.
 * This covers the mainline, every inline detour, and every independent variation.
 */
export function extractLines(chapter: Chapter): { lineId: string; displaySan: string }[] {
  const lines: { lineId: string; displaySan: string }[] = []
  // displaySan: null on the mainline path, set to variation root san when entering a branch
  function walk(nodes: MoveNode[], branchDisplay: string | null) {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      // Entering a variation branch for the first time — lock in its display name
      const thisDisplay = i > 0 ? node.san : branchDisplay
      if (node.children.length === 0) {
        lines.push({ lineId: node.fen, displaySan: thisDisplay ?? 'Main line' })
      } else {
        walk(node.children, thisDisplay)
      }
    }
  }
  walk(chapter.moves, null)
  return lines
}

/**
 * Returns a map of forkFen → mainline SAN for every fork position in a chapter.
 * A fork is any position from which the chapter has 2+ continuations (nodes.length > 1).
 * nodes[0] is always the mainline move.
 */
export function extractForkMoves(chapter: Chapter): Map<string, string> {
  const map = new Map<string, string>()
  function walk(parentFen: string, nodes: MoveNode[]) {
    if (nodes.length === 0) return
    if (nodes.length > 1) {
      map.set(parentFen, nodes[0].san)
    }
    for (const node of nodes) {
      walk(node.fen, node.children)
    }
  }
  walk(chapter.startFen, chapter.moves)
  return map
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
      startComment: game.gameComment?.comment,
      moves: buildLine(startFen, game.moves as PgnMove[], chess),
    }
  })
}
