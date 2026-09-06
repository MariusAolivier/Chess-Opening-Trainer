import { describe, expect, it } from 'vitest'
import { parseStudyWithWarnings } from './pgn'

describe('PGN parsing', () => {
  it('reports an illegal move instead of silently truncating the chapter', () => {
    const pgn = '[Event "Broken"]\n\n1. e4 e5 2. Bh6'

    expect(() => parseStudyWithWarnings(pgn)).toThrow(/Invalid PGN move "Bh6"/)
  })
})
