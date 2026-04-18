/**
 * PWA Module
 * Service Worker registration, install prompt, push notifications
 */

import { FCM_VAPID_KEY, db, getMessagingInstance } from './firebase-config.js'
import { arrayUnion, doc, updateDoc } from 'firebase/firestore'

let deferredInstallPrompt = null

// ==================== SERVICE WORKER ====================

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null

  try {
    const reg = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    })

    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing
      newWorker?.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          showUpdateBanner(newWorker)
        }
      })
    })

    if ('periodicSync' in reg) {
      try {
        await reg.periodicSync.register('sync-availability', { minInterval: 60 * 60 * 1000 })
      } catch {}
    }

    return reg
  } catch (err) {
    console.error('[PWA] SW registration failed:', err)
    return null
  }
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

function showUpdateBanner(newWorker) {
  const banner = document.createElement('div')
  banner.className = 'fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:max-w-sm z-50 bg-slate-800 text-white rounded-2xl shadow-2xl p-4'
  banner.innerHTML = `
    <div class="flex items-center justify-between gap-3">
      <div>
        <div class="font-semibold text-sm">Mise à jour disponible</div>
        <div class="text-xs text-slate-300 mt-0.5">Rechargez pour la dernière version</div>
      </div>
      <button id="sw-update-btn" class="bg-amber-500 hover:bg-amber-400 text-white text-xs font-bold px-3 py-2 rounded-xl whitespace-nowrap transition">
        Mettre à jour
      </button>
    </div>
  `
  document.body.appendChild(banner)
  // Délégation sur le banner
  banner.addEventListener('click', e => {
    if (e.target.closest('#sw-update-btn')) {
      newWorker.postMessage({ type: 'SKIP_WAITING' })
      window.location.reload()
    }
  })
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

export function generateQRCode(containerId, url) {
  const container = document.getElementById(containerId)
  if (!container) return

  const encodedUrl = encodeURIComponent(url)
  const qrUrl = `https://chart.googleapis.com/chart?cht=qr&chs=200x200&chl=${encodedUrl}&choe=UTF-8&chld=M|2`

  const img = document.createElement('img')
  img.src = qrUrl
  img.alt = 'QR Code de partage'
  img.className = 'w-24 h-24 rounded-xl'
  img.loading = 'lazy'

  container.innerHTML = ''
  container.appendChild(img)
}
