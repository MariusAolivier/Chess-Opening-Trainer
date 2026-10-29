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
  /** SM-2 ease factor, starts at the intensity's ease ceiling */
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
const DEVICE_REVIEW_ACTIVITY_KEY = 'chess-opening-trainer:device-review-activity'
const REVIEW_DEVICE_ID_KEY = 'chess-opening-trainer:review-device-id'
const scoreListeners = new Set<() => void>()
const activityListeners = new Set<() => void>()
let scoreCache: ScoreRecord[] | null = null
let activityCache: ReviewActivityRecord[] | null = null

interface DeviceReviewActivityRecord {
  day: string
  count: number
}

export interface ReviewActivityRecord {
  day: string
  count: number
  updatedAt?: string
}

function isScoreRecord(value: unknown): value is ScoreRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<ScoreRecord>
  return (
    typeof record.chapterId === 'string' &&
    typeof record.lineId === 'string' &&
    typeof record.displaySan === 'string' &&
    typeof record.ease === 'number' &&
    Number.isFinite(record.ease) &&
    typeof record.interval === 'number' &&
    Number.isFinite(record.interval) &&
    typeof record.dueDate === 'string' &&
    !Number.isNaN(Date.parse(record.dueDate)) &&
    (record.lastReviewedAt === undefined || (
      typeof record.lastReviewedAt === 'string' &&
      !Number.isNaN(Date.parse(record.lastReviewedAt))
    ))
  )
}

function load(): ScoreRecord[] {
  if (scoreCache) return scoreCache
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) as unknown : []
    scoreCache = Array.isArray(parsed) ? parsed.filter(isScoreRecord) : []
  } catch {
    scoreCache = []
  }
  return scoreCache
}

function save(records: ScoreRecord[]): void {
  scoreCache = records.map(record => ({ ...record }))
  localStorage.setItem(KEY, JSON.stringify(scoreCache))
  scoreListeners.forEach(listener => listener())
}

function loadReviewActivityRaw(): ReviewActivityRecord[] {
  if (activityCache) return activityCache
  try {
    const raw = localStorage.getItem(REVIEW_ACTIVITY_KEY)
    const parsed = raw ? JSON.parse(raw) as unknown : []
    activityCache = (Array.isArray(parsed) ? parsed : []).filter((record): record is ReviewActivityRecord => (
      Boolean(record) &&
      typeof record === 'object' &&
      typeof record.day === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(record.day) &&
      typeof record.count === 'number' &&
      Number.isFinite(record.count) &&
      record.count > 0 &&
      (record.updatedAt === undefined || (
        typeof record.updatedAt === 'string' &&
        !Number.isNaN(Date.parse(record.updatedAt))
      ))
    ))
  } catch {
    activityCache = []
  }
  return activityCache
}

function saveReviewActivity(records: ReviewActivityRecord[]): void {
  activityCache = records.map(record => ({ ...record }))
  localStorage.setItem(REVIEW_ACTIVITY_KEY, JSON.stringify(activityCache))
  activityListeners.forEach(listener => listener())
}

function loadDeviceReviewActivity(): DeviceReviewActivityRecord[] {
  try {
    const raw = localStorage.getItem(DEVICE_REVIEW_ACTIVITY_KEY)
    const parsed = raw ? JSON.parse(raw) as unknown : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter((record): record is DeviceReviewActivityRecord => (
      Boolean(record) &&
      typeof record === 'object' &&
      typeof record.day === 'string' &&
      typeof record.count === 'number' &&
      Number.isFinite(record.count) &&
      record.count > 0
    ))
  } catch {
    return []
  }
}

function saveDeviceReviewActivity(records: DeviceReviewActivityRecord[]): void {
  localStorage.setItem(DEVICE_REVIEW_ACTIVITY_KEY, JSON.stringify(records))
}

export function getReviewDeviceId(): string {
  const existing = localStorage.getItem(REVIEW_DEVICE_ID_KEY)
  if (existing) return existing
  const id = crypto.randomUUID()
  localStorage.setItem(REVIEW_DEVICE_ID_KEY, id)
  return id
}

