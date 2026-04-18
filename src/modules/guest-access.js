/**
 * Guest Access Module
 * Logique intelligente d'accès au code WiFi :
 *  - Visible 2h AVANT le check-in
 *  - Visible PENDANT le séjour
 *  - Caché 2h APRÈS le check-out
 */

import {
  FUNCTIONS_BASE_URL,
  PROPERTY_CONFIG,
  db,
  storage,
} from "./firebase-config.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";

const WIFI_WINDOW_HOURS = PROPERTY_CONFIG.wifiAccessWindowHours; // 2h

let currentBooking = null;
let countdownInterval = null;
let wifiBtnController = null; // AbortController pour éviter double-listeners

// ==================== BOOKING LOOKUP ====================

export async function loadGuestBooking(bookingId) {
  if (!bookingId) return null;

  try {
    const snap = await getDoc(doc(db, "reservations", bookingId));
    if (!snap.exists()) return null;

    const data = snap.data();
    if (data.status !== "confirmed") return null;

    currentBooking = {
      id: bookingId,
      ...data,
      checkIn: toDate(data.checkIn),
      checkOut: toDate(data.checkOut),
    };
    renderCheckinSection(currentBooking);
    return currentBooking;
  } catch (err) {
    console.error("[GuestAccess] Firestore load failed:", err);
    return null;
  }
}

