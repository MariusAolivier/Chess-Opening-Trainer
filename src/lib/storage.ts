import type { Chapter } from './pgn'

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
  const study: StoredStudy = { id: Date.now().toString(), name, playerColor, chapters }
  studies.push(study)
  localStorage.setItem(KEY, JSON.stringify(studies))
  return study
}

export function deleteStudy(id: string): StoredStudy[] {
  const studies = loadStudies().filter(s => s.id !== id)
  localStorage.setItem(KEY, JSON.stringify(studies))
  return studies
}
