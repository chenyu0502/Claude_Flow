import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';

const env = import.meta.env;

/** true 時連線本地 Firebase Emulator（Auth :9099、Firestore :8080），不需要真實專案 */
export const useEmulator = env.VITE_USE_EMULATOR === 'true';

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || (useEmulator ? 'demo-api-key' : undefined),
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || (useEmulator ? 'demo-claude-flow.firebaseapp.com' : undefined),
  projectId: env.VITE_FIREBASE_PROJECT_ID || (useEmulator ? 'demo-claude-flow' : undefined),
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

if (useEmulator) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}
