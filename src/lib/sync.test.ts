import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScoreRecord } from './scores'

interface Reference {
  path: string
  id: string
}

const remote = vi.hoisted(() => new Map<string, Record<string, unknown>>())
const operations = vi.hoisted(() => ({ queries: 0, reads: 0, writes: 0, active: 0, maxActive: 0 }))
const listeners = vi.hoisted(() => new Map<string, {
  next: (snapshot: { docs: Array<{ id: string; ref: Reference; data: () => Record<string, unknown> }>; empty: boolean }) => void
  error: (error: Error) => void
}>())

vi.mock('./firebase', () => ({ db: {} }))
vi.mock('firebase/firestore', () => {
  const reference = (path: string): Reference => ({ path, id: path.split('/').at(-1) ?? '' })
  const snapshot = (ref: Reference) => {
    const data = remote.get(ref.path)
    return { id: ref.id, ref, exists: () => data !== undefined, data: () => data }
  }
  return {
    Timestamp: { now: () => ({ toMillis: () => Date.now() }) },
    collection: (_db: unknown, ...parts: string[]) => parts.join('/'),
    doc: (parent: unknown, ...parts: string[]) => reference(
      [typeof parent === 'string' ? parent : '', ...parts].filter(Boolean).join('/'),
    ),
    getDocs: vi.fn(async (collection: string) => {
      operations.queries += 1
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
    ) => {
      operations.active += 1
      operations.maxActive = Math.max(operations.active, operations.maxActive)
      try {
        return await run({
          get: async ref => { operations.reads += 1; return snapshot(ref) },
          set: (ref, data) => { operations.writes += 1; remote.set(ref.path, { ...data }) },
        })
      } finally {
        operations.active -= 1
      }
    }),
    setDoc: vi.fn(async (ref: Reference, data: Record<string, unknown>) => {
      operations.writes += 1
      remote.set(ref.path, { ...data })
    }),
    writeBatch: () => {
      const writes: Array<() => void> = []
      return {
        set: (ref: Reference, data: Record<string, unknown>) => {
          writes.push(() => {
            operations.writes += 1
            remote.set(ref.path, { ...data })
          })
        },
        commit: async () => { writes.forEach(operation => operation()) },
      }
    },
    onSnapshot: vi.fn((collection: string, next: (snapshot: {
      docs: Array<{ id: string; ref: Reference; data: () => Record<string, unknown> }>
      empty: boolean
    }) => void, error: (error: Error) => void) => {
      listeners.set(collection, { next, error })
      return vi.fn(() => { listeners.delete(collection) })
    }),
    serverTimestamp: () => ({ toMillis: () => Date.now() }),
  }
})

