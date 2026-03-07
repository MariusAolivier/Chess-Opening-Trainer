import type { Chapter } from './pgn'

export interface StoredStudy {
  id: string       // unique key, timestamp-based
  name: string     // e.g. filename or first chapter event tag
  chapters: Chapter[]
}

const KEY = 'chess-opening-trainer:studies'

export function loadStudies(): StoredStudy[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as StoredStudy[]) : []
  } catch {
    return []
  }
}

export function saveStudy(name: string, chapters: Chapter[]): StoredStudy {
  const studies = loadStudies()
  const study: StoredStudy = { id: Date.now().toString(), name, chapters }
  studies.push(study)
  localStorage.setItem(KEY, JSON.stringify(studies))
  return study
}

export function deleteStudy(id: string): StoredStudy[] {
  const studies = loadStudies().filter(s => s.id !== id)
  localStorage.setItem(KEY, JSON.stringify(studies))
  return studies
}
