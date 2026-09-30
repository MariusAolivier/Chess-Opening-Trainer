import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  writeBatch,
  type DocumentData,
  type DocumentReference,
  type WriteBatch,
} from 'firebase/firestore'
import { db } from './firebase'
import type { Chapter } from './pgn'
import type { StoredStudy } from './storage'
import { buildChapterIds, loadStudies } from './storage'
import type { ForkMainlineRecord, ReviewActivityRecord, ScoreRecord } from './scores'
import {
  exportForkMainlines,
  importForkMainlines,
  importReviewActivity,
  getLocalDeviceReviewCount,
  getReviewDeviceId,
  loadReviewActivity,
  loadScores,
  remapChapterIds,
  replaceAllScores,
  restoreLocalDeviceReviewCount,
  scoreRecency,
} from './scores'
import { assertSyncAvailable, runSyncOperation } from './syncQuota'

type SyncCollection = 'studies' | 'scores' | 'forkMainlines' | 'reviewActivity'

interface SyncDocument {
  id: string
  ref: DocumentReference
  data: () => DocumentData
}

interface SyncSnapshot {
  docs: SyncDocument[]
  empty: boolean
}

interface CachedCollection {
  complete: boolean
  documents: Map<string, { ref: DocumentReference; data: DocumentData }>
}

const remoteCache = new Map<string, Map<SyncCollection, CachedCollection>>()

function cachedCollection(userId: string, name: SyncCollection): CachedCollection {
  let userCache = remoteCache.get(userId)
  if (!userCache) {
    userCache = new Map()
    remoteCache.set(userId, userCache)
  }
  let cached = userCache.get(name)
  if (!cached) {
    cached = { complete: false, documents: new Map() }
    userCache.set(name, cached)
  }
  return cached
}

function rememberSnapshot(userId: string, name: SyncCollection, snapshot: SyncSnapshot): void {
  const cached = cachedCollection(userId, name)
  cached.complete = true
  cached.documents = new Map(snapshot.docs.map(item => [item.id, { ref: item.ref, data: item.data() }]))
}

function cachedSnapshot(userId: string, name: SyncCollection): SyncSnapshot | null {
  const cached = cachedCollection(userId, name)
  if (!cached.complete) return null
  return {
    docs: [...cached.documents].map(([id, entry]) => ({ id, ref: entry.ref, data: () => entry.data })),
    empty: cached.documents.size === 0,
  }
}

function rememberWrite(userId: string, name: SyncCollection, target: DocumentReference, data: DocumentData): void {
  cachedCollection(userId, name).documents.set(target.id, { ref: target, data })
}

async function remoteSnapshot(userId: string, name: SyncCollection): Promise<SyncSnapshot> {
  const cached = cachedSnapshot(userId, name)
  if (cached) return cached
  const snapshot = await getDocs(collection(db, 'users', userId, name))
  rememberSnapshot(userId, name, snapshot)
  return snapshot
}

async function forEachConcurrent<T>(items: T[], operation: (item: T) => Promise<void>): Promise<void> {
  for (let offset = 0; offset < items.length; offset += 20) {
    await Promise.all(items.slice(offset, offset + 20).map(operation))
  }
}

function sameScore(left: ScoreRecord, right: ScoreRecord): boolean {
  return left.chapterId === right.chapterId && left.lineId === right.lineId &&
    left.displaySan === right.displaySan && left.ease === right.ease &&
    left.interval === right.interval && left.dueDate === right.dueDate &&
    left.lastReviewedAt === right.lastReviewedAt
}

function storedScore(data: FirestoreScore & Partial<ScoreRecord>): ScoreRecord | undefined {
  return data.record ?? (
    typeof data.chapterId === 'string' && typeof data.lineId === 'string'
      ? data as ScoreRecord
      : undefined
  )
}

type FirestoreStudy = {
  id: string
  name: string
  playerColor: 'white' | 'black'
  chaptersJson?: string
  chapters?: Chapter[]
  updatedAt?: string
  deletedAt?: Timestamp
  mergedInto?: string
}

type FirestoreScore = {
  record?: ScoreRecord
  deletedAt?: Timestamp
}

interface RemoteReviewActivityCounter {
  day: string
  deviceId: string
  count: number
  updatedAt: string
}

type FirestoreReviewActivity = {
  day?: string
  record?: ReviewActivityRecord | RemoteReviewActivityCounter
  deletedAt?: Timestamp
}

type FirestoreForkMainline = {
  record?: ForkMainlineRecord
  deletedAt?: Timestamp
}

