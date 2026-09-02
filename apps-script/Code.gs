/**
 * =============================================================================
 *  AFRO BRUNCH — BACKEND DE RESERVATION (Google Apps Script)
 * =============================================================================
 *
 *  Ce fichier fait tout le travail cote serveur :
 *    1. il enregistre chaque demande dans le Google Sheet (statut PENDING) ;
 *    2. il range la capture d'ecran du paiement dans un dossier Google Drive ;
 *    3. il envoie un email a l'acheteur ("demande recue") ;
 *    4. il envoie un email a l'organisateur avec la preuve et deux boutons ;
 *    5. quand l'organisateur clique sur VALIDER : le statut passe a CONFIRMED,
 *       le nom est ajoute a la feuille "Guest list", et l'acheteur recoit son
 *       numero de reservation ;
 *    6. il repond aux verifications de numero faites depuis verify.html.
 *
 *  Installation : voir le README du projet (5 minutes).
 * =============================================================================
 */


/* ============================================================================
 *  CONFIGURATION — LES 4 PREMIERES LIGNES SONT A REMPLIR
 * ========================================================================== */

var CONFIG = {

  /* << A REMPLIR >> Qui recoit les demandes a valider.
     Plusieurs adresses possibles, separees par une virgule. */
  ORGANIZER_EMAILS: 'organisateur@example.com',

  /* Adresse publique du site (GitHub Pages). */
  SITE_URL: 'https://djinan2693.github.io/afrobrunch/',

  /* << A REMPLIR >> Une longue phrase aleatoire, inventee par vous.
     Elle signe les liens de validation : sans elle, n'importe qui pourrait
     valider une reservation. Ne la partagez jamais. */
  SECRET: 'changez-moi-par-une-longue-phrase-aleatoire-42',

  /* << A REMPLIR >> Mot de passe du mode "pointage a l'entree".
     Le jour J, ouvrez verify.html?staff=CE_MOT_DE_PASSE */
  STAFF_KEY: 'afrobrunch-porte-2026',

  /* ---- Le reste peut rester tel quel ---- */

  /* Laissez vide si le script est lie au Google Sheet (Extensions > Apps Script).
     Sinon, collez ici l'identifiant du classeur (le code dans son URL). */
  SHEET_ID: '',

  SHEET_NAME: 'Reservations',
  GUEST_SHEET_NAME: 'Guest list',
  DRIVE_FOLDER_NAME: 'Afro Brunch - Payment proofs',

  TIMEZONE: 'Asia/Manila',
  CURRENCY_SYMBOL: '₱',
  PRICE: 1700,
  MAX_TICKETS: 10,

  EVENT: {
    name: 'Afro Brunch — Afro Food Experience',
    date: 'Sunday, September 27, 2026',
    time: '4:00 PM — 8:00 PM',
    venue: 'Escalades South Metro',
    address: 'Sucat, Parañaque, Metro Manila'
  },

  CONTACT: {
    phone1: '+63 977 078 4280',
    phone2: '+63 915 893 2310'
  }

};


/* ============================================================================
 *  CONSTANTES INTERNES
 * ========================================================================== */

var HEADERS = [
  'Timestamp', 'Reference', 'Status', 'Name', 'Email', 'Phone', 'Tickets',
  'Amount', 'Method', 'Payment ref', 'Proof', 'Notes',
  'Validated at', 'Validated by', 'Checked in at'
];

var COL = {
  timestamp: 1, ref: 2, status: 3, name: 4, email: 5, phone: 6, tickets: 7,
  amount: 8, method: 9, payRef: 10, proof: 11, notes: 12,
  validatedAt: 13, validatedBy: 14, checkedInAt: 15
};

var GOLD = '#D9B871';
var DARK = '#14100B';
var CARD = '#1D1811';


/* ============================================================================
 *  POINTS D'ENTREE HTTP
 * ========================================================================== */

/**
 * Reception d'une nouvelle demande de reservation depuis index.html.
 * Le corps est envoye en text/plain pour eviter le preflight CORS, qu'une
 * application web Apps Script ne sait pas traiter.
 */
