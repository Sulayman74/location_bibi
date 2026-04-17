/**
 * Swipe Module
 * Gestures tactiles via Pointer Events API (unifié touch + mouse)
 *
 * Utilisé pour :
 *  - Tabs du portail invité (guest.html)
 *  - Étapes de réservation (reservation.html) — retour seulement
 *  - Slider hero (index.html)
 *  - Tabs des recommandations
 */

// ==================== CORE SWIPE DETECTOR ====================

/**
 * Attache un détecteur de swipe horizontal sur un élément.
 * Respecte le scroll vertical natif (touch-action: pan-y).
 *
 * @param {HTMLElement} element
 * @param {object}      opts
 * @param {Function}    opts.onLeft      — swipe vers la gauche (→ suivant)
 * @param {Function}    opts.onRight     — swipe vers la droite (← précédent)
 * @param {number}      [opts.threshold=50]  — px minimum
 * @param {number}      [opts.velocityMin=0.3] — px/ms minimum
 * @returns {Function}  cleanup() — removeEventListeners
 */
export function addSwipe(element, { onLeft, onRight, threshold = 50, velocityMin = 0.3 } = {}) {
  let startX = 0
  let startY = 0
  let startTime = 0
  let tracking = false

  const onDown = e => {
    // Ignorer si l'événement vient d'un input / bouton
    if (e.target.closest('button, input, select, textarea, a')) return
    startX    = e.clientX
    startY    = e.clientY
    startTime = Date.now()
    tracking  = true
    element.setPointerCapture?.(e.pointerId)
  }

  const onUp = e => {
    if (!tracking) return
    tracking = false

    const dx      = e.clientX - startX
    const dy      = e.clientY - startY
    const dt      = Date.now() - startTime
    const velocity = Math.abs(dx) / dt

    // Ignorer si le déplacement est principalement vertical
    if (Math.abs(dy) > Math.abs(dx) * 1.5) return

    if (Math.abs(dx) >= threshold && velocity >= velocityMin) {
      if (dx < 0) onLeft?.()
      else onRight?.()
    }
  }

  const onCancel = () => { tracking = false }

  element.addEventListener('pointerdown', onDown)
  element.addEventListener('pointerup',   onUp)
  element.addEventListener('pointercancel', onCancel)

  // Retourner un cleanup
  return () => {
    element.removeEventListener('pointerdown', onDown)
    element.removeEventListener('pointerup',   onUp)
    element.removeEventListener('pointercancel', onCancel)
  }
}

// ==================== TAB SWIPE ====================

/**
 * Ajoute le swipe sur un conteneur de tabs.
 * L'ordre des tabs est déterminé par data-tab-target sur les boutons.
 *
 * @param {string} containerSelector — élément qui reçoit le swipe (ex: '#guest-content')
 * @param {string} tabBtnSelector    — sélecteur des boutons (ex: '[data-tab-target]')
 * @param {Function} navigateToTab   — callback(tabId: string)
 */
export function initTabSwipe(containerSelector, tabBtnSelector, navigateToTab) {
  const container = document.querySelector(containerSelector)
  if (!container) return

  const getTabIds = () =>
    [...document.querySelectorAll(tabBtnSelector)]
      .filter((el, idx, arr) => arr.findIndex(b => b.dataset.tabTarget === el.dataset.tabTarget) === idx)
      .map(b => b.dataset.tabTarget)

  const getActiveTab = () =>
    document.querySelector('.tab-panel.active')?.id ||
    getTabIds()[0]

  return addSwipe(container, {
    threshold: 60,
    onLeft: () => {
      const tabs    = getTabIds()
      const current = getActiveTab()
      const idx     = tabs.indexOf(current)
      if (idx < tabs.length - 1) navigateToTab(tabs[idx + 1])
    },
    onRight: () => {
      const tabs    = getTabIds()
      const current = getActiveTab()
      const idx     = tabs.indexOf(current)
      if (idx > 0) navigateToTab(tabs[idx - 1])
    },
  })
}

// ==================== STEP SWIPE (réservation) ====================

/**
 * Swipe retour uniquement sur le formulaire de réservation.
 * Le swipe vers l'avant est volontairement désactivé (sécurité paiement).
 */
export function initStepSwipe(containerSelector, goBack) {
  const container = document.querySelector(containerSelector)
  if (!container) return

  return addSwipe(container, {
    threshold: 80, // seuil plus haut pour éviter les faux positifs
    onRight: goBack, // swipe droite = retour
  })
}

// ==================== HERO SLIDER ====================

