/**
 * reservation.js — Entry point page réservation
 */
import './styles/main.css'
import { registerServiceWorker } from './modules/pwa.js'
import { fetchAvailability, renderCalendar, prevMonth, nextMonth, setGuests, restoreFromSession, initPricing } from './modules/calendar.js'
import { initBookingSteps, initStripe, goBackStep } from './modules/booking.js'
import { initPageTransitions } from './modules/transitions.js'
import { initStepSwipe } from './modules/swipe.js'
import { getBookingSettings } from './modules/firebase-config.js'

async function init() {
  initPageTransitions()
  await registerServiceWorker()

  const settings = await getBookingSettings()
  if (settings.booking_mode === 'ota_only') {
    document.getElementById('reservation-main')?.classList.add('hidden')
    const screen = document.getElementById('ota-mode-screen')
    if (screen) {
      screen.classList.remove('hidden')
      const a = document.getElementById('ota-res-airbnb')
      const b = document.getElementById('ota-res-booking')
      if (a && settings.url_airbnb)  a.href = settings.url_airbnb
      if (b && settings.url_booking) b.href = settings.url_booking
    }
    return
  }

  restoreFromSession()
  await Promise.all([initPricing(), fetchAvailability()])

  renderCalendar('cal2-grid', 'cal2-title', { compact: true })

  document.getElementById('cal2-prev')?.addEventListener('click', () => prevMonth('cal2-grid', 'cal2-title', { compact: true }))
  document.getElementById('cal2-next')?.addEventListener('click', () => nextMonth('cal2-grid', 'cal2-title', { compact: true }))

  const guests = parseInt(sessionStorage.getItem('villa_guests') || '2')
  setGuests(guests)

  initBookingSteps()
  initStepSwipe('#reservation-form', goBackStep)

  // Stripe chargé uniquement quand l'utilisateur arrive à l'étape 3
  const observer = new MutationObserver(() => {
    const step3 = document.getElementById('step3')
    if (step3 && !step3.classList.contains('hidden')) {
      initStripe()
      observer.disconnect()
    }
  })
  const main = document.querySelector('main')
  if (main) observer.observe(main, { subtree: true, attributeFilter: ['class'] })

  // Réactiver le bouton si les dates viennent du calendrier home
  const ci = sessionStorage.getItem('villa_checkin')
  const co = sessionStorage.getItem('villa_checkout')
  if (ci && co) document.getElementById('to-step2')?.removeAttribute('disabled')
}

init().catch(console.error)
