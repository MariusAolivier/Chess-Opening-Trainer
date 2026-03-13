import { db } from './firebase'
import {
  collection, doc, getDoc, getDocs,
  setDoc, deleteDoc, onSnapshot,
} from 'firebase/firestore'
import type { StoredStudy } from './storage'
import { loadStudies } from './storage'
import type { ScoreRecord } from './scores'
import { loadScores, importAllScores } from './scores'
import type { ForkMainlineRecord } from './scores'
import { exportForkMainlines, importForkMainlines } from './scores'

// Firestore layout (no auth, single user):
//   studies/{studyId}       — one document per study
//   app/scores              — { records: ScoreRecord[] }
//   app/forkMainlines       — { mainlines: ForkMainlineRecord[] }

const studyDoc = (id: string) => doc(db, 'studies', id)
const scoresDoc = doc(db, 'app', 'scores')
const forkMainlinesDoc = doc(db, 'app', 'forkMainlines')

// ── Uploads ─────────────────────────────────────────────────────────────────

export async function uploadStudy(study: StoredStudy): Promise<void> {
  await setDoc(studyDoc(study.id), study)
}

export async function deleteStudyRemote(studyId: string): Promise<void> {
  await deleteDoc(studyDoc(studyId))
}

export async function uploadScores(): Promise<void> {
  await setDoc(scoresDoc, { records: loadScores() })
}

export async function uploadForkMainlines(): Promise<void> {
  await setDoc(forkMainlinesDoc, { mainlines: exportForkMainlines() })
}

// ── Initial fetch & merge ────────────────────────────────────────────────────

/**
 * Pull all data from Firestore and merge into localStorage.
 * Studies: union by id (Firestore wins on conflict — same id = same study).
 * Scores: Firestore wins entirely (last-write-wins across devices).
 * Returns true if any data was fetched.
 */
export async function fetchAndMerge(): Promise<boolean> {
  const [studiesSnap, scoresSnap, forkSnap] = await Promise.all([
    getDocs(collection(db, 'studies')),
    getDoc(scoresDoc),
    getDoc(forkMainlinesDoc),
  ])

  let changed = false

  if (studiesSnap.empty) {
    // Firestore has no studies yet — seed it from whatever is in localStorage
    const local = loadStudies()
    if (local.length > 0) {
      await Promise.all(local.map(s => uploadStudy(s)))
      await uploadScores()
      await uploadForkMainlines()
    }
  } else {
    // Merge remote studies into local (remote wins on id collision)
    const remoteStudies = studiesSnap.docs.map(d => d.data() as StoredStudy)
    const local = loadStudies()
    const localById = new Map(local.map(s => [s.id, s]))
    remoteStudies.forEach(rs => localById.set(rs.id, rs))
    const merged = [...localById.values()]
    localStorage.setItem('chess-opening-trainer:studies', JSON.stringify(merged))
    changed = true
  }

  // Overwrite scores if Firestore has them
  if (scoresSnap.exists()) {
    const remoteRecords = (scoresSnap.data().records ?? []) as ScoreRecord[]
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
    const records = (snapshot.data().records ?? []) as ScoreRecord[]
    importAllScores(records)
    onChange()
  })
}