function emitCollection(name: string) {
  const collection = `users/owner/${name}`
  const docs = [...remote].filter(([path]) => path.startsWith(`${collection}/`)).map(([path, data]) => {
    const id = path.split('/').at(-1) ?? ''
    return { id, ref: { path, id }, data: () => data }
  })
  listeners.get(collection)?.next({ docs, empty: docs.length === 0 })
}

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
    listeners.clear()
    Object.assign(operations, { queries: 0, reads: 0, writes: 0, active: 0, maxActive: 0 })
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

  it('performs zero remote reads or writes when repeatedly flushing 1,000 unchanged scores and forks', async () => {
    const sync = await import('./sync')
    const scores = await import('./scores')
    const records = Array.from({ length: 1000 }, (_, index) => ({ ...reviewed(), lineId: `main::leaf-${index}` }))
    scores.replaceAllScores(records)
    scores.importForkMainlines(records.map((_, index) => ({
      chapterId: 'chapter', forkFen: `fork-${index}`, mainlineSan: 'e4', updatedAt: '2026-01-01T12:00:00.000Z',
    })))
    await sync.uploadProgress('owner')
    expect(operations.maxActive).toBeLessThanOrEqual(20)
    await sync.fetchAndMerge('owner')
    Object.assign(operations, { queries: 0, reads: 0, writes: 0 })

    for (let index = 0; index < 10; index += 1) await sync.uploadProgress('owner')
    await sync.uploadScores('owner', true)
    await sync.uploadForkMainlines('owner', true)

    expect(operations).toMatchObject({ queries: 0, reads: 0, writes: 0 })
  })

  it('uses received study and fork snapshots without rereading any collections', async () => {
    const sync = await import('./sync')
    const scores = await import('./scores')
    scores.updateForkMainlines('chapter', new Map([['fork', 'e4']]))
    await sync.fetchAndMerge('owner')
    Object.assign(operations, { queries: 0, reads: 0, writes: 0 })
    const onChange = vi.fn()
    const onError = vi.fn()
    const unsubscribe = sync.subscribeToStudiesAndMainlines('owner', onChange, onError)

    for (let index = 0; index < 10; index += 1) {
      emitCollection('studies')
      emitCollection('forkMainlines')
      await vi.advanceTimersByTimeAsync(0)
    }

    expect(onError).not.toHaveBeenCalled()
    expect(onChange).toHaveBeenCalledTimes(10)
    expect(operations).toMatchObject({ queries: 0, reads: 0, writes: 0 })
    const forkPath = [...remote.keys()].find(path => path.includes('/forkMainlines/'))
    if (!forkPath) throw new Error('Expected a synced fork recommendation.')
    remote.set(forkPath, { record: {
      chapterId: 'chapter', forkFen: 'fork', mainlineSan: 'd4', updatedAt: '2026-01-04T12:00:00.000Z',
    } })
    emitCollection('forkMainlines')
    await vi.advanceTimersByTimeAsync(0)
    expect(scores.exportForkMainlines()[0].mainlineSan).toBe('d4')
    expect(operations).toMatchObject({ queries: 0, reads: 0, writes: 0 })
    unsubscribe()
    expect(listeners.size).toBe(0)
  })

  it('writes only the reviewed score and device counter, and makes review retries idempotent', async () => {
    const sync = await import('./sync')
    const scores = await import('./scores')
    scores.replaceAllScores(Array.from({ length: 1000 }, (_, index) => ({
      ...reviewed(), lineId: `main::leaf-${index}`,
    })))
    await sync.uploadScores('owner')
    await sync.fetchAndMerge('owner')
    Object.assign(operations, { queries: 0, reads: 0, writes: 0 })
    const record = scores.recordReview('chapter', 'main::leaf-0', 'Main line', 5)
    const activity = scores.loadReviewActivity()[0]

    await sync.uploadScore('owner', record)
    await sync.incrementRemoteReviewActivity('owner', activity)
    await sync.uploadScore('owner', record)
    await sync.incrementRemoteReviewActivity('owner', activity)

    expect(operations).toMatchObject({ queries: 0, reads: 2, writes: 2 })
    const dailyCounter = [...remote].find(([path]) => path.includes('/reviewActivity/'))?.[1].record
    expect(dailyCounter).toMatchObject({ count: 1 })
  })

  it('does not write repeated reset tombstones', async () => {
    const sync = await import('./sync')
    const scores = await import('./scores')
    scores.replaceAllScores([reviewed()])
    await sync.uploadScores('owner')
    await sync.fetchAndMerge('owner')
    scores.clearScores()
    await sync.uploadScores('owner', true)
    Object.assign(operations, { queries: 0, reads: 0, writes: 0 })

    await sync.uploadScores('owner', true)

    expect(operations).toMatchObject({ queries: 0, reads: 0, writes: 0 })
  })

  it('restores this device counter before adding new reviews after its account cache was cleared', async () => {
    const sync = await import('./sync')
    const scores = await import('./scores')
    scores.recordReviewActivity()
    scores.recordReviewActivity()
    await sync.incrementRemoteReviewActivity('owner', scores.loadReviewActivity()[0])
    scores.clearReviewActivity()

    await sync.fetchAndMerge('owner')
    scores.recordReviewActivity()
    await sync.incrementRemoteReviewActivity('owner', scores.loadReviewActivity()[0])

    expect(scores.loadReviewActivity()[0].count).toBe(3)
    expect([...remote.values()][0].record).toMatchObject({ count: 3 })
  })

  it('keeps local progress and stops subsequent batches and retries after an SDK quota error', async () => {
    const sync = await import('./sync')
    const scores = await import('./scores')
    const firestore = await import('firebase/firestore')
    const records = Array.from({ length: 1000 }, (_, index) => ({ ...reviewed(), lineId: `main::leaf-${index}` }))
    scores.replaceAllScores(records)
    vi.mocked(firestore.runTransaction).mockRejectedValueOnce(
      Object.assign(new Error('Quota exceeded'), { code: 'resource-exhausted' }),
    )

    await expect(sync.uploadScores('owner')).rejects.toThrow('saved on this device')
    await vi.advanceTimersByTimeAsync(0)

    expect(operations.reads).toBeLessThanOrEqual(20)
    expect(scores.loadScores()).toEqual(records)
    Object.assign(operations, { queries: 0, reads: 0, writes: 0 })
    await expect(sync.uploadProgress('owner')).rejects.toThrow('Cloud sync is paused')
    await expect(sync.fetchAndMerge('owner')).rejects.toThrow('Cloud sync is paused')
    expect(operations).toMatchObject({ queries: 0, reads: 0, writes: 0 })
  })
})
