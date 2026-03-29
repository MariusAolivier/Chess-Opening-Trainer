import { useCallback, useEffect, useState } from 'react'
import {
  beginLichessOAuthLoginAndSync,
  clearLichessToken,
  completeLichessOAuthFromUrl,
  loadLichessToken,
} from '../lib/lichess'

interface UseLichessSyncParams {
  runLichessSync: (accessToken: string) => Promise<void>
  setError: (value: string | null) => void
  setSyncStatus: (value: 'idle' | 'syncing' | 'ok' | 'error') => void
  setSyncError: (value: string | null) => void
}

export function useLichessSync({
  runLichessSync,
  setError,
  setSyncStatus,
  setSyncError,
}: UseLichessSyncParams): { lichessSyncing: boolean; handleSyncWithLichess: () => Promise<void> } {
  const [lichessSyncing, setLichessSyncing] = useState(false)

  const startLichessSyncFromToken = useCallback((accessToken: string) => {
    setLichessSyncing(true)
    runLichessSync(accessToken)
      .then(() => {
        setSyncStatus('ok')
        setSyncError(null)
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        if (message.includes('expired')) {
          clearLichessToken()
        }
        setError(message)
        setSyncStatus('error')
        setSyncError(message)
      })
      .finally(() => setLichessSyncing(false))
  }, [runLichessSync, setError, setSyncError, setSyncStatus])

  const handleSyncWithLichess = useCallback(async () => {
    if (lichessSyncing) return
    setLichessSyncing(true)
    setError(null)

    try {
      const existingToken = loadLichessToken()
      if (!existingToken) {
        await beginLichessOAuthLoginAndSync()
        return
      }

      await runLichessSync(existingToken)
      setSyncStatus('ok')
      setSyncError(null)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      setSyncStatus('error')
      setSyncError(message)
    } finally {
      setLichessSyncing(false)
    }
  }, [lichessSyncing, runLichessSync, setError, setSyncError, setSyncStatus])

  useEffect(() => {
    completeLichessOAuthFromUrl()
      .then(result => {
        if (result?.shouldSync) {
          startLichessSyncFromToken(result.accessToken)
          return
        }

        const existingToken = loadLichessToken()
        if (!existingToken) return
        startLichessSyncFromToken(existingToken)
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        setError(message)
      })
  }, [setError, startLichessSyncFromToken])

  return {
    lichessSyncing,
    handleSyncWithLichess,
  }
}
