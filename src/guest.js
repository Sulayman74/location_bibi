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

function navigateToTab(tabId) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'))
  document.getElementById(tabId)?.classList.add('active')
  
  document.querySelectorAll('[data-tab-target]').forEach(t => {
    const isActive = t.dataset.tabTarget === tabId
    
    if (t.classList.contains('floating-nav-btn')) {
      t.classList.toggle('active', isActive)
      // Show/hide label
      const label = t.querySelector('.floating-nav-label')
      if (label) label.classList.toggle('hidden', !isActive)
    } else {
      // Handle desktop/other tabs if any
      t.classList.toggle('active', isActive)
      t.classList.toggle('text-stone-500', !isActive)
    }
  })
}

async function init() {
  initPageTransitions()
  await registerServiceWorker()
  await initForegroundMessaging()

  initTabs()
  initTabSwipe('#guest-content', '[data-tab-target]', navigateToTab)
  renderGuestRecommendations('guest-recommendations')

  // Résolution de la réservation
  const params     = new URLSearchParams(window.location.search)
  const fromUrl    = params.get('booking')
  const fromCache  = localStorage.getItem('villa_active_booking')
  const bookingId  = fromUrl || fromCache

  let booking = null
  if (bookingId) {
    booking = await loadGuestBooking(bookingId)
    if (booking) localStorage.setItem('villa_active_booking', booking.id)
  }

  if (booking) {
    document.getElementById('no-booking')?.classList.add('hidden')
    document.getElementById('guest-content')?.classList.remove('hidden')

    renderStayInfo(booking)
    await renderWifiSection(booking)
    renderReviewSection(booking)
    smartReviewRequest(booking, PROPERTY_CONFIG.googlePlaceId)
    startCheckinCountdown(booking.checkIn)

    // QR code de partage
    const shareUrl = `${window.location.origin}/guest.html?booking=${booking.id}`
    generateQRCode('qr-container', shareUrl)

    // Code boîte à clés
    const keyEl = document.getElementById('key-code')
    if (keyEl && booking.keyCode) keyEl.textContent = booking.keyCode

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

    const booking = await loadGuestBookingByCode(code)
    if (booking) {
      localStorage.setItem('villa_active_booking', booking.id)
      window.location.reload()
    } else {
      showErr('Code non trouvé. Vérifiez votre email de confirmation.')
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
  // Un seul listener délégué sur document — capte clics venant des nav-tabs ET du bottom-nav
  document.addEventListener('click', e => {
    const tab = e.target.closest('[data-tab-target]')
    if (!tab) return
    navigateToTab(tab.dataset.tabTarget)
  })
}

init().catch(console.error)
