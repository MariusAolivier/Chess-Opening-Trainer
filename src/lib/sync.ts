import { db } from './firebase'
import {
  collection, doc, getDoc, getDocs,
  setDoc, deleteDoc, onSnapshot,
} from 'firebase/firestore'
import type { Chapter } from './pgn'
import type { StoredStudy } from './storage'
import { loadStudies, buildChapterIds } from './storage'
import type { ScoreRecord } from './scores'
import { loadScores, importAllScores, loadReviewActivity, importReviewActivity, remapChapterIds } from './scores'
import type { ForkMainlineRecord } from './scores'
import { exportForkMainlines, importForkMainlines } from './scores'
import type { ReviewActivityRecord } from './scores'

// Firestore layout (no auth, single user):
//   studies/{studyId}       — one document per study
//   app/scores              — { records: ScoreRecord[] }
//   app/forkMainlines       — { mainlines: ForkMainlineRecord[] }
//   app/reviewActivity      — { records: ReviewActivityRecord[] }

const studyDoc = (id: string) => doc(db, 'studies', id)
const scoresDoc = doc(db, 'app', 'scores')
const forkMainlinesDoc = doc(db, 'app', 'forkMainlines')
const reviewActivityDoc = doc(db, 'app', 'reviewActivity')

function isNewScoreLineId(lineId: string): boolean {
  return lineId.startsWith('main::') || lineId.startsWith('var::')
}

function legacyScoreLineId(lineId: string): string {
  if (lineId.startsWith('main::')) return lineId.slice('main::'.length)
  if (lineId.startsWith('var::')) {
    const lastSep = lineId.lastIndexOf('::')
    if (lastSep > 0) return lineId.slice(lastSep + 2)
  }
  return lineId
}

function scoreRecency(record: ScoreRecord): number {
  const reviewed = record.lastReviewedAt ? Date.parse(record.lastReviewedAt) : Number.NaN
  if (!Number.isNaN(reviewed)) return reviewed
  const due = Date.parse(record.dueDate)
  if (!Number.isNaN(due)) return due
  return 0
}

function pickNewerScore(left: ScoreRecord, right: ScoreRecord): ScoreRecord {
  return scoreRecency(right) >= scoreRecency(left) ? right : left
}

function collapseRemoteScoreRecords(records: ScoreRecord[]): ScoreRecord[] {
  // Group by chapter + legacy identity, then prefer new-format ids when available.
  const byLegacy = new Map<string, ScoreRecord[]>()
  records.forEach(record => {
    if (!record || typeof record.chapterId !== 'string' || typeof record.lineId !== 'string') return
    const legacyId = legacyScoreLineId(record.lineId)
    const key = `${record.chapterId}||${legacyId}`
    const list = byLegacy.get(key) ?? []
    list.push(record)
    byLegacy.set(key, list)
  })

  const collapsed: ScoreRecord[] = []
  byLegacy.forEach(group => {
    const newFormat = group.filter(record => isNewScoreLineId(record.lineId))
    const source = newFormat.length > 0 ? newFormat : group
    const chosen = source.reduce((best, current) => pickNewerScore(best, current))
    collapsed.push(chosen)
  })

  return collapsed
}

function expandScoresForUpload(records: ScoreRecord[]): ScoreRecord[] {
  // Keep canonical records and add legacy mirrors so older cached clients can still sync.
  const byId = new Map<string, ScoreRecord>()

  records.forEach(record => {
    if (!record || typeof record.chapterId !== 'string' || typeof record.lineId !== 'string') return
    const key = `${record.chapterId}||${record.lineId}`
    const existing = byId.get(key)
    byId.set(key, existing ? pickNewerScore(existing, record) : record)

    if (isNewScoreLineId(record.lineId)) {
      const legacyId = legacyScoreLineId(record.lineId)
      const mirror: ScoreRecord = { ...record, lineId: legacyId }
      const mirrorKey = `${mirror.chapterId}||${mirror.lineId}`
      const existingMirror = byId.get(mirrorKey)
      byId.set(mirrorKey, existingMirror ? pickNewerScore(existingMirror, mirror) : mirror)
    }
  })

  return [...byId.values()]
}

type FirestoreStudy = {
  id: string
  name: string
  playerColor: 'white' | 'black'
  // New format: flattened to avoid Firestore nested-depth limits.
  chaptersJson?: string
  // Legacy format kept for backward compatibility.
  chapters?: Chapter[]
}

function normalizeStudyName(name: string): string {
  return name.trim().toLocaleLowerCase()
}

function encodeStudy(study: StoredStudy): FirestoreStudy {
  return {
    id: study.id,
    name: study.name,
    playerColor: study.playerColor,
    chaptersJson: JSON.stringify(study.chapters),
  }
}

