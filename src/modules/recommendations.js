/**
 * Recommendations Module
 * Adresses et activités aux alentours - données configurables
 */

// Configuration des recommandations (remplacer par vos vraies adresses)
export const RECOMMENDATIONS = {
  plages: [
    {
      name: "Plage du Midi",
      description: "Grande plage de sable fin, idéale pour les familles",
      distance: "800m",
      duration: "10 min à pied",
      tags: ["Sable fin", "Parasols", "Restaurants"],
      mapUrl: "https://maps.google.com/?q=Plage+du+Midi",
      rating: 4.7,
      reviews: 1240,
    },
    {
      name: "Calanque de Sugiton",
      description: "Calanque sauvage, eau turquoise cristalline",
      distance: "3km",
      duration: "15 min en voiture",
      tags: ["Randonnée", "Snorkeling", "Sauvage"],
      mapUrl: "https://maps.google.com/?q=Calanque+Sugiton",
      rating: 4.9,
      reviews: 890,
    },
    {
      name: "Plage des Catalans",
      description: "Plage urbaine animée avec vue sur les îles",
      distance: "1.5km",
      duration: "20 min à pied",
      tags: ["Animée", "Accès facile", "Snack"],
      mapUrl: "https://maps.google.com/?q=Plage+Catalans",
      rating: 4.2,
      reviews: 2100,
    },
  ],
  restaurants: [
    {
      name: "Chez Fonfon",
      description: "Bouillabaisse authentique, cadre exceptionnel dans une calanque",
      distance: "2km",
      duration: "10 min en voiture",
      tags: ["Fruits de mer", "Bouillabaisse", "Vue mer"],
      mapUrl: "https://maps.google.com/?q=Chez+Fonfon+Marseille",
      rating: 4.6,
      reviews: 1890,
      priceRange: "€€€",
    },
    {
      name: "La Table du Fort",
      description: "Cuisine provençale de qualité, terrasse ombragée",
      distance: "600m",
      duration: "7 min à pied",
      tags: ["Provençal", "Terrasse", "Local"],
      mapUrl: "https://maps.google.com/?q=La+Table+du+Fort",
      rating: 4.4,
      reviews: 340,
      priceRange: "€€",
    },
    {
      name: "Café Populaire",
      description: "Bistrot vintage, brunch le week-end, terrasse ensoleillée",
      distance: "900m",
      duration: "10 min à pied",
      tags: ["Brunch", "Cocktails", "Ambiance"],
      mapUrl: "https://maps.google.com/?q=Café+Populaire+Marseille",
      rating: 4.5,
      reviews: 780,
      priceRange: "€€",
    },
  ],
  activites: [
    {
      name: "Kayak en Calanques",
      description: "Location de kayak pour explorer les calanques depuis la mer",
      distance: "1km",
      duration: "15 min à pied",
      tags: ["Sport nautique", "Nature", "Famille"],
      mapUrl: "https://maps.google.com/?q=Kayak+Calanques",
      rating: 4.8,
      reviews: 220,
      priceRange: "À partir de 25€/h",
    },
    {
      name: "Château d'If",
      description: "Prison célèbre du Comte de Monte-Cristo, navette depuis le Vieux-Port",
      distance: "4km",
      duration: "20 min en bateau",
      tags: ["Histoire", "Île", "Culture"],
      mapUrl: "https://maps.google.com/?q=Château+If",
      rating: 4.5,
      reviews: 3400,
      priceRange: "12€/pers",
    },
    {
      name: "MuCEM",
      description: "Musée des Civilisations de l'Europe et de la Méditerranée",
      distance: "5km",
      duration: "25 min en bus",
      tags: ["Culture", "Architecture", "Vue mer"],
      mapUrl: "https://maps.google.com/?q=MuCEM+Marseille",
      rating: 4.4,
      reviews: 5600,
      priceRange: "11€/pers",
    },
  ],
  commerces: [
    {
      name: "Marché de Noailles",
      description: "Marché coloré pour fruits, légumes et épices du monde",
      distance: "1.2km",
      duration: "15 min à pied",
      tags: ["Marché", "Frais", "Exotique"],
      mapUrl: "https://maps.google.com/?q=Marché+Noailles",
      rating: 4.3,
      reviews: 890,
      schedule: "Tous les jours 7h-13h",
    },
    {
      name: "Carrefour Market",
      description: "Supermarché complet pour vos courses du quotidien",
      distance: "400m",
      duration: "5 min à pied",
      tags: ["Courses", "Ouvert tard", "Pratique"],
      mapUrl: "https://maps.google.com/?q=Carrefour",
      rating: 3.9,
      reviews: 1200,
      schedule: "7h-22h",
    },
    {
      name: "Pharmacie du Midi",
      description: "Pharmacie de garde, ouverte le week-end",
      distance: "300m",
      duration: "4 min à pied",
      tags: ["Santé", "Urgence", "Garde"],
      mapUrl: "https://maps.google.com/?q=Pharmacie",
      rating: 4.2,
      reviews: 180,
      schedule: "8h30-19h30",
    },
  ],
};

