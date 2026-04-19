/**
 * admin.js — Entry point portail administrateur
 */
import './styles/main.css'

import {
  broadcastPushNotification,
  getGuestStats,
  loadDashboardStats,
  loadGuests,
  loadReservations,
  previewBroadcastCount,
  renderBookingRow,
  renderGuestRow,
  renderStatsCards,
  subscribeToUpcomingBookings,
} from './modules/admin-panel.js'
import { getDownloadURL, ref } from 'firebase/storage'
import { isAdmin, onAuthChange, resetPassword, signIn, signOut } from './modules/auth.js'
import { cancelBooking } from './modules/booking.js'

import { initPageTransitions } from './modules/transitions.js'
import { storage, getPricing, savePricing, getBookingSettings, saveBookingSettings, db } from './modules/firebase-config.js';
import { doc, getDoc } from 'firebase/firestore';

// ==================== BOOT ====================

async function init() {
  initPageTransitions()
  const params = new URLSearchParams(window.location.search)

  // Écouter l'état auth
  onAuthChange(async user => {
    if (!user) {
      showLogin()
      return
    }
    const admin = await isAdmin(user.uid)
    if (!admin) {
      showLogin('unauthorized')
      return
    }
    showApp(user)
  })

  // Si on arrive avec ?login=1 → afficher la page login directement
  if (params.get('login')) showLogin(params.get('reason'))
    
    document.getElementById('bookings-table-body')?.addEventListener('click', async (e) => {
    // Voir pièce d'identité
    const viewBtn = e.target.closest('[data-action="view-id"]')
    if (viewBtn) {
      e.preventDefault()
      const path = viewBtn.getAttribute('data-path')
      if (path) {
        try {
          viewBtn.textContent = 'Chargement…'
          const url = await getDownloadURL(ref(storage, path))
          window.open(url, '_blank', 'noopener,noreferrer')
          viewBtn.textContent = 'Voir la pièce'
        } catch (err) {
          console.error('Erreur document:', err)
          alert('Impossible de charger le document.')
          viewBtn.textContent = 'Voir la pièce'
        }
      }
    }

    // Annuler une réservation
    const cancelBtn = e.target.closest('[data-action="cancel-booking"]')
    if (cancelBtn) {
      e.preventDefault()
      const bookingId   = cancelBtn.dataset.bookingId
      const guest       = cancelBtn.dataset.guest
      const amount      = cancelBtn.dataset.amount
      const refundLabel = cancelBtn.dataset.refundLabel

      const confirmed = window.confirm(
        `Annuler la réservation #${bookingId} ?\n\nVoyageur : ${guest}\nMontant : ${amount}€\nRemboursement : ${refundLabel}\n\nCette action est irréversible.`
      )
      if (!confirmed) return

      cancelBtn.textContent = 'Annulation…'
      cancelBtn.disabled = true

      try {
        await cancelBooking(bookingId, 'admin_request')
        await loadReservationsSection()
      } catch (err) {
        alert(`Erreur : ${err.message}`)
        cancelBtn.textContent = 'Annuler'
        cancelBtn.disabled = false
      }
    }
  })
}

// ==================== LOGIN ====================

function showLogin(reason = '') {
  document.getElementById('login-screen')?.classList.remove('hidden')
  document.getElementById('admin-app')?.classList.add('hidden')

  if (reason === 'unauthorized') {
    showLoginError('Accès refusé. Ce compte n\'a pas les droits administrateur.')
  }

  initLoginForm()
}

