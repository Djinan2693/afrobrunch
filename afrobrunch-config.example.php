<?php
/**
 * Afro Brunch — configuration du backend
 * ---------------------------------------------------------------------------
 * CE FICHIER CONTIENT DES SECRETS.
 * Il vit dans /home/afrobrunch/, EN DEHORS de public_html : il n'est donc
 * jamais servi par le serveur web, meme si PHP tombe en panne.
 * Il n'est pas non plus dans le depot GitHub, qui est public.
 */

return [

    // --- SMTP cPanel (Zoho gratuit n'autorise pas l'envoi programmatique) ---
    // Exim impose que l'expediteur corresponde au compte authentifie :
    // on envoie donc depuis contact@ et on renvoie les reponses vers billeterie@.
    'smtp' => [
        'host'   => 'mail.afrobrunch.online',
        'port'   => 587,
        'user'   => 'contact@afrobrunch.online',
        'pass'   => 'VOTRE_MOT_DE_PASSE_SMTP',
        'secure' => 'tls',
    ],

    'from_email' => 'contact@afrobrunch.online',
    'from_name'  => 'Afro Brunch',
    'reply_to'   => 'billeterie@afrobrunch.online',
    'organizer'  => ['billeterie@afrobrunch.online'],

    // --- Signatures et acces ---
    // 'secret' signe les liens Valider / Refuser des emails organisateur.
    // 'staff_key' ouvre le mode pointage et l'export a l'entree.
    'secret'    => 'REMPLACEZ_PAR_UNE_LONGUE_CHAINE_ALEATOIRE',
    'staff_key' => 'REMPLACEZ_PAR_UNE_CLE_STAFF',

    // --- Passerelle Google Sheet ---
    // Application web Apps Script (voir apps-script/SheetWebhook.gs). Appelee
    // au moment ou l'organisateur valide un paiement. Laisser vide pour
    // desactiver : le reste continue de fonctionner normalement.
    'sheet_webhook_url'    => '',
    'sheet_webhook_secret' => '',

    // --- Adresses ---
    'site_url' => 'https://afrobrunch.online/',
    'api_url'  => 'https://afrobrunch.online/api/',

    // --- Stockage, hors public_html ---
    'data_dir' => '/home/afrobrunch/data',

    // --- Billetterie ---
    'currency_symbol' => '₱',
    'price_adult'     => 1700,
    'price_child'     => 700,
    'child_ages'      => '7 to 12 years old',
    'infant_ages'     => 'under 7',
    'max_tickets'     => 10,

    // --- Evenement ---
    'event' => [
        'name'    => 'Afro Brunch — Afro Food Experience',
        'date'    => 'Sunday, September 27, 2026',
        'time'    => '4:00 PM — 8:00 PM',
        'venue'   => 'Escalades South Metro',
        'address' => 'Sucat, Parañaque, Metro Manila',
    ],
    'phone1' => '+63 977 078 4280',
    'phone2' => '+63 915 893 2310',
];
