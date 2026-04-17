# La Cabine du Cap d'Agde – Guide de déploiement

## Prérequis
- Node.js 20+
- Firebase CLI : `npm install -g firebase-tools`
- Un projet Firebase (console.firebase.google.com)
- Un compte Stripe
- Optionnel : Zodomus, SendGrid, Discord/Slack

---

## 1. Firebase Setup

```bash
firebase login
firebase init
# Sélectionner : Hosting, Firestore, Functions, Emulators
```

Mettre à jour `.firebaserc` avec votre Project ID.

## 2. Personnaliser la villa

### a) `public/src/modules/firebase-config.js`
Remplacer les valeurs Firebase et Stripe.

### b) `public/index.html`
- Remplacer `[Ville]`, `[Région]`, `[Adresse]`
- Mettre à jour les coordonnées GPS dans le schema.org
- Remplacer `VOTRE_ID_GOOGLE` par votre Google Place ID
- Mettre vos propres photos (remplacer les URLs Unsplash)

### c) `public/src/modules/recommendations.js`
Remplacer toutes les adresses par vos vraies recommandations locales.

### d) `public/src/modules/reviews.js`
Remplacer les avis exemples par vos vrais avis clients.

### e) `functions/index.js`
Configurer les constantes `PROPERTY` en haut du fichier.

## 3. Secrets Firebase

```bash
# Stripe
firebase functions:secrets:set STRIPE_SECRET_KEY
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET

# Zodomus (optionnel)
firebase functions:secrets:set ZODOMUS_API_KEY
firebase functions:secrets:set ZODOMUS_CHANNEL_ID

# Notifications
firebase functions:secrets:set DISCORD_WEBHOOK_URL
firebase functions:secrets:set SLACK_WEBHOOK_URL

# Email (optionnel)
firebase functions:secrets:set SENDGRID_API_KEY
```

## 4. Variables d'environnement Functions

```bash
firebase functions:config:set \
  property.wifi_ssid="Villa-Les-Oliviers" \
  property.wifi_password="VotreMotDePasse" \
  property.key_box_code="1234" \
  property.google_place_id="ChIJ..."
```

## 5. Stripe Webhook

Dans le dashboard Stripe → Webhooks → Ajouter un endpoint :
- URL : `https://REGION-votre-projet.cloudfunctions.net/stripeWebhook`
- Événements : `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`

## 6. Icônes PWA

Générer les icônes depuis votre logo :
```bash
npx pwa-asset-generator logo.png public/assets/icons
```

Ou utiliser : https://realfavicongenerator.net

## 7. Déployer

```bash
# Installer les dépendances Functions
cd functions && npm install && cd ..

# Déploiement complet
firebase deploy

# Ou en parties
firebase deploy --only hosting
firebase deploy --only functions
firebase deploy --only firestore:rules
```

## 8. Test local

```bash
firebase emulators:start
# Interface : http://localhost:4000
# App : http://localhost:5000
```

## 9. SEO & Google Business

1. Créer/revendiquer votre fiche Google Business
2. Récupérer votre Google Place ID : https://developers.google.com/maps/documentation/places/web-service/place-id
3. Mettre à jour `VOTRE_ID_GOOGLE` partout dans le code
4. Soumettre le sitemap dans Google Search Console

## 10. QR Code sur place

Générer un QR code pointant vers :
`https://votre-domaine.fr/guest.html`

Plastifier et placer à l'entrée de la villa.

---

## Architecture Firestore

```
reservations/
  {bookingId}/
    status: 'confirmed' | 'pending' | 'cancelled' | 'failed'
    checkIn: Timestamp
    checkOut: Timestamp
    guests: number
    guestName: string
    guestEmail: string
    nights: number
    amount: number
    currency: string
    accessCode: string (6 chars)
    keyCode: string (optional)
    stripePaymentIntentId: string
    fcmTokens: string[]
    reviewRequestSent: boolean
    createdAt: Timestamp
    paidAt: Timestamp
    cancelledAt?: Timestamp
    refundAmount?: number

availability/
  {YYYY-MM-DD}/
    bookingId: string
    status: 'blocked'
    updatedAt: Timestamp

config/
  zodomus_sync/
    lastSync: Timestamp
    blockedDates: string[]
```

## Logique WiFi

```
Réservation confirmée
         ↓
    checkIn - 2h ← Code VISIBLE à partir de là
         ↓
    checkIn 16:00
         ↓
    checkOut 11:00
         ↓
    checkOut + 2h ← Code CACHÉ après ça
```

Le code est servi par la Cloud Function `getWifiCode` qui vérifie :
1. La réservation existe et est `confirmed`
2. L'heure actuelle est dans la fenêtre autorisée

## Flux de réservation

```
Visiteur sélectionne dates → createPaymentIntent (CF)
    → Pre-booking "pending" créé
    → Stripe charge la carte
    → payment_intent.succeeded webhook
        → Booking → "confirmed"
        → Dates bloquées Firestore
        → Sync Zodomus (POST si dispo, sinon notification Discord)
        → Email confirmation
        → Notification Discord/Slack hôte
```
