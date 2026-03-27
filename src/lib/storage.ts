import type { Chapter } from './pgn'
import { deleteScoresForStudy, deleteChapterScores } from './scores'

export interface StoredStudy {
  id: string       // unique key, timestamp-based
  name: string     // e.g. filename or first chapter event tag
  playerColor: 'white' | 'black'
  chapters: Chapter[]
}

const KEY = 'chess-opening-trainer:studies'
const SOUND_ENABLED_KEY = 'chess-opening-trainer:sound-enabled'
const REPEAT_FAILED_VARIATIONS_KEY = 'chess-opening-trainer:repeat-failed-variations'
const SPACED_REPETITION_INTENSITY_KEY = 'chess-opening-trainer:spaced-repetition-intensity'

function clampIntensity(value: number): 1 | 2 | 3 | 4 | 5 {
  if (value <= 1) return 1
  if (value >= 5) return 5
  return Math.round(value) as 1 | 2 | 3 | 4 | 5
}

function normalizeStudyName(name: string): string {
  return name.trim().toLocaleLowerCase()
}

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

export function loadRepeatFailedVariationsEnabled(): boolean {
  try {
    const raw = localStorage.getItem(REPEAT_FAILED_VARIATIONS_KEY)
    if (raw === null) return true
    return raw === 'true'
  } catch {
    return true
  }
}

export function saveRepeatFailedVariationsEnabled(enabled: boolean): void {
  localStorage.setItem(REPEAT_FAILED_VARIATIONS_KEY, String(enabled))
}

export function loadSpacedRepetitionIntensity(): 1 | 2 | 3 | 4 | 5 {
  try {
    const raw = localStorage.getItem(SPACED_REPETITION_INTENSITY_KEY)
    if (raw === null) return 3
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? clampIntensity(parsed) : 3
  } catch {
    return 3
  }
}

export function saveSpacedRepetitionIntensity(value: number): void {
  localStorage.setItem(SPACED_REPETITION_INTENSITY_KEY, String(clampIntensity(value)))
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
  const normalizedName = normalizeStudyName(name)
  const sanitizedName = name.trim() || name
  const existing = studies.find(s => normalizeStudyName(s.name) === normalizedName)
  if (existing) {
    // Replace in-place, keeping the same ID so scores are preserved
    const study: StoredStudy = { ...existing, name: sanitizedName, playerColor, chapters }
    const updated = studies.map(s => s.id === existing.id ? study : s)
    localStorage.setItem(KEY, JSON.stringify(updated))
    return study
  }
  const study: StoredStudy = { id: Date.now().toString(), name: sanitizedName, playerColor, chapters }
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
  const study = studies.find(s => s.id === studyId)
  if (!study) return studies

  const deletedChapterId = chapterId(studyId, study.chapters, chapterIndex)
  const updated = studies
    .map(s => {
      if (s.id !== studyId) return s
      return { ...s, chapters: s.chapters.filter((_, i) => i !== chapterIndex) }
    })
    .filter(s => s.chapters.length > 0)
  localStorage.setItem(KEY, JSON.stringify(updated))
  deleteChapterScores(deletedChapterId)
  return updated
}

function chapterKeyPart(title: string): string {
  const normalized = title.trim() || 'untitled'
  return encodeURIComponent(normalized)
}

export function buildChapterIds(studyId: string, chapters: Chapter[]): string[] {
  const counts = new Map<string, number>()

  return chapters.map(chapter => {
    const key = chapterKeyPart(chapter.title)
    const occurrence = (counts.get(key) ?? 0) + 1
    counts.set(key, occurrence)
    return `${studyId}::${key}::${occurrence}`
  })
}

export function legacyChapterId(studyId: string, chapterIndex: number): string {
  return `${studyId}_${chapterIndex}`
}

/** Stable id for a single chapter, combining study id and chapter title. */
export function chapterId(studyId: string, chapters: Chapter[], chapterIndex: number): string {
  return buildChapterIds(studyId, chapters)[chapterIndex]
}