export async function loadGuestBookingByCode(code) {
  if (!code) return null;
  const clean = code.trim().toUpperCase();

  try {
    const q = query(
      collection(db, "reservations"),
      where("accessCode", "==", clean),
      where("status", "==", "confirmed"),
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;

    const docSnap = snap.docs[0];
    const data = docSnap.data();
    currentBooking = {
      id: docSnap.id,
      ...data,
      checkIn: toDate(data.checkIn),
      checkOut: toDate(data.checkOut),
    };
    return currentBooking;
  } catch (err) {
    console.error("[GuestAccess] Code lookup failed:", err);
    return null;
  }
}

// ==================== WIFI ACCESS LOGIC ====================

export function computeWifiAccess(booking) {
  if (!booking) return { canAccess: false, phase: "no-booking" };

  const now = new Date();
  const checkIn = new Date(booking.checkIn);
  const checkOut = new Date(booking.checkOut);

  checkIn.setHours(PROPERTY_CONFIG.checkInHour, 0, 0, 0);
  checkOut.setHours(PROPERTY_CONFIG.checkOutHour, 0, 0, 0);

  const windowStart = new Date(
    checkIn.getTime() - WIFI_WINDOW_HOURS * 3_600_000,
  );
  const windowEnd = new Date(
    checkOut.getTime() + WIFI_WINDOW_HOURS * 3_600_000,
  );

  if (now < windowStart) {
    return {
      canAccess: false,
      phase: "too-early",
      unlockAt: windowStart,
      msUntilUnlock: windowStart - now,
      checkIn,
    };
  }
  if (now > windowEnd) {
    return { canAccess: false, phase: "expired", checkOut };
  }

  return {
    canAccess: true,
    phase: now >= checkIn && now < checkOut ? "during-stay" : "pre-checkin",
    checkIn,
    checkOut,
    windowEnd,
  };
}

// ==================== WIFI RENDER ====================

export async function renderWifiSection(booking) {
  if (!booking) {
    showWifiLocked("Aucune réservation active.");
    return;
  }

  const access = computeWifiAccess(booking);

  if (!access.canAccess) {
    if (access.phase === "too-early") {
      showWifiLocked(`Disponible le ${formatDateTime(access.unlockAt)}`);
      startCountdown(access.unlockAt, "wifi-unlock-time", () => {
        if (currentBooking) renderWifiSection(currentBooking);
      });
    } else {
      showWifiLocked("Votre séjour est terminé. Merci de votre visite !");
    }
    return;
  }

  try {
    const wifiData = await fetchWifiCredentials(booking.id);
    showWifiUnlocked(wifiData.ssid, wifiData.password);

    localStorage.setItem(
      "villa_wifi",
      JSON.stringify({ ssid: wifiData.ssid, password: wifiData.password }),
    );
    navigator.serviceWorker?.controller?.postMessage({
      type: "CACHE_WIFI",
      ssid: wifiData.ssid,
      password: wifiData.password,
    });
  } catch (err) {
    console.error("[GuestAccess] WiFi fetch failed:", err);
    showWifiLocked("Impossible de charger le code WiFi. Contactez l'hôte.");
  }
}

async function fetchWifiCredentials(bookingId) {
  const res = await fetch(`${FUNCTIONS_BASE_URL}/getWifiCode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookingId }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function showWifiLocked(message) {
  document.getElementById("wifi-locked")?.classList.remove("hidden");
  document.getElementById("wifi-unlocked")?.classList.add("hidden");
  const msgEl = document.getElementById("wifi-locked-msg");
  if (msgEl) msgEl.textContent = message;
}

function showWifiUnlocked(ssid, password) {
  document.getElementById("wifi-locked")?.classList.add("hidden");
  document.getElementById("wifi-unlocked")?.classList.remove("hidden");

  const ssidEl = document.getElementById("wifi-ssid");
  const passEl = document.getElementById("wifi-password");
  if (ssidEl) ssidEl.textContent = ssid;
  if (passEl) {
    passEl.dataset.realPassword = password;
    passEl.textContent = "••••••••";
  }

  setupWifiButtons(password, ssid);
}

// ==================== WIFI BUTTONS — délégation sur le container ====================

function setupWifiButtons(password, ssid) {
  const container = document.getElementById("wifi-unlocked");
  if (!container) return;

  // Annuler les listeners précédents si appelé une 2e fois (ex : countdown atteint 0)
  wifiBtnController?.abort();
  wifiBtnController = new AbortController();
  const { signal } = wifiBtnController;

  let revealed = false;

  container.addEventListener(
    "click",
    async (e) => {
      const btn = e.target.closest("button[id]");
      if (!btn) return;

      if (btn.id === "toggle-wifi-btn") {
        revealed = !revealed;
        const passEl = document.getElementById("wifi-password");
        const eyeIcon = document.getElementById("eye-icon");
        if (passEl) passEl.textContent = revealed ? password : "••••••••";
        if (eyeIcon) {
          eyeIcon.innerHTML = revealed
            ? '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"/>'
            : '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>';
        }
      }

      if (btn.id === "copy-wifi-btn") {
        try {
          await navigator.clipboard.writeText(password);
        } catch {
          const ta = document.createElement("textarea");
          ta.value = password;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
        }
        const orig = btn.textContent;
        btn.textContent = "✓ Copié !";
        setTimeout(() => {
          btn.textContent = orig;
        }, 2000);
      }

      if (btn.id === "share-wifi-btn") {
        navigator
          .share?.({
            title: "Code WiFi – Villa Les Oliviers",
            text: `Réseau: ${ssid}\nMot de passe: ${password}`,
          })
          .catch(() => {});
      }
    },
    { signal },
  );

  const shareBtn = document.getElementById("share-wifi-btn");
  if (shareBtn && !navigator.share) shareBtn.hidden = true;
}

// ==================== COUNTDOWN ====================

function startCountdown(targetDate, displayId, onComplete) {
  if (countdownInterval) clearInterval(countdownInterval);

  const update = () => {
    const ms = targetDate - new Date();
    if (ms <= 0) {
      clearInterval(countdownInterval);
      onComplete?.();
      return;
    }

    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    const s = Math.floor((ms % 60_000) / 1_000);

    const el = document.getElementById(displayId);
    if (el) {
      el.textContent =
        h > 0
          ? `Dans ${h}h ${String(m).padStart(2, "0")}min`
          : `Dans ${m}min ${String(s).padStart(2, "0")}s`;
    }
  };

  update();
  countdownInterval = setInterval(update, 1000);
}

export function startCheckinCountdown(checkIn) {
  const countdownEl = document.getElementById("checkin-countdown");
  if (!countdownEl) return;

  const target = new Date(checkIn);
  target.setHours(PROPERTY_CONFIG.checkInHour, 0, 0, 0);

  const now = new Date();
  if (now >= target || target - now > 24 * 3_600_000) {
    countdownEl.classList.add("hidden");
    return;
  }

  countdownEl.classList.remove("hidden");
  startCountdown(target, "countdown-display", () =>
    countdownEl.classList.add("hidden"),
  );
}

// ==================== STAY INFO ====================

export function renderStayInfo(booking) {
  if (!booking) return;

  const checkIn = new Date(booking.checkIn);
  const checkOut = new Date(booking.checkOut);
  const nights = Math.round((checkOut - checkIn) / 86_400_000);

  const set = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };

  set(
    "stay-dates",
    `${formatDateShort(checkIn)} → ${formatDateShort(checkOut)}`,
  );
  set(
    "stay-nights",
    `${nights} nuit${nights > 1 ? "s" : ""} · ${booking.guests || 1} voyageur${(booking.guests || 1) > 1 ? "s" : ""}`,
  );
  set(
    "guest-name-header",
    booking.guestName
      ? `Bonjour, ${booking.guestName.split(" ")[0]} !`
      : "Espace voyageur",
  );

  const badge = document.getElementById("stay-status-badge");
  if (badge) {
    const now = new Date();
    const ci = new Date(checkIn);
    ci.setHours(PROPERTY_CONFIG.checkInHour, 0, 0, 0);
    const co = new Date(checkOut);
    co.setHours(PROPERTY_CONFIG.checkOutHour, 0, 0, 0);

    if (now < ci) {
      badge.className =
        "text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700";
      badge.textContent = "🕐 Avant séjour";
    } else if (now < co) {
      badge.className =
        "text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700";
      badge.textContent = "✅ En séjour";
    } else {
      badge.className =
        "text-xs font-semibold px-2.5 py-1 rounded-full bg-stone-100 text-stone-500";
      badge.textContent = "🏠 Séjour terminé";
    }
  }
  renderCheckinSection(booking);
}
export function renderCheckinSection(booking) {
  const checkinSection = document.getElementById("checkin-section");

  // Si le document a déjà été envoyé, on cache la section
  if (booking.idDocumentUrl) {
    checkinSection.classList.add("hidden");
    return;
  }

  checkinSection.classList.remove("hidden");
  const form = document.getElementById("checkin-form");
  const btn = document.getElementById("submit-checkin-btn");
  const errEl = document.getElementById("checkin-error");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const file = document.getElementById("id-upload").files[0];
    if (!file) return;

    btn.disabled = true;
    btn.textContent = "Envoi en cours...";
    errEl.classList.add("hidden");

    try {
      // 1. Définir le chemin de stockage sécurisé : identites/{bookingId}/{nom_fichier}
      const fileExt = file.name.split(".").pop();
      const storageRef = ref(
        storage,
        `identites/${booking.id}/id_document.${fileExt}`,
      );

      // 2. Uploader le fichier
      const snapshot = await uploadBytes(storageRef, file);

      const filePath = snapshot.ref.fullPath; // Ex: identites/12345/id_document.jpg
      await updateDoc(doc(db, "reservations", booking.id), {
        idDocumentPath: filePath,
        checkinCompletedAt: new Date(),
      });

      // 5. Cacher le formulaire avec un message de succès
      checkinSection.innerHTML = `<div class="text-sm text-emerald-600 text-center font-medium py-4">✅ Check-in validé. Merci !</div>`;
    } catch (err) {
      console.error(err);
      errEl.textContent = "Erreur lors de l'envoi. Veuillez réessayer.";
      errEl.classList.remove("hidden");
      btn.disabled = false;
      btn.textContent = "Envoyer le document";
    }
  });
}
// ==================== POST-STAY REVIEW ====================

export function renderReviewSection(booking) {
  if (!booking) return;

  const checkOut = new Date(booking.checkOut);
  checkOut.setHours(PROPERTY_CONFIG.checkOutHour, 0, 0, 0);

  if (new Date() > checkOut) {
    document.getElementById("review-before-departure")?.classList.add("hidden");
    document.getElementById("review-post-stay")?.classList.remove("hidden");
  }

  const googleLink = `https://g.page/r/${PROPERTY_CONFIG.googlePlaceId}/review`;
  document
    .getElementById("google-review-link")
    ?.setAttribute("href", googleLink);
  document
    .getElementById("post-google-review-link")
    ?.setAttribute("href", googleLink);

  const airbnbLink = `https://www.airbnb.fr/users/${PROPERTY_CONFIG.airbnbListingId}/reviews`;
  document
    .getElementById("airbnb-review-link")
    ?.setAttribute("href", airbnbLink);
}

// ==================== HELPERS ====================

function toDate(val) {
  if (!val) return null;
  if (val?.toDate) return val.toDate();
  if (val?.seconds) return new Date(val.seconds * 1000);
  return new Date(val);
}

function formatDateTime(date) {
  return date.toLocaleString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateShort(date) {
  return date.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
