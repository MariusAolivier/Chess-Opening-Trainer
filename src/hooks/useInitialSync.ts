import { useEffect } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { fetchAndMerge, subscribeToReviewActivity, subscribeToScores, uploadForkMainlines, uploadScores } from '../lib/sync'
import { loadStudies, type StoredStudy } from '../lib/storage'

interface UseInitialSyncParams {
  setSyncStatus: Dispatch<SetStateAction<'idle' | 'syncing' | 'ok' | 'error'>>
  setSyncError: Dispatch<SetStateAction<string | null>>
  setStoredStudies: Dispatch<SetStateAction<StoredStudy[]>>
  setStatsKey: Dispatch<SetStateAction<number>>
  migrateLegacyChapterIdsForStudies: (studiesToMigrate: StoredStudy[]) => boolean
}

export function useInitialSync({
  setSyncStatus,
  setSyncError,
  setStoredStudies,
  setStatsKey,
  migrateLegacyChapterIdsForStudies,
}: UseInitialSyncParams): void {
  useEffect(() => {
    setSyncStatus('syncing')
    fetchAndMerge()
      .then(changed => {
        const mergedStudies = loadStudies()
        const migrated = migrateLegacyChapterIdsForStudies(mergedStudies)
        setSyncStatus('ok')
        setStoredStudies(mergedStudies)
        if (changed || migrated) {
          setStatsKey(key => key + 1)
        }
        if (migrated) {
          uploadScores()
          uploadForkMainlines()
        }
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        console.error('[sync] fetchAndMerge failed:', err)
        setSyncStatus('error')
        setSyncError(message)
      })

    const unsubScores = subscribeToScores(() => {
      const studies = loadStudies()
      const migrated = migrateLegacyChapterIdsForStudies(studies)
      if (migrated) {
        uploadScores()
        uploadForkMainlines()
      }
      setStatsKey(key => key + 1)
    })

    const unsubReviewActivity = subscribeToReviewActivity(() => {
      setStatsKey(key => key + 1)
    })

    return () => {
      unsubScores()
      unsubReviewActivity()
    }
  }, [migrateLegacyChapterIdsForStudies, setStatsKey, setStoredStudies, setSyncError, setSyncStatus])
}
