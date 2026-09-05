'use strict';

/**
 * AFRO BRUNCH — VERIFICATION D'UNE RESERVATION
 * -----------------------------------------------------------------------------
 * Deux facons de chercher :
 *   1. par numero de reservation  (action=verify)
 *   2. par adresse email          (action=find) — pour ceux qui l'ont perdu
 *
 * On passe par du JSONP plutot que fetch : une application web Apps Script ne
 * repond pas aux requetes preflight CORS, et le JSONP n'en declenche jamais.
 *
 * URL utiles :
 *   verify.html?ref=AB26-XXXXXX    -> verification immediate (lien du QR code)
 *   verify.html?staff=LA_CLE       -> mode staff : pointage des arrivees, et
 *                                     recherche par nom seul autorisee
 */

(function () {

  var CFG = window.AFRO_CONFIG || {};
  var out = document.querySelector('[data-verify-result]');
  var refForm = document.querySelector('[data-verify-form]');
  var findForm = document.querySelector('[data-find-form]');
  if (!refForm || !findForm) return;

  var refInput = document.getElementById('vf-ref');
  var emailInput = document.getElementById('vf-email');
  var nameInput = document.getElementById('vf-name');
  var findHint = document.querySelector('[data-find-hint]');

  var params = new URLSearchParams(location.search);
  var staffKey = params.get('staff') || '';

  var esc = function (value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  var configured = function () {
    return CFG.API_URL && CFG.API_URL.indexOf('PASTE_YOUR') === -1;
  };

  /* ------------------------------------------------------------------ JSONP */

  var jsonp = function (query) {
    return new Promise(function (resolve, reject) {
      var callback = 'afroCb' + Date.now() + Math.floor(Math.random() * 1000);
      var script = document.createElement('script');

      var timer = setTimeout(function () {
        cleanup();
        reject(new Error('timeout'));
      }, 20000);

      function cleanup() {
        clearTimeout(timer);
        delete window[callback];
        if (script.parentNode) script.parentNode.removeChild(script);
      }

      window[callback] = function (data) {
        cleanup();
        resolve(data);
      };

      script.onerror = function () {
        cleanup();
        reject(new Error('network'));
      };

      query.callback = callback;
      script.src = CFG.API_URL + (CFG.API_URL.indexOf('?') > -1 ? '&' : '?') + new URLSearchParams(query).toString();
      document.body.appendChild(script);
    });
  };

  /* ------------------------------------------------------- fragments de rendu */

  var loading = function (message) {
    out.innerHTML = '<div class="vf-result"><p class="bk-sending" style="margin:0;">' +
      '<span class="bk-spinner" aria-hidden="true"></span> ' + esc(message) + '</p></div>';
  };

  var badge = function (kind, icon, label) {
    return '<span class="vf-badge is-' + kind + '"><ion-icon name="' + icon + '"></ion-icon>' +
      esc(label) + '</span>';
  };

  var line = function (label, value) {
    return '<div class="vf-line"><span>' + esc(label) + '</span><strong>' + esc(value) + '</strong></div>';
  };

  var note = function (text) {
    return '<p class="vf-msg" style="margin-block-start:18px;">' + text + '</p>';
  };

  var problem = function (kind, icon, label, text) {
    out.innerHTML = '<div class="vf-result">' + badge(kind, icon, label) +
      '<p class="vf-msg">' + text + '</p></div>';
  };

  var phone = function () {
    var c = CFG.CONTACT || {};
    if (c.phone1 && c.phone2) return esc(c.phone1) + ' or ' + esc(c.phone2);
    return esc(c.phone1 || c.phone2 || 'the organiser');
  };

  /* Carte d'une reservation, commune aux deux modes de recherche. */
  var card = function (b) {
    var html = '<div class="vf-result">';

    if (b.status === 'CONFIRMED') {
      html += badge('ok', 'checkmark-circle-outline', b.checkedIn ? 'Already checked in' : 'Confirmed');
    } else if (b.status === 'PENDING') {
      html += badge('pending', 'hourglass-outline', 'Awaiting confirmation');
    } else {
      html += badge('bad', 'close-circle-outline', 'Cancelled');
    }

    html += line('Reservation', b.ref);
    html += line('Name', b.name);

    /* on detaille adultes / enfants seulement si l'information existe */
    if (b.adults || b.children || b.infants) {
      html += line('Adults', b.adults);
      if (b.children) html += line('Children', b.children);
      if (b.infants) html += line('Under 7 (free)', b.infants);
    }
    html += line('Tickets', b.qty);

    if (b.confirmedAt) html += line('Confirmed on', b.confirmedAt);
    if (b.checkedInAt) html += line('Checked in at', b.checkedInAt);

    if (b.status === 'PENDING') {
      html += note('Your payment is still being reviewed by the organiser. You will receive a second ' +
        'email with your reservation number as soon as it is validated.');
    } else if (b.status === 'CONFIRMED' && !b.checkedIn) {
      html += note('Your seat is confirmed. Show this number at the door on ' +
        esc((CFG.EVENT || {}).dateLabel || 'the day of the event') + '.');
    }

    if (staffKey && b.status === 'CONFIRMED' && !b.checkedIn) {
      html += '<div class="vf-staff"><button type="button" class="btn btn-secondary" ' +
        'data-checkin-ref="' + esc(b.ref) + '" style="margin-inline:auto;">' +
        '<span class="text text-1">Mark As Checked In</span>' +
        '<span class="text text-2" aria-hidden="true">Mark As Checked In</span></button></div>';
    }

    return html + '</div>';
  };

  /* Rebranche les boutons de pointage apres chaque rendu. */
  var wireCheckIn = function () {
    Array.prototype.forEach.call(out.querySelectorAll('[data-checkin-ref]'), function (button) {
      button.addEventListener('click', function () {
        var ref = button.dataset.checkinRef;
        button.disabled = true;
        loading('Checking in ' + ref + '…');

        jsonp({ action: 'checkin', ref: ref, staff: staffKey })
          .then(function (result) {
            if (result && result.ok === false) {
              problem('bad', 'alert-circle-outline', 'Not possible', esc(result.error));
              return;
            }
            showOne(result, ref);
          })
          .catch(fail);
      });
    });
  };

  var fail = function () {
    problem('bad', 'wifi-outline', 'Unavailable',
      'We could not reach the reservation server. Check your connection and try again, ' +
      'or call ' + phone() + '.');
  };

  var preview = function () {
    out.innerHTML = '<div class="vf-result"><p class="bk-setup" style="margin:0;">' +
      '<strong>Preview.</strong> Reservation look-up goes live once bookings open.</p></div>';
  };

  /* ------------------------------------------- 1. recherche par numero */

  var showOne = function (data, ref) {
    if (!data || data.ok === false || !data.found) {
      problem('bad', 'close-circle-outline', 'Not found',
        'No reservation matches <strong>' + esc(ref) + '</strong>. Check the number in your ' +
        'confirmation email, use the <em>I lost my number</em> tab, or call ' + phone() + '.');
      return;
    }

    out.innerHTML = card(data);
    wireCheckIn();
  };

  var lookup = function (ref) {
    ref = String(ref || '').trim().toUpperCase();
    if (!ref) return;
    if (!configured()) return preview();

    loading('Looking up ' + ref + '…');

    jsonp({ action: 'verify', ref: ref })
      .then(function (data) { showOne(data, ref); })
      .catch(fail);
  };

  /* --------------------------------------------- 2. recherche par email */

  var showMany = function (data, what) {
    if (!data || data.ok === false) {
      problem('bad', 'alert-circle-outline', 'Cannot search',
        esc((data && data.error) || 'Please try again.'));
      return;
    }

    if (!data.count) {
      problem('bad', 'close-circle-outline', 'Nothing found',
        'No booking is registered under <strong>' + esc(what) + '</strong>. ' +
        'It may have been made with a different email address — call ' + phone() + ' and we will find it.');
      return;
    }

    var header = '<p class="vf-msg vf-count">' + data.count +
      (data.count > 1 ? ' bookings found' : ' booking found') + '</p>';

    out.innerHTML = header + data.results.map(card).join('');
    wireCheckIn();
  };

  var findBooking = function (email, name) {
    if (!configured()) return preview();

    var query = { action: 'find' };
    if (email) query.email = email;
    if (name) query.name = name;
    if (staffKey) query.staff = staffKey;

    loading('Searching…');

    jsonp(query)
      .then(function (data) { showMany(data, email || name); })
      .catch(fail);
  };

  /* ------------------------------------------------------------- onglets */

  var setMode = function (mode) {
    Array.prototype.forEach.call(document.querySelectorAll('[data-mode]'), function (tab) {
      var on = tab.dataset.mode === mode;
      tab.classList.toggle('is-active', on);
      tab.setAttribute('aria-selected', String(on));
    });

    Array.prototype.forEach.call(document.querySelectorAll('[data-panel]'), function (panel) {
      panel.hidden = panel.dataset.panel !== mode;
    });

    out.innerHTML = '';
    (mode === 'ref' ? refInput : emailInput).focus();
  };

  Array.prototype.forEach.call(document.querySelectorAll('[data-mode]'), function (tab) {
    tab.addEventListener('click', function () { setMode(tab.dataset.mode); });
  });

  /* ------------------------------------------------------------ formulaires */

  refForm.addEventListener('submit', function (event) {
    event.preventDefault();
    lookup(refInput.value);
  });

  findForm.addEventListener('submit', function (event) {
    event.preventDefault();

    var email = emailInput.value.trim();
    var name = nameInput.value.trim();

    /* Le public doit fournir l'email : sans cette contrainte, n'importe qui
       pourrait parcourir la liste des invites en tapant des noms au hasard. */
    if (!email && !(staffKey && name)) {
      problem('pending', 'mail-outline', 'Email needed',
        'Enter the email address you used when booking. It is the only way we can be sure ' +
        'the booking is yours.');
      emailInput.focus();
      return;
    }

    findBooking(email, name);
  });

  /* normalise la saisie du numero : majuscules et tiret automatique apres AB26 */
  refInput.addEventListener('input', function () {
    var raw = refInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    refInput.value = raw.length > 4 ? raw.slice(0, 4) + '-' + raw.slice(4, 10) : raw;
  });

  /* ------------------------------------------------------------- demarrage */

  if (staffKey && findHint) {
    findHint.innerHTML = '<strong>Staff mode.</strong> You can search by name alone — ' +
      'partial names work too.';
    emailInput.removeAttribute('required');
  }

  var preset = params.get('ref');
  if (preset) {
    refInput.value = preset.toUpperCase();
    lookup(preset);
  }

})();