function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);

    if (payload.action !== 'book') {
      return jsonOut_({ ok: false, error: 'Unknown action.' });
    }

    return jsonOut_(createBooking_(payload));

  } catch (err) {
    return jsonOut_({ ok: false, error: 'Server error: ' + err.message });
  }
}


/**
 * - validate / reject : liens cliques par l'organisateur dans son email
 * - verify / checkin  : appels JSONP de verify.html
 */
function doGet(e) {
  var p = (e && e.parameter) || {};
  var action = p.action || '';

  try {

    if (action === 'validate' || action === 'reject') {
      return decide_(action, p.ref, p.token);
    }

    if (action === 'verify') {
      return jsonOut_(lookup_(p.ref), p.callback);
    }

    if (action === 'checkin') {
      return jsonOut_(checkIn_(p.ref, p.staff), p.callback);
    }

    if (action === 'ping') {
      return jsonOut_({ ok: true, message: 'Afro Brunch backend is running.' }, p.callback);
    }

    return page_('Afro Brunch', 'This link is not valid.',
      'Nothing to do here — open the website to book a seat.');

  } catch (err) {
    return page_('Something went wrong', err.message,
      'Please try the link again, or open the Google Sheet directly.');
  }
}


/* ============================================================================
 *  1. CREATION DE LA RESERVATION
 * ========================================================================== */

function createBooking_(p) {

  var name = String(p.name || '').trim();
  var email = String(p.email || '').trim();
  var qty = Math.max(1, Math.min(CONFIG.MAX_TICKETS, parseInt(p.qty, 10) || 1));

  if (!name || !email.match(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/)) {
    return { ok: false, error: 'Name and a valid email address are required.' };
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var sheet = getSheet_();

    /* La reference vient du navigateur : on la garde si elle est libre, on en
       genere une autre en cas de collision (peu probable, mais gratuit). */
    var ref = normalizeRef_(p.ref);
    if (!ref || findRow_(sheet, ref) > 0) ref = uniqueRef_(sheet);

    var amount = qty * CONFIG.PRICE;
    var proofFile = saveProof_(p.proof, ref, name);

    sheet.appendRow([
      new Date(),
      ref,
      'PENDING',
      name,
      email,
      String(p.phone || ''),
      qty,
      amount,
      String(p.methodLabel || p.method || ''),
      String(p.payRef || ''),
      proofFile ? proofFile.getUrl() : '',
      String(p.notes || ''),
      '', '', ''
    ]);

    var booking = {
      ref: ref, name: name, email: email, phone: String(p.phone || ''),
      qty: qty, amount: amount, method: String(p.methodLabel || p.method || ''),
      payRef: String(p.payRef || ''), notes: String(p.notes || '')
    };

    /* Les emails ne doivent jamais faire echouer l'enregistrement : la ligne
       est deja dans le Sheet, l'organisateur peut la traiter a la main. */
    try { mailBuyerPending_(booking); } catch (err) { logMailError_('buyer-pending', ref, err); }
    try { mailOrganizer_(booking, proofFile); } catch (err) { logMailError_('organizer', ref, err); }

    return { ok: true, ref: ref };

  } finally {
    lock.releaseLock();
  }
}


/**
 * Range la capture d'ecran dans Drive. Le fichier reste prive : l'organisateur
 * la recoit directement dans le corps de son email, il n'y a donc aucun lien
 * public a faire circuler.
 */
function saveProof_(proof, ref, name) {
  if (!proof || !proof.data) return null;

  try {
    var bytes = Utilities.base64Decode(proof.data);
    var blob = Utilities.newBlob(bytes, proof.mime || 'image/jpeg',
      ref + ' - ' + name + '.jpg');
    return getFolder_().createFile(blob);
  } catch (err) {
    return null;
  }
}


/* ============================================================================
 *  2. DECISION DE L'ORGANISATEUR (lien clique dans l'email)
 * ========================================================================== */

