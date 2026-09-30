import {
  GoogleAuthProvider,
  onAuthStateChanged,
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

export function signInToSync(): Promise<SyncUser> {
  // getAuth already uses persistent browser storage; open the popup in the click handler.
  return signInWithPopup(auth, googleProvider).then(result => result.user)
}

export function syncSignInErrorMessage(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? error.code
    : undefined
  switch (code) {
    case 'auth/popup-blocked':
      return 'Your browser blocked Google sign-in. Allow pop-ups for this site and try again. If using the installed app, open it in Safari or Chrome on this device.'
    case 'auth/popup-closed-by-user':
      return 'Google sign-in was not completed. Try again and finish signing in in the Google window.'
    case 'auth/cancelled-popup-request':
      return 'Google sign-in was interrupted. Please try again.'
    case 'auth/unauthorized-domain':
      return 'Google sign-in is not enabled for this domain. Add this hostname to Firebase Authentication authorized domains.'
    case 'auth/operation-not-allowed':
      return 'Google sign-in is not enabled in Firebase Authentication.'
    case 'auth/web-storage-unsupported':
      return 'Google sign-in needs browser storage. Allow cookies and site storage, then try again.'
    case 'auth/network-request-failed':
      return 'Google sign-in could not connect. Check your internet connection and try again.'
    default:
      return error instanceof Error ? error.message : String(error)
  }
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
