import { useEffect } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import {
  fetchAndMerge,
  subscribeToReviewActivity,
  subscribeToScores,
  subscribeToStudiesAndMainlines,
  uploadProgress,
} from '../lib/sync'
import { clearStudies, loadStudies, type StoredStudy } from '../lib/storage'
import {
  capExistingScoreIntervals,
  clearForkMainlines,
  clearReviewActivity,
  clearScores,
} from '../lib/scores'
import { getLocalSyncOwner, setLocalSyncOwner } from '../lib/auth'
import { isSyncQuotaPaused, subscribeToQuotaPause, SyncQuotaError, syncOperationError } from '../lib/syncQuota'

interface UseInitialSyncParams {
  userId: string | null
  setSyncStatus: Dispatch<SetStateAction<'idle' | 'syncing' | 'ok' | 'error'>>
  setSyncError: Dispatch<SetStateAction<string | null>>
  setStoredStudies: Dispatch<SetStateAction<StoredStudy[]>>
  migrateLegacyChapterIdsForStudies: (studiesToMigrate: StoredStudy[]) => boolean
}

export function useInitialSync({
  userId,
  setSyncStatus,
  setSyncError,
  setStoredStudies,
  migrateLegacyChapterIdsForStudies,
}: UseInitialSyncParams): void {
  useEffect(() => {
    capExistingScoreIntervals()
    if (!userId) {
      setSyncStatus('idle')
      setSyncError(null)
      return
    }

    const localOwner = getLocalSyncOwner()
    if (localOwner && localOwner !== userId) {
      clearStudies()
      clearScores()
      clearForkMainlines()
      clearReviewActivity()
      setStoredStudies([])
    }
    setLocalSyncOwner(userId)

    let cancelled = false
    let fullReconcileGeneration = 0
    let unsubscribeProgress = () => {}
    const unsubscribeQuotaPause = subscribeToQuotaPause(pausedUserId => {
      if (cancelled || pausedUserId !== userId) return
      unsubscribeProgress()
      setSyncStatus('error')
      setSyncError(new SyncQuotaError().message)
    })
    const createFullReconcileGuard = () => {
      const run = ++fullReconcileGeneration
      return () => (
        !cancelled &&
        !isSyncQuotaPaused(userId) &&
        getLocalSyncOwner() === userId &&
        run === fullReconcileGeneration
      )
    }
    const initialFetchShouldApply = createFullReconcileGuard()
    setSyncStatus('syncing')
    fetchAndMerge(userId, initialFetchShouldApply)
      .then(async () => {
        if (cancelled) return
        if (!initialFetchShouldApply()) {
          return
        }
        const mergedStudies = loadStudies()
        const migrated = migrateLegacyChapterIdsForStudies(mergedStudies)
        setLocalSyncOwner(userId)
        setStoredStudies(mergedStudies)
        if (!shouldApply()) return
        if (migrated) await uploadProgress(userId)
        if (!shouldApply()) return
        setSyncStatus('ok')
        setSyncError(null)
        subscribeToProgress()
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : String(err)
        console.error('[sync] fetchAndMerge failed:', err)
        setSyncStatus('error')
        setSyncError(message)
      })

    const handleSubscriptionError = (error: Error) => {
      if (cancelled) return
      const normalized = syncOperationError(userId, error)
      if (isSyncQuotaPaused(userId)) unsubscribeProgress()
      console.error('[sync] subscription failed:', normalized)
      setSyncStatus('error')
      setSyncError(normalized.message)
    }
    const handleRecoveredSync = () => {
      if (cancelled || isSyncQuotaPaused(userId)) return
      setSyncStatus('ok')
      setSyncError(null)
    }

    const shouldApply = () => !cancelled && getLocalSyncOwner() === userId && !isSyncQuotaPaused(userId)

    const subscribeToProgress = () => {
      if (!shouldApply()) return

      const unsubScores = subscribeToScores(userId, () => {
        const studies = loadStudies()
        const migrated = migrateLegacyChapterIdsForStudies(studies)
        if (migrated) {
          void uploadProgress(userId).catch(handleSubscriptionError)
        }
      }, handleSubscriptionError, shouldApply)

      const unsubReviewActivity = subscribeToReviewActivity(
        userId,
        () => {},
        handleSubscriptionError,
        shouldApply,
      )
      const unsubStudies = subscribeToStudiesAndMainlines(
        userId,
        studies => {
          setStoredStudies(studies)
          handleRecoveredSync()
        },
        handleSubscriptionError,
        shouldApply,
        createFullReconcileGuard,
      )

      unsubscribeProgress = () => {
        unsubScores()
        unsubReviewActivity()
        unsubStudies()
      }
    }

    return () => {
      cancelled = true
      unsubscribeProgress()
      unsubscribeQuotaPause()
    }
  }, [migrateLegacyChapterIdsForStudies, setStoredStudies, setSyncError, setSyncStatus, userId])
}