function decide_(action, ref, token) {

  ref = normalizeRef_(ref);

  if (!ref || token !== signature_(ref, action)) {
    return page_('Invalid link',
      'This validation link is not valid or has been altered.',
      'Open the Google Sheet and change the status by hand if needed.');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var sheet = getSheet_();
    var row = findRow_(sheet, ref);

    if (row < 1) {
      return page_('Not found', 'No booking matches ' + ref + '.', '');
    }

    var booking = readRow_(sheet, row);

    if (booking.status !== 'PENDING') {
      return page_('Already handled',
        ref + ' is already marked as ' + booking.status + '.',
        booking.validatedAt ? 'Handled on ' + booking.validatedAt + '.' : '');
    }

    if (action === 'validate') {
      sheet.getRange(row, COL.status).setValue('CONFIRMED');
      sheet.getRange(row, COL.validatedAt).setValue(now_());
      sheet.getRange(row, COL.validatedBy).setValue(currentUser_());

      addToGuestList_(booking);

      try {
        mailBuyerConfirmed_(booking);
      } catch (err) {
        logMailError_('buyer-confirmed', ref, err);
        return page_('Confirmed — but the email failed',
          ref + ' is confirmed and added to the guest list.',
          'The confirmation email could not be sent (' + err.message +
          '). Contact ' + booking.email + ' directly.');
      }

      return page_('Payment validated',
        booking.name + ' · ' + booking.qty + ' ticket(s) · ' + ref,
        'The guest has been emailed their reservation number and added to the guest list.');
    }

    sheet.getRange(row, COL.status).setValue('CANCELLED');
    sheet.getRange(row, COL.validatedAt).setValue(now_());
    sheet.getRange(row, COL.validatedBy).setValue(currentUser_());

    try { mailBuyerRejected_(booking); } catch (err) { logMailError_('buyer-rejected', ref, err); }

    return page_('Booking rejected',
      ref + ' has been marked as cancelled.',
      booking.name + ' has been told the payment could not be matched.');

  } finally {
    lock.releaseLock();
  }
}


/**
 * La liste d'entree : une feuille propre, triee par ordre de validation,
 * a imprimer ou a ouvrir sur un telephone le jour J.
 */
function addToGuestList_(booking) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG.GUEST_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.GUEST_SHEET_NAME);
    sheet.appendRow(['Reservation', 'Name', 'Tickets', 'Email', 'Phone',
      'Confirmed at', 'Notes', 'Checked in at']);
    sheet.getRange(1, 1, 1, 8).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  sheet.appendRow([booking.ref, booking.name, booking.qty, booking.email,
    booking.phone, now_(), booking.notes, '']);
}


/* ============================================================================
 *  3. VERIFICATION ET POINTAGE A L'ENTREE
 * ========================================================================== */

function lookup_(ref) {
  ref = normalizeRef_(ref);
  if (!ref) return { ok: true, found: false };

  var sheet = getSheet_();
  var row = findRow_(sheet, ref);
  if (row < 1) return { ok: true, found: false };

  var booking = readRow_(sheet, row);

  return {
    ok: true,
    found: true,
    ref: booking.ref,
    name: booking.name,
    qty: booking.qty,
    status: booking.status,
    confirmedAt: booking.status === 'CONFIRMED' ? booking.validatedAt : '',
    checkedIn: !!booking.checkedInAt,
    checkedInAt: booking.checkedInAt
  };
}


function checkIn_(ref, staffKey) {
  if (staffKey !== CONFIG.STAFF_KEY) {
    return { ok: false, error: 'Invalid staff key.' };
  }

  ref = normalizeRef_(ref);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var sheet = getSheet_();
    var row = findRow_(sheet, ref);
    if (row < 1) return { ok: true, found: false };

    var booking = readRow_(sheet, row);

    if (booking.status !== 'CONFIRMED') {
      return { ok: false, error: 'This booking is ' + booking.status + ', not confirmed.' };
    }

    if (!booking.checkedInAt) {
      sheet.getRange(row, COL.checkedInAt).setValue(now_());
      markGuestListCheckIn_(ref);
    }

    return lookup_(ref);

  } finally {
    lock.releaseLock();
  }
}


function markGuestListCheckIn_(ref) {
  var sheet = getSpreadsheet_().getSheetByName(CONFIG.GUEST_SHEET_NAME);
  if (!sheet) return;

  var found = sheet.getRange(1, 1, sheet.getLastRow(), 1).createTextFinder(ref)
    .matchEntireCell(true).findNext();
  if (found) sheet.getRange(found.getRow(), 8).setValue(now_());
}


