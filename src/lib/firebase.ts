import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: 'AIzaSyDKoQ2E5F_7tV6_LK4q0BzNbBhSgeL0AaQ',
  authDomain: 'chess-opening-trainer-976b0.firebaseapp.com',
  projectId: 'chess-opening-trainer-976b0',
  storageBucket: 'chess-opening-trainer-976b0.firebasestorage.app',
  messagingSenderId: '420123943617',
  appId: '1:420123943617:web:4647eec036993cc54e6a40',
}

const app = initializeApp(firebaseConfig)
export const db = getFirestore(app)
export const auth = getAuth(app)