function initLoginForm() {
  const form    = document.getElementById('login-form')
  const spinner = document.getElementById('login-spinner')
  const btnText = document.getElementById('login-btn-text')
  const errEl   = document.getElementById('login-error')
  const okEl    = document.getElementById('login-success')

  // Toggle password visibility
  document.getElementById('toggle-password')?.addEventListener('click', () => {
    const input = document.getElementById('login-password')
    input.type = input.type === 'password' ? 'text' : 'password'
  })

  form?.addEventListener('submit', async e => {
    e.preventDefault()
    errEl?.classList.add('hidden')

    const email    = document.getElementById('login-email')?.value?.trim()
    const password = document.getElementById('login-password')?.value

    if (!email || !password) { showLoginError('Email et mot de passe requis') ; return }

    spinner?.classList.remove('hidden')
    if (btnText) btnText.textContent = 'Connexion…'
    document.getElementById('login-btn').disabled = true

    try {
      await signIn(email, password)
      // onAuthChange s'occupera de la suite
    } catch (err) {
      const msg = {
        'auth/user-not-found':  'Aucun compte trouvé pour cet email.',
        'auth/wrong-password':  'Mot de passe incorrect.',
        'auth/too-many-requests': 'Trop de tentatives. Réessayez dans quelques minutes.',
        'auth/invalid-email':   'Adresse email invalide.',
      }[err.code] || err.message
      showLoginError(msg)
    } finally {
      spinner?.classList.add('hidden')
      if (btnText) btnText.textContent = 'Se connecter'
      document.getElementById('login-btn').disabled = false
    }
  })

  document.getElementById('forgot-password')?.addEventListener('click', async () => {
    const email = document.getElementById('login-email')?.value?.trim()
    if (!email) { showLoginError('Entrez votre email pour réinitialiser.') ; return }
    try {
      await resetPassword(email)
      errEl?.classList.add('hidden')
      if (okEl) { okEl.textContent = 'Email envoyé ! Vérifiez votre boîte mail.' ; okEl.classList.remove('hidden') }
    } catch (err) {
      showLoginError('Impossible d\'envoyer l\'email : ' + err.message)
    }
  })

  function showLoginError(msg) {
    if (errEl) { errEl.textContent = msg ; errEl.classList.remove('hidden') }
  }
}

function showLoginError(msg) {
  const errEl = document.getElementById('login-error')
  if (errEl) { errEl.textContent = msg ; errEl.classList.remove('hidden') }
}

// ==================== APP SHELL ====================

let unsubBookings = null

function showApp(user) {
  document.getElementById('login-screen')?.classList.add('hidden')
  document.getElementById('admin-app')?.classList.remove('hidden')

  const emailEl = document.getElementById('admin-email-display')
  if (emailEl) emailEl.textContent = user.email

  initNavigation()
  initLogout()
  initMobileNav()
  navigateTo('dashboard') // section par défaut
}

// ==================== NAVIGATION ====================

function initNavigation() {
  // Desktop + mobile nav items
  document.querySelectorAll('[data-section]').forEach(btn => {
    btn.addEventListener('click', () => {
      const section = btn.dataset.section
      navigateTo(section)
      // Fermer nav mobile
      document.getElementById('mobile-nav')?.classList.add('hidden')
    })
  })
}

async function navigateTo(section) {
  // Mettre à jour les styles nav
  document.querySelectorAll('.admin-nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.section === section)
  })

  // Afficher la bonne section
  document.querySelectorAll('.admin-section').forEach(s => s.classList.add('hidden'))
  document.getElementById(`section-${section}`)?.classList.remove('hidden')

  // Charger les données
  switch (section) {
    case 'dashboard':     await loadDashboard() ; break
    case 'reservations':  await loadReservationsSection() ; break
    case 'push':          await loadPushSection() ; break
    case 'guests':        await loadGuestsSection() ; break
    case 'pricing':       await loadPricingSection() ; break
    case 'settings':      await loadSettingsSection() ; break
  }
}

// ==================== DASHBOARD ====================

async function loadDashboard() {
  try {
    const stats = await loadDashboardStats()

    document.getElementById('stats-grid').innerHTML = renderStatsCards(stats)

    const nextEl = document.getElementById('next-booking-card')
    if (nextEl) {
      if (stats.nextBooking) {
        const b = stats.nextBooking
        const checkIn = b.checkIn?.toDate ? b.checkIn.toDate() : new Date(b.checkIn)
        nextEl.innerHTML = `
          <div class="flex items-center gap-4">
            <div class="bg-amber-100 rounded-xl p-3 text-center min-w-[60px]">
              <div class="text-xs text-amber-600 font-medium">${checkIn.toLocaleDateString('fr-FR', { month: 'short' })}</div>
              <div class="text-2xl font-bold text-amber-700">${checkIn.getDate()}</div>
            </div>
            <div>
              <div class="font-semibold text-stone-800">${b.guestName || 'Voyageur'}</div>
              <div class="text-sm text-stone-500">${b.nights || 0} nuit${b.nights > 1 ? 's' : ''} · ${b.guests || 1} pers.</div>
              <div class="text-xs text-stone-400 mt-1">${b.guestEmail || ''}</div>
            </div>
          </div>
        `
      } else {
        nextEl.innerHTML = '<div class="text-stone-400 text-sm py-2">Aucune réservation à venir</div>'
      }
    }

    // Abonner aux updates en temps réel
    if (unsubBookings) unsubBookings()
    unsubBookings = subscribeToUpcomingBookings(bookings => {
      const stat = document.getElementById('stat-upcoming')
      if (stat) stat.textContent = bookings.length
    })

  } catch (err) {
    console.error('[Admin] Dashboard load error:', err)
  }
}