const HERO_IMAGES = [
  { src: 'https://a0.muscache.com/im/pictures/hosting/Hosting-602554771321363177/original/e9e4d04d-a540-4a3c-b096-40cfe5ec7834.jpeg?im_w=1200', alt: "La Cabine du Cap d'Agde vue extérieure"},
  { src: 'https://a0.muscache.com/im/pictures/hosting/Hosting-602554771321363177/original/e9e4d04d-a540-4a3c-b096-40cfe5ec7834.jpeg?im_w=1920', alt: 'Piscine de la villa' },
  { src: 'https://a0.muscache.com/im/pictures/hosting/Hosting-602554771321363177/original/1c4d5bb7-5dc2-4583-b155-d593913dde40.jpeg?im_w=1200', alt: 'Chambre principale' },
  { src: 'https://a0.muscache.com/im/pictures/hosting/Hosting-602554771321363177/original/5c19bfdb-a58f-44f1-94b9-64cb68510609.jpeg?im_w=1920', alt: 'Cuisine moderne' },
]

/**
 * Initialise le slider hero avec swipe + autoplay + dots.
 */
export function initHeroSlider() {
  const img       = document.getElementById('hero-img')
  const section   = document.querySelector('.hero-slider-section') || img?.closest('section')
  if (!img || !section) return

  let current     = 0
  let autoplayTimer = null
  let isTransitioning = false

  // Créer les dots
  const dotsContainer = document.createElement('div')
  dotsContainer.className = 'absolute bottom-20 left-1/2 -translate-x-1/2 flex gap-2 z-20'
  dotsContainer.setAttribute('aria-label', 'Navigation du diaporama')
  HERO_IMAGES.forEach((_, i) => {
    const dot = document.createElement('button')
    dot.className = `w-2 h-2 rounded-full transition-all duration-300 ${i === 0 ? 'bg-white w-5' : 'bg-white/50'}`
    dot.setAttribute('aria-label', `Photo ${i + 1}`)
    dot.addEventListener('click', () => goTo(i))
    dotsContainer.appendChild(dot)
  })
  section.style.position = 'relative'
  section.appendChild(dotsContainer)

  function updateDots() {
    dotsContainer.querySelectorAll('button').forEach((dot, i) => {
      dot.className = `rounded-full transition-all duration-300 h-2 ${
        i === current ? 'bg-white w-5' : 'bg-white/50 w-2'
      }`
    })
  }

  function goTo(index, direction = 'left') {
    if (isTransitioning || index === current) return
    isTransitioning = true

    const entering = direction === 'left' ? 'slide-in-right' : 'slide-in-left'
    const leaving  = direction === 'left' ? 'slide-out-left' : 'slide-out-right'

    // Créer l'image entrante en overlay
    const next = document.createElement('img')
    next.src       = HERO_IMAGES[index].src
    next.alt       = HERO_IMAGES[index].alt
    next.className = `absolute inset-0 w-full h-full object-cover opacity-80 ${entering}`
    next.style.zIndex = '1'
    img.parentElement.appendChild(next)

    img.classList.add(leaving)

    next.addEventListener('animationend', () => {
      img.src       = HERO_IMAGES[index].src
      img.alt       = HERO_IMAGES[index].alt
      img.className = 'w-full h-full object-cover opacity-80'
      next.remove()
      isTransitioning = false
      current = index
      updateDots()
    }, { once: true })
  }

  function next()     { goTo((current + 1) % HERO_IMAGES.length, 'left')  }
  function prev()     { goTo((current - 1 + HERO_IMAGES.length) % HERO_IMAGES.length, 'right') }

  function startAutoplay() {
    stopAutoplay()
    autoplayTimer = setInterval(next, 5000)
  }
  function stopAutoplay() {
    if (autoplayTimer) clearInterval(autoplayTimer)
  }

  // Swipe sur le hero
  addSwipe(section, {
    threshold: 60,
    onLeft:  () => { stopAutoplay(); next(); startAutoplay() },
    onRight: () => { stopAutoplay(); prev(); startAutoplay() },
  })

  // Pause au hover (desktop)
  section.addEventListener('mouseenter', stopAutoplay)
  section.addEventListener('mouseleave', startAutoplay)

  // Keyboard
  document.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft')  prev()
    if (e.key === 'ArrowRight') next()
  })

  startAutoplay()
}

// ==================== RECOMMANDATIONS SWIPE ====================

/**
 * Swipe horizontal sur les tabs de recommandations (index.html)
 */
export function initRecommendationSwipe() {
  const tabs = document.getElementById('rec-tabs')
  if (!tabs) return

  const tabOrder = ['plages', 'restaurants', 'activites', 'commerces']

  const getActive = () =>
    tabs.querySelector('.rec-tab.bg-amber-500')?.dataset.tab || tabOrder[0]

  addSwipe(document.getElementById('rec-content') || document.body, {
    threshold: 70,
    onLeft: () => {
      const idx = tabOrder.indexOf(getActive())
      if (idx < tabOrder.length - 1) {
        tabs.querySelector(`[data-tab="${tabOrder[idx + 1]}"]`)?.click()
      }
    },
    onRight: () => {
      const idx = tabOrder.indexOf(getActive())
      if (idx > 0) {
        tabs.querySelector(`[data-tab="${tabOrder[idx - 1]}"]`)?.click()
      }
    },
  })
}