function decodeStudy(data: FirestoreStudy): StoredStudy | null {
  if (typeof data.id !== 'string' || typeof data.name !== 'string') return null
  const playerColor = (data.playerColor ?? 'white') as 'white' | 'black'

  if (typeof data.chaptersJson === 'string') {
    try {
      const chapters = JSON.parse(data.chaptersJson) as Chapter[]
      return { id: data.id, name: data.name, playerColor, chapters }
    } catch {
      return null
    }
  }

  if (Array.isArray(data.chapters)) {
    return {
      id: data.id,
      name: data.name,
      playerColor,
      chapters: data.chapters,
    }
  }

  return null
}

function studyNameKey(study: StoredStudy): string {
  return normalizeStudyName(study.name)
}

function parseStudyTimestamp(studyId: string): number | null {
  if (!/^\d+$/.test(studyId)) return null
  const value = Number(studyId)
  return Number.isFinite(value) ? value : null
}

function pickPreferredStudy(left: StoredStudy, right: StoredStudy): StoredStudy {
  const leftTs = parseStudyTimestamp(left.id)
  const rightTs = parseStudyTimestamp(right.id)
  if (leftTs !== null && rightTs !== null) {
    return rightTs >= leftTs ? right : left
  }
  if (right.chapters.length !== left.chapters.length) {
    return right.chapters.length >= left.chapters.length ? right : left
  }
  return right.id >= left.id ? right : left
}

function buildChapterIdRemap(studiesById: Map<string, StoredStudy>, studyIdRemap: Map<string, string>): Map<string, string> {
  const chapterRemap = new Map<string, string>()

  studyIdRemap.forEach((toStudyId, fromStudyId) => {
    if (fromStudyId === toStudyId) return
    const fromStudy = studiesById.get(fromStudyId)
    const toStudy = studiesById.get(toStudyId)
    if (!fromStudy || !toStudy) return

    const fromIds = buildChapterIds(fromStudy.id, fromStudy.chapters)
    const toIds = buildChapterIds(toStudy.id, toStudy.chapters)

    const toBySuffix = new Map<string, string>()
    toIds.forEach(id => {
      const splitIndex = id.indexOf('::')
      if (splitIndex < 0) return
      toBySuffix.set(id.slice(splitIndex + 2), id)
    })

    fromIds.forEach((fromId, index) => {
      const splitIndex = fromId.indexOf('::')
      if (splitIndex >= 0) {
        const suffix = fromId.slice(splitIndex + 2)
        const target = toBySuffix.get(suffix)
        if (target) chapterRemap.set(fromId, target)
      }
      const legacyId = `${fromStudy.id}_${index}`
      const fallbackTarget = toIds[index]
      if (fallbackTarget) {
        chapterRemap.set(legacyId, fallbackTarget)
      }
    })
  })

  return chapterRemap
}

// ── Uploads ─────────────────────────────────────────────────────────────────

export async function uploadStudy(study: StoredStudy): Promise<void> {
  const normalizedName = normalizeStudyName(study.name)
  const studiesSnap = await getDocs(collection(db, 'studies'))

  const duplicateIds = studiesSnap.docs
    .filter(snapshot => {
      const data = snapshot.data() as FirestoreStudy
      return snapshot.id !== study.id && normalizeStudyName(data.name) === normalizedName
    })
    .map(snapshot => snapshot.id)

  if (duplicateIds.length > 0) {
    await Promise.all(duplicateIds.map(id => deleteDoc(studyDoc(id))))
  }

  await setDoc(studyDoc(study.id), encodeStudy(study))
}

export async function deleteStudyRemote(studyId: string, studyName?: string): Promise<void> {
  const idsToDelete = new Set<string>([studyId])
  const normalizedName = studyName ? normalizeStudyName(studyName) : null

  if (normalizedName) {
    const studiesSnap = await getDocs(collection(db, 'studies'))
    studiesSnap.docs.forEach(snapshot => {
      const data = snapshot.data() as FirestoreStudy
      if (normalizeStudyName(data.name) === normalizedName) {
        idsToDelete.add(snapshot.id)
      }
    })
  }

  await Promise.all([...idsToDelete].map(id => deleteDoc(studyDoc(id))))
}

export async function uploadScores(): Promise<void> {
  await setDoc(scoresDoc, { records: expandScoresForUpload(loadScores()) })
}

export async function uploadForkMainlines(): Promise<void> {
  await setDoc(forkMainlinesDoc, { mainlines: exportForkMainlines() })
}

export async function uploadReviewActivity(): Promise<void> {
  await setDoc(reviewActivityDoc, { records: loadReviewActivity() })
}

// ── Initial fetch & merge ────────────────────────────────────────────────────

