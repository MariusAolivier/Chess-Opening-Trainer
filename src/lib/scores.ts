/**
 * Spaced-repetition score records.
 *
 * Each record tracks one reviewable *line* (a complete path through the tree
 * from the chapter start to a leaf node), identified by:
 *   chapterId   – the StoredStudy id + chapter index (e.g. "1700000000_2")
 *   lineId      – the FEN of the leaf (last) position of the line
 *   lastMoveSan – the SAN of that leaf move (for display)
 *
 * One record per end-to-end line:
 *   • the full mainline
 *   • each inline detour
 *   • each independent variation
 */

export interface ScoreRecord {
  chapterId: string
  lineId: string
  displaySan: string
  /** SM-2 ease factor, starts at 2.5 */
  ease: number
  /** Current inter-review interval in days */
  interval: number
  /** ISO date string of the next due date */
  dueDate: string
}

const KEY = 'chess-opening-trainer:scores'

function load(): ScoreRecord[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    // Filter out legacy records from the old (forkFen, firstMoveSan) schema
    return (JSON.parse(raw) as ScoreRecord[]).filter(r => typeof r.lineId === 'string')
  } catch {
    return []
  }
}

function save(records: ScoreRecord[]): void {
  localStorage.setItem(KEY, JSON.stringify(records))
}

function makeId(chapterId: string, lineId: string): string {
  return `${chapterId}||${lineId}`
}

/** Load all score records. */
export function loadScores(): ScoreRecord[] {
  return load()
}

/**
 * Ensure a score record exists for this line.
 * If it already exists, does nothing. If new, creates it as "due now" with interval 0.
 * Call this at quiz start for every leaf line in the chapter.
 */
export function initScore(chapterId: string, lineId: string, displaySan: string): void {
  const records = load()
  if (records.some(r => r.chapterId === chapterId && r.lineId === lineId)) return
  records.push({ chapterId, lineId, displaySan, ease: 2.5, interval: 0, dueDate: new Date().toISOString() })
  save(records)
}

/** Return the score for a specific line, or undefined if never reviewed. */
export function getScore(chapterId: string, lineId: string): ScoreRecord | undefined {
  return load().find(r => r.chapterId === chapterId && r.lineId === lineId)
}

/**
 * Upsert a score record after a review.
 *
 * quality: 0–5  (SM-2 rating — 0/1/2 = forgot, 3 = hard, 4 = good, 5 = easy)
 */
export function recordReview(
  chapterId: string,
  lineId: string,
  displaySan: string,
  quality: 0 | 1 | 2 | 3 | 4 | 5
): ScoreRecord {
  const records = load()
  const idx = records.findIndex(r => r.chapterId === chapterId && r.lineId === lineId)

  const existing = idx >= 0 ? records[idx] : undefined
  // Keep the stored displaySan if the record already exists (seeded by initScore)
  const resolvedDisplaySan = existing?.displaySan ?? displaySan
  const ease = clampEase(
    (existing?.ease ?? 2.5) + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)
  )

  let interval: number
  if (quality < 3) {
    interval = 1
  } else if (!existing || existing.interval === 0) {
    interval = 1
  } else if (existing.interval === 1) {
    interval = 6
  } else {
    interval = Math.round(existing.interval * ease)
  }

  const dueDate = new Date(Date.now() + interval * 86_400_000).toISOString()
  const record: ScoreRecord = { chapterId, lineId, displaySan: resolvedDisplaySan, ease, interval, dueDate }

  if (idx >= 0) {
    records[idx] = record
  } else {
    records.push(record)
  }
  save(records)
  return record
}

/** Delete all scores for a given study (e.g. when the study is deleted). */
export function deleteScoresForStudy(studyId: string): void {
  const records = load().filter(r => !r.chapterId.startsWith(studyId + '_'))
  save(records)
  const mainlines = loadForkMainlines().filter(m => !m.chapterId.startsWith(studyId + '_'))
  saveForkMainlines(mainlines)
}

/**
 * Remove stale score records for a chapter — those whose lineId is no longer
 * present in the current PGN (line was removed or its path changed).
 * Returns the number of records removed.
 */
export function syncChapterLines(chapterId: string, validLineIds: Set<string>): number {
  const records = load()
  let removed = 0
  const kept = records.filter(r => {
    if (r.chapterId === chapterId && !validLineIds.has(r.lineId)) {
      removed++
      return false
    }
    return true
  })
  if (removed > 0) save(kept)
  return removed
}

function clampEase(e: number): number {
  return Math.max(1.3, e)
}

/** Stable key for a branch — useful as React key or Map key. */
export { makeId as scoreBranchKey }

// ---------------------------------------------------------------------------
// Fork-mainline tracking (used to detect when a re-uploaded study changes the
// recommended move for a position, so stale scores can be reset).
// ---------------------------------------------------------------------------

const MAINLINES_KEY = 'chess-opening-trainer:fork-mainlines'

interface ForkMainlineRecord {
  chapterId: string
  forkFen: string
  mainlineSan: string
}

function loadForkMainlines(): ForkMainlineRecord[] {
  try {
    const raw = localStorage.getItem(MAINLINES_KEY)
    return raw ? (JSON.parse(raw) as ForkMainlineRecord[]) : []
  } catch {
    return []
  }
}

function saveForkMainlines(records: ForkMainlineRecord[]): void {
  localStorage.setItem(MAINLINES_KEY, JSON.stringify(records))
}

export interface ConflictInfo {
  forkFen: string
  recommendations: { chapterId: string; chapterLabel: string; mainlineSan: string }[]
}

/** Update the stored fork mainlines for a chapter (used for conflict detection). */
export function updateForkMainlines(
  chapterId: string,
  newForkMap: Map<string, string>,  // forkFen → mainline SAN
): void {
  const mainlines = loadForkMainlines()
  const others = mainlines.filter(m => m.chapterId !== chapterId)
  newForkMap.forEach((mainlineSan, forkFen) => {
    others.push({ chapterId, forkFen, mainlineSan })
  })
  saveForkMainlines(others)
}

/**
 * Scan all stored fork mainlines and return positions where two or more active
 * chapters recommend different moves.
 *
 * @param allChapters  Map<chapterId, human-readable label>
 */
export function findConflicts(allChapters: Map<string, string>): ConflictInfo[] {
  const mainlines = loadForkMainlines()

  // Group by forkFen, restricted to active chapters
  const byFen = new Map<string, { chapterId: string; mainlineSan: string }[]>()
  mainlines.forEach(m => {
    if (!allChapters.has(m.chapterId)) return
    const list = byFen.get(m.forkFen) ?? []
    list.push({ chapterId: m.chapterId, mainlineSan: m.mainlineSan })
    byFen.set(m.forkFen, list)
  })

  const conflicts: ConflictInfo[] = []
  byFen.forEach((entries, forkFen) => {
    const uniqueSans = new Set(entries.map(e => e.mainlineSan))
    if (uniqueSans.size > 1) {
      conflicts.push({
        forkFen,
        recommendations: entries.map(e => ({
          chapterId: e.chapterId,
          chapterLabel: allChapters.get(e.chapterId) ?? e.chapterId,
          mainlineSan: e.mainlineSan,
        })),
      })
    }
  })

  return conflicts
}