// ==================== RESERVATIONS ====================

async function loadReservationsSection(filter = 'confirmed') {
  const tbody = document.getElementById('bookings-table-body')
  if (!tbody) return

  // 👇 1. Passe de 6 à 7 ici
  tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-8 text-center text-stone-400 text-sm">Chargement…</td></tr>'

  try {
    const bookings = await loadReservations(filter)
    
    // 👇 2. Et passe de 6 à 7 ici aussi
    tbody.innerHTML = bookings.length
      ? bookings.map(renderBookingRow).join('')
      : '<tr><td colspan="7" class="px-4 py-8 text-center text-stone-400 text-sm">Aucune réservation</td></tr>'
      
  } catch (err) {
    // 👇 3. Pareil en cas d'erreur (si la ligne existe)
    tbody.innerHTML = `<tr><td colspan="7" class="px-4 py-8 text-center text-red-400">Erreur : ${err.message}</td></tr>`
  }
}

// ==================== PUSH ====================

async function loadPushSection() {
  // Initialiser les compteurs de caractères
  const titleInput = document.getElementById('push-title')
  const bodyInput  = document.getElementById('push-body')

  titleInput?.addEventListener('input', () => {
    document.getElementById('title-count').textContent = titleInput.value.length
    document.getElementById('preview-title').textContent = titleInput.value || 'Titre du message'
  })
  bodyInput?.addEventListener('input', () => {
    document.getElementById('body-count').textContent = bodyInput.value.length
    document.getElementById('preview-body').textContent = bodyInput.value || 'Corps du message…'
  })

  // Compter les destinataires quand on change la cible
  const targetSelect = document.getElementById('push-target')
  const updateCount = async () => {
    const countEl = document.getElementById('push-recipient-count')
    if (!countEl) return
    countEl.textContent = 'Calcul…'
    try {
      const count = await previewBroadcastCount(targetSelect?.value || 'all')
      countEl.textContent = `${count} destinataire${count > 1 ? 's' : ''} estimé${count > 1 ? 's' : ''}`
    } catch {
      countEl.textContent = '—'
    }
  }
  targetSelect?.addEventListener('change', updateCount)
  updateCount()

  // Envoyer
  document.getElementById('send-push-btn')?.addEventListener('click', sendPushBroadcast, { once: true })
}

async function sendPushBroadcast() {
  const title   = document.getElementById('push-title')?.value?.trim()
  const body    = document.getElementById('push-body')?.value?.trim()
  const url     = document.getElementById('push-url')?.value?.trim() || '/'
  const target  = document.getElementById('push-target')?.value || 'all'
  const resultEl = document.getElementById('push-result')
  const btn     = document.getElementById('send-push-btn')
  const spinner = document.getElementById('send-push-spinner')
  const btnText = document.getElementById('send-push-text')

  if (!title || !body) {
    if (resultEl) {
      resultEl.className = 'mb-4 rounded-xl p-3 text-sm bg-red-50 text-red-700 border border-red-200'
      resultEl.textContent = '⚠️ Le titre et le message sont obligatoires.'
      resultEl.classList.remove('hidden')
    }
    // Re-attacher l'event
    btn?.addEventListener('click', sendPushBroadcast, { once: true })
    return
  }

  // Confirmation
  const count = document.getElementById('push-recipient-count')?.textContent || ''
  if (!confirm(`Envoyer à ${count} ?\n\nTitre : ${title}\n\n${body}`)) {
    btn?.addEventListener('click', sendPushBroadcast, { once: true })
    return
  }

  btn.disabled = true
  spinner?.classList.remove('hidden')
  if (btnText) btnText.textContent = 'Envoi en cours…'
  resultEl?.classList.add('hidden')

  try {
    const result = await broadcastPushNotification({ title, body, url, targetGroup: target })
    if (resultEl) {
      resultEl.className = 'mb-4 rounded-xl p-3 text-sm bg-emerald-50 text-emerald-700 border border-emerald-200'
      resultEl.textContent = `✅ Envoyé à ${result.sent} appareil${result.sent > 1 ? 's' : ''}. Échecs : ${result.failed}.`
      resultEl.classList.remove('hidden')
    }
    // Réinitialiser le formulaire
    document.getElementById('push-title').value = ''
    document.getElementById('push-body').value  = ''
    document.getElementById('title-count').textContent = '0'
    document.getElementById('body-count').textContent  = '0'
    document.getElementById('preview-title').textContent = 'Titre du message'
    document.getElementById('preview-body').textContent  = 'Corps du message…'

  } catch (err) {
    if (resultEl) {
      resultEl.className = 'mb-4 rounded-xl p-3 text-sm bg-red-50 text-red-700 border border-red-200'
      resultEl.textContent = `❌ Erreur : ${err.message}`
      resultEl.classList.remove('hidden')
    }
  } finally {
    btn.disabled = false
    spinner?.classList.add('hidden')
    if (btnText) btnText.textContent = 'Envoyer la notification'
    btn?.addEventListener('click', sendPushBroadcast, { once: true })
  }
}

