'use strict';

/**
 * AFRO BRUNCH — LISTE D'ATTENTE DE LA PROCHAINE EDITION
 * -----------------------------------------------------------------------------
 * Remplace le tunnel de reservation depuis la fin de l'edition 2026.
 * Envoie l'adresse a api/index.php (action « subscribe »), qui l'enregistre
 * et accuse reception par email.
 */

(function () {

  var CFG = window.AFRO_CONFIG || {};
  var form = document.querySelector('[data-waitlist]');
  if (!form) return;

  var nameInput = document.getElementById('wl-name');
  var emailInput = document.getElementById('wl-email');
  var errorBox = form.querySelector('[data-wl-error]');
  var sending = form.querySelector('[data-wl-sending]');
  var submit = form.querySelector('.tx-submit');
  var done = document.querySelector('[data-wl-done]');
  var doneText = document.querySelector('[data-wl-done-text]');

  var isEmail = function (v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v); };

  var fail = function (message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  };

  var contact = function () {
    var c = CFG.CONTACT || {};
    return c.phone1 && c.phone2 ? c.phone1 + ' or ' + c.phone2 : (c.phone1 || 'us');
  };

  form.addEventListener('submit', function (event) {
    event.preventDefault();

    var email = emailInput.value.trim();
    var name = nameInput.value.trim();

    emailInput.classList.remove('is-invalid');
    errorBox.hidden = true;

    if (!isEmail(email)) {
      emailInput.classList.add('is-invalid');
      fail('Please enter a valid email address so we can reach you.');
      emailInput.focus();
      return;
    }

    if (!CFG.API_URL || CFG.API_URL.indexOf('PASTE_YOUR') > -1) {
      fail('The list is not open yet. Call ' + contact() + ' and we will add you by hand.');
      return;
    }

    sending.hidden = false;
    submit.disabled = true;

    /* Corps en text/plain : une requete « simple », qui evite le preflight CORS
       et fonctionne aussi depuis la copie GitHub Pages. */
    fetch(CFG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'subscribe', email: email, name: name })
    })
      .then(function (r) { return r.json(); })
      .then(function (result) {
        sending.hidden = true;
        submit.disabled = false;

        if (!result || result.ok === false) {
          fail((result && result.error) || 'Something went wrong. Please try again in a moment.');
          return;
        }

        form.hidden = true;
        doneText.innerHTML = result.already
          ? 'You were already on the list &mdash; nothing to do. We will email you as soon as the '
            + 'next date is set.'
          : 'You are on the list. We will email you as soon as the date of the next Afro Brunch '
            + 'is set, before the tickets go on sale.';
        done.hidden = false;
      })
      .catch(function () {
        sending.hidden = true;
        submit.disabled = false;
        fail('We could not reach the server. Check your connection, or call ' + contact() + '.');
      });
  });

})();
