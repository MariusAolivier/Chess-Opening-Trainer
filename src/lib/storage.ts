import type { Chapter } from './pgn'
import { deleteScoresForStudy } from './scores'

export interface StoredStudy {
  id: string       // unique key, timestamp-based
  name: string     // e.g. filename or first chapter event tag
  playerColor: 'white' | 'black'
  chapters: Chapter[]
}

const KEY = 'chess-opening-trainer:studies'

export function loadStudies(): StoredStudy[] {
  try {
    const raw = localStorage.getItem(KEY)
    // Spread after parse to migrate old studies that lack playerColor
    return raw ? (JSON.parse(raw) as StoredStudy[]).map(s => ({ playerColor: 'white' as const, ...s })) : []
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

/** Stable id for a single chapter, combining study id and chapter index. */
export function chapterId(studyId: string, chapterIndex: number): string {
  return `${studyId}_${chapterIndex}`
}
