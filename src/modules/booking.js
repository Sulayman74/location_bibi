/**
 * Booking Module
 * Gestion du tunnel de réservation multi-étapes + paiement Stripe
 */

import { STRIPE_PUBLISHABLE_KEY, FUNCTIONS_BASE_URL, PROPERTY_CONFIG } from './firebase-config.js';
import { getSelectedDates } from './calendar.js';

let stripe = null;
let cardElement = null;
let currentStep = 1;
let bookingData = {};

// ==================== STEP MANAGEMENT ====================

export function goBackStep() {
  if (currentStep > 1) goToStep(currentStep - 1)
}

export function initBookingSteps() {
  restoreStepState();

  // Step navigation buttons
  bindBtn('to-step2',       () => goToStep(2));
  bindBtn('back-to-step1',  () => goToStep(1));
  bindBtn('to-step3',       () => validateStep2() && goToStep(3));
  bindBtn('back-to-step2',  () => goToStep(2));
  bindBtn('pay-btn',        () => handlePayment());

  // Guest count buttons
  bindBtn('guest-minus', () => {
    const { setGuests, getSelectedDates: gsd } = window._villaCalendar || {};
    if (setGuests) setGuests(bookingData.guests - 1);
    bookingData.guests = Math.max(1, (bookingData.guests || 2) - 1);
    updateGuestDisplay();
  });
  bindBtn('guest-plus', () => {
    bookingData.guests = Math.min(PROPERTY_CONFIG.maxGuests, (bookingData.guests || 2) + 1);
    updateGuestDisplay();
    if (window._villaCalendar?.setGuests) window._villaCalendar.setGuests(bookingData.guests);
  });
}

