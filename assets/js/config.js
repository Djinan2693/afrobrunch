'use strict';

/**
 * AFRO BRUNCH — CONFIGURATION
 * =============================================================================
 * C'EST LE SEUL FICHIER QUE VOUS AVEZ BESOIN DE MODIFIER POUR METTRE EN LIGNE.
 * Les 2 lignes marquees << A REMPLIR >> sont obligatoires.
 * Tout le reste peut rester tel quel.
 * =============================================================================
 */

window.AFRO_CONFIG = {

  /* << A REMPLIR >> URL de l'application web Google Apps Script.
     Vous l'obtenez a l'etape 4 du README (elle finit par /exec). */
  API_URL: 'PASTE_YOUR_GOOGLE_APPS_SCRIPT_URL_HERE',

  /* Adresse publique du site sur GitHub Pages. */
  SITE_URL: 'https://djinan2693.github.io/afrobrunch/',

  /* ---- Billets ----
     MAX_TICKETS s'applique separement aux adultes et aux enfants. */
  CURRENCY: 'PHP',
  CURRENCY_SYMBOL: '₱',
  PRICE_ADULT: 1700,
  PRICE_CHILD: 700,
  CHILD_AGES: '7 to 12 years old',
  MAX_TICKETS: 10,

  /* ---- Evenement ---- */
  EVENT: {
    name: 'Afro Brunch — Afro Food Experience',
    dateLabel: 'Sunday, September 27, 2026',
    timeLabel: '4:00 PM — 8:00 PM',
    venue: 'Escalades South Metro',
    address: 'Sucat, Parañaque, Metro Manila',
    mapsUrl: 'https://maps.google.com/?q=Escalades+South+Metro+Sucat+Metro+Manila'
  },

  /* ---- Contacts organisateur (affiches sur le site) ---- */
  CONTACT: {
    phone1: '+63 977 078 4280',
    phone2: '+63 915 893 2310',
    email: 'afrobrunchph@gmail.com'
  },

  /* ---- Moyens de paiement (QR scannes par l'acheteur) ---- */
  PAYMENT: {
    gcash: {
      label: 'GCash',
      qr: './assets/images/qr-gcash.jpeg',
      accountName: 'MB*A KO****A DE***E K.',
      accountRef: 'Mobile No. 0977 078 ••••',
      note: 'Ouvrez GCash › Send Money › Scan QR. Des frais de transfert peuvent s\'appliquer.'
    },
    bpi: {
      label: 'BPI / InstaPay',
      qr: './assets/images/qr-bpi.jpeg',
      accountName: 'Afrobrunch',
      accountRef: 'Compte ••••••706',
      note: 'Scannez avec n\'importe quelle application bancaire compatible InstaPay.'
    }
  }

};
