import { describe, expect, it } from 'vitest'
import { extractTrainableLines, parseStudyWithWarnings } from './pgn'
import { findQuizStartMoveIndex } from './training'

const AFTER_NF3 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2'

describe('PGN parsing', () => {
  it('reports an illegal move instead of silently truncating the chapter', () => {
    const pgn = '[Event "Broken"]\n\n1. e4 e5 2. Bh6'

    expect(() => parseStudyWithWarnings(pgn)).toThrow(/Invalid PGN move "Bh6"/)
  })

  it('starts a chapter after the mainline move marked "#start"', () => {
    const pgn = '[Event "Marked"]\n\n1. e4 e5 (1... c5 2. Nf3 d6) 2. Nf3 { #start Main tabiya } Nc6 3. Bb5 a6'

    const [chapter] = parseStudyWithWarnings(pgn).chapters

    expect(chapter.startFen).toBe(AFTER_NF3)
    expect(chapter.startComment).toBe('Main tabiya')
    expect(chapter.trainFromStart).toBe(true)
    expect(chapter.moves.map(move => move.san)).toEqual(['Nc6'])
  })

  it('drops variations before the marker but keeps line ids for the rest', () => {
    const marked = '[Event "Marked"]\n\n1. e4 e5 (1... c5 2. Nf3 d6) 2. Nf3 { #start } Nc6 (2... d6 3. d4 exd4) 3. Bb5 a6'
    const unmarked = marked.replace('{ #start }', '')

    const markedLines = extractTrainableLines(parseStudyWithWarnings(marked).chapters[0], 'white')
    const unmarkedLines = extractTrainableLines(parseStudyWithWarnings(unmarked).chapters[0], 'white')

    expect(markedLines.map(line => line.lineId)).toEqual(
      unmarkedLines.filter(line => !line.lineId.includes('::c5::')).map(line => line.lineId),
    )
  })

  it('starts the quiz right at a marked position', () => {
    const pgn = '[Event "Marked"]\n\n1. e4 e5 2. Nf3 { #start } Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7'
    const [chapter] = parseStudyWithWarnings(pgn).chapters
    const line = []
    for (let node = chapter.moves[0]; node; node = node.children[0]) line.push(node)

    expect(findQuizStartMoveIndex(chapter, line, 'w')).toBe(-1)
  })

  it('leaves chapters without a marker unchanged', () => {
    const pgn = '[Event "Plain"]\n\n1. e4 { Best by test } e5 2. Nf3'

    const [chapter] = parseStudyWithWarnings(pgn).chapters

    expect(chapter.trainFromStart).toBeUndefined()
    expect(chapter.moves[0].san).toBe('e4')
  })
})
