/**
 * Page Transitions — View Transitions API (MPA)
 *
 * Direction automatique :
 *   / → /reservation  = slide ← (vers l'avant)
 *   /reservation → /  = slide → (retour)
 *   /* → /guest       = slide up (modal-like)
 *   /* → /admin       = fade
 */

// Ordre de profondeur des pages pour déterminer la direction
const PAGE_DEPTH = {
  '/':                0,
  '/index.html':      0,
  '/reservation':     1,
  '/reservation.html':1,
  '/guest':           2,
  '/guest.html':      2,
  '/admin':           3,
  '/admin.html':      3,
}

function getDepth(pathname) {
  const key = Object.keys(PAGE_DEPTH).find(k => pathname.endsWith(k) || pathname === k)
  return key !== undefined ? PAGE_DEPTH[key] : 1
}

function getTransitionType(from, to) {
  const fromDepth = getDepth(from)
  const toDepth   = getDepth(to)
  if (toDepth === 3) return 'fade'        // admin = fade discret
  if (toDepth > fromDepth) return 'forward' // vers l'avant → slide-left
  if (toDepth < fromDepth) return 'back'    // retour → slide-right
  return 'fade'
}

/**
 * Initialise les transitions entre pages.
 * À appeler dans chaque entry point.
 */
export function initPageTransitions() {
  if (!document.startViewTransition) {
    // Fallback : simple fade via classe CSS
    initFallbackTransitions()
    return
  }

  // Intercepter tous les clics sur liens internes
  document.addEventListener('click', handleLinkClick, { capture: true })

  // Animer l'entrée initiale de la page
  document.documentElement.dataset.transitioning = 'in'
  requestAnimationFrame(() => {
    document.documentElement.removeAttribute('data-transitioning')
  })
}

function handleLinkClick(e) {
  const anchor = e.composedPath().find(el => el.tagName === 'A')
  if (!anchor) return

  const href = anchor.getAttribute('href')
  if (!href) return

  // Ignorer : liens externes, hash-only, nouveaux onglets, téléchargements
  if (
    anchor.target === '_blank' ||
    anchor.download ||
    href.startsWith('http') ||
    href.startsWith('mailto:') ||
    href.startsWith('tel:') ||
    href.startsWith('#')
  ) return

  // Lien interne → transition
  const dest = new URL(href, window.location.origin)
  if (dest.origin !== window.location.origin) return

  e.preventDefault()

  const type = getTransitionType(window.location.pathname, dest.pathname)
  document.documentElement.dataset.transitionType = type

  document.startViewTransition(() => {
    window.location.href = dest.href
  })
}

// Fallback pour Safari < 18 / Firefox
function initFallbackTransitions() {
  document.body.classList.add('page-enter')
  requestAnimationFrame(() => {
    requestAnimationFrame(() => document.body.classList.remove('page-enter'))
  })

  document.addEventListener('click', e => {
    const anchor = e.composedPath().find(el => el.tagName === 'A')
    if (!anchor || anchor.target === '_blank') return
    const href = anchor.getAttribute('href')
    if (!href || href.startsWith('#') || href.startsWith('http') || href.startsWith('mailto:')) return

    e.preventDefault()
    document.body.classList.add('page-leave')
    setTimeout(() => { window.location.href = href }, 220)
  })
}