export function getLocalDeviceReviewCount(day: string): number {
  const deviceRecord = loadDeviceReviewActivity().find(record => record.day === day)
  return deviceRecord?.count ?? 0
}

export function restoreLocalDeviceReviewCount(day: string, count: number): void {
  const records = loadDeviceReviewActivity()
  if (records.some(record => record.day === day)) return
  records.push({ day, count })
  saveDeviceReviewActivity(records)
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key === KEY) {
      scoreCache = null
      scoreListeners.forEach(listener => listener())
    }
    if (event.key === REVIEW_ACTIVITY_KEY) {
      activityCache = null
      activityListeners.forEach(listener => listener())
    }
  })
}

function toDayKey(value: number): string {
  const date = new Date(value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function reviewDayKey(value: number = Date.now()): string {
  return toDayKey(value)
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

export function getScoresSnapshot(): ScoreRecord[] {
  return load()
}

export function subscribeToLocalScores(listener: () => void): () => void {
  scoreListeners.add(listener)
  return () => scoreListeners.delete(listener)
}

/**
 * Ensure a score record exists for this line.
 * If it already exists, does nothing. If new, creates it as "due now" with interval 0.
 * Call this at quiz start for every leaf line in the chapter.
 */
export function initScore(chapterId: string, lineId: string, displaySan: string): void {
  const records = [...load()]
  if (records.some(r => r.chapterId === chapterId && r.lineId === lineId)) return
  records.push({ chapterId, lineId, displaySan, ease: 2.5, interval: 0, dueDate: new Date().toISOString() })
  save(records)
}

export type ReviewIntensity = 1 | 2 | 3 | 4 | 5

/**
 * Review rating for one line:
 *   5 = no wrong moves
 *   4 = one wrong move, answer not revealed
 *   3 = several wrong moves, answer not revealed
 *   2 = answer revealed once
 *   0 = answer revealed more than once
 * 3 and above count as a pass; 2 and 0 count as a fail.
 */
export type ReviewQuality = 0 | 2 | 3 | 4 | 5

export function reviewQuality(wrongMoves: number, reveals: number): ReviewQuality {
  if (reveals >= 2) return 0
  if (reveals === 1) return 2
  if (wrongMoves === 0) return 5
  if (wrongMoves === 1) return 4
  return 3
}

/** Ease change per quality, before the intensity's ease change scale. */
const EASE_CHANGE: Record<ReviewQuality, number> = {
  5: 0.15,
  4: 0,
  3: -0.07,
  2: -0.16,
  0: -0.3,
}

const MIN_EASE = 1.3

export interface SchedulingParams {
  /** Shortest interval in days; first passes and fails land here */
  minDays: number
  /** Longest interval in days */
  maxDays: number
  /** Highest ease a line can reach; new lines start here */
  easeCeiling: number
  /** Multiplier applied to EASE_CHANGE */
  easeChangeScale: number
}

// Intensity 1 (calm) and 5 (intense); settings in between are interpolated.
const CALM_PARAMS: SchedulingParams = { minDays: 60, maxDays: 150, easeCeiling: 2.5, easeChangeScale: 0.5 }
const INTENSE_PARAMS: SchedulingParams = { minDays: 7, maxDays: 30, easeCeiling: 2.0, easeChangeScale: 1 }

export function schedulingParams(intensity: ReviewIntensity): SchedulingParams {
  const t = (intensity - 1) / 4
  const lerp = (calm: number, intense: number) => calm + (intense - calm) * t
  return {
    minDays: Math.round(lerp(CALM_PARAMS.minDays, INTENSE_PARAMS.minDays)),
    maxDays: Math.round(lerp(CALM_PARAMS.maxDays, INTENSE_PARAMS.maxDays)),
    easeCeiling: lerp(CALM_PARAMS.easeCeiling, INTENSE_PARAMS.easeCeiling),
    easeChangeScale: lerp(CALM_PARAMS.easeChangeScale, INTENSE_PARAMS.easeChangeScale),
  }
}

/** Return the score for a specific line, or undefined if never reviewed. */
export function getScore(chapterId: string, lineId: string): ScoreRecord | undefined {
  return load().find(r => r.chapterId === chapterId && r.lineId === lineId)
}

/** Upsert a score record after a review. */
export function recordReview(
  chapterId: string,
  lineId: string,
  displaySan: string,
  quality: ReviewQuality,
  intensity: ReviewIntensity = 3
): ScoreRecord {
  const reviewedAt = new Date().toISOString()
  const records = load().map(record => ({ ...record }))
  const idx = records.findIndex(r => r.chapterId === chapterId && r.lineId === lineId)

  const existing = idx >= 0 ? records[idx] : undefined
  // Keep the stored displaySan if the record already exists (seeded by initScore)
  const resolvedDisplaySan = existing?.displaySan ?? displaySan
  const params = schedulingParams(intensity)
  const hasPassedBefore = Boolean(existing && existing.lastReviewedAt && existing.interval > 0)
  const previousEase = hasPassedBefore ? existing!.ease : params.easeCeiling
  const ease = clampEase(previousEase + EASE_CHANGE[quality] * params.easeChangeScale, params.easeCeiling)

  let interval: number
  if (quality < 3 || !hasPassedBefore) {
    interval = params.minDays
  } else {
    interval = Math.round(existing!.interval * ease)
  }

  interval = Math.min(Math.max(interval, params.minDays), params.maxDays)
  const dueDate = new Date(Date.now() + interval * 86_400_000).toISOString()
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

export function loadReviewActivity(): ReviewActivityRecord[] {
  return loadReviewActivityRaw()
}

export function getReviewActivitySnapshot(): ReviewActivityRecord[] {
  return loadReviewActivityRaw()
}

export function subscribeToLocalReviewActivity(listener: () => void): () => void {
  activityListeners.add(listener)
  return () => activityListeners.delete(listener)
}

export function importReviewActivity(records: ReviewActivityRecord[]): void {
  saveReviewActivity(records)
}

export function recordReviewActivity(at: number = Date.now()): void {
  const day = toDayKey(at)
  const updatedAt = new Date(at).toISOString()
  const records = loadReviewActivityRaw().map(record => ({ ...record }))
  const existing = records.find(record => record.day === day)
  if (existing) {
    existing.count += 1
    existing.updatedAt = updatedAt
  } else {
    records.push({ day, count: 1, updatedAt })
    records.sort((left, right) => left.day.localeCompare(right.day))
  }
  saveReviewActivity(records)

  const deviceRecords = loadDeviceReviewActivity()
  const deviceRecord = deviceRecords.find(record => record.day === day)
  if (deviceRecord) deviceRecord.count += 1
  else deviceRecords.push({ day, count: 1 })
  saveDeviceReviewActivity(deviceRecords)
}

export function calculateReviewStreak(
  activity: ReviewActivityRecord[],
  now: number = Date.now(),
): { current: number; best: number; todayCount: number } {
  const records = [...activity].sort((left, right) => left.day.localeCompare(right.day))
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

export function getReviewStreak(now: number = Date.now()): { current: number; best: number; todayCount: number } {
  return calculateReviewStreak(loadReviewActivityRaw(), now)
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

export function scoreRecency(record: ScoreRecord): number {
  const reviewedAt = record.lastReviewedAt ? Date.parse(record.lastReviewedAt) : Number.NaN
  if (!Number.isNaN(reviewedAt)) return reviewedAt
  if (record.interval <= 0) return 0
  // Legacy reviews have no timestamp; infer it from the scheduled interval.
  const dueAt = Date.parse(record.dueDate)
  return Number.isNaN(dueAt) ? 0 : dueAt - record.interval * 86_400_000
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
    if (!existing || scoreRecency(nextRecord) > scoreRecency(existing)) {
      scoresById.set(key, nextRecord)
    }
  })

  if (changed) {
    save([...scoresById.values()])
  }

  const originalMainlines = loadForkMainlines()
  let mainlinesChanged = false
  const mainlinesById = new Map<string, ForkMainlineRecord>()
  originalMainlines.forEach(record => {
    const nextChapterId = remap.get(record.chapterId) ?? record.chapterId
    if (nextChapterId !== record.chapterId) mainlinesChanged = true
    const nextRecord = nextChapterId === record.chapterId ? record : { ...record, chapterId: nextChapterId }
    const key = `${nextRecord.chapterId}||${nextRecord.forkFen}`
    if (!mainlinesById.has(key)) {
      mainlinesById.set(key, nextRecord)
    }
  })

  if (mainlinesChanged) {
    saveForkMainlines([...mainlinesById.values()])
  }

  return changed || mainlinesChanged
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
  const legacyTargets = new Map<string, string[]>()
  validLineIds.forEach(lineId => {
    let legacyId: string | null = null
    if (lineId.startsWith('main::')) {
      legacyId = lineId.slice('main::'.length)
    } else if (lineId.startsWith('var::')) {
      const separator = lineId.lastIndexOf('::')
      if (separator > 0) legacyId = lineId.slice(separator + 2)
    }
    if (!legacyId) return
    const targets = legacyTargets.get(legacyId) ?? []
    targets.push(lineId)
    legacyTargets.set(legacyId, targets)
  })

  let didMigrate = false
  const migrated = load().flatMap(record => {
    if (record.chapterId !== chapterId || validLineIds.has(record.lineId)) return [record]
    const targets = legacyTargets.get(record.lineId)
    if (targets?.length) didMigrate = true
    return targets?.map(lineId => ({ ...record, lineId })) ?? [record]
  })
  const recordsById = new Map<string, ScoreRecord>()
  migrated.forEach(record => {
    const id = makeId(record.chapterId, record.lineId)
    const existing = recordsById.get(id)
    if (!existing || scoreRecency(record) > scoreRecency(existing)) {
      recordsById.set(id, record)
    }
  })
  const records = [...recordsById.values()]
  let removed = 0
  const kept = records.filter(r => {
    if (r.chapterId === chapterId && !validLineIds.has(r.lineId)) {
      removed++
      return false
    }
    return true
  })
  if (removed > 0 || didMigrate) save(kept)
  return removed
}

function clampEase(e: number, ceiling: number): number {
  return Math.min(Math.max(MIN_EASE, e), ceiling)
}

/** Stable key for a branch — useful as React key or Map key. */
export { makeId as scoreBranchKey }

/** Write a full set of score records (used by sync on remote update). */
export function importAllScores(records: ScoreRecord[]): void {
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
  for (const r of records) {
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

/** Replace local scores with an authoritative snapshot, including an empty one. */
export function replaceAllScores(records: ScoreRecord[]): void {
  save(records)
}

export function clearScores(): void {
  save([])
}

export function clearReviewActivity(): void {
  saveReviewActivity([])
  saveDeviceReviewActivity([])
}

/** Read the raw fork mainlines array (used by sync to upload). */
export function exportForkMainlines(): ForkMainlineRecord[] {
  return loadForkMainlines()
}

/** Overwrite fork mainlines (used by sync on pull from Firestore). */
export function importForkMainlines(records: ForkMainlineRecord[]): void {
  saveForkMainlines(records)
}

export function clearForkMainlines(): void {
  saveForkMainlines([])
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
  updatedAt?: string
}

function loadForkMainlines(): ForkMainlineRecord[] {
  try {
    const raw = localStorage.getItem(MAINLINES_KEY)
    const parsed = raw ? JSON.parse(raw) as unknown : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter((record): record is ForkMainlineRecord => (
      Boolean(record) &&
      typeof record === 'object' &&
      typeof record.chapterId === 'string' &&
      typeof record.forkFen === 'string' &&
      typeof record.mainlineSan === 'string' &&
      (record.updatedAt === undefined || (
        typeof record.updatedAt === 'string' &&
        !Number.isNaN(Date.parse(record.updatedAt))
      ))
    ))
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
  const previous = new Map(mainlines.filter(record => record.chapterId === chapterId).map(record => [record.forkFen, record]))
  const others = mainlines.filter(m => m.chapterId !== chapterId)
  const updatedAt = new Date().toISOString()
  newForkMap.forEach((mainlineSan, forkFen) => {
    const existing = previous.get(forkFen)
    others.push(existing?.mainlineSan === mainlineSan
      ? existing
      : { chapterId, forkFen, mainlineSan, updatedAt })
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
