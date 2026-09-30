import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScoreRecord } from './scores'

interface Reference {
  path: string
  id: string
}

const remote = vi.hoisted(() => new Map<string, Record<string, unknown>>())

vi.mock('./firebase', () => ({ db: {} }))
vi.mock('firebase/firestore', () => {
  const reference = (path: string): Reference => ({ path, id: path.split('/').at(-1) ?? '' })
  const snapshot = (ref: Reference) => ({
    id: ref.id,
    ref,
    exists: () => remote.has(ref.path),
    data: () => remote.get(ref.path),
  })
  return {
    collection: (_db: unknown, ...parts: string[]) => parts.join('/'),
    doc: (parent: unknown, ...parts: string[]) => reference(
      [typeof parent === 'string' ? parent : '', ...parts].filter(Boolean).join('/'),
    ),
    getDocs: vi.fn(async (collection: string) => {
      const docs = [...remote.keys()]
        .filter(path => path.startsWith(`${collection}/`))
        .map(path => snapshot(reference(path)))
      return { docs, empty: docs.length === 0 }
    }),
    runTransaction: vi.fn(async (
      _db: unknown,
      run: (transaction: {
        get: (ref: Reference) => Promise<ReturnType<typeof snapshot>>
        set: (ref: Reference, data: Record<string, unknown>) => void
      }) => unknown,
    ) => run({
      get: async ref => snapshot(ref),
      set: (ref, data) => { remote.set(ref.path, { ...data }) },
    })),
    setDoc: vi.fn(async (ref: Reference, data: Record<string, unknown>) => {
      remote.set(ref.path, { ...data })
    }),
    writeBatch: () => {
      const operations: Array<() => void> = []
      return {
        set: (ref: Reference, data: Record<string, unknown>) => {
          operations.push(() => { remote.set(ref.path, { ...data }) })
        },
        commit: async () => { operations.forEach(operation => operation()) },
      }
    },
    onSnapshot: vi.fn(() => vi.fn()),
    serverTimestamp: () => ({ toMillis: () => Date.now() }),
  }
})

function useDeviceStorage() {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  })
}

function reviewed(lineId = 'main::leaf-fen'): ScoreRecord {
  return {
    chapterId: 'chapter',
    lineId,
    displaySan: 'Main line',
    ease: 2.5,
    interval: 6,
    dueDate: '2026-01-07T12:00:00.000Z',
    lastReviewedAt: '2026-01-01T12:00:00.000Z',
  }
}