// ==================== GUESTS ====================

async function loadGuestsSection() {
  const tbody   = document.getElementById('guests-table-body')
  const countEl = document.getElementById('guests-count')
  const statsEl = document.getElementById('guests-subtitle')
  if (!tbody) return

  tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-8 text-center text-stone-400">Chargement…</td></tr>'

  const onlySubscribed = document.getElementById('filter-subscribed')?.checked || false

  try {
    const [guests, stats] = await Promise.all([loadGuests({ onlySubscribed }), getGuestStats()])

    if (statsEl) {
      const v = stats.total > 1 ? 'voyageurs' : 'voyageur'
      const a = stats.subscribed > 1 ? 'abonnés' : 'abonné'
      statsEl.textContent = `${stats.total} ${v} · ${stats.subscribed} ${a} push`
    }

    tbody.innerHTML = guests.length
      ? guests.map(renderGuestRow).join('')
      : '<tr><td colspan="5" class="px-4 py-8 text-center text-stone-400">Aucun voyageur trouvé</td></tr>'

    if (countEl) countEl.textContent = `${guests.length} résultat${guests.length > 1 ? 's' : ''}`

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="px-4 py-8 text-center text-red-400">Erreur : ${err.message}</td></tr>`
  }

  document.getElementById('filter-subscribed')?.addEventListener('change', loadGuestsSection, { once: true })
}

// ==================== PRICING ====================

async function loadPricingSection() {
  const pricing = await getPricing()

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val }
  set('price-low',      pricing.low)
  set('price-high',     pricing.high)
  set('price-school',   pricing.school)
  set('price-cleaning', pricing.cleaningFee)
  set('price-service',  pricing.serviceFeePercent)

  updatePricingPreview(pricing)

  // Live preview on input change
  const inputs = ['price-low','price-high','price-school','price-cleaning','price-service']
  inputs.forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
      updatePricingPreview(getCurrentPricingValues())
    })
  })

  document.getElementById('save-pricing-btn')?.addEventListener('click', savePricingHandler, { once: true })
}

function getCurrentPricingValues() {
  const n = id => parseFloat(document.getElementById(id)?.value) || 0
  return {
    low:               n('price-low'),
    high:              n('price-high'),
    school:            n('price-school'),
    cleaningFee:       n('price-cleaning'),
    serviceFeePercent: n('price-service'),
  }
}

function updatePricingPreview(p) {
  const preview = document.getElementById('pricing-preview')
  if (!preview) return
  const nights   = 7
  const subtotal = nights * p.high
  const service  = Math.round(subtotal * (p.serviceFeePercent / 100))
  const total    = subtotal + p.cleaningFee + service
  preview.innerHTML = `
    <div class="flex justify-between"><span>${p.high}€ × ${nights} nuits</span><span class="font-medium">${subtotal}€</span></div>
    <div class="flex justify-between"><span>Frais de ménage</span><span class="font-medium">${p.cleaningFee}€</span></div>
    <div class="flex justify-between"><span>Frais de service (${p.serviceFeePercent}%)</span><span class="font-medium">${service}€</span></div>
    <div class="flex justify-between border-t border-stone-200 pt-2 mt-2 font-bold text-stone-800"><span>Total</span><span>${total}€</span></div>
  `
}

async function savePricingHandler() {
  const btn     = document.getElementById('save-pricing-btn')
  const spinner = document.getElementById('save-pricing-spinner')
  const btnText = document.getElementById('save-pricing-text')
  const alert   = document.getElementById('pricing-alert')

  const data = getCurrentPricingValues()
  if (!data.low || !data.high || !data.school) {
    showPricingAlert('Tous les tarifs par nuit sont obligatoires.', 'error')
    btn?.addEventListener('click', savePricingHandler, { once: true })
    return
  }

  btn.disabled = true
  spinner?.classList.remove('hidden')
  if (btnText) btnText.textContent = 'Sauvegarde…'

  try {
    await savePricing(data)
    showPricingAlert('✅ Tarifs mis à jour. Les visiteurs verront les nouveaux prix dans 30 min.', 'success')
  } catch (err) {
    showPricingAlert(`❌ Erreur : ${err.message}`, 'error')
  } finally {
    btn.disabled = false
    spinner?.classList.add('hidden')
    if (btnText) btnText.textContent = 'Sauvegarder les tarifs'
    btn?.addEventListener('click', savePricingHandler, { once: true })
  }
}

function showPricingAlert(msg, type) {
  const el = document.getElementById('pricing-alert')
  if (!el) return
  el.className = `mb-5 rounded-xl p-4 text-sm font-medium ${
    type === 'success'
      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
      : 'bg-red-50 text-red-700 border border-red-200'
  }`
  el.textContent = msg
  el.classList.remove('hidden')
  if (type === 'success') setTimeout(() => el.classList.add('hidden'), 5000)
}

// ==================== LOGOUT ====================

function initLogout() {
  const handler = async () => {
    await signOut()
    window.location.reload()
  }
  document.getElementById('logout-btn')?.addEventListener('click', handler)
  document.getElementById('mobile-logout-btn')?.addEventListener('click', handler)
}

// ==================== MOBILE NAV ====================

function initMobileNav() {
  const nav     = document.getElementById('mobile-nav')
  const overlay = document.getElementById('mobile-nav-overlay')
  const close   = document.getElementById('close-mobile-nav')

  document.getElementById('mobile-nav-btn')?.addEventListener('click', () => nav?.classList.remove('hidden'))
  overlay?.addEventListener('click', () => nav?.classList.add('hidden'))
  close?.addEventListener('click', () => nav?.classList.add('hidden'))
}

// ==================== SETTINGS ====================

let _currentBookingMode = 'direct'

async function loadSettingsSection() {
  const settings = await getBookingSettings()
  _currentBookingMode = settings.booking_mode || 'direct'

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? '' }
  set('url-airbnb',   settings.url_airbnb)
  set('url-booking',  settings.url_booking)
  set('ical-airbnb',  settings.ical_airbnb)
  set('ical-booking', settings.ical_booking)

  updateModeButtons(_currentBookingMode)

  // Load last iCal sync metadata
  try {
    const syncSnap = await getDoc(doc(db, 'config', 'ical_sync'))
    if (syncSnap.exists()) {
      const { lastSync, datesBlocked, eventsCount } = syncSnap.data()
      const date = lastSync?.toDate ? lastSync.toDate() : new Date(lastSync)
      const el = document.getElementById('ical-last-sync')
      if (el) el.textContent = `${date.toLocaleString('fr-FR')} · ${eventsCount || 0} événements · ${datesBlocked || 0} jours bloqués`
      document.getElementById('ical-sync-status')?.classList.remove('hidden')
    }
  } catch (e) { /* silently ignore */ }

  document.getElementById('mode-direct')?.addEventListener('click', () => {
    _currentBookingMode = 'direct'
    updateModeButtons('direct')
  })
  document.getElementById('mode-ota')?.addEventListener('click', () => {
    _currentBookingMode = 'ota_only'
    updateModeButtons('ota_only')
  })

  document.getElementById('save-settings-btn')?.addEventListener('click', saveSettingsHandler, { once: true })
  document.getElementById('manual-sync-btn')?.addEventListener('click', manualIcalSync, { once: true })
}

function updateModeButtons(mode) {
  const directBtn = document.getElementById('mode-direct')
  const otaBtn    = document.getElementById('mode-ota')
  const otaPanel  = document.getElementById('ota-links-panel')

  if (directBtn) {
    directBtn.classList.toggle('border-amber-500', mode === 'direct')
    directBtn.classList.toggle('bg-amber-50',      mode === 'direct')
    directBtn.classList.toggle('border-stone-200', mode !== 'direct')
  }
  if (otaBtn) {
    otaBtn.classList.toggle('border-amber-500', mode === 'ota_only')
    otaBtn.classList.toggle('bg-amber-50',      mode === 'ota_only')
    otaBtn.classList.toggle('border-stone-200', mode !== 'ota_only')
  }
  otaPanel?.classList.toggle('hidden', mode !== 'ota_only')
}

async function saveSettingsHandler() {
  const btn     = document.getElementById('save-settings-btn')
  const spinner = document.getElementById('save-settings-spinner')
  const btnText = document.getElementById('save-settings-text')

  const data = {
    booking_mode: _currentBookingMode,
    url_airbnb:   document.getElementById('url-airbnb')?.value?.trim()   || '',
    url_booking:  document.getElementById('url-booking')?.value?.trim()  || '',
    ical_airbnb:  document.getElementById('ical-airbnb')?.value?.trim()  || '',
    ical_booking: document.getElementById('ical-booking')?.value?.trim() || '',
  }

  btn.disabled = true
  spinner?.classList.remove('hidden')
  if (btnText) btnText.textContent = 'Sauvegarde…'

  try {
    await saveBookingSettings(data)
    showSettingsAlert('✅ Réglages mis à jour. Les visiteurs verront le changement dans 30 min.', 'success')
  } catch (err) {
    showSettingsAlert(`❌ Erreur : ${err.message}`, 'error')
  } finally {
    btn.disabled = false
    spinner?.classList.add('hidden')
    if (btnText) btnText.textContent = 'Sauvegarder les réglages'
    btn?.addEventListener('click', saveSettingsHandler, { once: true })
  }
}

async function manualIcalSync() {
  const btn     = document.getElementById('manual-sync-btn')
  const spinner = document.getElementById('manual-sync-spinner')
  const btnText = document.getElementById('manual-sync-text')
  const result  = document.getElementById('ical-result')

  btn.disabled = true
  spinner?.classList.remove('hidden')
  if (btnText) btnText.textContent = 'Synchronisation…'
  result?.classList.add('hidden')

  try {
    const { auth, FUNCTIONS_BASE_URL } = await import('./modules/firebase-config.js')
    const { getAuth } = await import('firebase/auth')
    const token = await getAuth().currentUser?.getIdToken()
    if (!token) throw new Error('Non authentifié')

    const res = await fetch(`${FUNCTIONS_BASE_URL}/manualSyncIcal`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `HTTP ${res.status}`)
    }
    const data = await res.json()
    if (result) {
      result.className = 'mt-4 rounded-xl p-3 text-sm bg-emerald-50 text-emerald-700 border border-emerald-200'
      result.textContent = `✅ Synchronisé : ${data.events || 0} événements · ${data.synced || 0} jours bloqués (${data.sources || 0} source${data.sources > 1 ? 's' : ''})`
      result.classList.remove('hidden')
    }
    // Refresh last sync display
    document.getElementById('ical-last-sync')?.parentElement?.classList.remove('hidden')
    const lastSyncEl = document.getElementById('ical-last-sync')
    if (lastSyncEl) lastSyncEl.textContent = `${new Date().toLocaleString('fr-FR')} · ${data.events || 0} événements · ${data.synced || 0} jours bloqués`
    document.getElementById('ical-sync-status')?.classList.remove('hidden')
  } catch (err) {
    if (result) {
      result.className = 'mt-4 rounded-xl p-3 text-sm bg-red-50 text-red-700 border border-red-200'
      result.textContent = `❌ Erreur : ${err.message}`
      result.classList.remove('hidden')
    }
  } finally {
    btn.disabled = false
    spinner?.classList.add('hidden')
    if (btnText) btnText.textContent = '🔄 Synchroniser maintenant'
    btn?.addEventListener('click', manualIcalSync, { once: true })
  }
}

function showSettingsAlert(msg, type) {
  const el = document.getElementById('settings-alert')
  if (!el) return
  el.className = `mb-5 rounded-xl p-4 text-sm font-medium ${
    type === 'success'
      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
      : 'bg-red-50 text-red-700 border border-red-200'
  }`
  el.textContent = msg
  el.classList.remove('hidden')
  if (type === 'success') setTimeout(() => el.classList.add('hidden'), 5000)
}

// ==================== START ====================

init().catch(console.error)
