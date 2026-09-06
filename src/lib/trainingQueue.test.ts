import { describe, expect, it } from 'vitest'
import type { Chapter } from './pgn'
import { buildChapterTrainingLines } from './appHelpers'
import { findQuizStartMoveIndex } from './training'
import { buildChapterTrainingQueue } from './trainingQueue'

const chapter: Chapter = {
  title: 'Chapter',
  startFen: 'position w - - 0 1',
  moves: [{
    san: 'e4',
    fen: 'after-e4 b - - 0 1',
    children: [
      { san: 'e5', fen: 'after-e5 w - - 0 2', children: [] },
      {
        san: 'c5',
        fen: 'after-c5 w - - 0 2',
        children: [{ san: 'Nf3', fen: 'after-nf3 b - - 1 2', children: [] }],
      },
    ],
  }],
}

describe('training queue', () => {
  it('includes future-due sidelines in review-ahead queues', () => {
    const details = buildChapterTrainingLines(chapter)
    const main = details.lines[0]
    const sideline = details.sidelineAlts[0]
    const scores = [main, { lineId: sideline.lineId }].map(item => ({
      chapterId: 'chapter',
      lineId: item.lineId,
      displaySan: 'Line',
      ease: 2.5,
      interval: 6,
      dueDate: '2099-01-01T00:00:00.000Z',
      lastReviewedAt: '2026-01-01T00:00:00.000Z',
    }))

    const queue = buildChapterTrainingQueue(chapter, 'chapter', scores, [2], Date.parse('2026-01-02'))

    expect(queue).toHaveLength(1)
    expect(queue[0].line.sidelines?.[0].sidelineLine.lineId).toBe(sideline.lineId)
  })

  it('recognizes *** chapters as themes', () => {
    expect(findQuizStartMoveIndex(
      { ...chapter, title: '*** Tactics' },
      chapter.moves,
      'w',
    )).toBe(-1)
  })
})