/* ============================================================================
 *  4. EMAILS
 * ========================================================================== */

function mailBuyerPending_(b) {
  var body = emailShell_(
    'Booking received',
    'We have your request for <strong>' + esc_(b.name) + '</strong> — ' +
    b.qty + ' ticket(s) for ' + CONFIG.EVENT.name + '.',
    '<p style="margin:0 0 18px;">The organiser is now checking the payment you sent. ' +
    'As soon as it is validated you will receive a second email containing your ' +
    '<strong style="color:' + GOLD + ';">reservation number</strong> — that is the one to ' +
    'show at the door.</p>' +
    refBox_('Your booking reference', b.ref) +
    detailsTable_(b) +
    '<p style="margin:22px 0 0;font-size:13px;color:#9b9186;">This is not your entry ticket yet. ' +
    'Keep this email until you receive the confirmation.</p>'
  );

  MailApp.sendEmail({
    to: b.email,
    replyTo: firstOrganizer_(),
    name: 'Afro Brunch',
    subject: 'We received your Afro Brunch booking (' + b.ref + ')',
    htmlBody: body
  });
}


function mailOrganizer_(b, proofFile) {

  var validateUrl = actionUrl_('validate', b.ref);
  var rejectUrl = actionUrl_('reject', b.ref);

  var html = emailShell_(
    'New booking to validate',
    esc_(b.name) + ' · ' + b.qty + ' ticket(s) · ' + money_(b.amount),
    detailsTable_(b) +

    '<p style="margin:26px 0 12px;font-size:13px;letter-spacing:2px;text-transform:uppercase;' +
    'color:' + GOLD + ';">Proof of payment</p>' +

    (proofFile
      ? '<img src="cid:proof" alt="Proof of payment" style="max-width:100%;border-radius:8px;' +
        'border:1px solid rgba(217,184,113,.25);">'
      : '<p style="margin:0;color:#c96b4a;">No screenshot was attached to this booking.</p>') +

    '<p style="margin:30px 0 14px;font-size:13px;letter-spacing:2px;text-transform:uppercase;' +
    'color:' + GOLD + ';">Your decision</p>' +

    '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 8px;"><tr>' +
    '<td style="padding-right:12px;">' + button_(validateUrl, 'Validate the payment', GOLD, DARK) + '</td>' +
    '<td>' + button_(rejectUrl, 'Reject', 'transparent', '#c96b4a', '#c96b4a') + '</td>' +
    '</tr></table>' +

    '<p style="margin:18px 0 0;font-size:12px;color:#8a8178;">Validating sends ' +
    esc_(b.name) + ' their reservation number and adds them to the "' +
    CONFIG.GUEST_SHEET_NAME + '" sheet. These links work once.</p>'
  );

  var message = {
    to: CONFIG.ORGANIZER_EMAILS,
    name: 'Afro Brunch Bookings',
    replyTo: b.email,
    subject: '[Afro Brunch] Validate — ' + b.name + ' · ' + b.qty +
      ' ticket(s) · ' + money_(b.amount),
    htmlBody: html
  };

  if (proofFile) message.inlineImages = { proof: proofFile.getBlob() };

  MailApp.sendEmail(message);
}


