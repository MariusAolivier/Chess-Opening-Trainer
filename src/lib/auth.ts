import {
  GoogleAuthProvider,
  browserLocalPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth'
import { auth } from './firebase'

const googleProvider = new GoogleAuthProvider()
googleProvider.setCustomParameters({ prompt: 'select_account' })
const SYNC_OWNER_KEY = 'chess-opening-trainer:sync-owner'

export type SyncUser = Pick<User, 'uid' | 'displayName' | 'email' | 'photoURL'>

export function subscribeToSyncUser(
  onChange: (user: SyncUser | null) => void,
  onError: (error: Error) => void,
): () => void {
  return onAuthStateChanged(auth, onChange, onError)
}

export async function signInToSync(): Promise<void> {
  await setPersistence(auth, browserLocalPersistence)
  await signInWithPopup(auth, googleProvider)
}

export async function signOutOfSync(): Promise<void> {
  await signOut(auth)
  clearLocalSyncOwner()
}

export function getLocalSyncOwner(): string | null {
  return localStorage.getItem(SYNC_OWNER_KEY)
}

export function setLocalSyncOwner(userId: string): void {
  localStorage.setItem(SYNC_OWNER_KEY, userId)
}

export function clearLocalSyncOwner(): void {
  localStorage.removeItem(SYNC_OWNER_KEY)
}
