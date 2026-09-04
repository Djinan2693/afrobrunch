/**
 * =============================================================================
 *  AFRO BRUNCH — PASSERELLE VERS LE GOOGLE SHEET
 * =============================================================================
 *
 *  Ce script reçoit une réservation confirmée envoyée par le site
 *  (api/index.php) et l'inscrit dans le Google Sheet auquel il est rattaché.
 *
 *  Il est appelé au moment où l'organisateur clique sur « Validate the
 *  payment » dans son email : le client reçoit son numéro de réservation, et
 *  la même seconde la ligne apparaît dans la feuille.
 *
 *  ---------------------------------------------------------------------------
 *  INSTALLATION — 5 minutes
 *  ---------------------------------------------------------------------------
 *  1. Créez un Google Sheet (sheets.new), nommez-le par exemple
 *     « Afro Brunch — réservations confirmées ».
 *  2. Extensions › Apps Script. Effacez le contenu, collez ce fichier.
 *  3. Remplacez SECRET ci-dessous par une longue phrase inventée par vous,
 *     puis enregistrez.
 *  4. Déployer › Nouveau déploiement › Application web
 *        Exécuter en tant que : moi
 *        Qui a accès        : tout le monde
 *     Copiez l'URL obtenue (elle finit par /exec).
 *  5. Donnez-moi cette URL et le SECRET : je les mets dans la configuration
 *     du serveur et tout s'enchaîne.
 *
 *  À chaque modification de ce fichier, refaites Déployer › Gérer les
 *  déploiements › ✏️ › Version : nouvelle version.
 * =============================================================================
 */


/* << A REMPLIR DANS L'EDITEUR APPS SCRIPT, PAS ICI >>
 *
 * Ce dépôt GitHub est PUBLIC : la vraie clé ne doit jamais figurer dans ce
 * fichier. Écrivez-la uniquement dans l'éditeur Apps Script, où elle reste
 * privée, et communiquez-la pour qu'elle soit reportée dans la configuration
 * du serveur (/home/afrobrunch/afrobrunch-config.php, hors dépôt).
 *
 * Elle empêche n'importe qui d'écrire dans votre feuille. */
var SECRET = 'A_REMPLACER_DANS_L_EDITEUR_APPS_SCRIPT';

var SHEET_NAME = 'Reservations confirmees';

var HEADERS = [
  'Numero de reservation', 'Confirme le', 'Nom', 'Email', 'Telephone',
  'Adultes', 'Enfants 7-12', 'Moins de 7', 'Billets payants', 'Convives',
  'Montant', 'Moyen de paiement', 'Ref. paiement', 'Notes', 'Arrivee pointee'
];


function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);

    if (payload.secret !== SECRET) {
      return json_({ ok: false, error: 'Cle invalide.' });
    }

    var bookings = payload.bookings || (payload.booking ? [payload.booking] : []);
    if (!bookings.length) {
      return json_({ ok: false, error: 'Aucune reservation transmise.' });
    }

    /* Un verrou : deux validations simultanees ne doivent pas s'ecraser. */
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);

    try {
      var sheet = getSheet_();
      var written = 0;

      for (var i = 0; i < bookings.length; i++) {
        writeBooking_(sheet, bookings[i]);
        written++;
      }

      return json_({ ok: true, written: written });

    } finally {
      lock.releaseLock();
    }

  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}


/** Permet de verifier depuis un navigateur que la passerelle repond. */
function doGet() {
  return json_({ ok: true, message: 'Passerelle Afro Brunch active.' });
}


/**
 * Ecrit la reservation. Si son numero est deja present, la ligne est mise a
 * jour au lieu d'etre dupliquee : le renvoi d'une meme reservation est donc
 * sans consequence, ce qui rend la resynchronisation sans risque.
 */
function writeBooking_(sheet, b) {
  var row = [
    b.ref || '',
    b.confirmedAt || '',
    b.name || '',
    b.email || '',
    b.phone || '',
    Number(b.adults) || 0,
    Number(b.children) || 0,
    Number(b.infants) || 0,
    Number(b.tickets) || 0,
    Number(b.guests) || 0,
    Number(b.amount) || 0,
    b.method || '',
    b.payRef || '',
    b.notes || '',
    b.checkedInAt || ''
  ];

  var existing = findRow_(sheet, b.ref);

  if (existing > 0) {
    sheet.getRange(existing, 1, 1, HEADERS.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
}


function findRow_(sheet, ref) {
  if (!ref) return -1;
  var last = sheet.getLastRow();
  if (last < 2) return -1;

  var found = sheet.getRange(2, 1, last - 1, 1)
    .createTextFinder(ref).matchEntireCell(true).findNext();

  return found ? found.getRow() : -1;
}


function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 170);
    sheet.setColumnWidth(3, 200);
    sheet.setColumnWidth(4, 230);
  }

  return sheet;
}


function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}


/**
 * A lancer une fois depuis l'editeur (menu deroulant des fonctions puis
 * Executer) : cela cree la feuille et fait accepter les autorisations.
 */
function setup() {
  var sheet = getSheet_();
  var report = 'Feuille « ' + sheet.getName() + ' » prete, '
    + Math.max(0, sheet.getLastRow() - 1) + ' reservation(s).'
    + (SECRET.indexOf('A_REMPLACER') > -1 ? '\n\nATTENTION : le SECRET est encore celui par defaut.' : '');
  Logger.log(report);
  return report;
}
