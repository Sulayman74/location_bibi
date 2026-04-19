/**
 * Firebase Cloud Functions – La Cabine du Cap d'Agde
 *
 * Functions:
 *  - createPaymentIntent   → Stripe PaymentIntent
 *  - stripeWebhook         → Stripe events (success, cancel, refund)
 *  - cancelBooking         → Annulation + remboursement Stripe
 *  - getAvailability       → Proxy Zodomus (GET) + Firestore
 *  - getWifiCode           → Sécurisé par bookingId + fenêtre temporelle
 *  - syncZodomus           → Cron : sync calendrier Zodomus toutes les heures
 *  - sendReviewRequest     → Cron : relance avis Google 24h après checkout
 */

const { onRequest, onCall } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

// ==================== SECRETS ====================
// Configure via: firebase functions:secrets:set stripeKey_KEY
const stripeKey = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SEC =process.env.STRIPE_WEBHOOK_SECRET;
const ZODOMUS_API_KEY    =process.env.ZODOMUS_API_KEY;
const ZODOMUS_CHANNEL    =process.env.ZODOMUS_CHANNEL_ID;
const DISCORD_WEBHOOK    =process.env.DISCORD_WEBHOOK_URL;
const SLACK_WEBHOOK      =process.env.SLACK_WEBHOOK_URL;
const SENDGRID_KEY       =process.env.SENDGRID_API_KEY;

// ==================== CONFIG ====================
const property = {
  wifiSSID: process.env.WIFI_SSID || 'BIBI',
  wifiPassword: process.env.WIFI_PASSWORD || 'AKHASONE',
  keyCode: process.env.KEY_BOX_CODE || '0000',
  checkInHour: 16,
  checkOutHour: 11,
  wifiWindowHours: 2,
  fromEmail: 'keohavong.sirikone@gmail.com',
  hostEmail: 'sirikone@hotmail.com',
  siteUrl: 'https://locationbibi.web.app',
};

// ==================== 1. CREATE PAYMENT INTENT ====================

exports.createPaymentIntent = onRequest(
  { 
    region: 'europe-west1', 
    cors: [property.siteUrl, 'http://localhost:5000'] 
  },
  async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { amount, currency, metadata } = req.body;
    if (!amount || amount < 100) return res.status(400).json({ error: 'Invalid amount' });

    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

    // Check availability before creating intent (double-lock)
    const dateConflict = await checkDateConflict(metadata.checkIn, metadata.checkOut);
    if (dateConflict) {
      return res.status(409).json({ error: 'Ces dates ne sont plus disponibles.' });
    }

    const bookingId = generateBookingId();
    const accessCode = generateAccessCode();

    // Pre-create booking as "pending"
    await db.collection('reservations').doc(bookingId).set({
      status: 'pending',
      checkIn: admin.firestore.Timestamp.fromDate(new Date(metadata.checkIn)),
      checkOut: admin.firestore.Timestamp.fromDate(new Date(metadata.checkOut)),
      guests: parseInt(metadata.guests) || 1,
      guestName: metadata.guestName,
      guestEmail: metadata.guestEmail,
      nights: parseInt(metadata.nights) || 1,
      amount: amount,
      currency: currency || 'eur',
      accessCode,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
try {
  const paymentIntent = await stripe.paymentIntents.create({
    amount,
    currency: currency || 'eur',
    metadata: { ...metadata, bookingId, accessCode },
    receipt_email: metadata.guestEmail,
    description: `La Cabine du Cap d'Agde – ${metadata.checkIn} au ${metadata.checkOut}`,
  });

  res.json({ clientSecret: paymentIntent.client_secret, bookingId });
  
} catch (error) {
  // Si Stripe refuse, on affiche la VRAIE erreur dans la console
      console.error("Erreur Stripe détaillée :", error);
      
      // On renvoie la vraie erreur à ton site (et plus une erreur 500 générique)
      res.status(400).json({ error: error.message });
    }
  });

// ==================== 2. STRIPE WEBHOOK ====================

exports.stripeWebhook = onRequest(
  {region: 'europe-west1'},
  async (req, res) => {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const sig = req.headers['stripe-signature'];

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.rawBody, sig, STRIPE_WEBHOOK_SEC);
    } catch (err) {
      console.error('Webhook signature verification failed:', err);
      return res.status(400).json({ error: `Webhook Error: ${err.message}` });
    }

    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentSuccessWithLoyalty(event.data.object, stripe);
        break;
      case 'payment_intent.payment_failed':
        await handlePaymentFailed(event.data.object);
        break;
      case 'charge.refunded':
        await handleRefund(event.data.object);
        break;
    }

    res.json({ received: true });
  }
);