const studiesCollection = (userId: string) => collection(db, 'users', userId, 'studies')
const studyDoc = (userId: string, id: string) => doc(db, 'users', userId, 'studies', id)
const scoresCollection = (userId: string) => collection(db, 'users', userId, 'scores')
const forkMainlinesCollection = (userId: string) => collection(db, 'users', userId, 'forkMainlines')
const reviewActivityCollection = (userId: string) => collection(db, 'users', userId, 'reviewActivity')

function stableDocumentId(value: string): string {
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    first = Math.imul(first ^ code, 0x01000193)
    second = Math.imul(second ^ code, 0x85ebca6b)
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`
}

function scoreDocumentId(record: Pick<ScoreRecord, 'chapterId' | 'lineId'>): string {
  return stableDocumentId(`${record.chapterId}\u0000${record.lineId}`)
}

function forkMainlineDocumentId(record: ForkMainlineRecord): string {
  return stableDocumentId(`${record.chapterId}\u0000${record.forkFen}`)
}

function reviewActivityDocumentId(day: string, deviceId: string): string {
  return stableDocumentId(`${day}\u0000${deviceId}`)
}

async function commitOperations(userId: string, operations: Array<(batch: WriteBatch) => void>): Promise<void> {
  const batchSize = 400
  for (let offset = 0; offset < operations.length; offset += batchSize) {
    assertSyncAvailable(userId)
    const batch = writeBatch(db)
    operations.slice(offset, offset + batchSize).forEach(operation => operation(batch))
    await batch.commit()
  }
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
    updatedAt: study.updatedAt ?? new Date().toISOString(),
  }
}

function decodeStudy(data: FirestoreStudy): StoredStudy | null {
  if (
    typeof data.id !== 'string' ||
    typeof data.name !== 'string' ||
    (data.playerColor !== 'white' && data.playerColor !== 'black')
  ) {
    return null
  }

  if (typeof data.chaptersJson === 'string') {
    try {
      const chapters = JSON.parse(data.chaptersJson) as unknown
      if (!Array.isArray(chapters)) return null
      return {
        id: data.id,
        name: data.name,
        playerColor: data.playerColor,
        chapters: chapters as Chapter[],
        updatedAt: data.updatedAt,
      }
    } catch {
      return null
    }
  }

  if (Array.isArray(data.chapters)) {
    return {
      id: data.id,
      name: data.name,
      playerColor: data.playerColor,
      chapters: data.chapters,
      updatedAt: data.updatedAt,
    }
  }

  return null
}

function parseStudyTimestamp(studyId: string): number | null {
  if (!/^\d+$/.test(studyId)) return null
  const value = Number(studyId)
  return Number.isFinite(value) ? value : null
}

function pickPreferredStudy(left: StoredStudy, right: StoredStudy): StoredStudy {
  const leftUpdatedAt = left.updatedAt ? Date.parse(left.updatedAt) : 0
  const rightUpdatedAt = right.updatedAt ? Date.parse(right.updatedAt) : 0
  if (leftUpdatedAt !== rightUpdatedAt) {
    return rightUpdatedAt > leftUpdatedAt ? right : left
  }
  const leftTimestamp = parseStudyTimestamp(left.id)
  const rightTimestamp = parseStudyTimestamp(right.id)
  if (leftTimestamp !== null && rightTimestamp !== null) {
    return rightTimestamp >= leftTimestamp ? right : left
  }
  if (right.chapters.length !== left.chapters.length) {
    return right.chapters.length >= left.chapters.length ? right : left
  }
  return right.id >= left.id ? right : left
}

function buildChapterIdRemap(
  studiesById: Map<string, StoredStudy>,
  studyIdRemap: Map<string, string>,
): Map<string, string> {
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
      const separator = id.indexOf('::')
      if (separator >= 0) toBySuffix.set(id.slice(separator + 2), id)
    })

    fromIds.forEach((fromId, index) => {
      const separator = fromId.indexOf('::')
      const target = separator >= 0 ? toBySuffix.get(fromId.slice(separator + 2)) : undefined
      if (target) chapterRemap.set(fromId, target)

      const fallbackTarget = toIds[index]
      if (fallbackTarget) chapterRemap.set(`${fromStudy.id}_${index}`, fallbackTarget)
    })
  })

  return chapterRemap
}

function legacyScoreLineId(lineId: string): string {
  if (lineId.startsWith('main::')) return lineId.slice('main::'.length)
  if (lineId.startsWith('var::')) {
    const separator = lineId.lastIndexOf('::')
    if (separator > 0) return lineId.slice(separator + 2)
  }
  return lineId
}

function collapseRemoteScoreRecords(records: ScoreRecord[]): ScoreRecord[] {
  const grouped = new Map<string, ScoreRecord[]>()
  records.forEach(record => {
    if (!record || typeof record.chapterId !== 'string' || typeof record.lineId !== 'string') return
    const key = `${record.chapterId}\u0000${legacyScoreLineId(record.lineId)}`
    const group = grouped.get(key) ?? []
    group.push(record)
    grouped.set(key, group)
  })

  return [...grouped.values()].flatMap(group => {
    const canonical = group.filter(record => record.lineId.startsWith('main::') || record.lineId.startsWith('var::'))
    const newest = (candidates: ScoreRecord[]) => candidates.reduce((winner, record) => (
      scoreRecency(record) >= scoreRecency(winner) ? record : winner
    ))
    if (canonical.length === 0) return [newest(group)]

    const legacy = group.filter(record => !canonical.includes(record))
    const lineIds = new Set(canonical.map(record => record.lineId))
    return [...lineIds].map(lineId => {
      const candidates = canonical.filter(record => record.lineId === lineId)
      const winner = newest([...legacy, ...candidates])
      return { ...winner, lineId, displaySan: candidates[0].displaySan }
    })
  })
}

export function uploadStudy(userId: string, study: StoredStudy): Promise<void> {
  return runSyncOperation(userId, () => uploadStudyRecord(userId, study))
}

async function uploadStudyRecord(userId: string, study: StoredStudy): Promise<void> {
  const target = studyDoc(userId, study.id)
  const encoded = encodeStudy(study)
  const written = await runTransaction(db, async transaction => {
    const existing = await transaction.get(target)
    if (existing.exists()) {
      const data = existing.data() as FirestoreStudy
      const deletedAt = data.deletedAt?.toMillis()
      const localUpdatedAt = study.updatedAt ? Date.parse(study.updatedAt) : 0
      if (deletedAt !== undefined && localUpdatedAt <= deletedAt) return false
      const remoteUpdatedAt = data.updatedAt ? Date.parse(data.updatedAt) : 0
      if (remoteUpdatedAt > localUpdatedAt) return false
      if (!data.deletedAt && data.name === encoded.name && data.playerColor === encoded.playerColor &&
        data.chaptersJson === encoded.chaptersJson && data.updatedAt === encoded.updatedAt) return false
    }
    transaction.set(target, encoded)
    return true
  })
  if (written) rememberWrite(userId, 'studies', target, encoded)
}

export function deleteStudyRemote(userId: string, studyId: string, studyName?: string): Promise<void> {
  return runSyncOperation(userId, () => deleteStudyRecords(userId, studyId, studyName))
}

async function deleteStudyRecords(userId: string, studyId: string, studyName?: string): Promise<void> {
  const ids = new Set([studyId])
  if (studyName) {
    const normalizedName = normalizeStudyName(studyName)
    const snapshot = await remoteSnapshot(userId, 'studies')
    snapshot.docs.forEach(item => {
      const data = item.data() as FirestoreStudy
      if (typeof data.name === 'string' && normalizeStudyName(data.name) === normalizedName) ids.add(item.id)
    })
  }
  await forEachConcurrent([...ids], async id => {
    assertSyncAvailable(userId)
    const existing = cachedCollection(userId, 'studies').documents.get(id)?.data as FirestoreStudy | undefined
    if (existing?.deletedAt && !existing.mergedInto) return
    const target = studyDoc(userId, id)
    await setDoc(target, { deletedAt: serverTimestamp() })
    rememberWrite(userId, 'studies', target, { deletedAt: Timestamp.now() })
  })
}

export function uploadScore(userId: string, record: ScoreRecord): Promise<void> {
  return runSyncOperation(userId, () => uploadScoreRecord(userId, record))
}

async function uploadScoreRecord(userId: string, record: ScoreRecord): Promise<void> {
  const target = doc(scoresCollection(userId), scoreDocumentId(record))
  const cached = cachedCollection(userId, 'scores').documents.get(target.id)?.data as FirestoreScore | undefined
  if (cached?.deletedAt && scoreRecency(record) <= cached.deletedAt.toMillis()) return
  const cachedRecord = cached ? storedScore(cached) : undefined
  if (cachedRecord && (sameScore(cachedRecord, record) || scoreRecency(cachedRecord) > scoreRecency(record))) return
  const result = await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(target)
    if (snapshot.exists()) {
      const data = snapshot.data() as FirestoreScore & Partial<ScoreRecord>
      const deletedAt = data.deletedAt?.toMillis()
      if (deletedAt !== undefined && scoreRecency(record) <= deletedAt) return data
      const remoteRecord = storedScore(data)
      if (remoteRecord && (sameScore(remoteRecord, record) || scoreRecency(remoteRecord) > scoreRecency(record))) return data
    }
    transaction.set(target, { record })
    return { record }
  })
  rememberWrite(userId, 'scores', target, result)
}

export function uploadScores(userId: string, deleteMissing = false): Promise<void> {
  return runSyncOperation(userId, () => uploadScoreRecords(userId, deleteMissing))
}

async function uploadScoreRecords(userId: string, deleteMissing: boolean): Promise<void> {
  const records = loadScores()
  await forEachConcurrent(records, record => uploadScore(userId, record))
  if (!deleteMissing) return

  const desiredIds = new Set(records.map(scoreDocumentId))
  const snapshot = await remoteSnapshot(userId, 'scores')
  const missing = snapshot.docs.filter(existing => !desiredIds.has(existing.id) && !existing.data().deletedAt)
  await commitOperations(userId, missing.map(existing => batch => {
    batch.set(existing.ref, { deletedAt: serverTimestamp() })
  }))
  missing.forEach(existing => rememberWrite(userId, 'scores', existing.ref, { deletedAt: Timestamp.now() }))
}

export function uploadForkMainlines(userId: string, deleteMissing = true): Promise<void> {
  return runSyncOperation(userId, () => uploadForkMainlineRecords(userId, deleteMissing))
}

async function uploadForkMainlineRecords(userId: string, deleteMissing: boolean): Promise<void> {
  const records = exportForkMainlines()
  const reference = forkMainlinesCollection(userId)
  const snapshot = await remoteSnapshot(userId, 'forkMainlines')
  const remoteById = new Map(snapshot.docs.map(item => [item.id, item.data() as FirestoreForkMainline]))
  const uploads = records.filter(record => {
    const existing = remoteById.get(forkMainlineDocumentId(record))
    if (existing?.deletedAt && forkMainlineRecency(record) <= existing.deletedAt.toMillis()) return false
    if (existing?.record && (
      existing.record.mainlineSan === record.mainlineSan ||
      forkMainlineRecency(existing.record) > forkMainlineRecency(record)
    )) return false
    return true
  })
  const operations = uploads.map(record => (batch: WriteBatch) => {
    batch.set(doc(reference, forkMainlineDocumentId(record)), { record })
  })
  const deleted: SyncDocument[] = []
  if (deleteMissing) {
    const desiredIds = new Set(records.map(forkMainlineDocumentId))
    snapshot.docs.forEach(existing => {
      if (!desiredIds.has(existing.id) && !existing.data().deletedAt) {
        operations.push(batch => batch.set(existing.ref, { deletedAt: serverTimestamp() }))
        deleted.push(existing)
      }
    })
  }
  await commitOperations(userId, operations)
  uploads.forEach(record => rememberWrite(userId, 'forkMainlines', doc(reference, forkMainlineDocumentId(record)), { record }))
  deleted.forEach(existing => rememberWrite(userId, 'forkMainlines', existing.ref, { deletedAt: Timestamp.now() }))
}

export function uploadReviewActivity(userId: string, deleteMissing = true): Promise<void> {
  return runSyncOperation(userId, () => uploadReviewActivityRecords(userId, deleteMissing))
}

async function uploadReviewActivityRecords(userId: string, deleteMissing: boolean): Promise<void> {
  const records = loadReviewActivity()
  const deviceId = getReviewDeviceId()
  await forEachConcurrent(records, record => syncRemoteDeviceReviewActivity(userId, record))
  const operations: Array<(batch: WriteBatch) => void> = []
  const deleted: Array<{ document: SyncDocument; day: string }> = []

  if (deleteMissing) {
    const desiredIds = new Set(records.map(record => reviewActivityDocumentId(record.day, deviceId)))
    const snapshot = await remoteSnapshot(userId, 'reviewActivity')
    snapshot.docs.forEach(existing => {
      if (!desiredIds.has(existing.id) && !existing.data().deletedAt) {
        const data = existing.data() as FirestoreReviewActivity
        const day = data.record?.day ?? data.day
        if (!day) throw new Error('Cannot reset cloud review activity with a missing day.')
        operations.push(batch => batch.set(existing.ref, { day, deletedAt: serverTimestamp() }))
        deleted.push({ document: existing, day })
      }
    })
  }

  await commitOperations(userId, operations)
  deleted.forEach(({ document, day }) => rememberWrite(userId, 'reviewActivity', document.ref, {
    day, deletedAt: Timestamp.now(),
  }))
}

export async function uploadProgress(userId: string): Promise<void> {
  await Promise.all([
    uploadScores(userId),
    uploadForkMainlines(userId, false),
  ])
}

export async function incrementRemoteReviewActivity(
  userId: string,
  localRecord: ReviewActivityRecord,
): Promise<void> {
  await runSyncOperation(userId, () => syncRemoteDeviceReviewActivity(userId, localRecord))
}

async function syncRemoteDeviceReviewActivity(
  userId: string,
  localRecord: ReviewActivityRecord,
): Promise<void> {
  assertSyncAvailable(userId)
  const { day } = localRecord
  const deviceId = getReviewDeviceId()
  const localDeviceCount = getLocalDeviceReviewCount(day)
  if (localDeviceCount === 0) return
  const target = doc(
    reviewActivityCollection(userId),
    reviewActivityDocumentId(day, deviceId),
  )
  const cached = cachedCollection(userId, 'reviewActivity').documents.get(target.id)?.data as FirestoreReviewActivity | undefined
  if (cached?.record && 'deviceId' in cached.record && cached.record.count >= localDeviceCount) return
  const result = await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(target)
    const data = snapshot.data() as FirestoreReviewActivity | undefined
    const remote = data?.record && 'deviceId' in data.record
      ? data.record
      : undefined
    const deletedAt = data?.deletedAt?.toMillis()
    const localIsAfterReset = deletedAt === undefined || activityRecency(localRecord) > deletedAt
    if (!localIsAfterReset) return data
    const remoteCount = remote?.count ?? 0
    if (remoteCount >= localDeviceCount) return data
    const result = {
      record: {
        day,
        deviceId,
        count: localDeviceCount,
        updatedAt: localRecord.updatedAt ?? new Date().toISOString(),
      } satisfies RemoteReviewActivityCounter,
    }
    transaction.set(target, result)
    return result
  })
  if (result) rememberWrite(userId, 'reviewActivity', target, result)
}

export function fetchAndMerge(
  userId: string,
  shouldApply: () => boolean = () => true,
): Promise<boolean> {
  return runSyncOperation(userId, async () => {
    const snapshots = await Promise.all([
      getDocs(studiesCollection(userId)),
      getDocs(scoresCollection(userId)),
      getDocs(forkMainlinesCollection(userId)),
      getDocs(reviewActivityCollection(userId)),
    ])
    const names: SyncCollection[] = ['studies', 'scores', 'forkMainlines', 'reviewActivity']
    snapshots.forEach((snapshot, index) => rememberSnapshot(userId, names[index], snapshot))
    return reconcileSnapshots(userId, snapshots, shouldApply)
  })
}

async function reconcileSnapshots(
  userId: string,
  [studiesSnapshot, scoresSnapshot, forkSnapshot, activitySnapshot]: SyncSnapshot[],
  shouldApply: () => boolean,
): Promise<boolean> {
  if (!shouldApply()) return false
  let changed = false
  let chapterRemap = new Map<string, string>()
  const studyRedirects: Array<{ study: StoredStudy; targetId: string }> = []

  {
    const localById = new Map(loadStudies().map(study => [study.id, study]))
    const studiesById = new Map(localById)
    const reconciledStudies = new Map<string, StoredStudy>()
    const studiesToUpload: StoredStudy[] = []
    const existingRedirects = new Map<string, string>()
    const studyIdRemap = new Map<string, string>()

    studiesSnapshot.docs.forEach(snapshot => {
      const data = snapshot.data() as FirestoreStudy
      const local = localById.get(snapshot.id)
      localById.delete(snapshot.id)
      const remote = decodeStudy(data)
      if (remote) studiesById.set(remote.id, remote)
      const deletedAt = data.deletedAt?.toMillis()
      if (deletedAt !== undefined) {
        if (typeof data.mergedInto === 'string') {
          existingRedirects.set(snapshot.id, data.mergedInto)
          studyIdRemap.set(snapshot.id, data.mergedInto)
          return
        }
        const localUpdatedAt = local?.updatedAt ? Date.parse(local.updatedAt) : 0
        if (local && localUpdatedAt > deletedAt) {
          reconciledStudies.set(local.id, local)
          studiesToUpload.push(local)
        }
        return
      }

      if (!remote) return
      const localUpdatedAt = local?.updatedAt ? Date.parse(local.updatedAt) : 0
      const remoteUpdatedAt = remote.updatedAt ? Date.parse(remote.updatedAt) : 0
      if (local && localUpdatedAt > remoteUpdatedAt) {
        reconciledStudies.set(local.id, local)
        studiesToUpload.push(local)
      } else {
        reconciledStudies.set(remote.id, remote)
      }
    })

    localById.forEach(study => {
      reconciledStudies.set(study.id, study)
      studiesToUpload.push(study)
    })

    await forEachConcurrent(studiesToUpload, study => uploadStudy(userId, study))
    if (!shouldApply()) return false

    const remoteStudies = [...reconciledStudies.values()]
    remoteStudies.forEach(study => studiesById.set(study.id, study))
    const byName = new Map<string, StoredStudy>()

    remoteStudies.forEach(study => {
      const key = normalizeStudyName(study.name)
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

    studiesById.forEach(study => {
      const target = byName.get(normalizeStudyName(study.name))
      if (target && study.id !== target.id) studyIdRemap.set(study.id, target.id)
    })
    studyIdRemap.forEach((targetId, sourceId) => {
      const visited = new Set([sourceId])
      while (true) {
        const nextTargetId = studyIdRemap.get(targetId)
        if (nextTargetId === undefined) break
        if (visited.has(targetId)) throw new Error('Cloud sync contains a circular study redirect.')
        visited.add(targetId)
        targetId = nextTargetId
      }
      studyIdRemap.set(sourceId, targetId)
      const study = studiesById.get(sourceId)
      if (study && existingRedirects.get(sourceId) !== targetId) {
        studyRedirects.push({ study, targetId })
      }
    })

    chapterRemap = buildChapterIdRemap(studiesById, studyIdRemap)
    changed = !studiesSnapshot.empty || studiesToUpload.length > 0
  }

  await reconcileScoreSnapshot(userId, scoresSnapshot, shouldApply)
  if (!shouldApply()) return false
  if (remapChapterIds(chapterRemap)) {
    replaceAllScores(collapseRemoteScoreRecords(loadScores()))
    await uploadScores(userId)
  }
  if (!shouldApply()) return false
  changed = changed || !scoresSnapshot.empty

  await reconcileForkMainlineSnapshot(userId, forkSnapshot, shouldApply)
  if (!shouldApply()) return false
  if (remapChapterIds(chapterRemap)) await uploadForkMainlines(userId, false)
  if (!shouldApply()) return false
  changed = changed || !forkSnapshot.empty

  // Keep duplicate study metadata so later devices can migrate their original chapter IDs.
  await forEachConcurrent(studyRedirects, async ({ study, targetId }) => {
    assertSyncAvailable(userId)
    const target = studyDoc(userId, study.id)
    const data = { ...encodeStudy(study), mergedInto: targetId }
    await setDoc(target, { ...data, deletedAt: serverTimestamp() })
    rememberWrite(userId, 'studies', target, { ...data, deletedAt: Timestamp.now() })
  })
  if (!shouldApply()) return false

  await reconcileReviewActivitySnapshot(userId, activitySnapshot, shouldApply)
  if (!shouldApply()) return false
  changed = changed || !activitySnapshot.empty

  return changed
}

function forkMainlineRecency(record: ForkMainlineRecord): number {
  if (!record.updatedAt) return 0
  const updatedAt = Date.parse(record.updatedAt)
  return Number.isNaN(updatedAt) ? 0 : updatedAt
}

async function reconcileForkMainlineSnapshot(
  userId: string,
  snapshot: SyncSnapshot,
  shouldApply: () => boolean = () => true,
): Promise<void> {
  if (!shouldApply()) return
  const localById = new Map(exportForkMainlines().map(record => [forkMainlineDocumentId(record), record]))
  const merged = new Map<string, ForkMainlineRecord>()
  const uploads: ForkMainlineRecord[] = []

  snapshot.docs.forEach(item => {
    const data = item.data() as FirestoreForkMainline & Partial<ForkMainlineRecord>
    const local = localById.get(item.id)
    localById.delete(item.id)
    const deletedAt = data.deletedAt?.toMillis()
    if (deletedAt !== undefined) {
      if (local && forkMainlineRecency(local) > deletedAt) {
        merged.set(item.id, local)
        uploads.push(local)
      }
      return
    }
    const remote = data.record ?? (
      typeof data.chapterId === 'string' && typeof data.forkFen === 'string'
        ? data as ForkMainlineRecord
        : undefined
    )
    if (!remote) return
    if (local && local.mainlineSan !== remote.mainlineSan && forkMainlineRecency(local) > forkMainlineRecency(remote)) {
      merged.set(item.id, local)
      uploads.push(local)
    } else {
      merged.set(item.id, remote)
    }
  })

  localById.forEach(record => {
    merged.set(forkMainlineDocumentId(record), record)
    uploads.push(record)
  })
  if (!shouldApply()) return
  importForkMainlines([...merged.values()])
  if (uploads.length > 0) {
    const reference = forkMainlinesCollection(userId)
    const operations = uploads.map(record => (batch: WriteBatch) => {
      batch.set(doc(reference, forkMainlineDocumentId(record)), { record })
    })
    await commitOperations(userId, operations)
    uploads.forEach(record => rememberWrite(userId, 'forkMainlines', doc(reference, forkMainlineDocumentId(record)), { record }))
  }
}

export function subscribeToScores(
  userId: string,
  onChange: () => void,
  onError: (error: Error) => void,
  shouldApply: () => boolean = () => true,
): () => void {
  let generation = 0
  return onSnapshot(
    scoresCollection(userId),
    snapshot => {
      rememberSnapshot(userId, 'scores', snapshot)
      const run = ++generation
      const runShouldApply = () => shouldApply() && run === generation
      void reconcileScoreSnapshot(userId, snapshot, runShouldApply)
        .then(() => {
          if (runShouldApply()) onChange()
        })
        .catch(onError)
    },
    onError,
  )
}

async function reconcileScoreSnapshot(
  userId: string,
  snapshot: SyncSnapshot,
  shouldApply: () => boolean = () => true,
): Promise<void> {
  if (!shouldApply()) return
  const localById = new Map(loadScores().map(record => [scoreDocumentId(record), record]))
  const merged = new Map<string, ScoreRecord>()
  const uploads: ScoreRecord[] = []

  snapshot.docs.forEach(item => {
    const data = item.data() as FirestoreScore & Partial<ScoreRecord>
    const local = localById.get(item.id)
    localById.delete(item.id)

    const deletedAt = data.deletedAt?.toMillis()
    if (deletedAt !== undefined) {
      if (local && scoreRecency(local) > deletedAt) {
        merged.set(item.id, local)
        uploads.push(local)
      }
      return
    }

    const remote = data.record ?? (
      typeof data.chapterId === 'string' && typeof data.lineId === 'string'
        ? data as ScoreRecord
        : undefined
    )
    if (!remote) return
    if (local && scoreRecency(local) > scoreRecency(remote)) {
      merged.set(item.id, local)
      uploads.push(local)
    } else {
      merged.set(item.id, remote)
    }
  })

  localById.forEach(record => {
    merged.set(scoreDocumentId(record), record)
    uploads.push(record)
  })

  if (!shouldApply()) return
  replaceAllScores(collapseRemoteScoreRecords([...merged.values()]))
  await forEachConcurrent(uploads, record => uploadScore(userId, record))
}

export function subscribeToReviewActivity(
  userId: string,
  onChange: () => void,
  onError: (error: Error) => void,
  shouldApply: () => boolean = () => true,
): () => void {
  let generation = 0
  return onSnapshot(
    reviewActivityCollection(userId),
    snapshot => {
      rememberSnapshot(userId, 'reviewActivity', snapshot)
      const run = ++generation
      const runShouldApply = () => shouldApply() && run === generation
      void reconcileReviewActivitySnapshot(userId, snapshot, runShouldApply)
        .then(() => {
          if (runShouldApply()) onChange()
        })
        .catch(onError)
    },
    onError,
  )
}

export function subscribeToStudiesAndMainlines(
  userId: string,
  onChange: (studies: StoredStudy[]) => void,
  onError: (error: Error) => void,
  shouldApply: () => boolean = () => true,
  createReconcileGuard?: () => () => boolean,
): () => void {
  let generation = 0
  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  let refreshing = false
  let pending = false
  let stopped = false
  const beginReconcile = createReconcileGuard ?? (() => {
    const run = ++generation
    return () => shouldApply() && run === generation
  })

  const reconcile = async () => {
    refreshing = true
    try {
      while (pending && !stopped && shouldApply()) {
        pending = false
        const runShouldApply = beginReconcile()
        await runSyncOperation(userId, async () => {
          const snapshots = await Promise.all([
            remoteSnapshot(userId, 'studies'),
            remoteSnapshot(userId, 'scores'),
            remoteSnapshot(userId, 'forkMainlines'),
            remoteSnapshot(userId, 'reviewActivity'),
          ])
          await reconcileSnapshots(userId, snapshots, runShouldApply)
        })
        if (runShouldApply() && !stopped) onChange(loadStudies())
      }
    } catch (error) {
      pending = false
      onError(error instanceof Error ? error : new Error(String(error)))
    } finally {
      refreshing = false
    }
  }

  const refresh = () => {
    if (stopped) return
    pending = true
    if (refreshTimer !== null || refreshing) return
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      void reconcile()
    }, 0)
  }

  const unsubscribeStudies = onSnapshot(
    studiesCollection(userId),
    snapshot => {
      rememberSnapshot(userId, 'studies', snapshot)
      refresh()
    },
    onError,
  )
  const unsubscribeMainlines = onSnapshot(
    forkMainlinesCollection(userId),
    snapshot => {
      rememberSnapshot(userId, 'forkMainlines', snapshot)
      refresh()
    },
    onError,
  )

  return () => {
    stopped = true
    pending = false
    generation += 1
    if (refreshTimer !== null) {
      clearTimeout(refreshTimer)
      refreshTimer = null
    }
    unsubscribeStudies()
    unsubscribeMainlines()
  }
}

function activityRecency(record: ReviewActivityRecord): number {
  if (record.updatedAt) {
    const updatedAt = Date.parse(record.updatedAt)
    if (!Number.isNaN(updatedAt)) return updatedAt
  }
  const day = Date.parse(`${record.day}T23:59:59.999Z`)
  return Number.isNaN(day) ? 0 : day
}

async function reconcileReviewActivitySnapshot(
  userId: string,
  snapshot: SyncSnapshot,
  shouldApply: () => boolean = () => true,
): Promise<void> {
  if (!shouldApply()) return
  const localByDay = new Map(loadReviewActivity().map(record => [record.day, record]))
  const remoteByDay = new Map<string, ReviewActivityRecord>()
  const tombstonesByDay = new Map<string, number>()
  const currentDeviceId = getReviewDeviceId()
  const currentDeviceRemoteCounts = new Map<string, number>()
  const currentDeviceTombstones = new Map<string, number>()

  snapshot.docs.forEach(item => {
    const data = item.data() as FirestoreReviewActivity & Partial<ReviewActivityRecord>
    const deletedAt = data.deletedAt?.toMillis()
    if (deletedAt !== undefined) {
      const day = data.day ?? data.record?.day
      if (day) {
        tombstonesByDay.set(day, Math.max(tombstonesByDay.get(day) ?? 0, deletedAt))
        if (item.id === reviewActivityDocumentId(day, currentDeviceId)) {
          currentDeviceTombstones.set(day, deletedAt)
        }
      }
      return
    }

    const storedRecord = data.record ?? (
      typeof data.day === 'string' && typeof data.count === 'number'
        ? data as ReviewActivityRecord
        : undefined
    )
    if (!storedRecord) return
    if ('deviceId' in storedRecord && storedRecord.deviceId === currentDeviceId) {
      currentDeviceRemoteCounts.set(storedRecord.day, storedRecord.count)
      restoreLocalDeviceReviewCount(storedRecord.day, storedRecord.count)
    } else if (!('deviceId' in storedRecord)) {
      // Treat the legacy aggregate document as this device's seed to avoid duplicating it.
      currentDeviceRemoteCounts.set(
        storedRecord.day,
        Math.max(currentDeviceRemoteCounts.get(storedRecord.day) ?? 0, storedRecord.count),
      )
    }
    const remote: ReviewActivityRecord = {
      day: storedRecord.day,
      count: storedRecord.count,
      updatedAt: storedRecord.updatedAt,
    }
    const existing = remoteByDay.get(remote.day)
    remoteByDay.set(remote.day, {
      day: remote.day,
      count: (existing?.count ?? 0) + remote.count,
      updatedAt: activityRecency(remote) >= activityRecency(existing ?? remote)
        ? remote.updatedAt
        : existing?.updatedAt,
    })
  })

  const merged = new Map<string, ReviewActivityRecord>()
  const deviceUploads: ReviewActivityRecord[] = []
  const days = new Set([...localByDay.keys(), ...remoteByDay.keys(), ...tombstonesByDay.keys()])
  days.forEach(day => {
    const local = localByDay.get(day)
    const remote = remoteByDay.get(day)
    const tombstonedAt = tombstonesByDay.get(day) ?? 0
    const localDeviceCount = getLocalDeviceReviewCount(day)
    const remoteDeviceCount = currentDeviceRemoteCounts.get(day) ?? 0
    const deviceTombstonedAt = currentDeviceTombstones.get(day) ?? 0
    const hasPendingDeviceReviews = Boolean(
      local &&
      localDeviceCount > remoteDeviceCount &&
      activityRecency(local) > deviceTombstonedAt,
    )
    const localIsCurrent = local && activityRecency(local) > Math.max(
      tombstonedAt,
      remote ? activityRecency(remote) : 0,
    )

    if (localIsCurrent || hasPendingDeviceReviews) {
      merged.set(day, {
        ...(local as ReviewActivityRecord),
        count: Math.max(local?.count ?? 0, remote?.count ?? 0),
      })
      if (hasPendingDeviceReviews && local) deviceUploads.push(local)
    } else if (remote) {
      merged.set(day, remote)
    }
  })

  if (!shouldApply()) return
  importReviewActivity([...merged.values()])
  await forEachConcurrent(deviceUploads, record => syncRemoteDeviceReviewActivity(userId, record))
}
