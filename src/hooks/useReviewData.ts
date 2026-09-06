import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  getReviewActivitySnapshot,
  getScoresSnapshot,
  subscribeToLocalReviewActivity,
  subscribeToLocalScores,
} from '../lib/scores'

export function useScoresSnapshot() {
  return useSyncExternalStore(subscribeToLocalScores, getScoresSnapshot, getScoresSnapshot)
}

export function useReviewActivitySnapshot() {
  return useSyncExternalStore(
    subscribeToLocalReviewActivity,
    getReviewActivitySnapshot,
    getReviewActivitySnapshot,
  )
}

export function useCurrentTime(refreshIntervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), refreshIntervalMs)
    return () => window.clearInterval(interval)
  }, [refreshIntervalMs])

  return now
}
