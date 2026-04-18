/**
 * Firebase Configuration
 * Utilise import.meta.env (Vite) → variables dans .env.local
 */
import { getApps, initializeApp } from 'firebase/app'

import { getAuth }                from 'firebase/auth'
import { getFirestore }           from 'firebase/firestore'
import { getFunctions }           from 'firebase/functions'
import { getStorage } from 'firebase/storage'

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId:     import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
}

// Singleton — évite double init en HMR Vite
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig)

export const db        = getFirestore(app)
export const auth      = getAuth(app)
export const functions = getFunctions(app, 'europe-west1')
export const storage = getStorage(app)

// FCM — chargé lazily (nécessite ServiceWorker + HTTPS)
export async function getMessagingInstance() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null
  try {
    const { getMessaging } = await import('firebase/messaging')
    return getMessaging(app)
  } catch {
    return null
  }
}

export const FCM_VAPID_KEY          = import.meta.env.VITE_FCM_VAPID_KEY
export const STRIPE_PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
export const FUNCTIONS_BASE_URL     = import.meta.env.VITE_FUNCTIONS_BASE_URL

export const PROPERTY_CONFIG = {
  name:                  "La Cabine du Cap d'Agde",
  checkInHour:           16,
  checkOutHour:          11,
  wifiAccessWindowHours: 2,
  maxGuests:             8,
  basePrice:             { low: 45, high: 85, school: 90 },
  cleaningFee:           50,
  currency:              'EUR',
  googlePlaceId:         import.meta.env.VITE_GOOGLE_PLACE_ID    || '',
  airbnbListingId:       import.meta.env.VITE_AIRBNB_LISTING_ID  || '',
}