function mailBuyerConfirmed_(b) {

  var verifyUrl = CONFIG.SITE_URL + 'verify.html?ref=' + encodeURIComponent(b.ref);
  var qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=10&data=' +
    encodeURIComponent(verifyUrl);

  var body = emailShell_(
    'You’re in — see you on the 27th',
    'Payment confirmed for <strong>' + esc_(b.name) + '</strong> · ' + b.qty + ' ticket(s).',

    refBox_('Your reservation number', b.ref) +

    '<p style="margin:0 0 22px;text-align:center;">' +
    '<img src="' + qrUrl + '" width="240" height="240" alt="Reservation QR code" ' +
    'style="border-radius:12px;background:#fff;padding:8px;"><br>' +
    '<span style="font-size:12px;color:#9b9186;">Show this number or QR code at the door.</span></p>' +

    detailsTable_(b) +

    '<p style="margin:24px 0 12px;font-size:13px;letter-spacing:2px;text-transform:uppercase;' +
    'color:' + GOLD + ';">Where &amp; when</p>' +

    '<p style="margin:0 0 6px;font-size:16px;color:#efe6d8;">' + CONFIG.EVENT.date + '</p>' +
    '<p style="margin:0 0 6px;font-size:16px;color:#efe6d8;">' + CONFIG.EVENT.time + '</p>' +
    '<p style="margin:0 0 22px;font-size:16px;color:#efe6d8;">' + CONFIG.EVENT.venue + ', ' +
    CONFIG.EVENT.address + '</p>' +

    button_(verifyUrl, 'Check my reservation', GOLD, DARK) +

    '<p style="margin:26px 0 0;font-size:13px;color:#9b9186;">Come hungry. Leave happy. ' +
    'Questions: ' + CONFIG.CONTACT.phone1 + ' or ' + CONFIG.CONTACT.phone2 + '.</p>'
  );

  MailApp.sendEmail({
    to: b.email,
    replyTo: firstOrganizer_(),
    name: 'Afro Brunch',
    subject: 'Confirmed — your Afro Brunch reservation ' + b.ref,
    htmlBody: body
  });
}


function mailBuyerRejected_(b) {
  var body = emailShell_(
    'We could not confirm your payment',
    'Booking ' + b.ref + ' for ' + esc_(b.name) + ' has been put on hold.',
    '<p style="margin:0 0 18px;">The organiser could not match your payment with the ' +
    'reference you sent. Nothing is lost — get in touch and we will sort it out.</p>' +
    detailsTable_(b) +
    '<p style="margin:22px 0 0;">Call or message us on <strong style="color:' + GOLD + ';">' +
    CONFIG.CONTACT.phone1 + '</strong> or <strong style="color:' + GOLD + ';">' +
    CONFIG.CONTACT.phone2 + '</strong>.</p>'
  );

  MailApp.sendEmail({
    to: b.email,
    replyTo: firstOrganizer_(),
    name: 'Afro Brunch',
    subject: 'About your Afro Brunch booking ' + b.ref,
    htmlBody: body
  });
}


/* ---------------------------------------------------------- gabarits email */

function emailShell_(title, lead, content) {
  return '' +
    '<div style="margin:0;padding:24px 12px;background:#0d0a07;font-family:Helvetica,Arial,sans-serif;">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" ' +
    'style="max-width:600px;margin:0 auto;background:' + CARD + ';border-top:3px solid ' + GOLD + ';">' +
    '<tr><td style="padding:34px 30px 30px;">' +

    '<p style="margin:0 0 6px;font-size:12px;letter-spacing:4px;text-transform:uppercase;' +
    'color:' + GOLD + ';">Afro Brunch</p>' +

    '<h1 style="margin:0 0 10px;font-size:26px;line-height:1.25;color:#ffffff;font-weight:normal;">' +
    title + '</h1>' +

    '<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#b9ad9d;">' + lead + '</p>' +

    '<div style="font-size:15px;line-height:1.6;color:#d8cec0;">' + content + '</div>' +

    '</td></tr>' +
    '<tr><td style="padding:18px 30px 26px;border-top:1px solid rgba(217,184,113,.15);' +
    'font-size:12px;color:#7d7469;">' +
    CONFIG.EVENT.name + ' · ' + CONFIG.EVENT.date + ' · ' + CONFIG.EVENT.venue +
    '</td></tr></table></div>';
}


function refBox_(label, ref) {
  return '' +
    '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" ' +
    'style="margin:0 0 22px;"><tr><td align="center" ' +
    'style="padding:20px;border:1px dashed ' + GOLD + ';background:rgba(217,184,113,.06);">' +
    '<div style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:' + GOLD +
    ';margin-bottom:10px;">' + label + '</div>' +
    '<div style="font-size:30px;letter-spacing:4px;color:' + GOLD + ';font-weight:bold;">' +
    ref + '</div></td></tr></table>';
}


