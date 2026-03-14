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

/** Variations longer than this many plies get their own session; shorter ones are inlined */
const INLINE_MAX_DEPTH = 6

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
  const altNodes: MoveNode[] = move.variations.flatMap((varMoves: PgnMove[]) => {
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
 * Removes variation branches that only contain a single ply (one move by one side).
 * Branches with 2+ plies are kept (e.g. one move for White and one for Black).
 * Mainline moves (index 0 in each sibling list) are always kept.
 */
function pruneSingleMoveBranches(nodes: MoveNode[]): MoveNode[] {
  if (nodes.length === 0) return []

  return nodes.flatMap((node, index) => {
    const prunedChildren = pruneSingleMoveBranches(node.children)
    const prunedNode: MoveNode = { ...node, children: prunedChildren }

    if (index === 0) return [prunedNode]

    const branchDepthInPlies = 1 + lineDepth(prunedChildren)
    return branchDepthInPlies <= 1 ? [] : [prunedNode]
  })
}

/**
 * Returns all lines currently trainable by the quiz flow.
 *
 * The trainer follows the chapter mainline and, at each mainline fork,
 * temporarily enters each alternative by following that branch's primary path
 * (children[0] chain) to its leaf.
 */
export interface TrainableLine {
  lineId: string
  displaySan: string
  plyCount: number
}

export function extractTrainableLines(chapter: Chapter): TrainableLine[] {
  const lines: TrainableLine[] = []
  const seen = new Set<string>()

  function addLine(lineId: string, displaySan: string, plyCount: number) {
    if (seen.has(lineId)) return
    seen.add(lineId)
    lines.push({ lineId, displaySan, plyCount })
  }

  function leafOnPrimaryPath(root: MoveNode): MoveNode {
    let node = root
    while (node.children.length > 0) {
      node = node.children[0]
    }
    return node
  }

  let nodes = chapter.moves
  let mainlineLeaf: MoveNode | null = null

  while (nodes.length > 0) {
    for (let index = 1; index < nodes.length; index += 1) {
      const alternative = nodes[index]
      if (alternative.independent) continue
      const leaf = leafOnPrimaryPath(alternative)
      addLine(leaf.fen, alternative.san, 1 + lineDepth(alternative.children))
    }

    const main = nodes[0]
    mainlineLeaf = main
    nodes = main.children
  }

  if (mainlineLeaf) {
    addLine(mainlineLeaf.fen, 'Main line', lineDepth(chapter.moves))
  }

  return lines
}

export function extractLines(chapter: Chapter): { lineId: string; displaySan: string }[] {
  return extractTrainableLines(chapter).map(({ lineId, displaySan }) => ({ lineId, displaySan }))
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
 * Also extracts the StudyName tag (present in Lichess exports) as the study name.
 */
export function parseStudy(pgn: string): { name: string | null; chapters: Chapter[] } {
  const games = parseGames(pgn)
  const chess = new Chess()

  // StudyName is the same across all chapters — read it from the first game
  const firstTags = games[0]?.tags as Record<string, string> | undefined
  const name = firstTags?.StudyName ?? null

  const chapters = games.map(game => {
    const tags = game.tags as Record<string, string> | undefined
    const title = tags?.Event ?? 'Untitled'
    const startFen = tags?.FEN ?? START_FEN

    chess.load(startFen)

    return {
      title,
      startFen,
      startComment: game.gameComment?.comment,
      moves: pruneSingleMoveBranches(buildLine(startFen, game.moves as PgnMove[], chess)),
    }
  })

  return { name, chapters }
}
