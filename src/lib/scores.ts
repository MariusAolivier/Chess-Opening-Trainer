/**
 * Spaced-repetition score records.
 *
 * Each record tracks one reviewable branch point identified by:
 *   chapterId  – the StoredStudy id + chapter index (e.g. "1700000000_2")
 *   forkFen    – the FEN *before* the fork (the parent position)
 *   firstMoveSan – the SAN of the first move of the branch (variation root)
 *
 * This covers both inline and independent branches.
 */

export interface ScoreRecord {
  chapterId: string
  forkFen: string
  firstMoveSan: string
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
    return raw ? (JSON.parse(raw) as ScoreRecord[]) : []
  } catch {
    return []
  }
}

function save(records: ScoreRecord[]): void {
  localStorage.setItem(KEY, JSON.stringify(records))
}

function makeId(chapterId: string, forkFen: string, firstMoveSan: string): string {
  return `${chapterId}||${forkFen}||${firstMoveSan}`
}

/** Load all score records. */
export function loadScores(): ScoreRecord[] {
  return load()
}

/**
 * Ensure a score record exists for this branch.
 * If it already exists, does nothing. If new, creates it as "due now" with interval 0.
 * Call this the first time the fork position is reached, for all alternatives.
 */
export function initScore(chapterId: string, forkFen: string, firstMoveSan: string): void {
  const records = load()
  const exists = records.some(
    r => r.chapterId === chapterId && r.forkFen === forkFen && r.firstMoveSan === firstMoveSan
  )
  if (exists) return
  records.push({ chapterId, forkFen, firstMoveSan, ease: 2.5, interval: 0, dueDate: new Date().toISOString() })
  save(records)
}

/** Return the score for a specific branch, or undefined if never reviewed. */
export function getScore(chapterId: string, forkFen: string, firstMoveSan: string): ScoreRecord | undefined {
  return load().find(
    r => r.chapterId === chapterId && r.forkFen === forkFen && r.firstMoveSan === firstMoveSan
  )
}

/**
 * Upsert a score record after a review.
 *
 * quality: 0–5  (SM-2 rating — 0/1/2 = forgot, 3 = hard, 4 = good, 5 = easy)
 */
export function recordReview(
  chapterId: string,
  forkFen: string,
  firstMoveSan: string,
  quality: 0 | 1 | 2 | 3 | 4 | 5
): ScoreRecord {
  const records = load()
  const idx = records.findIndex(
    r => r.chapterId === chapterId && r.forkFen === forkFen && r.firstMoveSan === firstMoveSan
  )

  const existing = idx >= 0 ? records[idx] : undefined
  const ease = clampEase(
    (existing?.ease ?? 2.5) + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)
  )

  let interval: number
  if (quality < 3) {
    // Failed — reset to 1 day
    interval = 1
  } else if (!existing || existing.interval === 0) {
    interval = 1
  } else if (existing.interval === 1) {
    interval = 6
  } else {
    interval = Math.round(existing.interval * ease)
  }

  const dueDate = new Date(Date.now() + interval * 86_400_000).toISOString()

  const record: ScoreRecord = { chapterId, forkFen, firstMoveSan, ease, interval, dueDate }

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

/**
 * Update the stored fork mainlines for a chapter and reset any score records
 * where the recommended (mainline) move at a fork position has changed.
 * Returns the number of score records deleted.
 */
export function updateAndResetChangedForks(
  chapterId: string,
  newForkMap: Map<string, string>,  // forkFen → mainline SAN
): number {
  const mainlines = loadForkMainlines()

  // Collect fork positions whose mainline move differs from what was stored
  const changedFens = new Set<string>()
  newForkMap.forEach((newMainlineSan, forkFen) => {
    const existing = mainlines.find(m => m.chapterId === chapterId && m.forkFen === forkFen)
    if (existing && existing.mainlineSan !== newMainlineSan) {
      changedFens.add(forkFen)
    }
  })

  // Delete all score records for those changed positions
  let resetCount = 0
  if (changedFens.size > 0) {
    const scores = load()
    const kept = scores.filter(r => {
      if (r.chapterId === chapterId && changedFens.has(r.forkFen)) {
        resetCount++
        return false
      }
      return true
    })
    save(kept)
  }

  // Persist the updated mainlines for this chapter
  const others = mainlines.filter(m => m.chapterId !== chapterId)
  newForkMap.forEach((mainlineSan, forkFen) => {
    others.push({ chapterId, forkFen, mainlineSan })
  })
  saveForkMainlines(others)

  return resetCount
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