function detailsTable_(b) {
  var rows = [
    ['Name', b.name],
    ['Tickets', String(b.qty)],
    ['Amount', money_(b.amount)],
    ['Email', b.email],
    ['Phone', b.phone],
    ['Paid with', b.method],
    ['Payment ref.', b.payRef]
  ];

  if (b.notes) rows.push(['Notes', b.notes]);

  var html = '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" ' +
    'style="border-collapse:collapse;font-size:14px;">';

  for (var i = 0; i < rows.length; i++) {
    html += '<tr>' +
      '<td style="padding:9px 0;color:#8a8178;border-bottom:1px solid rgba(255,255,255,.06);">' +
      rows[i][0] + '</td>' +
      '<td align="right" style="padding:9px 0;color:#efe6d8;font-weight:bold;' +
      'border-bottom:1px solid rgba(255,255,255,.06);">' + esc_(rows[i][1]) + '</td></tr>';
  }

  return html + '</table>';
}


function button_(url, label, bg, color, border) {
  return '<a href="' + url + '" style="display:inline-block;padding:14px 26px;background:' + bg +
    ';color:' + color + ';border:2px solid ' + (border || bg) + ';text-decoration:none;' +
    'font-size:13px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;">' +
    label + '</a>';
}


/* ============================================================================
 *  5. PAGE DE REPONSE APRES UN CLIC DE L'ORGANISATEUR
 * ========================================================================== */

function page_(title, lead, note) {
  var html = '' +
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + esc_(title) + ' — Afro Brunch</title></head>' +
    '<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;' +
    'background:#0d0a07;font-family:Helvetica,Arial,sans-serif;padding:24px;">' +
    '<div style="max-width:460px;width:100%;background:' + CARD + ';border-top:3px solid ' + GOLD +
    ';padding:40px 30px;text-align:center;">' +
    '<p style="margin:0 0 8px;font-size:12px;letter-spacing:4px;text-transform:uppercase;color:' +
    GOLD + ';">Afro Brunch</p>' +
    '<h1 style="margin:0 0 14px;font-size:26px;color:#fff;font-weight:normal;">' + esc_(title) + '</h1>' +
    '<p style="margin:0 0 10px;font-size:16px;line-height:1.6;color:#d8cec0;">' + esc_(lead) + '</p>' +
    (note ? '<p style="margin:0;font-size:13px;line-height:1.6;color:#8a8178;">' + esc_(note) + '</p>' : '') +
    '</div></body></html>';

  return HtmlService.createHtmlOutput(html)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}


/* ============================================================================
 *  6. OUTILS
 * ========================================================================== */

function getSpreadsheet_() {
  if (CONFIG.SHEET_ID) return SpreadsheetApp.openById(CONFIG.SHEET_ID);

  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;

  throw new Error('No spreadsheet found: bind the script to a Google Sheet, ' +
    'or fill in CONFIG.SHEET_ID.');
}


function getSheet_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG.SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAME);
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  return sheet;
}


function getFolder_() {
  var found = DriveApp.getFoldersByName(CONFIG.DRIVE_FOLDER_NAME);
  return found.hasNext() ? found.next() : DriveApp.createFolder(CONFIG.DRIVE_FOLDER_NAME);
}


function findRow_(sheet, ref) {
  var last = sheet.getLastRow();
  if (last < 2) return -1;

  var found = sheet.getRange(2, COL.ref, last - 1, 1)
    .createTextFinder(ref).matchEntireCell(true).findNext();

  return found ? found.getRow() : -1;
}


function readRow_(sheet, row) {
  var values = sheet.getRange(row, 1, 1, HEADERS.length).getValues()[0];

  return {
    ref: String(values[COL.ref - 1]),
    status: String(values[COL.status - 1]),
    name: String(values[COL.name - 1]),
    email: String(values[COL.email - 1]),
    phone: String(values[COL.phone - 1]),
    qty: Number(values[COL.tickets - 1]) || 1,
    amount: Number(values[COL.amount - 1]) || 0,
    method: String(values[COL.method - 1]),
    payRef: String(values[COL.payRef - 1]),
    notes: String(values[COL.notes - 1]),
    validatedAt: values[COL.validatedAt - 1] ? String(values[COL.validatedAt - 1]) : '',
    checkedInAt: values[COL.checkedInAt - 1] ? String(values[COL.checkedInAt - 1]) : ''
  };
}