// ==================== RENDER ====================

export function renderRecommendations(containerId = 'rec-content', category = 'plages') {
  const container = document.getElementById(containerId);
  if (!container) return;

  const items = RECOMMENDATIONS[category] || [];
  container.innerHTML = items.map(item => createCard(item)).join('');
}

function createCard(item) {
  const stars = item.rating ? renderStars(item.rating) : '';
  const priceTag = item.priceRange
    ? `<span class="text-xs bg-stone-100 text-stone-600 px-2 py-0.5 rounded-full">${item.priceRange}</span>`
    : '';

  return `
    <div class="bg-white rounded-2xl p-4 shadow-sm border border-stone-100 hover:shadow-md transition-shadow">
      <div class="flex items-start justify-between gap-2 mb-2">
        <div class="font-semibold text-stone-800 text-sm leading-tight">${item.name}</div>
        ${priceTag}
      </div>
      <p class="text-xs text-stone-500 mb-3 leading-relaxed">${item.description}</p>

      <div class="flex flex-wrap gap-1.5 mb-3">
        ${item.tags.map(tag => `<span class="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full">${tag}</span>`).join('')}
      </div>

      <div class="flex items-center justify-between">
        <div class="text-xs text-stone-400">
          📍 ${item.distance} · ${item.duration}
          ${item.schedule ? `<br>🕐 ${item.schedule}` : ''}
        </div>
        ${stars ? `
          <div class="flex items-center gap-1 text-xs text-stone-500">
            <span class="text-yellow-400">★</span>
            <span>${item.rating}</span>
            <span class="text-stone-300">(${item.reviews})</span>
          </div>
        ` : ''}
      </div>

      ${item.mapUrl ? `
        <a href="${item.mapUrl}" target="_blank" rel="noopener"
          class="mt-3 flex items-center justify-center gap-1.5 text-xs font-medium text-amber-600 hover:text-amber-700 border border-amber-200 hover:border-amber-300 py-2 rounded-xl transition w-full">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/>
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>
          </svg>
          Voir sur Google Maps
        </a>
      ` : ''}
    </div>
  `;
}

function renderStars(rating) {
  const full  = Math.floor(rating);
  const half  = rating % 1 >= 0.5 ? 1 : 0;
  const empty = 5 - full - half;
  return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(empty);
}

// ==================== TAB LOGIC ====================

export function initRecommendationTabs(tabsId = 'rec-tabs', contentId = 'rec-content') {
  const tabsEl = document.getElementById(tabsId);
  if (!tabsEl) return;

  // Render initial
  renderRecommendations(contentId, 'plages');

  tabsEl.addEventListener('click', e => {
    const btn = e.target.closest('[data-tab]');
    if (!btn) return;

    const category = btn.dataset.tab;
    tabsEl.querySelectorAll('.rec-tab').forEach(t => {
      t.classList.toggle('bg-amber-500', t === btn);
      t.classList.toggle('text-white', t === btn);
      t.classList.toggle('bg-white', t !== btn);
      t.classList.toggle('text-stone-600', t !== btn);
    });

    renderRecommendations(contentId, category);
  });
}

// ==================== GUEST PAGE MINI-LIST ====================

export function renderGuestRecommendations(containerId = 'guest-recommendations') {
  const container = document.getElementById(containerId);
  if (!container) return;

  const allItems = Object.entries(RECOMMENDATIONS).flatMap(([cat, items]) =>
    items.slice(0, 2).map(item => ({ ...item, category: cat }))
  );

  const icons = { plages: '🏖', restaurants: '🍽', activites: '🎯', commerces: '🛒' };

  container.innerHTML = allItems.map(item => `
    <div class="flex items-start gap-3 p-3 bg-stone-50 rounded-xl hover:bg-stone-100 transition">
      <span class="text-xl mt-0.5">${icons[item.category] || '📍'}</span>
      <div class="flex-1 min-w-0">
        <div class="font-semibold text-sm text-stone-800">${item.name}</div>
        <div class="text-xs text-stone-400 mt-0.5">${item.distance} · ${item.duration}</div>
        ${item.mapUrl ? `
          <a href="${item.mapUrl}" target="_blank" rel="noopener"
            class="text-xs text-amber-600 underline mt-1 inline-block">
            Itinéraire →
          </a>` : ''}
      </div>
      ${item.rating ? `
        <div class="text-xs text-stone-400 flex items-center gap-0.5 flex-shrink-0">
          <span class="text-yellow-400">★</span> ${item.rating}
        </div>` : ''}
    </div>
  `).join('');
}
