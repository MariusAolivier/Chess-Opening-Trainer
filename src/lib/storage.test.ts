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

describe('chapter storage', () => {
  beforeEach(() => {
    vi.resetModules()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: new MemoryStorage(),
    })
  })

  it('remaps scores when deleting the first of two identically named chapters', async () => {
    const storage = await import('./storage')
    const scores = await import('./scores')
    const chapters = [
      { title: 'Duplicate', startFen: 'start w - - 0 1', moves: [] },
      { title: 'Duplicate', startFen: 'start w - - 0 1', moves: [] },
    ]
    const study = { id: 'study', name: 'Study', playerColor: 'white' as const, chapters }
    localStorage.setItem('chess-opening-trainer:studies', JSON.stringify([study]))
    const [firstId, secondId] = storage.buildChapterIds(study.id, chapters)
    scores.replaceAllScores([
      {
        chapterId: firstId,
        lineId: 'first',
        displaySan: 'First',
        ease: 2.5,
        interval: 1,
        dueDate: '2026-01-01T00:00:00.000Z',
      },
      {
        chapterId: secondId,
        lineId: 'second',
        displaySan: 'Second',
        ease: 2.5,
        interval: 1,
        dueDate: '2026-01-02T00:00:00.000Z',
      },
    ])

    storage.deleteChapter(study.id, 0)

    expect(scores.loadScores()).toEqual([
      expect.objectContaining({
        chapterId: storage.buildChapterIds(study.id, [chapters[1]])[0],
        lineId: 'second',
      }),
    ])
  })
})