describe('cross-device progress merging', () => {
  beforeEach(() => {
    vi.resetModules()
    remote.clear()
    useDeviceStorage()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-03T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('loads phone completion and its due date over a newer laptop initialization', async () => {
    const sync = await import('./sync')
    const scores = await import('./scores')
    const phoneReview = reviewed()
    await sync.uploadScore('owner', phoneReview)
    scores.initScore('chapter', phoneReview.lineId, 'Main line')

    await sync.fetchAndMerge('owner')

    expect(scores.loadScores()).toEqual([phoneReview])
    expect([...remote.values()].map(data => data.record)).toEqual([phoneReview])
  })

  it('does not upload an unreviewed laptop seed over an existing phone review', async () => {
    const sync = await import('./sync')
    const scores = await import('./scores')
    const phoneReview = reviewed()
    await sync.uploadScore('owner', phoneReview)
    scores.initScore('chapter', phoneReview.lineId, 'Main line')

    await sync.uploadScores('owner')

    expect([...remote.values()].map(data => data.record)).toEqual([phoneReview])
  })

  it('carries legacy review progress into canonical line ids rather than preferring an unreviewed seed', async () => {
    const sync = await import('./sync')
    const scores = await import('./scores')
    const phoneReview = reviewed('leaf-fen')
    await sync.uploadScore('owner', phoneReview)
    scores.initScore('chapter', 'main::leaf-fen', 'Main line')

    await sync.fetchAndMerge('owner')

    expect(scores.loadScores()).toEqual([{ ...phoneReview, lineId: 'main::leaf-fen' }])
  })

  it('keeps different canonical variations that finish at the same position separate', async () => {
    const sync = await import('./sync')
    const scores = await import('./scores')
    const first = reviewed('var::first-path::leaf-fen')
    const second = { ...reviewed('var::second-path::leaf-fen'), interval: 1 }
    await sync.uploadScore('owner', first)
    await sync.uploadScore('owner', second)

    await sync.fetchAndMerge('owner')

    expect(scores.loadScores()).toEqual([first, second])
  })

  it('makes the same reviewed scores available in a fresh device store', async () => {
    const sync = await import('./sync')
    const phoneScores = await import('./scores')
    phoneScores.replaceAllScores([reviewed()])
    await sync.uploadScores('owner')

    vi.resetModules()
    useDeviceStorage()
    const laptopSync = await import('./sync')
    const laptopScores = await import('./scores')
    expect(laptopScores.loadScores()).toEqual([])

    await laptopSync.fetchAndMerge('owner')

    expect(laptopScores.loadScores()).toEqual([reviewed()])
  })

  it.each(['main::leaf-fen', 'leaf-fen'])('maps %s progress from independently imported phone and laptop studies', async lineId => {
    const sync = await import('./sync')
    const scores = await import('./scores')
    const storage = await import('./storage')
    const chapters = [{ title: 'Chapter', startFen: 'start', moves: [] }]
    const phoneStudy = {
      id: 'phone-study',
      name: 'My study',
      playerColor: 'white' as const,
      chapters,
      updatedAt: '2026-01-01T12:00:00.000Z',
    }
    await sync.uploadStudy('owner', phoneStudy)
    const phoneReview = { ...reviewed(lineId), chapterId: 'phone-study::Chapter::1' }
    await sync.uploadScore('owner', phoneReview)
    const laptopStudy = storage.saveStudy('My study', 'white', chapters)
    const laptopChapterId = storage.chapterId(laptopStudy.id, chapters, 0)
    scores.initScore(laptopChapterId, 'main::leaf-fen', 'Main line')

    await sync.fetchAndMerge('owner')

    expect(storage.loadStudies()).toHaveLength(1)
    expect(scores.loadScores()).toEqual([{ ...phoneReview, chapterId: laptopChapterId, lineId: 'main::leaf-fen' }])

    await sync.uploadScores('owner')
    vi.resetModules()
    useDeviceStorage()
    const freshSync = await import('./sync')
    const freshScores = await import('./scores')
    await freshSync.fetchAndMerge('owner')
    expect(freshScores.loadScores()).toEqual([{ ...phoneReview, chapterId: laptopChapterId, lineId: 'main::leaf-fen' }])

    vi.resetModules()
    useDeviceStorage()
    localStorage.setItem('chess-opening-trainer:studies', JSON.stringify([phoneStudy]))
    const phoneSync = await import('./sync')
    const returningPhoneScores = await import('./scores')
    const nextReview = {
      ...phoneReview,
      interval: 1,
      lastReviewedAt: '2026-01-04T12:00:00.000Z',
      dueDate: '2026-01-05T12:00:00.000Z',
    }
    returningPhoneScores.replaceAllScores([nextReview])

    await phoneSync.fetchAndMerge('owner')

    expect(returningPhoneScores.loadScores()).toEqual([{ ...nextReview, chapterId: laptopChapterId, lineId: 'main::leaf-fen' }])
  })

  it('respects a remote reset rather than resurrecting an older review', async () => {
    const sync = await import('./sync')
    const scores = await import('./scores')
    await sync.uploadScore('owner', reviewed())
    const [path] = remote.keys()
    remote.set(path, { deletedAt: { toMillis: () => Date.now() } })
    scores.replaceAllScores([reviewed()])

    await sync.fetchAndMerge('owner')

    expect(scores.loadScores()).toEqual([])
    expect(remote.get(path)).not.toHaveProperty('record')
  })
})
