/**
 * Calendar Module
 * Gestion des disponibilités via Zodomus (GET) + Firestore
 * Rendu du calendrier interactif pour index.html et reservation.html
 */

import { FUNCTIONS_BASE_URL, PROPERTY_CONFIG, db, getPricing } from './firebase-config.js';
import { collection, getDocs, query, where, Timestamp } from 'firebase/firestore';

// ==================== STATE ====================
let bookedDates = new Set(); // ISO dates "YYYY-MM-DD"
let _pricing    = null;

export async function initPricing() {
  _pricing = await getPricing()
  return _pricing
}
let calendarState = {
  year: new Date().getFullYear(),
  month: new Date().getMonth(),
  checkIn: null,
  checkOut: null,
  guests: 2,
  selecting: 'checkin', // 'checkin' | 'checkout'
};

const FR_MONTHS = ['Janvier','Février','Mars','Avril','Mai','Juin',
                   'Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

// ==================== ZODOMUS SYNC ====================

/**
 * Fetches blocked dates from our Cloud Function (which proxies Zodomus)
 * Falls back to Firestore cache if network is unavailable
 */
const AVAILABILITY_CACHE_TTL = 30 * 60 * 1000; // 30 min

export async function fetchAvailability() {
  // Serve from localStorage cache if fresh (saves Cloud Function invocations)
  const cached = JSON.parse(localStorage.getItem('villa_booked_dates') || 'null');
  if (cached && Date.now() - cached.fetchedAt < AVAILABILITY_CACHE_TTL) {
    bookedDates = new Set(cached.dates);
    return bookedDates;
  }

  try {
    if (!FUNCTIONS_BASE_URL) throw new Error('FUNCTIONS_BASE_URL not configured');
    const res = await fetch(`${FUNCTIONS_BASE_URL}/getAvailability`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    bookedDates = new Set(data.bookedDates || []);
    localStorage.setItem('villa_booked_dates', JSON.stringify({
      dates: [...bookedDates],
      fetchedAt: Date.now(),
    }));
    return bookedDates;
  } catch (err) {
    console.warn('[Calendar] Network fetch failed, using Firestore fallback:', err.message);
    return fetchAvailabilityFromFirestore();
  }
}

async function fetchAvailabilityFromFirestore() {
  // Try localStorage cache first (valid for 30 min)
  const cached = JSON.parse(localStorage.getItem('villa_booked_dates') || 'null');
  if (cached && Date.now() - cached.fetchedAt < 30 * 60 * 1000) {
    bookedDates = new Set(cached.dates);
    return bookedDates;
  }

  try {
    const now = Timestamp.now();
    const q = query(collection(db, 'reservations'),
      where('status', 'in', ['confirmed', 'pending']),
      where('checkOut', '>=', now)
    );
    const snap = await getDocs(q);
    const dates = new Set();
    snap.forEach(doc => {
      const { checkIn, checkOut } = doc.data();
      if (checkIn && checkOut) {
        const start = checkIn.toDate ? checkIn.toDate() : new Date(checkIn);
        const end   = checkOut.toDate ? checkOut.toDate() : new Date(checkOut);
        iterateDates(start, end, d => dates.add(toISO(d)));
      }
    });
    bookedDates = dates;
  } catch (e) {
    console.error('[Calendar] Firestore fetch failed:', e);
  }
  return bookedDates;
}

// ==================== CALENDAR RENDER ====================

export function renderCalendar(gridId, titleId, options = {}) {
  const grid  = document.getElementById(gridId);
  const title = document.getElementById(titleId);
  if (!grid || !title) return;

  const { year, month } = calendarState;
  title.textContent = `${FR_MONTHS[month]} ${year}`;

  const firstDay  = new Date(year, month, 1);
  const lastDay   = new Date(year, month + 1, 0);
  // Start on Monday (ISO weeks)
  let startOffset = (firstDay.getDay() + 6) % 7;

  grid.innerHTML = '';

  // Empty cells before first day
  for (let i = 0; i < startOffset; i++) {
    const empty = document.createElement('div');
    empty.className = 'h-9';
    grid.appendChild(empty);
  }

  const today = toISO(new Date());

  for (let day = 1; day <= lastDay.getDate(); day++) {
    const date    = new Date(year, month, day);
    const iso     = toISO(date);
    const isPast  = iso < today;
    const isToday = iso === today;
    const isBooked = bookedDates.has(iso);
    const isSelected = iso === calendarState.checkIn || iso === calendarState.checkOut;
    const isInRange  = isInSelectedRange(iso);

    const cell = document.createElement('div');
    cell.dataset.date = iso;
    cell.className = buildDayClass(isPast, isBooked, isSelected, isInRange, isToday, options.compact);
    cell.textContent = day;

    if (!isPast && !isBooked) {
      cell.addEventListener('click', () => handleDateClick(iso, gridId, titleId, options));
    }

    grid.appendChild(cell);
  }

  // Update display if on reservation page
  updateDateDisplay();
  updatePriceBreakdown();
}

function buildDayClass(isPast, isBooked, isSelected, isInRange, isToday, compact) {
  const base = `availability-day rounded-lg border text-center text-sm font-medium transition-all duration-150 select-none ${compact ? 'h-8 text-xs' : 'h-9'}`;
  if (isPast)     return `${base} bg-stone-50 text-stone-300 border-transparent cursor-not-allowed`;
  if (isBooked)   return `${base} booked`;
  if (isSelected) return `${base} selected`;
  if (isInRange)  return `${base} in-range`;
  if (isToday)    return `${base} available ring-2 ring-amber-400`;
  return `${base} available`;
}

function isInSelectedRange(iso) {
  if (!calendarState.checkIn || !calendarState.checkOut) return false;
  return iso > calendarState.checkIn && iso < calendarState.checkOut;
}

function handleDateClick(iso, gridId, titleId, options) {
  if (calendarState.selecting === 'checkin' || !calendarState.checkIn) {
    calendarState.checkIn = iso;
    calendarState.checkOut = null;
    calendarState.selecting = 'checkout';
  } else {
    if (iso <= calendarState.checkIn) {
      // Clicked before check-in → reset
      calendarState.checkIn = iso;
      calendarState.checkOut = null;
      calendarState.selecting = 'checkout';
    } else {
      // Validate no booked dates in range
      if (hasBookedDatesInRange(calendarState.checkIn, iso)) {
        showCalendarError('Ces dates incluent des jours déjà réservés.');
        return;
      }
      calendarState.checkOut = iso;
      calendarState.selecting = 'checkin';

      // Store selection for reservation page
      sessionStorage.setItem('villa_checkin', calendarState.checkIn);
      sessionStorage.setItem('villa_checkout', calendarState.checkOut);

      // Enable CTA button if present
      const ctaBtn = document.getElementById('to-step2') || document.getElementById('calendar-cta');
      if (ctaBtn) ctaBtn.removeAttribute('disabled');
    }
  }
  renderCalendar(gridId, titleId, options);
}

function hasBookedDatesInRange(start, end) {
  const s = new Date(start), e = new Date(end);
  for (let d = new Date(s); d < e; d.setDate(d.getDate() + 1)) {
    if (bookedDates.has(toISO(d))) return true;
  }
  return false;
}

// ==================== PRICE BREAKDOWN ====================

export function updatePriceBreakdown() {
  const container = document.getElementById('price-breakdown');
  const totalEl   = document.getElementById('price-total');
  const totalPriceEl = document.getElementById('total-price');
  if (!container) return;

  const { checkIn, checkOut } = calendarState;
  if (!checkIn || !checkOut) {
    container.innerHTML = '<div class="text-stone-400 text-center py-4 text-sm">Sélectionnez vos dates pour voir le détail</div>';
    if (totalEl) totalEl.classList.add('hidden');
    return;
  }

  const nights = nightsBetween(checkIn, checkOut);
  const nightly = getNightlyRate(new Date(checkIn));
  const subtotal = nights * nightly;
  const cleaning = _pricing?.cleaningFee ?? PROPERTY_CONFIG.cleaningFee;
  const serviceFee = Math.round(subtotal * ((_pricing?.serviceFeePercent ?? PROPERTY_CONFIG.serviceFeePercent) / 100));
  const total = subtotal + cleaning + serviceFee;

  container.innerHTML = `
    <div class="flex justify-between text-stone-600">
      <span>${nightly}€ × ${nights} nuit${nights > 1 ? 's' : ''}</span>
      <span>${subtotal}€</span>
    </div>
    <div class="flex justify-between text-stone-600">
      <span>Frais de ménage</span>
      <span>${cleaning}€</span>
    </div>
    <div class="flex justify-between text-stone-600">
      <span>Frais de service</span>
      <span>${serviceFee}€</span>
    </div>
  `;

  if (totalEl) totalEl.classList.remove('hidden');
  if (totalPriceEl) totalPriceEl.textContent = `${total}€`;

  // Store for payment
  sessionStorage.setItem('villa_total', total);
  sessionStorage.setItem('villa_nights', nights);
  sessionStorage.setItem('villa_nightly', nightly);
}

function getNightlyRate(date) {
  const month = date.getMonth();
  const p = _pricing ?? PROPERTY_CONFIG.basePrice
  const high   = _pricing ? p.high   : p.high
  const school = _pricing ? p.school : p.school
  const low    = _pricing ? p.low    : p.low
  if (month >= 5 && month <= 8) return high;
  if (month === 11 || month === 2) return school;
  return low;
}

function nightsBetween(start, end) {
  return Math.round((new Date(end) - new Date(start)) / (1000 * 60 * 60 * 24));
}

// ==================== DISPLAY UPDATES ====================

function updateDateDisplay() {
  const ciEl = document.getElementById('display-checkin');
  const coEl = document.getElementById('display-checkout');
  if (ciEl) ciEl.textContent = calendarState.checkIn ? formatDate(calendarState.checkIn) : 'Sélectionnez';
  if (coEl) coEl.textContent = calendarState.checkOut ? formatDate(calendarState.checkOut) : 'Sélectionnez';
}

export function getSelectedDates() {
  return {
    checkIn: calendarState.checkIn,
    checkOut: calendarState.checkOut,
    guests: calendarState.guests,
    nights: calendarState.checkIn && calendarState.checkOut
      ? nightsBetween(calendarState.checkIn, calendarState.checkOut) : 0,
  };
}

export function restoreFromSession() {
  const ci = sessionStorage.getItem('villa_checkin');
  const co = sessionStorage.getItem('villa_checkout');
  if (ci) calendarState.checkIn = ci;
  if (co) calendarState.checkOut = co;
}

// ==================== NAVIGATION ====================

export function prevMonth(gridId, titleId, options) {
  if (calendarState.month === 0) {
    calendarState.month = 11;
    calendarState.year--;
  } else {
    calendarState.month--;
  }
  renderCalendar(gridId, titleId, options);
}

export function nextMonth(gridId, titleId, options) {
  if (calendarState.month === 11) {
    calendarState.month = 0;
    calendarState.year++;
  } else {
    calendarState.month++;
  }
  renderCalendar(gridId, titleId, options);
}

export function setGuests(count) {
  calendarState.guests = Math.max(1, Math.min(8, count));
  const display = document.getElementById('guest-display');
  const countEl = document.getElementById('guest-count');
  if (display) display.textContent = calendarState.guests;
  if (countEl)  countEl.textContent = calendarState.guests;
  sessionStorage.setItem('villa_guests', calendarState.guests);
}

// ==================== NEXT AVAILABLE DATE ====================

export function getNextAvailableDate() {
  const today = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const iso = toISO(d);
    if (!bookedDates.has(iso)) return d;
  }
  return null;
}

// ==================== HELPERS ====================

function toISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDate(iso) {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}

function iterateDates(start, end, callback) {
  const d = new Date(start);
  while (d < end) {
    callback(new Date(d));
    d.setDate(d.getDate() + 1);
  }
}

function showCalendarError(msg) {
  const err = document.getElementById('calendar-error');
  if (err) {
    err.textContent = msg;
    err.classList.remove('hidden');
    setTimeout(() => err.classList.add('hidden'), 3000);
  }
}