/**
 * Pull all data from Firestore and merge into localStorage.
 * Studies: Firestore is authoritative when it has data.
 * Scores: Firestore wins entirely (last-write-wins across devices).
 * Returns true if any data was fetched.
 */
export async function fetchAndMerge(): Promise<boolean> {
  const [studiesSnap, scoresSnap, forkSnap, reviewActivitySnap] = await Promise.all([
    getDocs(collection(db, 'studies')),
    getDoc(scoresDoc),
    getDoc(forkMainlinesDoc),
    getDoc(reviewActivityDoc),
  ])

  let changed = false

  if (studiesSnap.empty) {
    // Firestore has no studies yet — seed it from whatever is in localStorage
    const local = loadStudies()
    if (local.length > 0) {
      await Promise.all(local.map(s => uploadStudy(s)))
      await uploadScores()
      await uploadForkMainlines()
      await uploadReviewActivity()
    }
  } else {
    // Firestore is the source of truth. Deduplicate same-name studies remotely,
    // then mirror the result into localStorage so deletions propagate to devices.
    const remoteStudies = studiesSnap.docs
      .map(d => decodeStudy(d.data() as FirestoreStudy))
      .filter((s): s is StoredStudy => s !== null)
    const studiesById = new Map<string, StoredStudy>()
    remoteStudies.forEach(study => studiesById.set(study.id, study))

    const byName = new Map<string, StoredStudy>()
    const studyIdRemap = new Map<string, string>()

    remoteStudies.forEach(study => {
      const key = studyNameKey(study)
      const existing = byName.get(key)
      if (!existing) {
        byName.set(key, study)
        return
      }

      const winner = pickPreferredStudy(existing, study)
      const loser = winner.id === existing.id ? study : existing
      byName.set(key, winner)
      studyIdRemap.set(loser.id, winner.id)
    })

    const merged = [...byName.values()]
    merged.forEach(study => studiesById.set(study.id, study))
    localStorage.setItem('chess-opening-trainer:studies', JSON.stringify(merged))

    const duplicateRemoteIds = [...studyIdRemap.entries()]
      .filter(([fromStudyId, toStudyId]) => fromStudyId !== toStudyId)
      .map(([fromStudyId]) => fromStudyId)
    if (duplicateRemoteIds.length > 0) {
      await Promise.all(duplicateRemoteIds.map(id => deleteDoc(studyDoc(id))))
    }

    const chapterRemap = buildChapterIdRemap(studiesById, studyIdRemap)
    if (chapterRemap.size > 0 && remapChapterIds(chapterRemap)) {
      changed = true
    }

    changed = true
  }

  // Overwrite scores if Firestore has them
  if (scoresSnap.exists()) {
    const remoteRecords = collapseRemoteScoreRecords((scoresSnap.data().records ?? []) as ScoreRecord[])
    if (remoteRecords.length > 0) {
      importAllScores(remoteRecords)
      changed = true
    }
  }

  // Overwrite fork mainlines if Firestore has them
  if (forkSnap.exists()) {
    const remoteMainlines = (forkSnap.data().mainlines ?? []) as ForkMainlineRecord[]
    if (remoteMainlines.length > 0) {
      importForkMainlines(remoteMainlines)
      changed = true
    }
  }

  if (!reviewActivitySnap.exists()) {
    const localActivity = loadReviewActivity()
    if (localActivity.length > 0) {
      await uploadReviewActivity()
    }
  } else {
    const remoteActivity = (reviewActivitySnap.data().records ?? []) as ReviewActivityRecord[]
    if (remoteActivity.length > 0) {
      importReviewActivity(remoteActivity)
      changed = true
    }
  }

  return changed
}

// ── Real-time scores listener ────────────────────────────────────────────────

/**
 * Subscribe to score changes in Firestore. When scores are updated on another
 * device, they're written into localStorage and `onChange` is called so the UI
 * can re-render. Returns an unsubscribe function.
 */
export function subscribeToScores(onChange: () => void): () => void {
  let isFirst = true
  return onSnapshot(scoresDoc, snapshot => {
    // Skip the immediate echo of our own writes
    if (isFirst) { isFirst = false; return }
    if (!snapshot.exists()) return
    const records = collapseRemoteScoreRecords((snapshot.data().records ?? []) as ScoreRecord[])
    importAllScores(records)
    onChange()
  })
}

export function subscribeToReviewActivity(onChange: () => void): () => void {
  let isFirst = true
  return onSnapshot(reviewActivityDoc, snapshot => {
    if (isFirst) { isFirst = false; return }
    if (!snapshot.exists()) return
    const records = (snapshot.data().records ?? []) as ReviewActivityRecord[]
    importReviewActivity(records)
    onChange()
  })
}
