import type { Chapter } from './pgn'
import { deleteScoresForStudy, deleteAndReindexChapter } from './scores'

export interface StoredStudy {
  id: string       // unique key, timestamp-based
  name: string     // e.g. filename or first chapter event tag
  playerColor: 'white' | 'black'
  chapters: Chapter[]
}

const KEY = 'chess-opening-trainer:studies'
const SOUND_ENABLED_KEY = 'chess-opening-trainer:sound-enabled'

export function loadSoundEnabled(): boolean {
  try {
    const raw = localStorage.getItem(SOUND_ENABLED_KEY)
    if (raw === null) return true
    return raw === 'true'
  } catch {
    return true
  }
}

export function saveSoundEnabled(enabled: boolean): void {
  localStorage.setItem(SOUND_ENABLED_KEY, String(enabled))
}

export function loadStudies(): StoredStudy[] {
  try {
    const raw = localStorage.getItem(KEY)
    // Spread after parse to migrate old studies that lack playerColor
    return raw ? (JSON.parse(raw) as StoredStudy[]).map(s => ({ ...s, playerColor: (s.playerColor ?? 'white') as 'white' | 'black' })) : []
  } catch {
    return []
  }
}

export function saveStudy(name: string, playerColor: 'white' | 'black', chapters: Chapter[]): StoredStudy {
  const studies = loadStudies()
  const existing = studies.find(s => s.name === name)
  if (existing) {
    // Replace in-place, keeping the same ID so scores are preserved
    const study: StoredStudy = { ...existing, playerColor, chapters }
    const updated = studies.map(s => s.id === existing.id ? study : s)
    localStorage.setItem(KEY, JSON.stringify(updated))
    return study
  }
  const study: StoredStudy = { id: Date.now().toString(), name, playerColor, chapters }
  studies.push(study)
  localStorage.setItem(KEY, JSON.stringify(studies))
  return study
}

export function deleteStudy(id: string): StoredStudy[] {
  const studies = loadStudies().filter(s => s.id !== id)
  localStorage.setItem(KEY, JSON.stringify(studies))
  deleteScoresForStudy(id)
  return studies
}

/**
 * Remove a single chapter from a study. If it was the last chapter, the whole
 * study is removed. Scores for the deleted chapter are removed and subsequent
 * chapter scores are re-indexed. Returns the updated studies list.
 */
export function deleteChapter(studyId: string, chapterIndex: number): StoredStudy[] {
  const studies = loadStudies()
  const updated = studies
    .map(s => {
      if (s.id !== studyId) return s
      return { ...s, chapters: s.chapters.filter((_, i) => i !== chapterIndex) }
    })
    .filter(s => s.chapters.length > 0)
  localStorage.setItem(KEY, JSON.stringify(updated))
  deleteAndReindexChapter(studyId, chapterIndex)
  return updated
}

/** Stable id for a single chapter, combining study id and chapter index. */
export function chapterId(studyId: string, chapterIndex: number): string {
  return `${studyId}_${chapterIndex}`
}
