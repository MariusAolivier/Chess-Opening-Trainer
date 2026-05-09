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
  /** ISO date string of the most recent review time */
  lastReviewedAt?: string
}

const KEY = 'chess-opening-trainer:scores'
const REVIEW_ACTIVITY_KEY = 'chess-opening-trainer:review-activity'

export interface ReviewActivityRecord {
  day: string
  count: number
}

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

function loadReviewActivityRaw(): ReviewActivityRecord[] {
  try {
    const raw = localStorage.getItem(REVIEW_ACTIVITY_KEY)
    if (!raw) return []
    return (JSON.parse(raw) as ReviewActivityRecord[]).filter(record => (
      typeof record.day === 'string' &&
      typeof record.count === 'number' &&
      Number.isFinite(record.count) &&
      record.count > 0
    ))
  } catch {
    return []
  }
}

function saveReviewActivity(records: ReviewActivityRecord[]): void {
  localStorage.setItem(REVIEW_ACTIVITY_KEY, JSON.stringify(records))
}

function toDayKey(value: number): string {
  const date = new Date(value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function toDayNumber(dayKey: string): number {
  const [year, month, day] = dayKey.split('-').map(Number)
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000)
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

const MAX_INTERVAL_DAYS = 30

/**
 * One-time migration: clamp any existing score whose interval exceeds 14 days.
 * Also adjusts the dueDate so it is no more than 14 days from lastReviewedAt
 * (or from now if lastReviewedAt is missing).
 */
export function capExistingScoreIntervals(): void {
  const records = load()
  const capped = applyIntervalCap(records)
  const changed = capped.some((r, i) => r !== records[i])
  if (changed) save(capped)
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
  quality: 0 | 1 | 2 | 3 | 4 | 5,
  intensity: 1 | 2 | 3 | 4 | 5 = 3
): ScoreRecord {
  const reviewedAt = new Date().toISOString()
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
    const baseInterval = Math.round(existing.interval * ease)
    interval = Math.max(1, Math.round(baseInterval * intensityIntervalScale(intensity)))
  }

  const dueDate = new Date(Date.now() + Math.min(interval, MAX_INTERVAL_DAYS) * 86_400_000).toISOString()
  const record: ScoreRecord = {
    chapterId,
    lineId,
    displaySan: resolvedDisplaySan,
    ease,
    interval,
    dueDate,
    lastReviewedAt: reviewedAt,
  }

  if (idx >= 0) {
    records[idx] = record
  } else {
    records.push(record)
  }
  save(records)
  recordReviewActivity()
  return record
}

function intensityIntervalScale(intensity: 1 | 2 | 3 | 4 | 5): number {
  // Higher intensity means the same lines come back sooner.
  switch (intensity) {
    case 1:
      return 1.35
    case 2:
      return 1.15
    case 3:
      return 1
    case 4:
      return 0.85
    case 5:
      return 0.7
  }
}

export function loadReviewActivity(): ReviewActivityRecord[] {
  return loadReviewActivityRaw()
}

export function importReviewActivity(records: ReviewActivityRecord[]): void {
  saveReviewActivity(records)
}

export function recordReviewActivity(at: number = Date.now()): void {
  const day = toDayKey(at)
  const records = loadReviewActivityRaw()
  const existing = records.find(record => record.day === day)
  if (existing) {
    existing.count += 1
  } else {
    records.push({ day, count: 1 })
    records.sort((left, right) => left.day.localeCompare(right.day))
  }
  saveReviewActivity(records)
}

export function getReviewStreak(now: number = Date.now()): { current: number; best: number; todayCount: number } {
  const records = loadReviewActivityRaw().sort((left, right) => left.day.localeCompare(right.day))
  if (records.length === 0) return { current: 0, best: 0, todayCount: 0 }

  const dayNumbers = records.map(record => toDayNumber(record.day))
  const todayKey = toDayKey(now)
  const todayNumber = toDayNumber(todayKey)
  const todayCount = records.find(record => record.day === todayKey)?.count ?? 0

  let best = 1
  let run = 1
  for (let index = 1; index < dayNumbers.length; index += 1) {
    if (dayNumbers[index] === dayNumbers[index - 1] + 1) {
      run += 1
    } else {
      run = 1
    }
    if (run > best) best = run
  }

  const latestDayNumber = dayNumbers[dayNumbers.length - 1]
  let current = 0
  if (latestDayNumber >= todayNumber - 1) {
    current = 1
    for (let index = dayNumbers.length - 1; index > 0; index -= 1) {
      if (dayNumbers[index] === dayNumbers[index - 1] + 1) {
        current += 1
      } else {
        break
      }
    }
  }

  return { current, best, todayCount }
}

/** Delete all scores for a given study (e.g. when the study is deleted). */
export function deleteScoresForStudy(studyId: string): void {
  const records = load().filter(r => !r.chapterId.startsWith(studyId + '_') && !r.chapterId.startsWith(studyId + '::'))
  save(records)
  const mainlines = loadForkMainlines().filter(m => !m.chapterId.startsWith(studyId + '_') && !m.chapterId.startsWith(studyId + '::'))
  saveForkMainlines(mainlines)
}

/**
 * Delete scores and fork-mainline data for a single chapter.
 */
export function deleteChapterScores(chapterId: string): void {
  const records = load().filter(r => r.chapterId !== chapterId)
  save(records)

  const mainlines = loadForkMainlines().filter(m => m.chapterId !== chapterId)
  saveForkMainlines(mainlines)
}

function scorePriority(record: ScoreRecord): number {
  const dueTime = Number.isNaN(Date.parse(record.dueDate)) ? 0 : Date.parse(record.dueDate)
  return record.interval * 1_000_000_000 + dueTime
}

export function remapChapterIds(remap: Map<string, string>): boolean {
  if (remap.size === 0) return false

  const originalScores = load()
  let changed = false
  const scoresById = new Map<string, ScoreRecord>()

  originalScores.forEach(record => {
    const nextChapterId = remap.get(record.chapterId) ?? record.chapterId
    if (nextChapterId !== record.chapterId) changed = true
    const nextRecord = nextChapterId === record.chapterId ? record : { ...record, chapterId: nextChapterId }
    const key = makeId(nextRecord.chapterId, nextRecord.lineId)
    const existing = scoresById.get(key)
    if (!existing || scorePriority(nextRecord) > scorePriority(existing)) {
      scoresById.set(key, nextRecord)
    }
  })

  if (changed) {
    save([...scoresById.values()])
  }

  const originalMainlines = loadForkMainlines()
  const mainlinesById = new Map<string, ForkMainlineRecord>()
  originalMainlines.forEach(record => {
    const nextChapterId = remap.get(record.chapterId) ?? record.chapterId
    const nextRecord = nextChapterId === record.chapterId ? record : { ...record, chapterId: nextChapterId }
    const key = `${nextRecord.chapterId}||${nextRecord.forkFen}`
    if (!mainlinesById.has(key)) {
      mainlinesById.set(key, nextRecord)
    }
  })

  if (changed) {
    saveForkMainlines([...mainlinesById.values()])
  }

  return changed
}

export function pruneStudyChapterIds(studyId: string, validChapterIds: Set<string>): number {
  const records = load()
  let removed = 0
  const kept = records.filter(record => {
    const belongsToStudy = record.chapterId.startsWith(studyId + '::') || record.chapterId.startsWith(studyId + '_')
    if (belongsToStudy && !validChapterIds.has(record.chapterId)) {
      removed += 1
      return false
    }
    return true
  })

  if (removed > 0) {
    save(kept)
  }

  const mainlines = loadForkMainlines()
  const keptMainlines = mainlines.filter(record => {
    const belongsToStudy = record.chapterId.startsWith(studyId + '::') || record.chapterId.startsWith(studyId + '_')
    return !belongsToStudy || validChapterIds.has(record.chapterId)
  })

  if (keptMainlines.length !== mainlines.length) {
    saveForkMainlines(keptMainlines)
  }

  return removed
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

/** Write a full set of score records (used by sync on remote update). */
export function importAllScores(records: ScoreRecord[]): void {
  const incoming = applyIntervalCap(records)
  const existing = load()

  // Merge rather than replace: keep any local record not present in the incoming
  // data, and for conflicts prefer whichever record has the more recent review.
  // This prevents a Firestore snapshot (echo of a prior write, or an optimistic
  // write that was reverted on network failure) from discarding a just-recorded
  // local review that hasn't been uploaded yet.
  const byId = new Map<string, ScoreRecord>()
  for (const r of existing) {
    byId.set(makeId(r.chapterId, r.lineId), r)
  }
  for (const r of incoming) {
    const key = makeId(r.chapterId, r.lineId)
    const local = byId.get(key)
    if (!local) {
      byId.set(key, r)
    } else {
      const localTime = local.lastReviewedAt ? Date.parse(local.lastReviewedAt) : 0
      const incomingTime = r.lastReviewedAt ? Date.parse(r.lastReviewedAt) : 0
      if (incomingTime > localTime) byId.set(key, r)
    }
  }
  save([...byId.values()])
}

function applyIntervalCap(records: ScoreRecord[]): ScoreRecord[] {
  return records.map(r => {
    if (r.interval <= MAX_INTERVAL_DAYS) return r
    const base = r.lastReviewedAt ? Date.parse(r.lastReviewedAt) : Date.now()
    return { ...r, interval: MAX_INTERVAL_DAYS, dueDate: new Date(base + MAX_INTERVAL_DAYS * 86_400_000).toISOString() }
  })
}

/** Read the raw fork mainlines array (used by sync to upload). */
export function exportForkMainlines(): ForkMainlineRecord[] {
  return loadForkMainlines()
}

/** Overwrite fork mainlines (used by sync on pull from Firestore). */
export function importForkMainlines(records: ForkMainlineRecord[]): void {
  saveForkMainlines(records)
}

export type { ForkMainlineRecord }

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
