import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('cloud quota circuit breaker', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-03T07:59:00Z'))
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('pauses the affected account and rejects later attempts before any network operation', async () => {
    const quota = await import('./syncQuota')
    const notification = vi.fn()
    const unsubscribe = quota.subscribeToQuotaPause(notification)
    const failed = vi.fn().mockRejectedValue(Object.assign(new Error('Quota exceeded.'), { code: 'resource-exhausted' }))

    await expect(quota.runSyncOperation('owner', failed)).rejects.toThrow('saved on this device')
    expect(notification).toHaveBeenCalledWith('owner')
    const retried = vi.fn().mockResolvedValue(undefined)
    await expect(quota.runSyncOperation('owner', retried)).rejects.toThrow('Cloud sync is paused')
    expect(retried).not.toHaveBeenCalled()
    await expect(quota.runSyncOperation('other-account', retried)).resolves.toBeUndefined()
    unsubscribe()
  })

  it('keeps the pause across a page reload and resumes at the next Pacific quota day', async () => {
    const quota = await import('./syncQuota')
    quota.syncOperationError('owner', { code: 'resource-exhausted' })
    vi.resetModules()
    const reloaded = await import('./syncQuota')
    expect(reloaded.isSyncQuotaPaused('owner')).toBe(true)

    vi.setSystemTime(new Date('2026-01-03T08:00:00Z'))

    expect(reloaded.isSyncQuotaPaused('owner')).toBe(false)
    const operation = vi.fn().mockResolvedValue('synced')
    await expect(reloaded.runSyncOperation('owner', operation)).resolves.toBe('synced')
  })

  it('does not disguise permission or network errors as quota exhaustion', async () => {
    const quota = await import('./syncQuota')
    const error = Object.assign(new Error('Permission denied'), { code: 'permission-denied' })

    await expect(quota.runSyncOperation('owner', async () => { throw error })).rejects.toBe(error)
    expect(quota.isSyncQuotaPaused('owner')).toBe(false)
  })

  it('does not let an in-flight success restore sync after another operation exhausts quota', async () => {
    const quota = await import('./syncQuota')
    let finish!: () => void
    const pending = quota.runSyncOperation('owner', () => new Promise<void>(resolve => { finish = resolve }))
    const result = expect(pending).rejects.toThrow('Cloud sync is paused')
    quota.syncOperationError('owner', { code: 'firestore/resource-exhausted' })

    finish()

    await result
  })

  it('retains its in-memory pause when browser storage is unavailable', async () => {
    const quota = await import('./syncQuota')
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('Storage disabled') },
      setItem: () => { throw new Error('Storage disabled') },
    })

    quota.syncOperationError('owner', { code: 'resource-exhausted' })

    expect(quota.isSyncQuotaPaused('owner')).toBe(true)
    expect(log).toHaveBeenCalledWith('[sync] Could not persist the quota pause:', expect.any(Error))
    log.mockRestore()
  })
})
