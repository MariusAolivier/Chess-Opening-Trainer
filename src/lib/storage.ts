import type { Chapter, MoveNode } from './pgn'
import { deleteScoresForStudy, deleteChapterScores, remapChapterIds } from './scores'

export interface StoredStudy {
  id: string       // unique key, timestamp-based
  name: string     // e.g. filename or first chapter event tag
  playerColor: 'white' | 'black'
  chapters: Chapter[]
  updatedAt?: string
}

const KEY = 'chess-opening-trainer:studies'
const SOUND_ENABLED_KEY = 'chess-opening-trainer:sound-enabled'
const REPEAT_FAILED_VARIATIONS_KEY = 'chess-opening-trainer:repeat-failed-variations'
const SPACED_REPETITION_INTENSITY_KEY = 'chess-opening-trainer:spaced-repetition-intensity'
const COMMENTS_VISIBLE_KEY = 'chess-opening-trainer:comments-visible'

function clampIntensity(value: number): 1 | 2 | 3 | 4 | 5 {
  if (value <= 1) return 1
  if (value >= 5) return 5
  return Math.round(value) as 1 | 2 | 3 | 4 | 5
}

function normalizeStudyName(name: string): string {
  return name.trim().toLocaleLowerCase()
}

function isMoveNode(value: unknown): value is MoveNode {
  if (!value || typeof value !== 'object') return false
  const node = value as Partial<MoveNode>
  return (
    typeof node.san === 'string' &&
    typeof node.fen === 'string' &&
    (node.comment === undefined || typeof node.comment === 'string') &&
    (node.annotation === undefined || typeof node.annotation === 'string') &&
    Array.isArray(node.children) &&
    node.children.every(isMoveNode) &&
    (node.independent === undefined || typeof node.independent === 'boolean')
  )
}

function isChapter(value: unknown): value is Chapter {
  if (!value || typeof value !== 'object') return false
  const chapter = value as Partial<Chapter>
  return (
    typeof chapter.title === 'string' &&
    typeof chapter.startFen === 'string' &&
    (chapter.startComment === undefined || typeof chapter.startComment === 'string') &&
    Array.isArray(chapter.moves) &&
    chapter.moves.every(isMoveNode)
  )
}

function normalizeStoredStudy(value: unknown): StoredStudy | null {
  if (!value || typeof value !== 'object') return null
  const study = value as Partial<StoredStudy>
  if (
    typeof study.id !== 'string' ||
    typeof study.name !== 'string' ||
    !Array.isArray(study.chapters) ||
    !study.chapters.every(isChapter)
  ) {
    return null
  }
  const playerColor = study.playerColor ?? 'white'
  if (playerColor !== 'white' && playerColor !== 'black') return null
  const updatedAt = typeof study.updatedAt === 'string' && !Number.isNaN(Date.parse(study.updatedAt))
    ? study.updatedAt
    : undefined
  return { id: study.id, name: study.name, playerColor, chapters: study.chapters, updatedAt }
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

export function loadCommentsVisible(): boolean {
  try {
    const raw = localStorage.getItem(COMMENTS_VISIBLE_KEY)
    if (raw === null) return true
    return raw === 'true'
  } catch {
    return true
  }
}

export function saveCommentsVisible(visible: boolean): void {
  localStorage.setItem(COMMENTS_VISIBLE_KEY, String(visible))
}

export function loadStudies(): StoredStudy[] {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) as unknown : []
    if (!Array.isArray(parsed)) return []
    return parsed.map(normalizeStoredStudy).filter((study): study is StoredStudy => study !== null)
  } catch {
    return []
  }
}

export function saveStudy(name: string, playerColor: 'white' | 'black', chapters: Chapter[]): StoredStudy {
  const studies = loadStudies()
  const normalizedName = normalizeStudyName(name)
  const sanitizedName = name.trim() || name
  const existing = studies.find(s => normalizeStudyName(s.name) === normalizedName)
  const updatedAt = new Date().toISOString()
  if (existing) {
    // Replace in-place, keeping the same ID so scores are preserved
    const study: StoredStudy = { ...existing, name: sanitizedName, playerColor, chapters, updatedAt }
    const updated = studies.map(s => s.id === existing.id ? study : s)
    localStorage.setItem(KEY, JSON.stringify(updated))
    return study
  }

  const study: StoredStudy = { id: Date.now().toString(), name: sanitizedName, playerColor, chapters, updatedAt }
  studies.push(study)
  localStorage.setItem(KEY, JSON.stringify(studies))
  return study
}

export function clearStudies(): void {
  localStorage.setItem(KEY, JSON.stringify([]))
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

  const oldChapterIds = buildChapterIds(studyId, study.chapters)
  const deletedChapterId = oldChapterIds[chapterIndex]
  const remainingChapters = study.chapters.filter((_, i) => i !== chapterIndex)
  const updatedAt = new Date().toISOString()
  const updated = studies
    .map(s => {
      if (s.id !== studyId) return s
      return { ...s, chapters: remainingChapters, updatedAt }
    })
    .filter(s => s.chapters.length > 0)
  localStorage.setItem(KEY, JSON.stringify(updated))

  if (remainingChapters.length === 0) {
    deleteScoresForStudy(studyId)
    return updated
  }

  if (deletedChapterId) {
    deleteChapterScores(deletedChapterId)
  }

  const nextChapterIds = buildChapterIds(studyId, remainingChapters)
  const remap = new Map<string, string>()
  study.chapters.forEach((_, oldIndex) => {
    if (oldIndex === chapterIndex) return
    const newIndex = oldIndex > chapterIndex ? oldIndex - 1 : oldIndex
    const oldId = oldChapterIds[oldIndex]
    const nextId = nextChapterIds[newIndex]
    if (oldId && nextId && oldId !== nextId) remap.set(oldId, nextId)
  })
  remapChapterIds(remap)
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

// ---------------------------------------------------------------------------
// Insights cache
// ---------------------------------------------------------------------------

const INSIGHTS_KEY = 'chess-opening-trainer:insights'

export interface CachedGameStat {
  eco: string
  opening: string
  color: 'white' | 'black'
  wins: number
  draws: number
  losses: number
}

export interface CachedInsights {
  username: string
  fetchedAt: string
  stats: CachedGameStat[]
}

export function loadInsights(): CachedInsights | null {
  try {
    const raw = localStorage.getItem(INSIGHTS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CachedInsights>
    if (
      typeof parsed.username !== 'string' ||
      typeof parsed.fetchedAt !== 'string' ||
      Number.isNaN(Date.parse(parsed.fetchedAt)) ||
      !Array.isArray(parsed.stats)
    ) {
      return null
    }
    const stats = parsed.stats.filter((stat): stat is CachedGameStat => (
      Boolean(stat) &&
      typeof stat === 'object' &&
      typeof stat.eco === 'string' &&
      typeof stat.opening === 'string' &&
      (stat.color === 'white' || stat.color === 'black') &&
      Number.isFinite(stat.wins) &&
      Number.isFinite(stat.draws) &&
      Number.isFinite(stat.losses)
    ))
    return { username: parsed.username, fetchedAt: parsed.fetchedAt, stats }
  } catch {
    return null
  }
}

export function saveInsights(data: CachedInsights): void {
  localStorage.setItem(INSIGHTS_KEY, JSON.stringify(data))
}
