import { beforeEach, describe, expect, it, vi } from 'vitest'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()

  get length() {
    return this.values.size
  }

  clear() {
    this.values.clear()
  }

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string) {
    this.values.delete(key)
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

describe('score persistence', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T12:00:00Z'))
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: new MemoryStorage(),
    })
  })

  it('clears scores authoritatively', async () => {
    const scores = await import('./scores')
    scores.initScore('chapter', 'line', 'Main line')

    scores.clearScores()

    expect(scores.loadScores()).toEqual([])
  })

  it('publishes new snapshot identities after local mutations', async () => {
    const scores = await import('./scores')
    const scoreSnapshot = scores.getScoresSnapshot()
    const activitySnapshot = scores.getReviewActivitySnapshot()

    scores.initScore('chapter', 'line', 'Main line')
    const initializedSnapshot = scores.getScoresSnapshot()
    scores.recordReview('chapter', 'line', 'Main line', 5)
    scores.recordReviewActivity()

    expect(scores.getScoresSnapshot()).not.toBe(scoreSnapshot)
    expect(scores.getScoresSnapshot()).not.toBe(initializedSnapshot)
    expect(initializedSnapshot[0].interval).toBe(0)
    expect(scores.getReviewActivitySnapshot()).not.toBe(activitySnapshot)
  })

  it('stores the capped interval rather than only capping the due date', async () => {
    const scores = await import('./scores')
    scores.replaceAllScores([{
      chapterId: 'chapter',
      lineId: 'line',
      displaySan: 'Main line',
      ease: 2.5,
      interval: 30,
      dueDate: '2026-01-01T12:00:00.000Z',
      lastReviewedAt: '2026-01-01T12:00:00.000Z',
    }])

    const reviewed = scores.recordReview('chapter', 'line', 'Main line', 5)

    expect(reviewed.interval).toBe(30)
    expect(reviewed.dueDate).toBe('2026-01-31T12:00:00.000Z')
  })

  it('migrates legacy leaf-FEN line ids before pruning', async () => {
    const scores = await import('./scores')
    scores.replaceAllScores([{
      chapterId: 'chapter',
      lineId: 'leaf-fen',
      displaySan: 'Legacy line',
      ease: 2.5,
      interval: 6,
      dueDate: '2026-01-10T12:00:00.000Z',
    }])

    scores.syncChapterLines('chapter', new Set(['main::leaf-fen']))

    expect(scores.loadScores()).toEqual([
      expect.objectContaining({ lineId: 'main::leaf-fen' }),
    ])
  })

  it('tracks this device review count separately from aggregate activity', async () => {
    const scores = await import('./scores')

    scores.recordReviewActivity()
    scores.recordReviewActivity()

    expect(scores.getLocalDeviceReviewCount('2026-01-01')).toBe(2)
  })
})
