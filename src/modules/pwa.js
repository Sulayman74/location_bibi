/**
 * PWA Module
 * Service Worker registration, install prompt, push notifications
 */

import { registerSW } from 'virtual:pwa-register'
import { FCM_VAPID_KEY, db, getMessagingInstance } from './firebase-config.js'
import { arrayUnion, doc, updateDoc } from 'firebase/firestore'

let deferredInstallPrompt = null

// ==================== SERVICE WORKER ====================

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null

  return registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, reg) {
      if (reg && 'periodicSync' in reg) {
        reg.periodicSync
          .register('sync-availability', { minInterval: 60 * 60 * 1000 })
          .catch(() => {})
      }
    },
    onRegisterError(err) {
      console.error('[PWA] SW registration failed:', err)
    },
  })
}

// ==================== INSTALL PROMPT ====================

export function initInstallPrompt() {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault()
    deferredInstallPrompt = e

    const dismissed = localStorage.getItem('pwa_banner_dismissed')
    if (dismissed && Date.now() - parseInt(dismissed) < 7 * 24 * 3600 * 1000) return

    showInstallBanner()
  })

  window.addEventListener('appinstalled', () => {
    hidePwaBanner()
    deferredInstallPrompt = null
    try { if (window.gtag) window.gtag('event', 'pwa_install') } catch {}
  })
}

function showInstallBanner() {
  const banner = document.getElementById('pwa-banner')
  if (!banner || banner.dataset.bound) return   // évite double-binding
  banner.dataset.bound = '1'
  banner.classList.remove('hidden')

  // Délégation sur le banner — un seul listener sur le parent
  banner.addEventListener('click', async e => {
    const btn = e.target.closest('button')
    if (!btn) return

    if (btn.id === 'pwa-install-btn') {
      if (!deferredInstallPrompt) return
      hidePwaBanner()
      const { outcome } = await deferredInstallPrompt.prompt()
      console.log('[PWA] Install outcome:', outcome)
      deferredInstallPrompt = null
    } else if (btn.id === 'pwa-dismiss-btn') {
      hidePwaBanner()
      localStorage.setItem('pwa_banner_dismissed', Date.now().toString())
    }
  })
}

function hidePwaBanner() {
  document.getElementById('pwa-banner')?.classList.add('hidden')
}

// ==================== PUSH NOTIFICATIONS ====================

export async function requestNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported'
  if (Notification.permission === 'granted') { await subscribeToPush(); return 'granted' }
  if (Notification.permission === 'denied') return 'denied'

  const permission = await Notification.requestPermission()
  if (permission === 'granted') await subscribeToPush()
  return permission
}

async function subscribeToPush() {
  const messaging = await getMessagingInstance()
  if (!messaging) return

  try {
    // Import dynamique pour ne charger FCM que si nécessaire
    const { getToken } = await import('firebase/messaging')
    const reg = await navigator.serviceWorker.ready
    const token = await getToken(messaging, {
      vapidKey: FCM_VAPID_KEY,
      serviceWorkerRegistration: reg,
    })
    if (token) await saveFcmToken(token)
  } catch (err) {
    console.error('[PWA] FCM token error:', err)
  }
}

async function saveFcmToken(token) {
  const bookingId = sessionStorage.getItem('villa_booking_id')
  if (!bookingId) return

  try {
    await updateDoc(doc(db, 'reservations', bookingId), {
      fcmTokens: arrayUnion(token),
    })
  } catch (err) {
    console.error('[PWA] saveFcmToken failed:', err)
  }
}

// ==================== FOREGROUND MESSAGING ====================

export async function initForegroundMessaging() {
  const messaging = await getMessagingInstance()
  if (!messaging) return

  try {
    const { onMessage } = await import('firebase/messaging')
    onMessage(messaging, payload => {
      showInAppNotification(
        payload.notification?.title,
        payload.notification?.body,
        payload.data
      )
    })
  } catch (e) {
    console.warn('[PWA] Foreground messaging failed:', e)
  }
}

function showInAppNotification(title, body, data) {
  const toast = document.createElement('div')
  toast.className = 'fixed top-20 left-4 right-4 sm:left-auto sm:right-4 sm:max-w-sm z-50 bg-white rounded-2xl shadow-2xl p-4 border border-stone-200 animate-slide-up'
  toast.innerHTML = `
    <div class="flex items-start gap-3">
      <div class="w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">KP</div>
      <div class="flex-1 min-w-0">
        <div class="font-semibold text-stone-800 text-sm">${title || "La Cabine du Cap d'Agde"}</div>
        <div class="text-xs text-stone-500 mt-0.5">${body || ''}</div>
        ${data?.url ? `<a href="${data.url}" class="text-xs text-amber-600 underline mt-1 inline-block">Voir →</a>` : ''}
      </div>
      <button data-close class="text-stone-300 hover:text-stone-500 flex-shrink-0">✕</button>
    </div>
  `
  document.body.appendChild(toast)
  toast.addEventListener('click', e => { if (e.target.closest('[data-close]')) toast.remove() })
  setTimeout(() => toast.remove(), 8000)
}

// ==================== QR CODE ====================

export async function generateQRCode(containerId, url) {
  const container = document.getElementById(containerId)
  if (!container) return

  try {
    const QRCode = (await import('qrcode')).default
    const canvas = document.createElement('canvas')
    await QRCode.toCanvas(canvas, url, { width: 160, margin: 1, color: { dark: '#1c1917', light: '#fafaf9' } })
    canvas.className = 'rounded-lg'
    container.innerHTML = ''
    container.appendChild(canvas)
  } catch (e) {
    console.error('[QR] generation failed:', e)
  }
}
