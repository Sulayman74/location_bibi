/**
 * guest.js — Entry point portail voyageur (guest.html)
 */
import './styles/main.css'
import { registerServiceWorker, initForegroundMessaging, generateQRCode } from './modules/pwa.js'
import { renderGuestRecommendations } from './modules/recommendations.js'
import { smartReviewRequest } from './modules/reviews.js'
import {
  loadGuestBooking,
  loadGuestBookingByCode,
  renderWifiSection,
  renderStayInfo,
  renderReviewSection,
  startCheckinCountdown,
} from './modules/guest-access.js'
import { PROPERTY_CONFIG } from './modules/firebase-config.js'
import { requestNotificationPermission } from './modules/pwa.js'
import { initPageTransitions } from './modules/transitions.js'
import { initTabSwipe } from './modules/swipe.js'

const TAB_ORDER = ['tab-guide', 'tab-local', 'tab-review', 'tab-profile']

function navigateToTab(tabId) {
  const panel = document.getElementById(tabId)
  if (!panel) return

  const allPanels = document.querySelectorAll('.tab-panel')
  const currentPanel = [...allPanels].find(p => p.classList.contains('active'))
  const fromIdx = TAB_ORDER.indexOf(currentPanel?.id ?? '')
  const toIdx   = TAB_ORDER.indexOf(tabId)
  const slideClass = toIdx > fromIdx ? 'tab-slide-from-right' : 'tab-slide-from-left'

  allPanels.forEach(p => p.classList.remove('active'))
  panel.classList.add('active')

  if (fromIdx !== toIdx) {
    panel.classList.add(slideClass)
    panel.addEventListener('animationend', () => panel.classList.remove(slideClass), { once: true })
  }
  
  document.querySelectorAll('[data-tab-target]').forEach(t => {
    const isActive = t.dataset.tabTarget === tabId

    if (t.classList.contains('floating-nav-btn')) {
      t.classList.toggle('active', isActive)
      const label = t.querySelector('.floating-nav-label')
      if (label) label.classList.toggle('hidden', !isActive)
    } else {
      t.classList.toggle('active', isActive)
      t.classList.remove('bg-amber-500', 'text-stone-900', 'text-stone-500', 'font-semibold')
      if (isActive) {
        t.style.backgroundColor = '#f59e0b'
        t.style.color = '#1c1917'
        t.style.fontWeight = '600'
      } else {
        t.style.backgroundColor = '#ffffff'
        t.style.color = '#78716c'
        t.style.fontWeight = '500'
      }
    }
  })
}

async function init() {
  // 1. Initialisation UI immédiate
  initPageTransitions()
  initTabs()
  initTabSwipe('#guest-content', '[data-tab-target]', navigateToTab)
  renderGuestRecommendations('guest-recommendations')

  // 2. PWA init (non-blocking)
  // registerServiceWorker retourne updateSW (une fonction du plugin), pas une Promise
  // → les erreurs SW sont gérées via onRegisterError dans pwa.js
  try { registerServiceWorker() } catch (e) { console.warn('SW init error:', e) }
  initForegroundMessaging().catch(e => console.warn('Messaging init error:', e))

  // 3. Résolution de la réservation
  const params     = new URLSearchParams(window.location.search)
  const fromUrl    = params.get('booking')
  const fromCache  = localStorage.getItem('villa_active_booking')
  const bookingId  = fromUrl || fromCache

  let booking = null
  if (bookingId) {
    try {
      booking = await loadGuestBooking(bookingId)
      if (booking) localStorage.setItem('villa_active_booking', booking.id)
    } catch (err) { console.error('Booking fetch error:', err) }
  }

  if (booking) {
    document.getElementById('no-booking')?.classList.add('hidden')
    document.getElementById('guest-content')?.classList.remove('hidden')

    renderStayInfo(booking)
    renderWifiSection(booking).catch(console.error)
    renderReviewSection(booking)
    smartReviewRequest(booking, PROPERTY_CONFIG.googlePlaceId)
    startCheckinCountdown(booking.checkIn)

    const keyEl = document.getElementById('key-code')
    if (keyEl) keyEl.textContent = booking.keyCode || '—'

    // Remplir le profil
    const profileName = document.getElementById('profile-name')
    const profileId   = document.getElementById('profile-booking-id')
    if (profileName) profileName.textContent = booking.guestName || 'Voyageur'
    if (profileId)   profileId.textContent   = booking.bookingId

    // Logout guest
    document.getElementById('logout-guest-btn')?.addEventListener('click', () => {
      localStorage.removeItem('villa_active_booking')
      window.location.reload()
    })

    // Demander permission notifs (sans friction — seulement si pas encore demandé)
    if (Notification.permission === 'default') {
      setTimeout(() => requestNotificationPermission(), 4000)
    }

  } else {
    document.getElementById('no-booking')?.classList.remove('hidden')
    document.getElementById('guest-content')?.classList.add('hidden')
    initCodeForm()
  }
}

function initCodeForm() {
  const input = document.getElementById('booking-code-input')
  const btn   = document.getElementById('verify-booking-btn')
  const errEl = document.getElementById('booking-code-error')

  input?.addEventListener('input', e => {
    e.target.value = e.target.value.replace(/[^A-Za-z0-9-]/g, '').toUpperCase()
  })

  const verify = async () => {
    const code = input?.value?.trim()
    if (!code) { showErr('Entrez votre code de réservation') ; return }

    btn.disabled = true
    btn.textContent = 'Vérification…'
    errEl?.classList.add('hidden')

    try {
      const booking = await loadGuestBookingByCode(code)
      if (booking) {
        localStorage.setItem('villa_active_booking', booking.id)
        window.location.reload()
      } else {
        showErr('Code non trouvé. Vérifiez votre email de confirmation.')
        btn.disabled = false
        btn.textContent = 'Accéder à mon séjour'
      }
    } catch (e) {
      showErr('Erreur de connexion.')
      btn.disabled = false
      btn.textContent = 'Accéder à mon séjour'
    }
  }

  btn?.addEventListener('click', verify)
  input?.addEventListener('keydown', e => e.key === 'Enter' && verify())

  function showErr(msg) {
    if (errEl) { errEl.textContent = msg ; errEl.classList.remove('hidden') }
  }
}

function initTabs() {
  document.addEventListener('click', e => {
    const tab = e.target.closest('[data-tab-target]')
    if (!tab) return
    navigateToTab(tab.dataset.tabTarget)
  })
}

function hideSplash() {
  const splash = document.getElementById('splash-screen')
  if (!splash) return
  splash.classList.add('hide')
  setTimeout(() => splash.remove(), 500)
}

init()
  .catch(console.error)
  .finally(() => {
    // Délai mini 400ms pour éviter le flash si init est instantanée
    const minDelay = new Promise(r => setTimeout(r, 400))
    minDelay.then(hideSplash)
  })
