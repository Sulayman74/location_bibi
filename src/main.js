/**
 * main.js — Entry point page d'accueil (index.html)
 */
import './styles/main.css'
import { registerServiceWorker, initInstallPrompt } from './modules/pwa.js'
import { fetchAvailability, renderCalendar, prevMonth, nextMonth, getNextAvailableDate, initPricing } from './modules/calendar.js'
import { initRecommendationTabs } from './modules/recommendations.js'
import { renderReviews } from './modules/reviews.js'
import { initPageTransitions } from './modules/transitions.js'
import { initHeroSlider, initRecommendationSwipe } from './modules/swipe.js'

async function init() {
  // 1. Initialisation UI immédiate (Indépendant du réseau)
  initPageTransitions()
  initNavbar()
  initScrollAnimations()

  // Menu mobile : Doit être dispo tout de suite
  const burgerBtn = document.getElementById('mobile-menu-btn')
  const mobileMenu = document.getElementById('mobile-menu')
  burgerBtn?.addEventListener('click', () => {
    mobileMenu?.classList.toggle('hidden')
  })

  // Fermer le menu mobile sur un lien
  document.querySelectorAll('#mobile-menu a').forEach(a => {
    a.addEventListener('click', () => mobileMenu?.classList.add('hidden'))
  })

  // 2. Initialisation des composants UI secondaires
  initRecommendationTabs('rec-tabs', 'rec-content')
  initRecommendationSwipe()
  renderReviews('reviews-grid')
  initHeroSlider()

  // 3. Appels réseau (Asynchrones, ne doivent pas bloquer l'UI)
  try {
    registerServiceWorker() // Ne pas awaiter pour ne pas bloquer le reste
    initInstallPrompt()
  } catch (e) { console.warn('PWA init error:', e) }

  try {
    const [pricing] = await Promise.all([initPricing(), fetchAvailability()])
    // Update dynamic price display in hero/sticky bar
    if (pricing?.low) {
      document.querySelectorAll('[data-price-from]').forEach(el => {
        el.textContent = pricing.low + '€'
      })
    }
    renderCalendar('calendar-grid', 'calendar-title')

    document.getElementById('prev-month')?.addEventListener('click', () => prevMonth('calendar-grid', 'calendar-title'))
    document.getElementById('next-month')?.addEventListener('click', () => nextMonth('calendar-grid', 'calendar-title'))

    // Prochain dispo dans le hero
    const next = getNextAvailableDate()
    const el = document.getElementById('next-available')
    if (el && next) {
      el.textContent = next.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
    }
  } catch (err) {
    console.error('[Main] Calendar/Availability error:', err)
    // Fallback: render calendar even without fetch
    renderCalendar('calendar-grid', 'calendar-title')
  }
}

function initNavbar() {
  const navbar = document.getElementById('navbar')
  if (!navbar) return
  const update = () => {
    const scrolled = window.scrollY > 80
    navbar.classList.toggle('bg-white', scrolled)
    navbar.classList.toggle('shadow-md', scrolled)
    navbar.querySelectorAll('a.nav-link').forEach(a => {
      a.classList.toggle('text-stone-700', scrolled)
      a.classList.toggle('text-white/90', !scrolled)
    })
  }
  window.addEventListener('scroll', update, { passive: true })
  update()
}

function initScrollAnimations() {
  const observer = new IntersectionObserver(
    entries => entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.style.animationPlayState = 'running'
        observer.unobserve(e.target)
      }
    }),
    { threshold: 0.1 }
  )
  document.querySelectorAll('[class*="animate-"]').forEach(el => {
    el.style.animationPlayState = 'paused'
    observer.observe(el)
  })
}

init().catch(console.error)