function goToStep(step) {
  currentStep = step;
  document.querySelectorAll('.booking-step').forEach((el, idx) => {
    el.classList.toggle('hidden', idx + 1 !== step);
  });

  // Update progress indicators
  for (let i = 1; i <= 4; i++) {
    const indicator = document.getElementById(`step${i}-indicator`);
    const connector = document.getElementById(`connector-${i}-${i+1}`);
    if (!indicator) continue;

    indicator.className = indicator.className
      .replace(/step-indicator\s+(active|done)/, 'step-indicator');

    if (i < step) {
      indicator.classList.add('done');
      indicator.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>';
      if (connector) connector.classList.add('done');
    } else if (i === step) {
      indicator.classList.add('active');
      indicator.textContent = i;
    } else {
      indicator.textContent = i;
    }
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ==================== STEP 2: GUEST FORM ====================

function validateStep2() {
  const form = document.getElementById('guest-form');
  if (!form) return true;

  let valid = true;
  form.querySelectorAll('[required]').forEach(field => {
    field.classList.remove('border-red-400');
    if (!field.value.trim()) {
      field.classList.add('border-red-400');
      valid = false;
    }
    if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(field.value)) {
      field.classList.add('border-red-400');
      valid = false;
    }
    if (field.type === 'checkbox' && !field.checked) {
      valid = false;
    }
  });

  if (!valid) {
    showError('Veuillez remplir tous les champs obligatoires.');
    form.querySelector('[required]:invalid, [required].border-red-400')?.focus();
  }

  if (valid) {
    const data = Object.fromEntries(new FormData(form));
    bookingData = { ...bookingData, ...data };
    sessionStorage.setItem('villa_booking_data', JSON.stringify(bookingData));
  }

  return valid;
}

// ==================== STEP 3: STRIPE PAYMENT ====================

export async function initStripe() {
  if (stripe) return;
  if (!window.Stripe) {
    console.error('[Booking] Stripe.js not loaded');
    return;
  }

  stripe = window.Stripe(STRIPE_PUBLISHABLE_KEY);
  const elements = stripe.elements({
    appearance: {
      theme: 'stripe',
      variables: {
        colorPrimary: '#d97706',
        colorBackground: '#ffffff',
        colorText: '#1c1917',
        fontFamily: 'Inter, sans-serif',
        borderRadius: '12px',
      }
    }
  });

  cardElement = elements.create('card', {
    style: {
      base: {
        fontSize: '15px',
        fontFamily: 'Inter, sans-serif',
        color: '#1c1917',
        '::placeholder': { color: '#a8a29e' }
      }
    }
  });

  const mountEl = document.getElementById('card-element');
  if (mountEl) {
    cardElement.mount('#card-element');
    cardElement.on('change', event => {
      const errEl = document.getElementById('card-errors');
      if (errEl) {
        errEl.textContent = event.error?.message || '';
        errEl.classList.toggle('hidden', !event.error);
      }
    });
  }
}

async function handlePayment() {
  const btn = document.getElementById('pay-btn');
  const spinner = document.getElementById('pay-spinner');
  const btnText = document.getElementById('pay-btn-text');

  if (!stripe || !cardElement) {
    showPaymentError('Le système de paiement n\'est pas initialisé. Rechargez la page.');
    return;
  }

  // Collect final booking data
  const dates = getSelectedDates();
  const formData = JSON.parse(sessionStorage.getItem('villa_booking_data') || '{}');
  const total = parseInt(sessionStorage.getItem('villa_total') || '0');

  if (!dates.checkIn || !dates.checkOut || !total) {
    showPaymentError('Informations de réservation incomplètes. Recommencez depuis le début.');
    return;
  }

  // Loading state
  btn.disabled = true;
  spinner?.classList.remove('hidden');
  if (btnText) btnText.textContent = 'Traitement en cours…';

  try {
    // 1. Create PaymentIntent on server
    const intentRes = await fetch(`${FUNCTIONS_BASE_URL}/createPaymentIntent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: total * 100, // Stripe uses cents
        currency: PROPERTY_CONFIG.currency.toLowerCase(),
        metadata: {
          checkIn: dates.checkIn,
          checkOut: dates.checkOut,
          guests: dates.guests,
          guestName: `${formData.firstName} ${formData.lastName}`,
          guestEmail: formData.email,
          nights: dates.nights,
        }
      })
    });

    if (!intentRes.ok) throw new Error(`Server error: ${intentRes.status}`);
    const { clientSecret, bookingId } = await intentRes.json();

    // 2. Confirm card payment with Stripe
    const { paymentIntent, error } = await stripe.confirmCardPayment(clientSecret, {
      payment_method: {
        card: cardElement,
        billing_details: {
          name: `${formData.firstName} ${formData.lastName}`,
          email: formData.email,
          phone: formData.phone,
        }
      }
    });

    if (error) throw new Error(error.message);

    if (paymentIntent.status === 'succeeded') {
      sessionStorage.setItem('villa_booking_id', bookingId);
      sessionStorage.setItem('villa_payment_intent', paymentIntent.id);
      goToStep(4);
      renderConfirmation(bookingId, dates, formData, total);
    }

  } catch (err) {
    showPaymentError(err.message || 'Une erreur est survenue. Veuillez réessayer.');
    console.error('[Booking] Payment error:', err);
  } finally {
    btn.disabled = false;
    spinner?.classList.add('hidden');
    if (btnText) btnText.textContent = 'Confirmer et payer';
  }
}

// ==================== STEP 4: CONFIRMATION ====================

function renderConfirmation(bookingId, dates, formData, total) {
  const subtitle = document.getElementById('confirmation-subtitle');
  if (subtitle) subtitle.textContent = `Un email de confirmation a été envoyé à ${formData.email}`;

  const summaryEl = document.getElementById('booking-summary');
  if (summaryEl) {
    summaryEl.innerHTML = `
      <div class="grid grid-cols-2 gap-3 text-sm">
        <div>
          <div class="text-xs text-stone-400 uppercase tracking-wider mb-1">Réservation</div>
          <div class="font-semibold font-mono text-amber-600">#${bookingId?.toUpperCase?.() || 'XXXXXX'}</div>
        </div>
        <div>
          <div class="text-xs text-stone-400 uppercase tracking-wider mb-1">Voyageur</div>
          <div class="font-semibold">${formData.firstName} ${formData.lastName}</div>
        </div>
        <div>
          <div class="text-xs text-stone-400 uppercase tracking-wider mb-1">Arrivée</div>
          <div class="font-semibold">${formatDateFR(dates.checkIn)} · 16:00</div>
        </div>
        <div>
          <div class="text-xs text-stone-400 uppercase tracking-wider mb-1">Départ</div>
          <div class="font-semibold">${formatDateFR(dates.checkOut)} · 11:00</div>
        </div>
        <div>
          <div class="text-xs text-stone-400 uppercase tracking-wider mb-1">Nuits</div>
          <div class="font-semibold">${dates.nights} nuit${dates.nights > 1 ? 's' : ''}</div>
        </div>
        <div>
          <div class="text-xs text-stone-400 uppercase tracking-wider mb-1">Total payé</div>
          <div class="font-bold text-emerald-600">${total}€</div>
        </div>
      </div>
    `;
  }

  // Link to guest portal with booking ID
  const guestLink = document.getElementById('to-guest-portal');
  if (guestLink) {
    guestLink.href = `/guest.html?booking=${bookingId}`;
  }
}

// ==================== CANCELLATION ====================

/**
 * Initiates a refund for a confirmed booking.
 * Called from guest portal or admin panel.
 */
export async function cancelBooking(bookingId, reason = '') {
  try {
    const res = await fetch(`${FUNCTIONS_BASE_URL}/cancelBooking`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingId, reason })
    });
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('[Booking] Cancel error:', err);
    throw err;
  }
}

// ==================== HELPERS ====================

function updateGuestDisplay() {
  const el = document.getElementById('guest-display');
  const el2 = document.getElementById('guest-count');
  if (el) el.textContent = bookingData.guests || 2;
  if (el2) el2.textContent = bookingData.guests || 2;
}

function showError(msg) {
  const err = document.getElementById('form-error');
  if (err) {
    err.textContent = msg;
    err.classList.remove('hidden');
    setTimeout(() => err.classList.add('hidden'), 4000);
  } else {
    alert(msg);
  }
}

function showPaymentError(msg) {
  const err = document.getElementById('payment-error');
  if (err) {
    err.textContent = `⚠️ ${msg}`;
    err.classList.remove('hidden');
    err.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function restoreStepState() {
  try {
    const saved = sessionStorage.getItem('villa_booking_data')
    if (saved) bookingData = JSON.parse(saved)
  } catch {}
  bookingData.guests = bookingData.guests || parseInt(sessionStorage.getItem('villa_guests') || '2')
  updateGuestDisplay()
}

function bindBtn(id, handler) {
  const btn = document.getElementById(id);
  if (btn) btn.addEventListener('click', handler);
}

function formatDateFR(iso) {
  if (!iso) return '—';
  return new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
}
