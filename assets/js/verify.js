'use strict';

/**
 * AFRO BRUNCH — VERIFICATION D'UN NUMERO DE RESERVATION
 * -----------------------------------------------------------------------------
 * Utilise du JSONP plutot que fetch : une application web Apps Script ne repond
 * pas aux requetes preflight CORS, et le JSONP ne declenche jamais de preflight.
 *
 * URL utiles :
 *   verify.html?ref=AB26-XXXXXX    -> verification immediate (lien du QR code)
 *   verify.html?staff=LA_CLE       -> mode staff : bouton "pointer l'arrivee"
 */

(function () {

  var CFG = window.AFRO_CONFIG || {};
  var form = document.querySelector('[data-verify-form]');
  var input = document.getElementById('vf-ref');
  var out = document.querySelector('[data-verify-result]');
  if (!form) return;

  var params = new URLSearchParams(location.search);
  var staffKey = params.get('staff') || '';

  var esc = function (value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  /* ------------------------------------------------------------------ JSONP */

  var jsonp = function (params) {
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

      params.callback = callback;
      script.src = CFG.API_URL + '?' + new URLSearchParams(params).toString();
      document.body.appendChild(script);
    });
  };

  /* ------------------------------------------------------------- rendu HTML */

  var loading = function (message) {
    out.innerHTML = '<div class="vf-result"><p class="bk-sending" style="margin:0;">' +
      '<span class="bk-spinner" aria-hidden="true"></span> ' + esc(message) + '</p></div>';
  };

  var badge = function (kind, icon, label) {
    return '<span class="vf-badge is-' + kind + '"><ion-icon name="' + icon + '"></ion-icon>' + esc(label) + '</span>';
  };

  var line = function (label, value) {
    return '<div class="vf-line"><span>' + esc(label) + '</span><strong>' + esc(value) + '</strong></div>';
  };

  var render = function (data, ref) {

    if (!data || data.ok === false || !data.found) {
      out.innerHTML = '<div class="vf-result">' +
        badge('bad', 'close-circle-outline', 'Not found') +
        '<p class="vf-msg">No reservation matches <strong>' + esc(ref) + '</strong>. ' +
        'Check the number in your confirmation email, or call ' +
        esc((CFG.CONTACT || {}).phone1 || 'the organiser') + '.</p></div>';
      return;
    }

    var html = '<div class="vf-result">';

    if (data.status === 'CONFIRMED') {
      html += badge('ok', 'checkmark-circle-outline', data.checkedIn ? 'Already checked in' : 'Confirmed');
    } else if (data.status === 'PENDING') {
      html += badge('pending', 'hourglass-outline', 'Awaiting confirmation');
    } else {
      html += badge('bad', 'close-circle-outline', 'Cancelled');
    }

    html += line('Reservation', data.ref);
    html += line('Name', data.name);
    html += line('Tickets', data.qty);
    if (data.confirmedAt) html += line('Confirmed on', data.confirmedAt);
    if (data.checkedInAt) html += line('Checked in at', data.checkedInAt);

    if (data.status === 'PENDING') {
      html += '<p class="vf-msg" style="margin-block-start:18px;">' +
        'Your payment is still being reviewed by the organiser. You will receive a second email ' +
        'with your reservation number as soon as it is validated.</p>';
    } else if (data.status === 'CONFIRMED' && !data.checkedIn) {
      html += '<p class="vf-msg" style="margin-block-start:18px;">' +
        'Your seat is confirmed. Show this number at the door on ' +
        esc((CFG.EVENT || {}).dateLabel || 'the day of the event') + '.</p>';
    }

    /* mode staff : bouton de pointage a l'entree */
    if (staffKey && data.status === 'CONFIRMED' && !data.checkedIn) {
      html += '<div class="vf-staff"><button type="button" class="btn btn-secondary" data-checkin ' +
        'style="margin-inline:auto;"><span class="text text-1">Mark As Checked In</span>' +
        '<span class="text text-2" aria-hidden="true">Mark As Checked In</span></button></div>';
    }

    html += '</div>';
    out.innerHTML = html;

    var checkinBtn = out.querySelector('[data-checkin]');
    if (checkinBtn) {
      checkinBtn.addEventListener('click', function () {
        checkinBtn.disabled = true;
        loading('Checking in…');
        jsonp({ action: 'checkin', ref: data.ref, staff: staffKey })
          .then(function (result) { render(result, data.ref); })
          .catch(function () { fail(); });
      });
    }
  };

  var fail = function () {
    out.innerHTML = '<div class="vf-result">' +
      badge('bad', 'wifi-outline', 'Unavailable') +
      '<p class="vf-msg">We could not reach the reservation server. Check your connection and try again, ' +
      'or call ' + esc((CFG.CONTACT || {}).phone1 || 'the organiser') + '.</p></div>';
  };

  /* ------------------------------------------------------------- recherche */

  var lookup = function (ref) {
    ref = String(ref || '').trim().toUpperCase();
    if (!ref) return;

    if (!CFG.API_URL || CFG.API_URL.indexOf('script.google.com') === -1) {
      out.innerHTML = '<div class="vf-result"><p class="bk-setup" style="margin:0;">' +
        '<strong>Preview.</strong> Reservation look-up goes live once bookings open.</p></div>';
      return;
    }

    loading('Looking up ' + ref + '…');

    jsonp({ action: 'verify', ref: ref })
      .then(function (data) { render(data, ref); })
      .catch(function () { fail(); });
  };

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    lookup(input.value);
  });

  /* normalise la saisie : majuscules et tiret automatique apres "AB26" */
  input.addEventListener('input', function () {
    var raw = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    input.value = raw.length > 4 ? raw.slice(0, 4) + '-' + raw.slice(4, 10) : raw;
  });

  /* pre-remplissage depuis le lien du QR code de l'email de confirmation */
  var preset = params.get('ref');
  if (preset) {
    input.value = preset.toUpperCase();
    lookup(preset);
  }

})();
