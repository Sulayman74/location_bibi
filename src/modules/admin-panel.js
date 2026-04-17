/**
 * Admin Panel Module
 * - Stats dashboard
 * - Liste des réservations
 * - Broadcast push notifications
 * - Gestion de la base voyageurs (loyalty)
 */
import {
  collection, query, where, orderBy, limit,
  getDocs, doc, getDoc, updateDoc,
  Timestamp, onSnapshot,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from './firebase-config.js'

// ==================== STATS ====================

export async function loadDashboardStats() {
  const now = Timestamp.now()

  const [upcoming, allGuests, thisMonth] = await Promise.all([
    getDocs(query(
      collection(db, 'reservations'),
      where('status', '==', 'confirmed'),
      where('checkIn', '>=', now),
      orderBy('checkIn'),
      limit(5)
    )),
    getDocs(query(collection(db, 'guests'), where('consentMarketing', '==', true))),
    getDocs(query(
      collection(db, 'reservations'),
      where('status', '==', 'confirmed'),
      where('createdAt', '>=', Timestamp.fromDate(startOfMonth()))
    )),
  ])

  const revenue = thisMonth.docs.reduce((sum, d) => sum + (d.data().amount || 0), 0) / 100

  return {
    upcomingBookings: upcoming.size,
    pushSubscribers:  allGuests.size,
    bookingsThisMonth: thisMonth.size,
    revenueThisMonth: revenue,
    nextBooking: upcoming.docs[0]?.data() || null,
  }
}

// ==================== RESERVATIONS ====================

export async function loadReservations(statusFilter = 'confirmed', limitCount = 20) {
  const constraints = [
    where('status', '==', statusFilter),
    orderBy('checkIn', 'desc'),
    limit(limitCount),
  ]
  const snap = await getDocs(query(collection(db, 'reservations'), ...constraints))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export function subscribeToUpcomingBookings(callback) {
  const now = Timestamp.now()
  return onSnapshot(
    query(
      collection(db, 'reservations'),
      where('status', '==', 'confirmed'),
      where('checkIn', '>=', now),
      orderBy('checkIn'),
      limit(10)
    ),
    snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  )
}

// ==================== GUESTS (LOYALTY) ====================

export async function loadGuests(opts = {}) {
  const { onlySubscribed = false, limitCount = 50 } = opts
  const constraints = [orderBy('lastCheckOut', 'desc'), limit(limitCount)]
  if (onlySubscribed) constraints.unshift(where('consentMarketing', '==', true))

  const snap = await getDocs(query(collection(db, 'guests'), ...constraints))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export async function getGuestStats() {
  const [total, subscribed] = await Promise.all([
    getDocs(collection(db, 'guests')),
    getDocs(query(collection(db, 'guests'), where('consentMarketing', '==', true))),
  ])
  return { total: total.size, subscribed: subscribed.size }
}

// ==================== PUSH BROADCAST ====================

/**
 * Envoie une notification push à tous les voyageurs ayant accepté le marketing.
 * Appelle la Cloud Function sécurisée (vérification du rôle admin côté serveur).
 */
export async function broadcastPushNotification({ title, body, url = '/', targetGroup = 'all' }) {
  if (!title?.trim()) throw new Error('Le titre est obligatoire')
  if (!body?.trim())  throw new Error('Le message est obligatoire')

  const broadcast = httpsCallable(functions, 'broadcastPushNotification')
  const result = await broadcast({ title, body, url, targetGroup })
  return result.data // { sent: N, failed: M, skipped: K }
}

/**
 * Aperçu avant envoi : combien de destinataires seront touchés
 */
export async function previewBroadcastCount(targetGroup = 'all') {
  const preview = httpsCallable(functions, 'previewBroadcastCount')
  const result = await preview({ targetGroup })
  return result.data.count
}

// ==================== RENDER HELPERS ====================

export function renderStatsCards(stats) {
  const cards = [
    {
      id: 'stat-upcoming',
      label: 'Réservations à venir',
      value: stats.upcomingBookings,
      icon: '📅',
      color: 'bg-blue-50 text-blue-700',
    },
    {
      id: 'stat-subscribers',
      label: 'Abonnés push',
      value: stats.pushSubscribers,
      icon: '🔔',
      color: 'bg-amber-50 text-amber-700',
    },
    {
      id: 'stat-month-bookings',
      label: 'Réservations ce mois',
      value: stats.bookingsThisMonth,
      icon: '📊',
      color: 'bg-emerald-50 text-emerald-700',
    },
    {
      id: 'stat-revenue',
      label: 'Revenus ce mois',
      value: `${stats.revenueThisMonth.toLocaleString('fr-FR')}€`,
      icon: '💰',
      color: 'bg-purple-50 text-purple-700',
    },
  ]

  return cards.map(c => `
    <div class="bg-white rounded-2xl p-5 shadow-sm border border-stone-100">
      <div class="flex items-center justify-between mb-3">
        <span class="text-2xl">${c.icon}</span>
        <span class="text-xs font-medium px-2.5 py-1 rounded-full ${c.color}">${c.label}</span>
      </div>
      <div class="text-3xl font-bold text-stone-800" id="${c.id}">${c.value}</div>
    </div>
  `).join('')
}

export function renderBookingRow(booking) {
  const checkIn  = toDate(booking.checkIn)
  const checkOut = toDate(booking.checkOut)
  const status   = booking.status

  const statusClass = {
    confirmed:  'bg-emerald-100 text-emerald-700',
    pending:    'bg-amber-100 text-amber-700',
    cancelled:  'bg-red-100 text-red-700',
    failed:     'bg-stone-100 text-stone-500',
  }[status] || 'bg-stone-100 text-stone-500'

  return `
    <tr class="hover:bg-stone-50 transition">
      <td class="px-4 py-3 text-xs font-mono text-amber-600 font-semibold">#${booking.id}</td>
      <td class="px-4 py-3 text-sm font-medium text-stone-800">${booking.guestName || '—'}</td>
      <td class="px-4 py-3 text-xs text-stone-500">${booking.guestEmail || '—'}</td>
      <td class="px-4 py-3 text-xs text-stone-600">
        ${formatDateShort(checkIn)} → ${formatDateShort(checkOut)}
        <div class="text-stone-400">${booking.nights || 0} nuit${booking.nights > 1 ? 's' : ''}</div>
      </td>
      <td class="px-4 py-3 text-sm font-semibold text-stone-800">${((booking.amount || 0) / 100).toLocaleString('fr-FR')}€</td>
      <td class="px-4 py-3">
        <span class="text-xs font-medium px-2.5 py-1 rounded-full ${statusClass}">${status}</span>
      </td>
    </tr>
  `
}

export function renderGuestRow(guest) {
  const hasFcm   = (guest.fcmTokens?.length || 0) > 0
  const lastStay = guest.lastCheckOut ? formatDateShort(toDate(guest.lastCheckOut)) : 'N/A'

  return `
    <tr class="hover:bg-stone-50 transition">
      <td class="px-4 py-3">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
            ${(guest.firstName?.[0] || '?') + (guest.lastName?.[0] || '')}
          </div>
          <div>
            <div class="text-sm font-medium text-stone-800">${guest.firstName || ''} ${guest.lastName || ''}</div>
            <div class="text-xs text-stone-400">${guest.email || ''}</div>
          </div>
        </div>
      </td>
      <td class="px-4 py-3 text-xs text-stone-500">${lastStay}</td>
      <td class="px-4 py-3 text-xs text-stone-500">${guest.staysCount || 1} séjour${(guest.staysCount || 1) > 1 ? 's' : ''}</td>
      <td class="px-4 py-3">
        ${hasFcm
          ? '<span class="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">🔔 Abonné</span>'
          : '<span class="text-xs font-medium px-2 py-0.5 rounded-full bg-stone-100 text-stone-400">—</span>'
        }
      </td>
      <td class="px-4 py-3">
        ${guest.consentMarketing
          ? '<span class="text-xs text-emerald-600">✓ Oui</span>'
          : '<span class="text-xs text-stone-400">Non</span>'
        }
      </td>
    </tr>
  `
}

// ==================== UTILS ====================

function toDate(val) {
  if (!val) return new Date()
  if (val?.toDate) return val.toDate()
  if (val?.seconds) return new Date(val.seconds * 1000)
  return new Date(val)
}

function formatDateShort(date) {
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
}

function startOfMonth() {
  const d = new Date()
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d
}
