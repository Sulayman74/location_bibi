/**
 * Auth Module
 * Firebase Auth email/password + vérification du rôle dans Firestore
 *
 * Rôles : 'admin' (hôte propriétaire) | 'host' (co-hôte lecture seule)
 * Le rôle est stocké dans Firestore : users/{uid}.role
 */
import {
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
} from 'firebase/auth'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { auth, db } from './firebase-config.js'

// Cache en mémoire pour éviter trop de lectures Firestore
let _cachedRole = null

// ==================== SIGN IN ====================

export async function signIn(email, password) {
  const credential = await signInWithEmailAndPassword(auth, email, password)
  _cachedRole = null // reset cache
  return credential.user
}

export async function signOut() {
  _cachedRole = null
  await firebaseSignOut(auth)
}

export function resetPassword(email) {
  return sendPasswordResetEmail(auth, email)
}

// ==================== ROLE ====================

export async function getUserRole(uid) {
  if (_cachedRole) return _cachedRole
  const snap = await getDoc(doc(db, 'users', uid))
  if (!snap.exists()) return null
  _cachedRole = snap.data().role || null
  return _cachedRole
}

export async function isAdmin(uid) {
  const role = await getUserRole(uid)
  return role === 'admin'
}

// ==================== AUTH GUARD ====================

/**
 * À appeler au top de chaque page protégée.
 * Redirige vers /admin.html#login si non connecté ou pas admin.
 * Retourne l'user si OK.
 */
export function requireAdmin() {
  return new Promise((resolve, reject) => {
    const unsub = onAuthStateChanged(auth, async user => {
      unsub()
      if (!user) { redirectToLogin() ; return reject(new Error('unauthenticated')) }
      const admin = await isAdmin(user.uid)
      if (!admin) { redirectToLogin('unauthorized') ; return reject(new Error('unauthorized')) }
      resolve(user)
    })
  })
}

function redirectToLogin(reason = '') {
  const current = encodeURIComponent(window.location.pathname + window.location.search)
  window.location.href = `/admin.html?login=1&reason=${reason}&next=${current}`
}

// ==================== OBSERVER ====================

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback)
}

// ==================== FIRST ADMIN SETUP ====================
// À appeler une seule fois en console pour créer le premier compte admin

export async function createAdminUser(uid, email) {
  await setDoc(doc(db, 'users', uid), {
    email,
    role: 'admin',
    createdAt: serverTimestamp(),
  })
}