async function handlePaymentSuccess(paymentIntent, stripe) {
  const { bookingId, checkIn, checkOut, guestName, guestEmail, nights, guests, accessCode } = paymentIntent.metadata;
  if (!bookingId) return;

  // 1. Update Firestore → confirmed
  await db.collection('reservations').doc(bookingId).update({
    status: 'confirmed',
    stripePaymentIntentId: paymentIntent.id,
    paidAt: admin.firestore.FieldValue.serverTimestamp(),
    accessCode,
  });

  // 2. Block dates in availability collection
  await blockDatesInFirestore(checkIn, checkOut, bookingId);

  // 3. Notify host via Discord + Slack
  await notifyHostNewBooking({
    bookingId, checkIn, checkOut, guestName, guestEmail,
    nights, guests, amount: paymentIntent.amount / 100,
  });

  // 4. Update Zodomus (if POST available)
  await syncToZodomus(checkIn, checkOut, bookingId, guestName);

  // 5. Send confirmation email to guest
  await sendConfirmationEmail(guestEmail, {
    bookingId, checkIn, checkOut, nights, guests, guestName, accessCode,
    amount: paymentIntent.amount / 100,
  });

  console.log(`[Webhook] Booking confirmed: ${bookingId}`);
}

async function handlePaymentFailed(paymentIntent) {
  const { bookingId } = paymentIntent.metadata;
  if (!bookingId) return;
  await db.collection('reservations').doc(bookingId).update({
    status: 'failed',
    failedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function handleRefund(charge) {
  const bookingId = charge.metadata?.bookingId;
  if (!bookingId) return;

  await db.collection('reservations').doc(bookingId).update({
    status: 'cancelled',
    refundedAt: admin.firestore.FieldValue.serverTimestamp(),
    refundAmount: charge.amount_refunded / 100,
  });

  // Unblock dates
  const snap = await db.collection('reservations').doc(bookingId).get();
  if (snap.exists) {
    const { checkIn, checkOut } = snap.data();
    await unblockDatesInFirestore(
      checkIn.toDate().toISOString().split('T')[0],
      checkOut.toDate().toISOString().split('T')[0]
    );
  }

  await notifyHostCancellation(bookingId, charge.amount_refunded / 100);
  console.log(`[Webhook] Booking cancelled: ${bookingId}`);
}

// ==================== 3. CANCEL BOOKING ====================

exports.cancelBooking = onRequest(
  {region: 'europe-west1'},
  async (req, res) => {
    if (req.method !== 'POST') return res.status(405).end();

    // Vérifier que l'appelant est un admin Firebase Auth
    const authHeader = req.headers.authorization || ''
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!idToken) return res.status(401).json({ error: 'Unauthorized' })
    let caller
    try {
      caller = await admin.auth().verifyIdToken(idToken)
    } catch {
      return res.status(401).json({ error: 'Invalid token' })
    }
    const callerDoc = await db.collection('users').doc(caller.uid).get()
    if (!callerDoc.exists || callerDoc.data().role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' })
    }

    const { bookingId, reason } = req.body;
    if (!bookingId) return res.status(400).json({ error: 'bookingId required' });

    const snap = await db.collection('reservations').doc(bookingId).get();
    if (!snap.exists) return res.status(404).json({ error: 'Booking not found' });

    const booking = snap.data();
    if (booking.status !== 'confirmed') {
      return res.status(400).json({ error: 'Only confirmed bookings can be cancelled' });
    }

    // Politique d'annulation : remboursement total si ≥ 7 jours avant check-in
    const checkIn = booking.checkIn.toDate();
    const daysUntilCheckIn = (checkIn - new Date()) / (1000 * 60 * 60 * 24);
    const refundable = daysUntilCheckIn >= 7;

    try {
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

      if (refundable && booking.stripePaymentIntentId) {
        await stripe.refunds.create({
          payment_intent: booking.stripePaymentIntentId,
          reason: 'requested_by_customer',
          metadata: { bookingId, reason },
        });
        // handleRefund will be triggered by webhook
      } else {
        // No refund – just cancel
        await db.collection('reservations').doc(bookingId).update({
          status: 'cancelled',
          cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
          cancellationReason: reason || 'guest_request',
          refundAmount: 0,
        });
        await unblockDatesInFirestore(
          checkIn.toISOString().split('T')[0],
          booking.checkOut.toDate().toISOString().split('T')[0]
        );
      }

      res.json({ success: true, refunded: refundable, daysUntilCheckIn: Math.floor(daysUntilCheckIn) });
    } catch (err) {
      console.error('[cancelBooking] Error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ==================== 4. GET AVAILABILITY ====================

exports.getAvailability = onRequest(
{cors:true,region: 'europe-west1'},
  async (req, res) => {
    res.set('Cache-Control', 'public, max-age=1800'); // 30 min cache

    try {
      // Merge: Firestore reservations + availability collection (iCal/direct) + Zodomus
      const [firestoreDates, availabilityDates, zodomusDates] = await Promise.allSettled([
        getBlockedDatesFromFirestore(),
        getBlockedDatesFromAvailability(),
        getBlockedDatesFromZodomus(),
      ]);

      const allDates = new Set([
        ...(firestoreDates.status === 'fulfilled'    ? firestoreDates.value    : []),
        ...(availabilityDates.status === 'fulfilled' ? availabilityDates.value : []),
        ...(zodomusDates.status === 'fulfilled'      ? zodomusDates.value      : []),
      ]);

      res.json({
        bookedDates: [...allDates],
        source: 'merged',
        fetchedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[getAvailability] Error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

async function getBlockedDatesFromFirestore() {
  const snap = await db.collection('reservations')
    .where('status', 'in', ['confirmed', 'pending'])
    .get();

  const dates = [];
  snap.forEach(doc => {
    const { checkIn, checkOut } = doc.data();
    if (checkIn && checkOut) {
      iterateDates(
        checkIn.toDate ? checkIn.toDate() : new Date(checkIn),
        checkOut.toDate ? checkOut.toDate() : new Date(checkOut),
        d => dates.push(toISO(d))
      );
    }
  });
  return dates;
}

async function getBlockedDatesFromAvailability() {
  const today = toISO(new Date());
  const snap = await db.collection('availability')
    .where(admin.firestore.FieldPath.documentId(), '>=', today)
    .where('status', '==', 'blocked')
    .get();
  return snap.docs.map(d => d.id);
}

async function getBlockedDatesFromZodomus() {
  // Zodomus read-only API (GET only)
  // Docs: https://zodomus.com/api
  const apiKey     = ZODOMUS_API_KEY.value?.() || process.env.ZODOMUS_API_KEY;
  const channelId  = ZODOMUS_CHANNEL.value?.() || process.env.ZODOMUS_CHANNEL_ID;
  if (!apiKey || !channelId) return [];

  try {
    const today = new Date();
    const endDate = new Date(today);
    endDate.setFullYear(today.getFullYear() + 1);

    const url = `https://api.zodomus.com/v1/channels/${channelId}/calendar?` +
      `start_date=${toISO(today)}&end_date=${toISO(endDate)}&api_key=${apiKey}`;

    const res = await fetch(url, {
      headers: { 'Accept': 'application/json', 'X-API-Key': apiKey },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) throw new Error(`Zodomus API error: ${res.status}`);
    const data = await res.json();

    // Zodomus returns unavailable dates
    return data.blocked_dates || data.unavailable_dates || [];
  } catch (err) {
    console.warn('[Zodomus] Failed to fetch calendar:', err.message);
    return [];
  }
}

// ==================== 5. GET WIFI CODE ====================

exports.getWifiCode = onRequest(
  { cors: [property.siteUrl, 'http://localhost:5000'], region: 'europe-west1' },
  async (req, res) => {
    if (req.method !== 'POST') return res.status(405).end();

    const { bookingId } = req.body;
    if (!bookingId) return res.status(400).json({ error: 'bookingId required' });

    const snap = await db.collection('reservations').doc(bookingId).get();
    if (!snap.exists || snap.data().status !== 'confirmed') {
      return res.status(403).json({ error: 'Réservation invalide' });
    }

    const booking = snap.data();
    const checkIn  = booking.checkIn.toDate();
    const checkOut = booking.checkOut.toDate();

    checkIn.setHours(property.checkInHour, 0, 0, 0);
    checkOut.setHours(property.checkOutHour, 0, 0, 0);

    const now = new Date();
    const windowStart = new Date(checkIn.getTime() - property.wifiWindowHours * 3600000);
    const windowEnd   = new Date(checkOut.getTime() + property.wifiWindowHours * 3600000);

    if (now < windowStart || now > windowEnd) {
      return res.status(403).json({
        error: 'WiFi code not yet available',
        availableFrom: windowStart.toISOString(),
        availableUntil: windowEnd.toISOString(),
      });
    }

    res.json({
      ssid: property.wifiSSID,
      password: property.wifiPassword,
    });
  }
);

// ==================== 6. CRON: SYNC ZODOMUS ====================

exports.syncZodomus = onSchedule(
  { 
    region: 'europe-west1',
    schedule: 'every 1 hours', 
    timeZone: 'Europe/Paris'
  },
  async () => {
    console.log('[syncZodomus] Starting sync...');
    const dates = await getBlockedDatesFromZodomus();

    if (dates.length > 0) {
      const batch = db.batch();
      const syncRef = db.collection('config').doc('zodomus_sync');
      batch.set(syncRef, {
        lastSync: admin.firestore.FieldValue.serverTimestamp(),
        blockedDatesCount: dates.length,
        blockedDates: dates.slice(0, 500), // Firestore limit
      });
      await batch.commit();
    }
    console.log(`[syncZodomus] Synced ${dates.length} blocked dates`);
  }
);

// ==================== 7. CRON: SYNC ICAL ====================

exports.syncIcal = onSchedule(
  { schedule: 'every 1 hours', timeZone: 'Europe/Paris', region: 'europe-west1' },
  async () => syncIcalFeeds()
);

exports.manualSyncIcal = onRequest(
  { cors: [property.siteUrl, 'http://localhost:5000'], region: 'europe-west1' },
  async (req, res) => {
    if (req.method !== 'POST') return res.status(405).end();
    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!idToken) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const caller = await admin.auth().verifyIdToken(idToken);
      const callerDoc = await db.collection('users').doc(caller.uid).get();
      if (!callerDoc.exists || callerDoc.data().role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden' });
      }
    } catch {
      return res.status(401).json({ error: 'Invalid token' });
    }
    const result = await syncIcalFeeds();
    res.json(result);
  }
);

async function syncIcalFeeds() {
  const settingsSnap = await db.collection('config').doc('booking_settings').get();
  if (!settingsSnap.exists) return { synced: 0, sources: 0 };
  const { ical_airbnb, ical_booking } = settingsSnap.data();

  const urls = [ical_airbnb, ical_booking].filter(Boolean);
  if (!urls.length) return { synced: 0, sources: 0 };

  const allEvents = [];
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      allEvents.push(...parseIcal(text));
    } catch (err) {
      console.warn(`[syncIcal] Failed to fetch ${url}:`, err.message);
    }
  }

  if (!allEvents.length) {
    console.log('[syncIcal] No events found in iCal feeds');
    return { synced: 0, sources: urls.length };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Collect all dates to write
  const datesToWrite = [];
  for (const { start, end, summary } of allEvents) {
    if (end <= today) continue;
    iterateDates(start, end, d => {
      datesToWrite.push({ iso: toISO(d), summary: summary || '' });
    });
  }

  // Firestore batch: max 500 writes per batch
  const BATCH_SIZE = 450;
  for (let i = 0; i < datesToWrite.length; i += BATCH_SIZE) {
    const chunk = datesToWrite.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    chunk.forEach(({ iso, summary }) => {
      batch.set(db.collection('availability').doc(iso), {
        status: 'blocked',
        source: 'ical',
        summary,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    });
    await batch.commit();
  }

  await db.collection('config').doc('ical_sync').set({
    lastSync: admin.firestore.FieldValue.serverTimestamp(),
    eventsCount: allEvents.length,
    datesBlocked: datesToWrite.length,
  });

  console.log(`[syncIcal] Synced ${allEvents.length} events → ${datesToWrite.length} dates blocked`);
  return { synced: datesToWrite.length, sources: urls.length, events: allEvents.length };
}

function parseIcal(text) {
  // Unfold lines (RFC 5545: continuation lines begin with space or tab)
  const unfolded = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n[ \t]/g, '');

  const events = [];
  let inEvent = false;
  let current = {};

  for (const line of unfolded.split('\n')) {
    if (line === 'BEGIN:VEVENT') {
      inEvent = true;
      current = {};
    } else if (line === 'END:VEVENT') {
      inEvent = false;
      if (current.start && current.end) events.push(current);
    } else if (inEvent) {
      if (line.startsWith('DTSTART')) {
        const val = line.includes(':') ? line.split(':').slice(1).join(':') : null;
        if (val) current.start = parseIcalDate(val.trim());
      } else if (line.startsWith('DTEND')) {
        const val = line.includes(':') ? line.split(':').slice(1).join(':') : null;
        if (val) current.end = parseIcalDate(val.trim());
      } else if (line.startsWith('SUMMARY')) {
        current.summary = line.replace(/^SUMMARY[^:]*:/, '').trim();
      }
    }
  }
  return events.filter(e => e.start && e.end && e.end > e.start);
}

function parseIcalDate(value) {
  if (!value) return null;
  const v = value.trim();
  if (v.length === 8) {
    // YYYYMMDD — all-day
    return new Date(parseInt(v.slice(0, 4)), parseInt(v.slice(4, 6)) - 1, parseInt(v.slice(6, 8)));
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (m) {
    const [, y, mo, d, h, mi, s, z] = m;
    return z === 'Z'
      ? new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s))
      : new Date(+y, +mo - 1, +d, +h, +mi, +s);
  }
  return null;
}

// ==================== 8. CRON: REVIEW REQUESTS ====================

exports.sendReviewRequests = onSchedule(
{ 
    region: 'europe-west1',
    schedule: 'every day 10:00', 
    timeZone: 'Europe/Paris'
  },
  async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(11, 0, 0, 0); // Checkout time

    const today = new Date();
    today.setHours(11, 0, 0, 0);

    // Find bookings that checked out yesterday
    const snap = await db.collection('reservations')
      .where('status', '==', 'confirmed')
      .where('checkOut', '>=', admin.firestore.Timestamp.fromDate(yesterday))
      .where('checkOut', '<', admin.firestore.Timestamp.fromDate(today))
      .where('reviewRequestSent', '==', false)
      .get();

    const promises = snap.docs.map(async doc => {
      const booking = doc.data();
      await sendReviewRequestEmail(booking.guestEmail, booking.guestName, doc.id);
      await doc.ref.update({ reviewRequestSent: true });
    });

    await Promise.allSettled(promises);
    console.log(`[reviewRequests] Sent ${snap.size} review request emails`);
  }
);

// ==================== NOTIFICATIONS ====================

async function notifyHostNewBooking(booking) {
  const message = {
    content: null,
    embeds: [{
      title: '🎉 Nouvelle réservation confirmée !',
      color: 0xd97706,
      fields: [
        { name: '📋 Réservation', value: `\`${booking.bookingId}\``, inline: true },
        { name: '👤 Voyageur', value: booking.guestName || '—', inline: true },
        { name: '📧 Email', value: booking.guestEmail || '—', inline: true },
        { name: '📅 Arrivée', value: formatDateFR(booking.checkIn), inline: true },
        { name: '📅 Départ', value: formatDateFR(booking.checkOut), inline: true },
        { name: '🌙 Nuits', value: `${booking.nights} nuit${booking.nights > 1 ? 's' : ''}`, inline: true },
        { name: '👥 Voyageurs', value: `${booking.guests} pers.`, inline: true },
        { name: '💰 Montant', value: `${booking.amount}€`, inline: true },
      ],
      footer: { text: "La Cabine du Cap d'Agde · Réservation directe"},
      timestamp: new Date().toISOString(),
    }],
  };

  await Promise.allSettled([
    sendDiscordNotification(message),
    sendSlackNotification(buildSlackMessage('nouvelle réservation', booking)),
  ]);
}

async function notifyHostCancellation(bookingId, refundAmount) {
  const message = {
    embeds: [{
      title: '❌ Réservation annulée',
      color: 0xef4444,
      fields: [
        { name: '📋 Réservation', value: `\`${bookingId}\``, inline: true },
        { name: '💸 Remboursé', value: `${refundAmount}€`, inline: true },
      ],
      timestamp: new Date().toISOString(),
    }],
  };

  await Promise.allSettled([
    sendDiscordNotification(message),
    sendSlackNotification(buildSlackMessage('annulation', { bookingId, refundAmount })),
  ]);
}

async function sendDiscordNotification(message) {
  const webhookUrl = DISCORD_WEBHOOK;
  if (!webhookUrl) return;

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
  });
}

async function sendSlackNotification(message) {
  const webhookUrl = SLACK_WEBHOOK;
  if (!webhookUrl) return;

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
  });
}

function buildSlackMessage(type, data) {
  return {
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: type === 'nouvelle réservation' ? '🎉 Nouvelle réservation !' : '❌ Annulation',
          emoji: true,
        },
      },
      {
        type: 'section',
        fields: Object.entries(data).map(([k, v]) => ({
          type: 'mrkdwn',
          text: `*${k}:* ${v}`,
        })),
      },
    ],
  };
}

// ==================== ZODOMUS SYNC (POST if available) ====================

async function syncToZodomus(checkIn, checkOut, bookingId, guestName) {
  const apiKey    = ZODOMUS_API_KEY;
  const channelId = ZODOMUS_CHANNEL;
  if (!apiKey || !channelId) return;

  try {
    // Try POST to block dates on Zodomus
    const res = await fetch(`https://api.zodomus.com/v1/channels/${channelId}/reservations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({
        check_in: checkIn,
        check_out: checkOut,
        external_id: bookingId,
        guest_name: guestName,
        source: 'direct',
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (res.ok) {
      console.log('[Zodomus] Reservation synced via POST');
    } else if (res.status === 405) {
      // POST not supported – host will be notified via Discord/Slack
      // to manually block dates on Airbnb/Booking
      console.warn('[Zodomus] POST not supported – manual block needed. Host notified via Discord.');
    }
  } catch (err) {
    console.warn('[Zodomus] Sync failed (non-critical):', err.message);
  }
}

// ==================== EMAIL ====================

async function sendConfirmationEmail(to, booking) {
  const apiKey = SENDGRID_KEY;
  if (!apiKey || !to) return;

  const msg = {
    to,
    from: property.fromEmail,
    subject: `✅ Réservation confirmée – La Cabine du Cap d'Agde (#${booking.bookingId})`,
    html: buildConfirmationEmailHtml(booking),
  };

  try {
    const sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(apiKey);
    await sgMail.send(msg);
    console.log(`[Email] Confirmation sent to ${to}`);
  } catch (err) {
    console.error('[Email] SendGrid error:', err.message);
  }
}

async function sendReviewRequestEmail(to, guestName, bookingId) {
  const apiKey = SENDGRID_KEY;
  if (!apiKey || !to) return;

  const reviewUrl = `https://g.page/r/${process.env.GOOGLE_PLACE_ID || 'VOTRE_ID'}/review`;

  try {
    const sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(apiKey);
    await sgMail.send({
      to,
      from: property.fromEmail,
      subject: "⭐ Comment s'est passé votre séjour à la La Cabine du Cap d'Agde ?",
      html: `
        <div style="font-family: Inter, sans-serif; max-width: 600px; margin: auto; padding: 20px;">
          <h2 style="color: #d97706;">Merci pour votre séjour, ${guestName?.split(' ')[0] || 'cher voyageur'} !</h2>
          <p>Nous espérons que vous avez passé un moment inoubliable à la La Cabine du Cap d'Agde.</p>
          <p>Votre avis est précieux – cela prend 2 minutes et aide d'autres voyageurs à choisir :</p>
          <a href="${reviewUrl}" style="display:inline-block;background:#d97706;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin:16px 0;">
            ⭐ Laisser un avis Google
          </a>
          <p style="color:#888;font-size:12px;">À très bientôt, l'équipe La Cabine du Cap d'Agde</p>
        </div>
      `,
    });
  } catch (err) {
    console.error('[Email] Review request error:', err.message);
  }
}

function buildConfirmationEmailHtml(b) {
  return `
    <div style="font-family:Inter,sans-serif;max-width:600px;margin:auto;background:#fff;border-radius:16px;overflow:hidden;">
      <div style="background:#d97706;padding:32px;text-align:center;">
        <h1 style="color:white;margin:0;font-size:24px;">Réservation confirmée !</h1>
      </div>
      <div style="padding:24px;">
        <p>Bonjour <strong>${b.guestName}</strong>,</p>
        <p>Votre réservation à la <strong>La Cabine du Cap d'Agde</strong> est confirmée. Voici le récapitulatif :</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
          <tr style="background:#fef3c7;"><td style="padding:10px;font-weight:bold;">Réservation</td><td style="padding:10px;">#${b.bookingId}</td></tr>
          <tr><td style="padding:10px;color:#888;">Code d'accès</td><td style="padding:10px;font-weight:bold;font-family:monospace;">${b.accessCode}</td></tr>
          <tr style="background:#fef3c7;"><td style="padding:10px;color:#888;">Arrivée</td><td style="padding:10px;">${formatDateFR(b.checkIn)} · 16:00</td></tr>
          <tr><td style="padding:10px;color:#888;">Départ</td><td style="padding:10px;">${formatDateFR(b.checkOut)} · 11:00</td></tr>
          <tr style="background:#fef3c7;"><td style="padding:10px;color:#888;">Montant payé</td><td style="padding:10px;font-weight:bold;color:#10b981;">${b.amount}€</td></tr>
        </table>
        <div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:16px;margin:16px 0;">
          <strong>📱 Accédez à votre portail invité</strong><br>
          <a href="${property.siteUrl}/guest.html?booking=${b.bookingId}" style="color:#d97706;">
            Voir le code WiFi et les infos de séjour →
          </a><br>
          <small style="color:#888;">Code WiFi disponible 2h avant votre arrivée</small>
        </div>
        <p style="color:#888;font-size:12px;">Annulation gratuite jusqu'à 7 jours avant l'arrivée.</p>
      </div>
    </div>
  `;
}

// ==================== FIRESTORE HELPERS ====================

async function blockDatesInFirestore(checkIn, checkOut, bookingId) {
  const start = new Date(checkIn);
  const end   = new Date(checkOut);
  const batch = db.batch();

  iterateDates(start, end, d => {
    const iso = toISO(d);
    const ref = db.collection('availability').doc(iso);
    batch.set(ref, { bookingId, status: 'blocked', updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  });

  await batch.commit();
}

async function unblockDatesInFirestore(checkIn, checkOut) {
  const start = new Date(checkIn);
  const end   = new Date(checkOut);
  const batch = db.batch();

  iterateDates(start, end, d => {
    const iso = toISO(d);
    batch.delete(db.collection('availability').doc(iso));
  });

  await batch.commit();
}

async function checkDateConflict(checkIn, checkOut) {
  const start = toISO(new Date(checkIn));
  const end   = toISO(new Date(checkOut));
  const snap = await db.collection('availability')
    .where(admin.firestore.FieldPath.documentId(), '>=', start)
    .where(admin.firestore.FieldPath.documentId(), '<', end)
    .limit(1).get();
  return !snap.empty;
}

// ==================== UTILS ====================

function generateBookingId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function generateAccessCode() {
  return Math.random().toString(36).substr(2, 6).toUpperCase();
}

function toISO(date) {
  return date.toISOString().split('T')[0];
}

function iterateDates(start, end, callback) {
  const d = new Date(start);
  while (d < end) {
    callback(new Date(d));
    d.setDate(d.getDate() + 1);
  }
}

function formatDateFR(isoOrTimestamp) {
  const d = typeof isoOrTimestamp === 'string'
    ? new Date(isoOrTimestamp + 'T12:00:00')
    : new Date(isoOrTimestamp);
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

// ==================== 8. GUEST LOYALTY — upsert à chaque réservation confirmée ====================

async function upsertGuest(bookingData) {
  const { guestEmail, firstName, lastName, phone, checkIn, checkOut, nights, guests, bookingId } = bookingData;
  if (!guestEmail) return;

  const guestRef = db.collection('guests').doc(guestEmail.toLowerCase());
  const snap = await guestRef.get();

  if (!snap.exists) {
    await guestRef.set({
      email: guestEmail.toLowerCase(),
      firstName: firstName || '',
      lastName: lastName || '',
      phone: phone || '',
      firstCheckIn: admin.firestore.Timestamp.fromDate(new Date(checkIn)),
      lastCheckIn: admin.firestore.Timestamp.fromDate(new Date(checkIn)),
      lastCheckOut: admin.firestore.Timestamp.fromDate(new Date(checkOut)),
      staysCount: 1,
      totalNights: nights || 0,
      bookingIds: [bookingId],
      fcmTokens: [],
      consentMarketing: true, // opt-in implicite à la réservation, configurable
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } else {
    const existing = snap.data();
    await guestRef.update({
      lastCheckIn: admin.firestore.Timestamp.fromDate(new Date(checkIn)),
      lastCheckOut: admin.firestore.Timestamp.fromDate(new Date(checkOut)),
      staysCount: (existing.staysCount || 0) + 1,
      totalNights: (existing.totalNights || 0) + (nights || 0),
      bookingIds: admin.firestore.FieldValue.arrayUnion(bookingId),
      // Mettre à jour le nom si manquant
      ...(firstName && !existing.firstName ? { firstName } : {}),
      ...(lastName  && !existing.lastName  ? { lastName  } : {}),
      ...(phone     && !existing.phone     ? { phone     } : {}),
    });
  }
}

// ==================== 9. SYNC FCM TOKEN VOYAGEUR → GUEST DOC ====================

exports.syncGuestFcmToken = onRequest(
  { cors: [property.siteUrl, 'http://localhost:5000'], region: 'europe-west1' },
  async (req, res) => {
    if (req.method !== 'POST') return res.status(405).end();
    const { bookingId, fcmToken } = req.body;
    if (!bookingId || !fcmToken) return res.status(400).json({ error: 'bookingId and fcmToken required' });

    const snap = await db.collection('reservations').doc(bookingId).get();
    if (!snap.exists || snap.data().status !== 'confirmed') return res.status(403).end();

    const { guestEmail } = snap.data();
    if (!guestEmail) return res.status(404).json({ error: 'No guest email' });

    const guestRef = db.collection('guests').doc(guestEmail.toLowerCase());
    await guestRef.set(
      { fcmTokens: admin.firestore.FieldValue.arrayUnion(fcmToken) },
      { merge: true }
    );

    // Aussi sur la réservation
    await db.collection('reservations').doc(bookingId).update({
      fcmTokens: admin.firestore.FieldValue.arrayUnion(fcmToken),
    });

    res.json({ ok: true });
  }
);

// ==================== 10. BROADCAST PUSH NOTIFICATION (callable sécurisée) ====================

exports.broadcastPushNotification = onCall(
  {region: 'europe-west1'},
  async (request) => {
    // 1. Vérifier auth
    if (!request.auth) {
      throw new Error('unauthenticated');
    }

    // 2. Vérifier rôle admin dans Firestore
    const userSnap = await db.collection('users').doc(request.auth.uid).get();
    if (!userSnap.exists || userSnap.data().role !== 'admin') {
      throw new Error('permission-denied');
    }

    const { title, body, url = '/', targetGroup = 'all' } = request.data;
    if (!title || !body) throw new Error('title and body are required');

    // 3. Récupérer les tokens selon le groupe cible
    const tokens = await getTargetTokens(targetGroup);
    if (tokens.length === 0) return { sent: 0, failed: 0, skipped: 0 };

    // 4. Envoyer via FCM multicast (max 500 tokens par batch)
    let totalSent = 0, totalFailed = 0;
    const BATCH = 500;

    for (let i = 0; i < tokens.length; i += BATCH) {
      const batch = tokens.slice(i, i + BATCH);
      const response = await admin.messaging().sendEachForMulticast({
        tokens: batch,
        notification: { title, body },
        webpush: {
          notification: { title, body, icon: '/assets/icons/icon-192.png', badge: '/assets/icons/icon-96.png' },
          fcmOptions: { link: url },
        },
        data: { url, clickAction: 'FLUTTER_NOTIFICATION_CLICK' },
      });
      totalSent   += response.successCount;
      totalFailed += response.failureCount;

      // Nettoyer les tokens invalides
      await cleanInvalidTokens(batch, response.responses);
    }

    // 5. Logger l'envoi
    await db.collection('push_history').add({
      title, body, url, targetGroup,
      sent: totalSent, failed: totalFailed,
      sentBy: request.auth.uid,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`[broadcastPush] Sent: ${totalSent}, Failed: ${totalFailed}`);
    return { sent: totalSent, failed: totalFailed };
  }
);

exports.previewBroadcastCount = onCall(
  {region:"europe-west1"},
  async (request) => {
    if (!request.auth) throw new Error('unauthenticated');
    const userSnap = await db.collection('users').doc(request.auth.uid).get();
    if (!userSnap.exists || userSnap.data().role !== 'admin') throw new Error('permission-denied');

    const { targetGroup = 'all' } = request.data;
    const tokens = await getTargetTokens(targetGroup);
    return { count: tokens.length };
  }
);

async function getTargetTokens(targetGroup) {
  const now = new Date();
  let guestQuery;

  switch (targetGroup) {
    case 'current': {
      // Voyageurs actuellement en séjour
      const snap = await db.collection('reservations')
        .where('status', '==', 'confirmed')
        .where('checkIn', '<=', admin.firestore.Timestamp.fromDate(now))
        .where('checkOut', '>=', admin.firestore.Timestamp.fromDate(now))
        .get();
      const emails = snap.docs.map(d => d.data().guestEmail?.toLowerCase()).filter(Boolean);
      return await getTokensForEmails(emails);
    }
    case 'upcoming': {
      const in7 = new Date(now.getTime() + 7 * 86400000);
      const snap = await db.collection('reservations')
        .where('status', '==', 'confirmed')
        .where('checkIn', '>=', admin.firestore.Timestamp.fromDate(now))
        .where('checkIn', '<=', admin.firestore.Timestamp.fromDate(in7))
        .get();
      const emails = snap.docs.map(d => d.data().guestEmail?.toLowerCase()).filter(Boolean);
      return await getTokensForEmails(emails);
    }
    case 'past': {
      // Anciens voyageurs (checkOut passé + consentement)
      const snap = await db.collection('guests')
        .where('consentMarketing', '==', true)
        .where('lastCheckOut', '<', admin.firestore.Timestamp.fromDate(now))
        .get();
      return snap.docs.flatMap(d => d.data().fcmTokens || []);
    }
    default: {
      // all — tous les consentants avec un token
      const snap = await db.collection('guests')
        .where('consentMarketing', '==', true)
        .get();
      return snap.docs.flatMap(d => d.data().fcmTokens || []);
    }
  }
}

async function getTokensForEmails(emails) {
  if (!emails.length) return [];
  const tokens = [];
  // Firestore 'in' limit = 30
  const chunks = [];
  for (let i = 0; i < emails.length; i += 30) chunks.push(emails.slice(i, i + 30));
  for (const chunk of chunks) {
    const snap = await db.collection('guests')
      .where(admin.firestore.FieldPath.documentId(), 'in', chunk)
      .get();
    snap.forEach(d => tokens.push(...(d.data().fcmTokens || [])));
  }
  return tokens;
}

async function cleanInvalidTokens(tokens, responses) {
  const invalid = responses
    .map((r, i) => (!r.success && r.error?.code === 'messaging/invalid-registration-token') ? tokens[i] : null)
    .filter(Boolean);

  if (!invalid.length) return;

  const guestsWithBadTokens = await db.collection('guests')
    .where('fcmTokens', 'array-contains-any', invalid.slice(0, 10))
    .get();

  const batch = db.batch();
  guestsWithBadTokens.forEach(doc => {
    const cleaned = (doc.data().fcmTokens || []).filter(t => !invalid.includes(t));
    batch.update(doc.ref, { fcmTokens: cleaned });
  });
  await batch.commit();
}

// ==================== Patch handlePaymentSuccess to call upsertGuest ====================
// (Injecté dans le webhook existant)

const _originalHandleSuccess = handlePaymentSuccess;
// handlePaymentSuccess est déjà défini plus haut — on ajoute l'upsert guest dedans
// via une redéfinition locale de la fonction de notification :

async function handlePaymentSuccessWithLoyalty(paymentIntent, stripe) {
  const meta = paymentIntent.metadata;
  const { bookingId, checkIn, checkOut, guestName, guestEmail, nights, guests, accessCode } = meta;
  if (!bookingId) return;

  // Mettre à jour la réservation
  await db.collection('reservations').doc(bookingId).update({
    status: 'confirmed',
    stripePaymentIntentId: paymentIntent.id,
    paidAt: admin.firestore.FieldValue.serverTimestamp(),
    accessCode,
    reviewRequestSent: false,
  });

  await blockDatesInFirestore(checkIn, checkOut, bookingId);

  // Upsert guest pour la fidélisation
  const [nameParts] = [(guestName || '').split(' ')];
  await upsertGuest({
    guestEmail,
    firstName: nameParts[0] || '',
    lastName:  nameParts.slice(1).join(' ') || '',
    checkIn, checkOut,
    nights: parseInt(nights) || 1,
    guests: parseInt(guests) || 1,
    bookingId,
  });

  await notifyHostNewBooking({ bookingId, checkIn, checkOut, guestName, guestEmail, nights, guests, amount: paymentIntent.amount / 100 });
  await syncToZodomus(checkIn, checkOut, bookingId, guestName);
  await sendConfirmationEmail(guestEmail, { bookingId, checkIn, checkOut, nights, guests, guestName, accessCode, amount: paymentIntent.amount / 100 });
  console.log(`[Webhook] Booking confirmed + guest upserted: ${bookingId}`);
}
