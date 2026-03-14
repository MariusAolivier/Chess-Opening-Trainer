import type { Chapter, MoveNode } from './pgn'

export type FlatMove = {
  fen: string
  san: string
  comment?: string
  annotation?: string
}

export type MainlineMove = {
  fen: string
  san: string
  comment?: string
  annotation?: string
  alternatives: MoveNode[]
}

export type InlineDetour = {
  forkFen: string
  forkMainlineIndex: number
  pendingInlines: MoveNode[]
  detourLine: FlatMove[]
  detourIndex: number
}

export const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const QUIZ_START_USER_TURN = 3

export const HOME_FENS = [
  'rnbqkbnr/pppp1ppp/4p3/8/3PP3/8/PPP2PPP/RNBQKBNR b KQkq - 0 2',
  'r1bqkbnr/pppp1ppp/2n5/4p3/3P4/5N2/PPP1PPPP/RNBQKB1R w KQkq - 2 3',
  'rnbqkb1r/pp1ppppp/5n2/2p5/4P3/2N5/PPPP1PPP/R1BQKBNR w KQkq - 2 3',
  'r1bqkbnr/pppp1ppp/2n5/4p3/1bPP4/5N2/PP2PPPP/RNBQKB1R w KQkq - 2 4',
]

export function flattenDetour(root: MoveNode): FlatMove[] {
  const line: FlatMove[] = []
  let node: MoveNode | undefined = root
  while (node) {
    line.push({ fen: node.fen, san: node.san, comment: node.comment, annotation: node.annotation })
    node = node.children[0]
  }
  return line
}

export function nextPlayableDetourIndex(
  detourLine: Array<{ fen: string }>,
  detourIndex: number,
  currentFen: string,
): number {
  let next = detourIndex + 1
  while (next < detourLine.length && detourLine[next]?.fen === currentFen) {
    next += 1
  }
  return next
}

export function findQuizStartMoveIndex(
  chapter: Chapter,
  line: Array<{ fen: string }>,
  userColor: 'w' | 'b',
  targetUserTurn = QUIZ_START_USER_TURN,
): number {
  let userTurnCount = 0

  for (let moveToPlayIndex = 0; moveToPlayIndex < line.length; moveToPlayIndex++) {
    const fenBeforeMove = moveToPlayIndex === 0 ? chapter.startFen : line[moveToPlayIndex - 1].fen
    const sideToMove = fenBeforeMove.split(' ')[1] as 'w' | 'b'
    if (sideToMove !== userColor) continue

    userTurnCount += 1
    if (userTurnCount === targetUserTurn) {
      return moveToPlayIndex - 1
    }
  }

  return -1
}
