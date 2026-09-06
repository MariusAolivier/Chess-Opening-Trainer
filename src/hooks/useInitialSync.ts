import { useEffect } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import {
  fetchAndMerge,
  subscribeToReviewActivity,
  subscribeToScores,
  subscribeToStudiesAndMainlines,
  uploadForkMainlines,
  uploadScores,
} from '../lib/sync'
import { clearStudies, loadStudies, type StoredStudy } from '../lib/storage'
import {
  capExistingScoreIntervals,
  clearForkMainlines,
  clearReviewActivity,
  clearScores,
} from '../lib/scores'
import { getLocalSyncOwner, setLocalSyncOwner } from '../lib/auth'

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
    let initialFetchSettled = false
    let snapshotRecovered = false
    let fullReconcileGeneration = 0
    const createFullReconcileGuard = () => {
      const run = ++fullReconcileGeneration
      return () => (
        !cancelled &&
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
          initialFetchSettled = true
          return
        }
        initialFetchSettled = true
        const mergedStudies = loadStudies()
        const migrated = migrateLegacyChapterIdsForStudies(mergedStudies)
        setSyncStatus('ok')
        setSyncError(null)
        setLocalSyncOwner(userId)
        setStoredStudies(mergedStudies)
        if (migrated) {
          await Promise.all([uploadScores(userId), uploadForkMainlines(userId)])
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        initialFetchSettled = true
        if (snapshotRecovered) {
          setSyncStatus('ok')
          setSyncError(null)
          return
        }
        const message = err instanceof Error ? err.message : String(err)
        console.error('[sync] fetchAndMerge failed:', err)
        setSyncStatus('error')
        setSyncError(message)
      })

    const handleSubscriptionError = (error: Error) => {
      if (cancelled) return
      console.error('[sync] subscription failed:', error)
      setSyncStatus('error')
      setSyncError(error.message)
    }
    const handleRecoveredSync = () => {
      if (cancelled) return
      snapshotRecovered = true
      if (!initialFetchSettled) return
      setSyncStatus('ok')
      setSyncError(null)
    }

    const shouldApply = () => !cancelled && getLocalSyncOwner() === userId

    const unsubScores = subscribeToScores(userId, () => {
      const studies = loadStudies()
      const migrated = migrateLegacyChapterIdsForStudies(studies)
      if (migrated) {
        void Promise.all([uploadScores(userId), uploadForkMainlines(userId)]).catch(handleSubscriptionError)
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

    return () => {
      cancelled = true
      unsubScores()
      unsubReviewActivity()
      unsubStudies()
    }
  }, [migrateLegacyChapterIdsForStudies, setStoredStudies, setSyncError, setSyncStatus, userId])
}
