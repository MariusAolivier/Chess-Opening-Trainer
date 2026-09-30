import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const effect = vi.hoisted(() => ({ cleanup: undefined as (() => void) | undefined }))
const cloud = vi.hoisted(() => ({
  fetchAndMerge: vi.fn(),
  uploadProgress: vi.fn(),
  subscribeToScores: vi.fn(),
  subscribeToReviewActivity: vi.fn(),
  subscribeToStudiesAndMainlines: vi.fn(),
}))
const callbacks = vi.hoisted(() => ({
  studies: undefined as ((studies: []) => void) | undefined,
  scoresGuard: undefined as (() => boolean) | undefined,
}))
const stops = vi.hoisted(() => ({ scores: vi.fn(), activity: vi.fn(), studies: vi.fn() }))

vi.mock('react', () => ({
  useEffect: (start: () => (() => void) | void) => { effect.cleanup = start() ?? undefined },
}))
vi.mock('../lib/sync', () => cloud)
vi.mock('../lib/auth', () => ({
  getLocalSyncOwner: () => 'owner',
  setLocalSyncOwner: vi.fn(),
}))
vi.mock('../lib/storage', () => ({ loadStudies: () => [], clearStudies: vi.fn() }))
vi.mock('../lib/scores', () => ({
  capExistingScoreIntervals: vi.fn(),
  clearForkMainlines: vi.fn(),
  clearReviewActivity: vi.fn(),
  clearScores: vi.fn(),
}))

describe('initial sync quota handling', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-03T12:00:00Z'))
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
    })
    cloud.fetchAndMerge.mockResolvedValue(false)
    cloud.subscribeToScores.mockImplementation((_id, _next, _error, guard) => {
      callbacks.scoresGuard = guard
      return stops.scores
    })
    cloud.subscribeToReviewActivity.mockReturnValue(stops.activity)
    cloud.subscribeToStudiesAndMainlines.mockImplementation((_id, next) => {
      callbacks.studies = next
      return stops.studies
    })
  })

  afterEach(() => {
    effect.cleanup?.()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  async function start() {
    const { useInitialSync } = await import('./useInitialSync')
    const setSyncStatus = vi.fn()
    const setSyncError = vi.fn()
    function HookHarness() {
      useInitialSync({
        userId: 'owner', setSyncStatus, setSyncError,
        setStoredStudies: vi.fn(),
        migrateLegacyChapterIdsForStudies: () => false,
      })
    }
    HookHarness()
    await vi.advanceTimersByTimeAsync(0)
    return { setSyncStatus, setSyncError }
  }

  it('unsubscribes every listener when a separate review upload exhausts quota', async () => {
    const { setSyncStatus, setSyncError } = await start()
    const quota = await import('../lib/syncQuota')
    expect(setSyncStatus).toHaveBeenLastCalledWith('ok')
    expect(cloud.uploadProgress).not.toHaveBeenCalled()

    quota.syncOperationError('owner', { code: 'resource-exhausted' })

    expect(stops.scores).toHaveBeenCalledOnce()
    expect(stops.activity).toHaveBeenCalledOnce()
    expect(stops.studies).toHaveBeenCalledOnce()
    expect(callbacks.scoresGuard?.()).toBe(false)
    callbacks.studies?.([])
    expect(setSyncStatus).toHaveBeenLastCalledWith('error')
    expect(setSyncError).toHaveBeenLastCalledWith(expect.stringContaining('saved on this device'))
  })

  it('does not start listeners after quota exhaustion during the initial merge', async () => {
    const quota = await import('../lib/syncQuota')
    cloud.fetchAndMerge.mockImplementation(() => quota.runSyncOperation('owner', async () => {
      throw Object.assign(new Error('Quota exceeded'), { code: 'resource-exhausted' })
    }))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { setSyncStatus } = await start()

    expect(setSyncStatus).toHaveBeenLastCalledWith('error')
    expect(cloud.subscribeToScores).not.toHaveBeenCalled()
    expect(cloud.subscribeToReviewActivity).not.toHaveBeenCalled()
    expect(cloud.subscribeToStudiesAndMainlines).not.toHaveBeenCalled()
    log.mockRestore()
  })
})
