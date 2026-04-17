/**
 * Reviews Module
 * Smart review strategy : affichage des avis + demande au bon moment
 */

// ==================== STATIC REVIEWS ====================
// Remplacer par vos vrais avis (ou les charger depuis Firestore)
const REVIEWS = [
  {
    id: 1,
    name: "Marie L.",
    date: "Août 2024",
    rating: 5,
    text: "Séjour absolument parfait ! La villa est magnifique avec une piscine chauffée et une vue incroyable. L'hôte est très réactif et de bon conseil. On reviendra sans hésiter.",
    source: "Airbnb",
    avatar: "ML",
    verified: true,
  },
  {
    id: 2,
    name: "Thomas & Sophie",
    date: "Juillet 2024",
    rating: 5,
    text: "Nous avons passé une semaine de rêve. La maison est parfaitement équipée, très propre et l'emplacement est idéal. Les recommandations de l'hôte sont très utiles.",
    source: "Booking.com",
    avatar: "TS",
    verified: true,
  },
  {
    id: 3,
    name: "Claire M.",
    date: "Juin 2024",
    rating: 5,
    text: "Villa conforme aux photos, voire encore plus belle en vrai ! Piscine parfaite, cuisine très bien équipée. Arrivée facilité grâce à l'application. Je recommande à 100%.",
    source: "Direct",
    avatar: "CM",
    verified: true,
  },
  {
    id: 4,
    name: "Philippe D.",
    date: "Mai 2024",
    rating: 4,
    text: "Très bonne expérience globale. La villa est spacieuse et bien entretenue. Quelques équipements à améliorer mais l'hôte est très arrangeant. Super rapport qualité/prix.",
    source: "Airbnb",
    avatar: "PD",
    verified: true,
  },
  {
    id: 5,
    name: "Julie & Marc",
    date: "Septembre 2024",
    rating: 5,
    text: "Notre 3ème séjour ici et toujours aussi magique ! La villa est notre coup de cœur absolu. Piscine, vue, calme... tout est parfait. Merci encore !",
    source: "Direct",
    avatar: "JM",
    verified: true,
  },
  {
    id: 6,
    name: "Isabelle F.",
    date: "Août 2024",
    rating: 5,
    text: "Villa de charme avec tout le confort. L'accès WiFi via l'application est très pratique. Les alentours sont magnifiques. On recommande à toute notre famille.",
    source: "Booking.com",
    avatar: "IF",
    verified: true,
  },
];

// ==================== RENDER ON HOMEPAGE ====================

export function renderReviews(containerId = 'reviews-grid') {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = REVIEWS.map(review => createReviewCard(review)).join('');
}

function createReviewCard(review) {
  const stars = '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating);
  const sourceColor = {
    'Airbnb': 'bg-red-100 text-red-700',
    'Booking.com': 'bg-blue-100 text-blue-700',
    'Google': 'bg-emerald-100 text-emerald-700',
    'Direct': 'bg-amber-100 text-amber-700',
  }[review.source] || 'bg-stone-100 text-stone-600';

  const avatarColors = [
    'bg-violet-500', 'bg-blue-500', 'bg-emerald-500',
    'bg-amber-500', 'bg-rose-500', 'bg-teal-500',
  ];
  const avatarColor = avatarColors[review.id % avatarColors.length];

  return `
    <div class="bg-white rounded-2xl p-5 shadow-sm border border-stone-100 hover:shadow-md transition-shadow flex flex-col">
      <div class="flex items-start justify-between mb-3">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-full ${avatarColor} flex items-center justify-center text-white font-semibold text-xs flex-shrink-0">
            ${review.avatar}
          </div>
          <div>
            <div class="font-semibold text-stone-800 text-sm">${review.name}</div>
            <div class="text-xs text-stone-400">${review.date}</div>
          </div>
        </div>
        <span class="text-xs px-2 py-0.5 rounded-full ${sourceColor} flex-shrink-0">${review.source}</span>
      </div>

      <div class="text-yellow-400 text-sm mb-2">${stars}</div>

      <p class="text-stone-600 text-sm leading-relaxed flex-1">"${review.text}"</p>

      ${review.verified ? `
        <div class="flex items-center gap-1 mt-3 text-xs text-emerald-600">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>
          </svg>
          Séjour vérifié
        </div>
      ` : ''}
    </div>
  `;
}

// ==================== AVERAGE RATING ====================

export function getAverageRating() {
  const avg = REVIEWS.reduce((sum, r) => sum + r.rating, 0) / REVIEWS.length;
  return Math.round(avg * 10) / 10;
}

// ==================== SMART REVIEW REQUEST ====================

/**
 * Schedules or immediately shows review request based on stay phase:
 * - During stay (2h before checkout): soft nudge
 * - After checkout: direct prompt
 * - 24h after checkout (via Firebase Messaging): push notification
 */
export function smartReviewRequest(booking, googlePlaceId) {
  if (!booking) return;

  const checkOut = new Date(booking.checkOut);
  checkOut.setHours(11, 0, 0, 0); // 11:00 checkout

  const now = new Date();
  const hoursAfterCheckout = (now - checkOut) / 3600000;

  const googleReviewUrl = `https://g.page/r/${googlePlaceId}/review`;

  if (now > checkOut) {
    // Post-stay: show prominent review CTA
    showPostStayReviewPrompt(googleReviewUrl);
  } else {
    const hoursBeforeCheckout = (checkOut - now) / 3600000;
    if (hoursBeforeCheckout <= 2) {
      // 2h before checkout: gentle reminder
      showPreCheckoutReviewNudge(googleReviewUrl);
    }
  }
}

function showPostStayReviewPrompt(url) {
  const container = document.getElementById('review-post-stay');
  if (container) {
    container.classList.remove('hidden');
    document.getElementById('review-before-departure')?.classList.add('hidden');
  }

  // Also show a toast after 5 seconds
  setTimeout(() => {
    const toast = document.createElement('div');
    toast.className = 'fixed bottom-20 left-4 right-4 sm:bottom-4 sm:left-auto sm:right-4 sm:max-w-sm z-50 bg-white rounded-2xl shadow-2xl p-4 border border-amber-200';
    toast.innerHTML = `
      <div class="flex items-start gap-3">
        <span class="text-2xl">⭐</span>
        <div class="flex-1">
          <div class="font-semibold text-stone-800 text-sm">Votre avis nous aide beaucoup !</div>
          <div class="text-xs text-stone-500 mt-0.5">2 minutes pour partager votre expérience sur Google</div>
          <div class="flex gap-2 mt-2">
            <a href="${url}" target="_blank" class="bg-amber-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg">
              Laisser un avis
            </a>
            <button onclick="this.closest('[class*=fixed]').remove()" class="text-stone-400 text-xs px-2">
              Plus tard
            </button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 15000);
  }, 5000);
}

function showPreCheckoutReviewNudge(url) {
  const tab = document.querySelector('[data-tab-target="tab-review"]');
  if (tab) {
    tab.classList.add('ring-2', 'ring-amber-400', 'ring-offset-2');
    setTimeout(() => tab.classList.remove('ring-2', 'ring-amber-400', 'ring-offset-2'), 5000);
  }
}
