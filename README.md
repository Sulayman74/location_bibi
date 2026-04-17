***

# 🏠 La Cabine du Cap d'Agde – Système de Réservation Directe

Ce projet est une solution complète de location saisonnière permettant la réservation directe sans commission, incluant un portail voyageur (PWA) et un panneau d'administration propriétaire.

## ✨ Fonctionnalités

### 🌍 Site Public & Réservation
* **Landing Page Optimisée** : Présentation du studio avec galerie photos et avis clients.
* **Calendrier en Temps Réel** : Synchronisation des disponibilités via Zodomus (Airbnb/Booking) et Firestore.
* **Tunnel de Réservation** : Processus en 4 étapes (Dates → Infos → Paiement → Confirmation).
* **Paiement Sécurisé** : Intégration complète avec **Stripe** pour les paiements par carte bancaire.

### 🔑 Portail Voyageur (PWA)
* **Accès Intelligent au WiFi** : Le code WiFi s'affiche automatiquement 2h avant l'arrivée et disparaît 2h après le départ.
* **Guide de Bienvenue numérique** : Accès aux instructions (clés, piscine, climatisation) et recommandations locales.
* **Mode Hors-Ligne** : Grâce au Service Worker, les infos de séjour restent accessibles même sans réseau.

### 🛡️ Administration Propriétaire
* **Dashboard de Performance** : Vue sur les revenus du mois, les abonnés push et les prochaines arrivées.
* **Gestion des Voyageurs** : Base de données de fidélisation avec historique des séjours.
* **Notifications Push** : Envoi de messages broadcast (promos, infos) aux voyageurs abonnés.

## 🛠️ Stack Technique

* **Frontend** : Vite, Tailwind CSS, JavaScript (ES Modules).
* **Backend** : Firebase (Hosting, Firestore, Auth, Cloud Functions v2).
* **Paiement** : Stripe API.
* **Channel Manager** : Proxy Zodomus pour la synchronisation des calendriers.

## 🚀 Installation & Déploiement

### Prérequis
* Node.js 20+
* Firebase CLI (`npm install -g firebase-tools`)
* Un compte Stripe et (optionnel) Zodomus / SendGrid

### Configuration
1.  Copier le fichier `.env.example` en `.env.local` et remplir les clés Firebase et Stripe.
2.  Initialiser Firebase : `firebase init`.
3.  Configurer les secrets pour les Cloud Functions :
    ```bash
    firebase functions:secrets:set STRIPE_SECRET_KEY
    firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
    ```

### Déploiement
```bash
# Installer les dépendances
npm install
cd functions && npm install

# Déployer sur Firebase
npm run deploy
```

## 📁 Structure du Projet
```text
├── functions/              # Logique backend (Stripe, Sync, Emails)
├── public/                 # Assets statiques, Manifest PWA & Service Worker
├── src/
│   ├── modules/            # Logique métier (Calendrier, Auth, Paiement)
│   ├── styles/             # Fichiers CSS Tailwind
│   ├── main.js             # Entry point site public
│   ├── guest.js            # Entry point portail voyageur
│   └── admin.js            # Entry point gestion propriétaire
├── index.html              # Landing page
├── reservation.html        # Tunnel de paiement
└── guest.html              # Application voyageur
```

## 🔒 Sécurité
* **Règles Firestore** : Accès restreint selon les rôles (Admin vs Public).
* **Variables d'environnement** : Les clés sensibles sont gérées via Firebase Secret Manager.
* **Validation côté serveur** : Double vérification de la disponibilité avant chaque transaction Stripe.

---
*Développé pour "La Cabine du Cap d'Agde".*
