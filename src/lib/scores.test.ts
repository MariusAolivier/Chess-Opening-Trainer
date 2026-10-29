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

  it('maps wrong moves and reveals to a review quality', async () => {
    const { reviewQuality } = await import('./scores')

    expect(reviewQuality(0, 0)).toBe(5)
    expect(reviewQuality(1, 0)).toBe(4)
    expect(reviewQuality(3, 0)).toBe(3)
    expect(reviewQuality(1, 1)).toBe(2)
    expect(reviewQuality(2, 2)).toBe(0)
  })

  it('interpolates scheduling bands between calm and intense', async () => {
    const { schedulingParams } = await import('./scores')

    expect(schedulingParams(1)).toEqual({ minDays: 60, maxDays: 150, easeCeiling: 2.5, easeChangeScale: 0.5 })
    expect(schedulingParams(3)).toEqual({ minDays: 34, maxDays: 90, easeCeiling: 2.25, easeChangeScale: 0.75 })
    expect(schedulingParams(5)).toEqual({ minDays: 7, maxDays: 30, easeCeiling: 2, easeChangeScale: 1 })
  })

  it('grows intervals within the intense band', async () => {
    const scores = await import('./scores')
    scores.initScore('chapter', 'line', 'Main line')

    const intervals = [1, 2, 3, 4].map(() => scores.recordReview('chapter', 'line', 'Main line', 5, 5).interval)

    expect(intervals).toEqual([7, 14, 28, 30])
  })

  it('schedules calm lines two to five months out', async () => {
    const scores = await import('./scores')

    const first = scores.recordReview('chapter', 'line', 'Main line', 5, 1)
    const second = scores.recordReview('chapter', 'line', 'Main line', 5, 1)

    expect(first.interval).toBe(60)
    expect(first.dueDate).toBe('2026-03-02T12:00:00.000Z')
    expect(second.interval).toBe(150)
  })

  it('sends failed lines back to the band minimum, never the next day', async () => {
    const scores = await import('./scores')
    scores.replaceAllScores([{
      chapterId: 'chapter',
      lineId: 'line',
      displaySan: 'Main line',
      ease: 2,
      interval: 30,
      dueDate: '2026-01-01T12:00:00.000Z',
      lastReviewedAt: '2025-12-02T12:00:00.000Z',
    }])

    const failed = scores.recordReview('chapter', 'line', 'Main line', 0, 5)

    expect(failed.interval).toBe(7)
    expect(failed.ease).toBeCloseTo(1.7)
  })

  it('keeps intervals longer than 30 days and clamps ease to the ceiling', async () => {
    const scores = await import('./scores')
    scores.replaceAllScores([{
      chapterId: 'chapter',
      lineId: 'line',
      displaySan: 'Main line',
      ease: 2.5,
      interval: 150,
      dueDate: '2026-01-01T12:00:00.000Z',
      lastReviewedAt: '2025-08-04T12:00:00.000Z',
    }])

    expect(scores.loadScores()[0].interval).toBe(150)

    const reviewed = scores.recordReview('chapter', 'line', 'Main line', 4, 5)

    expect(reviewed.ease).toBe(2)
    expect(reviewed.interval).toBe(30)
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

  it('does not replace reviewed progress with a newly initialized line when remapping chapters', async () => {
    const scores = await import('./scores')
    const reviewed = scores.recordReview('phone-chapter', 'line', 'Main line', 5)
    vi.setSystemTime(new Date('2026-01-02T12:00:00Z'))
    scores.initScore('laptop-chapter', 'line', 'Main line')

    scores.remapChapterIds(new Map([['phone-chapter', 'laptop-chapter']]))

    expect(scores.loadScores()).toEqual([{ ...reviewed, chapterId: 'laptop-chapter' }])
  })

  it('compares review timestamps rather than next due dates for legacy records', async () => {
    const scores = await import('./scores')
    const older = {
      chapterId: 'chapter',
      lineId: 'line',
      displaySan: 'Main line',
      ease: 2.5,
      interval: 30,
      dueDate: '2026-01-31T12:00:00.000Z',
    }
    const newer = {
      ...older,
      interval: 1,
      dueDate: '2026-01-03T12:00:00.000Z',
      lastReviewedAt: '2026-01-02T12:00:00.000Z',
    }

    expect(scores.scoreRecency(newer)).toBeGreaterThan(scores.scoreRecency(older))
    expect(scores.scoreRecency({ ...older, interval: 0 })).toBe(0)
  })

  it('remaps fork-only progress even when there are no score records', async () => {
    const scores = await import('./scores')
    scores.updateForkMainlines('old-chapter', new Map([['fork-fen', 'e4']]))

    expect(scores.remapChapterIds(new Map([['old-chapter', 'chapter']]))).toBe(true)
    expect(scores.exportForkMainlines()).toEqual([
      expect.objectContaining({ chapterId: 'chapter', forkFen: 'fork-fen' }),
    ])
  })

  it('does not change timestamps when fork recommendations are unchanged', async () => {
    const scores = await import('./scores')
    scores.updateForkMainlines('chapter', new Map([['fork', 'e4']]))
    const original = scores.exportForkMainlines()
    vi.setSystemTime(new Date('2026-01-03T12:00:00Z'))

    scores.updateForkMainlines('chapter', new Map([['fork', 'e4']]))

    expect(scores.exportForkMainlines()).toEqual(original)
    scores.updateForkMainlines('chapter', new Map([['fork', 'd4']]))
    expect(scores.exportForkMainlines()[0]).toMatchObject({
      mainlineSan: 'd4', updatedAt: '2026-01-03T12:00:00.000Z',
    })
  })
})