var REF_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function uniqueRef_(sheet) {
  for (var attempt = 0; attempt < 20; attempt++) {
    var body = '';
    for (var i = 0; i < 6; i++) {
      body += REF_ALPHABET.charAt(Math.floor(Math.random() * REF_ALPHABET.length));
    }
    var ref = 'AB26-' + body;
    if (findRow_(sheet, ref) < 1) return ref;
  }
  return 'AB26-' + Date.now().toString(36).toUpperCase();
}


function normalizeRef_(ref) {
  ref = String(ref || '').trim().toUpperCase();
  return /^AB26-[A-Z0-9]{4,10}$/.test(ref) ? ref : '';
}


/**
 * Signe une action pour une reference donnee. Les liens de l'email ne sont
 * donc valides que pour cette reservation et cette action precise.
 */
function signature_(ref, action) {
  var raw = Utilities.computeHmacSha256Signature(action + ':' + ref, CONFIG.SECRET);
  return Utilities.base64EncodeWebSafe(raw).replace(/=+$/, '').substring(0, 24);
}


function actionUrl_(action, ref) {
  return ScriptApp.getService().getUrl() +
    '?action=' + action +
    '&ref=' + encodeURIComponent(ref) +
    '&token=' + encodeURIComponent(signature_(ref, action));
}


function jsonOut_(data, callback) {
  var json = JSON.stringify(data);

  if (callback && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(callback)) {
    return ContentService.createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}


function now_() {
  return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'dd/MM/yyyy HH:mm');
}


function money_(amount) {
  return CONFIG.CURRENCY_SYMBOL + Number(amount).toLocaleString('en-US');
}


function firstOrganizer_() {
  return String(CONFIG.ORGANIZER_EMAILS).split(',')[0].trim();
}


function currentUser_() {
  try { return Session.getActiveUser().getEmail() || 'organiser'; }
  catch (err) { return 'organiser'; }
}


function esc_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}


function logMailError_(kind, ref, err) {
  console.error('Email failed [' + kind + '] for ' + ref + ': ' + err.message);
}


/* ============================================================================
 *  7. A LANCER UNE FOIS DEPUIS L'EDITEUR APPS SCRIPT
 * ==========================================================================
 *  Selectionnez "setup" dans la liste des fonctions puis cliquez sur Executer.
 *  Cela cree les feuilles et le dossier Drive, et vous fait accepter les
 *  autorisations une bonne fois pour toutes.
 */
function setup() {
  var sheet = getSheet_();
  var folder = getFolder_();

  var problems = [];
  if (CONFIG.ORGANIZER_EMAILS.indexOf('example.com') > -1) problems.push('ORGANIZER_EMAILS');
  if (CONFIG.SECRET.indexOf('changez-moi') > -1) problems.push('SECRET');

  var report =
    'Feuille   : ' + sheet.getName() + ' (' + Math.max(0, sheet.getLastRow() - 1) + ' reservations)\n' +
    'Dossier   : ' + folder.getName() + '\n' +
    'Quota mail: ' + MailApp.getRemainingDailyQuota() + ' emails restants aujourd\'hui\n' +
    'A remplir : ' + (problems.length ? problems.join(', ') : 'rien, tout est configure');

  console.log(report);
  return report;
}


/**
 * Envoie a l'organisateur un faux email de validation, pour verifier la mise
 * en page et le fonctionnement des boutons avant l'ouverture des ventes.
 */
function sendTestEmail() {
  mailOrganizer_({
    ref: 'AB26-TEST99',
    name: 'Test Guest',
    email: firstOrganizer_(),
    phone: CONFIG.CONTACT.phone1,
    qty: 2,
    amount: 2 * CONFIG.PRICE,
    method: 'GCash',
    payRef: '1234567890',
    notes: 'Ceci est un test.'
  }, null);

  return 'Email de test envoye a ' + CONFIG.ORGANIZER_EMAILS;
}
