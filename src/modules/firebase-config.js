/**
 * Firebase Configuration
 * Utilise import.meta.env (Vite) → variables dans .env.local
 */
import { getApps, initializeApp } from 'firebase/app'

import { getAuth }                from 'firebase/auth'
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
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
  serviceFeePercent:     5,
  currency:              'EUR',
  googlePlaceId:         import.meta.env.VITE_GOOGLE_PLACE_ID    || '',
  airbnbListingId:       import.meta.env.VITE_AIRBNB_LISTING_ID  || '',
}

// ==================== DYNAMIC PRICING ====================

const PRICING_CACHE_KEY = 'villa_pricing'
const PRICING_CACHE_TTL = 30 * 60 * 1000
let _pricingCache = null

export async function getPricing() {
  if (_pricingCache) return _pricingCache

  const cached = JSON.parse(localStorage.getItem(PRICING_CACHE_KEY) || 'null')
  if (cached && Date.now() - cached.fetchedAt < PRICING_CACHE_TTL) {
    _pricingCache = cached.data
    return _pricingCache
  }

  try {
    const snap = await getDoc(doc(db, 'config', 'pricing'))
    if (snap.exists()) {
      _pricingCache = snap.data()
      localStorage.setItem(PRICING_CACHE_KEY, JSON.stringify({ data: _pricingCache, fetchedAt: Date.now() }))
      return _pricingCache
    }
  } catch (e) {
    console.warn('[pricing] Firestore failed, using defaults')
  }

  _pricingCache = {
    low:               PROPERTY_CONFIG.basePrice.low,
    high:              PROPERTY_CONFIG.basePrice.high,
    school:            PROPERTY_CONFIG.basePrice.school,
    cleaningFee:       PROPERTY_CONFIG.cleaningFee,
    serviceFeePercent: PROPERTY_CONFIG.serviceFeePercent,
  }
  return _pricingCache
}

export async function savePricing(data) {
  await setDoc(doc(db, 'config', 'pricing'), { ...data, updatedAt: serverTimestamp() })
  _pricingCache = null
  localStorage.removeItem(PRICING_CACHE_KEY)
}

// ==================== BOOKING SETTINGS ====================

const BOOKING_CACHE_KEY = 'villa_booking_settings'
const BOOKING_CACHE_TTL = 30 * 60 * 1000
let _bookingCache = null

export async function getBookingSettings() {
  if (_bookingCache) return _bookingCache

  const cached = JSON.parse(localStorage.getItem(BOOKING_CACHE_KEY) || 'null')
  if (cached && Date.now() - cached.fetchedAt < BOOKING_CACHE_TTL) {
    _bookingCache = cached.data
    return _bookingCache
  }

  try {
    const snap = await getDoc(doc(db, 'config', 'booking_settings'))
    if (snap.exists()) {
      _bookingCache = snap.data()
      localStorage.setItem(BOOKING_CACHE_KEY, JSON.stringify({ data: _bookingCache, fetchedAt: Date.now() }))
      return _bookingCache
    }
  } catch (e) {
    console.warn('[booking_settings] Firestore failed, using defaults')
  }

  _bookingCache = { booking_mode: 'direct', url_airbnb: '', url_booking: '' }
  return _bookingCache
}

export async function saveBookingSettings(data) {
  await setDoc(doc(db, 'config', 'booking_settings'), { ...data, updatedAt: serverTimestamp() })
  _bookingCache = null
  localStorage.removeItem(BOOKING_CACHE_KEY)
}
