const PAUSE_KEY = 'chess-opening-trainer:sync-quota-pause:'
const pausedDays = new Map<string, string>()
const pauseListeners = new Set<(userId: string) => void>()
const quotaDayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export class SyncQuotaError extends Error {
  readonly code = 'resource-exhausted'

  constructor() {
    super('Cloud sync is paused because Firebase quota was exceeded. Your progress is saved on this device. Reload after the daily quota resets around midnight Pacific time. Do not clear site storage.')
    this.name = 'SyncQuotaError'
  }
}

export function isSyncQuotaError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  return 'code' in error && (
    error.code === 'resource-exhausted' ||
    error.code === 'firestore/resource-exhausted'
  )
}

export function isSyncQuotaPaused(userId: string): boolean {
  const today = quotaDayFormatter.format(new Date())
  let pausedDay = pausedDays.get(userId)
  if (!pausedDay) {
    try {
      pausedDay = localStorage.getItem(PAUSE_KEY + userId) ?? undefined
    } catch (error) {
      console.error('[sync] Could not read the quota pause:', error)
    }
  }
  if (!pausedDay) return false
  if (pausedDay === today) return true
  pausedDays.delete(userId)
  try {
    localStorage.removeItem(PAUSE_KEY + userId)
  } catch (error) {
    console.error('[sync] Could not clear the expired quota pause:', error)
  }
  return false
}

export function assertSyncAvailable(userId: string): void {
  if (isSyncQuotaPaused(userId)) throw new SyncQuotaError()
}

export function subscribeToQuotaPause(listener: (userId: string) => void): () => void {
  pauseListeners.add(listener)
  return () => { pauseListeners.delete(listener) }
}

export function syncOperationError(userId: string, error: unknown): Error {
  if (!isSyncQuotaError(error)) return error instanceof Error ? error : new Error(String(error))
  const today = quotaDayFormatter.format(new Date())
  const alreadyPaused = pausedDays.get(userId) === today
  pausedDays.set(userId, today)
  try {
    localStorage.setItem(PAUSE_KEY + userId, today)
  } catch (storageError) {
    console.error('[sync] Could not persist the quota pause:', storageError)
  }
  if (!alreadyPaused) pauseListeners.forEach(listener => listener(userId))
  return new SyncQuotaError()
}

export async function runSyncOperation<T>(userId: string, operation: () => Promise<T>): Promise<T> {
  assertSyncAvailable(userId)
  try {
    const result = await operation()
    assertSyncAvailable(userId)
    return result
  } catch (error) {
    throw syncOperationError(userId, error)
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', event => {
      if (!event.key?.startsWith(PAUSE_KEY) || event.newValue !== quotaDayFormatter.format(new Date())) return
      const userId = event.key.slice(PAUSE_KEY.length)
      pausedDays.set(userId, event.newValue)
      pauseListeners.forEach(listener => listener(userId))
    })
  }
}
