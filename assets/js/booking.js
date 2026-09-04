'use strict';

/**
 * AFRO BRUNCH — TUNNEL DE RESERVATION SEMI-MANUEL
 * -----------------------------------------------------------------------------
 * Etape 1 : coordonnees            Etape 3 : reference + capture d'ecran
 * Etape 2 : QR GCash / BPI         Etape 4 : confirmation
 *
 * L'envoi se fait vers l'application web Google Apps Script definie dans
 * assets/js/config.js (AFRO_CONFIG.API_URL).
 */

(function () {

  var CFG = window.AFRO_CONFIG || {};
  var root = document.getElementById('booking');
  if (!root) return;

  /* ---------------------------------------------------------------- helpers */

  var $ = function (sel, ctx) { return (ctx || root).querySelector(sel); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || root).querySelectorAll(sel)); };

  var money = function (value) {
    var symbol = CFG.CURRENCY_SYMBOL || '₱';
    return symbol + Number(value).toLocaleString('en-US');
  };

  /* Alphabet sans caracteres ambigus (pas de 0/O ni 1/I) : la reference est
     lue a voix haute au telephone et recopiee a la main a l'entree. */
  var ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

  var makeRef = function () {
    var bytes = new Uint8Array(6);
    (window.crypto || window.msCrypto).getRandomValues(bytes);
    var out = '';
    for (var i = 0; i < bytes.length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
    return 'AB26-' + out;
  };

  var isEmail = function (value) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value); };

  /* ------------------------------------------------------------------ state */

  var state = {
    ref: makeRef(),
    name: '',
    email: '',
    phone: '',
    adults: 1,
    children: 0,
    infants: 0,
    notes: '',
    method: 'gcash',
    payRef: '',
    proof: null,      // { data, mime, filename, sizeLabel }
    step: 1,
    sent: false
  };

  /* --------------------------------------------------- avertissement config */

  if (!CFG.API_URL || CFG.API_URL.indexOf('script.google.com') === -1) {
    var warn = document.createElement('p');
    warn.className = 'bk-setup';
    warn.innerHTML = '<strong>Preview.</strong> You can walk through the whole booking flow, ' +
      'but nothing is sent yet — bookings open soon.';
    var main = $('.bk-main');
    main.insertBefore(warn, main.firstChild);
  }

  /* ------------------------------------------------------- quantite & total */

  var PRICE_ADULT = CFG.PRICE_ADULT || 0;
  var PRICE_CHILD = CFG.PRICE_CHILD || 0;
  var MAX = CFG.MAX_TICKETS || 10;

  var adultSelect = $('#bk-adults');
  var childSelect = $('#bk-children');
  var infantSelect = $('#bk-infants');

  /* Les adultes demarrent a 1 (on ne reserve pas pour zero adulte par defaut),
     les enfants a 0. Les deux peuvent descendre a 0 : une famille peut tres
     bien n'inscrire que des adultes, et le controle du total se fait plus bas. */
  var fillSelect = function (select, from, to, singular, plural) {
    for (var n = from; n <= to; n++) {
      var opt = document.createElement('option');
      opt.value = String(n);
      opt.textContent = n + ' ' + (n === 1 ? singular : plural);
      select.appendChild(opt);
    }
  };

  fillSelect(adultSelect, 0, MAX, 'adult', 'adults');
  fillSelect(childSelect, 0, MAX, 'child', 'children');
  fillSelect(infantSelect, 0, MAX, 'child', 'children');
  adultSelect.value = '1';
  childSelect.value = '0';
  infantSelect.value = '0';

  var totals = function () {
    var adults = state.adults * PRICE_ADULT;
    var children = state.children * PRICE_CHILD;
    return { adults: adults, children: children, total: adults + children };
  };

  var setText = function (selector, text) {
    var el = $(selector);
    if (el) el.textContent = text;
  };

  var refreshTotals = function () {
    var t = totals();

    $$('[data-total-amount]').forEach(function (el) { el.textContent = money(t.total); });

    setText('[data-sum-adults-qty]', '× ' + state.adults);
    setText('[data-sum-adults-total]', money(t.adults));
    setText('[data-sum-children-qty]', '× ' + state.children);
    setText('[data-sum-children-total]', money(t.children));

    setText('[data-sum-infants-qty]', '× ' + state.infants);

    var adultsRow = $('[data-sum-adults-row]');
    var childrenRow = $('[data-sum-children-row]');
    var infantsRow = $('[data-sum-infants-row]');
    if (adultsRow) adultsRow.hidden = state.adults === 0;
    if (childrenRow) childrenRow.hidden = state.children === 0;
    if (infantsRow) infantsRow.hidden = state.infants === 0;
  };

  var readQuantities = function () {
    state.adults = Number(adultSelect.value) || 0;
    state.children = Number(childSelect.value) || 0;
    state.infants = Number(infantSelect.value) || 0;
    refreshTotals();
  };

  adultSelect.addEventListener('change', readQuantities);
  childSelect.addEventListener('change', readQuantities);
  infantSelect.addEventListener('change', readQuantities);

  /* rappel des tarifs sous chaque selecteur */
  setText('[data-price-adult]', money(PRICE_ADULT));
  setText('[data-price-child]', money(PRICE_CHILD));
  if (CFG.CHILD_AGES) setText('[data-child-ages]', CFG.CHILD_AGES);
  if (CFG.INFANT_AGES) setText('[data-infant-ages]', CFG.INFANT_AGES);

  /* ------------------------------------------------------------- navigation */

  var goTo = function (step) {
    state.step = step;

    $$('.bk-panel').forEach(function (panel) {
      panel.classList.toggle('is-active', Number(panel.dataset.step) === step);
    });

    $$('.bk-step').forEach(function (dot) {
      var n = Number(dot.dataset.stepDot);
      dot.classList.toggle('is-active', n === step);
      dot.classList.toggle('is-done', n < step);
    });

    var top = root.getBoundingClientRect().top + window.scrollY - 90;
    window.scrollTo({ top: top, behavior: 'smooth' });
  };

  var showError = function (step, message) {
    var box = $('[data-error-for="' + step + '"]');
    if (!box) return;
    box.textContent = message;
    box.hidden = !message;
  };

  /* --------------------------------------------------- etape 1 : validation */

  var validateDetails = function () {
    var name = $('#bk-name');
    var email = $('#bk-email');
    var phone = $('#bk-phone');

    [name, email, phone].forEach(function (el) { el.classList.remove('is-invalid'); });

    if (name.value.trim().length < 2) {
      name.classList.add('is-invalid');
      showError(1, 'Please enter the full name the ticket should be issued to.');
      name.focus();
      return false;
    }

    if (!isEmail(email.value.trim())) {
      email.classList.add('is-invalid');
      showError(1, 'Please enter a valid email address — your reservation number is sent there.');
      email.focus();
      return false;
    }

    if (phone.value.replace(/\D/g, '').length < 7) {
      phone.classList.add('is-invalid');
      showError(1, 'Please enter a mobile number we can reach you on.');
      phone.focus();
      return false;
    }

    state.name = name.value.trim();
    state.email = email.value.trim();
    state.phone = phone.value.trim();
    state.notes = $('#bk-notes').value.trim();
    readQuantities();

    if (state.adults + state.children < 1) {
      showError(1, 'Please choose at least one paying ticket — under 7s are free but ' +
        'cannot be booked on their own.');
      adultSelect.focus();
      return false;
    }

    showError(1, '');
    return true;
  };

  /* --------------------------------------------- etape 2 : methode & QR code */

  var applyMethod = function (method) {
    var pay = (CFG.PAYMENT || {})[method];
    if (!pay) return;

    state.method = method;

    $$('.bk-tab').forEach(function (tab) {
      var on = tab.dataset.method === method;
      tab.classList.toggle('is-active', on);
      tab.setAttribute('aria-selected', String(on));
    });

    var img = $('[data-qr-img]');
    img.src = pay.qr;
    img.alt = 'QR code — ' + pay.label;

    $('[data-acc-name]').textContent = pay.accountName;
    $('[data-acc-ref]').textContent = pay.accountRef;
    $('[data-acc-note]').textContent = pay.note;

    var dl = $('[data-qr-download]');
    dl.href = pay.qr;
    dl.setAttribute('download', 'afrobrunch-' + method + '-qr.jpeg');
  };

  $$('.bk-tab').forEach(function (tab) {
    tab.addEventListener('click', function () { applyMethod(tab.dataset.method); });
  });

  /* ------------------------------------------- etape 3 : capture de paiement */

  var MAX_SIDE = 1400;
  var fileInput = $('#bk-proof');
  var drop = $('[data-drop]');
  var dropEmpty = $('[data-drop-empty]');
  var dropPreview = $('[data-drop-preview]');
  var previewImg = $('[data-preview-img]');
  var previewMeta = $('[data-preview-meta]');
  var clearBtn = $('[data-clear-proof]');

  /* Redimensionne et recompresse cote navigateur : une capture d'ecran de
     telephone fait 3 a 8 Mo, ce qui passerait mal dans une requete Apps Script. */
  var compress = function (file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();

      reader.onerror = function () { reject(new Error('read-failed')); };

      reader.onload = function () {
        var img = new Image();

        img.onerror = function () { reject(new Error('decode-failed')); };

        img.onload = function () {
          var scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
          var canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);

          var quality = 0.82;
          var url = canvas.toDataURL('image/jpeg', quality);

          /* garde-fou : on redescend la qualite tant que l'on depasse ~2,5 Mo */
          while (url.length > 2500000 && quality > 0.4) {
            quality -= 0.12;
            url = canvas.toDataURL('image/jpeg', quality);
          }

          resolve({
            data: url.split(',')[1],
            mime: 'image/jpeg',
            filename: 'proof.jpg',
            preview: url,
            sizeLabel: Math.round(url.length * 0.75 / 1024) + ' KB'
          });
        };

        img.src = reader.result;
      };

      reader.readAsDataURL(file);
    });
  };

  var acceptFile = function (file) {
    if (!file) return;

    if (!/^image\//.test(file.type)) {
      showError(3, 'Please upload an image (JPG or PNG screenshot of your payment).');
      return;
    }

    showError(3, '');

    compress(file).then(function (proof) {
      state.proof = proof;
      previewImg.src = proof.preview;
      previewMeta.textContent = proof.sizeLabel + ' — tap to choose another';
      dropEmpty.hidden = true;
      dropPreview.hidden = false;
      clearBtn.hidden = false;
    }).catch(function () {
      showError(3, 'That image could not be read. Try another screenshot, or send it to us on WhatsApp.');
    });
  };

  fileInput.addEventListener('change', function () { acceptFile(fileInput.files[0]); });

  ['dragenter', 'dragover'].forEach(function (type) {
    drop.addEventListener(type, function (event) {
      event.preventDefault();
      drop.classList.add('is-dragover');
    });
  });

  ['dragleave', 'drop'].forEach(function (type) {
    drop.addEventListener(type, function (event) {
      event.preventDefault();
      drop.classList.remove('is-dragover');
    });
  });

  drop.addEventListener('drop', function (event) {
    if (event.dataTransfer && event.dataTransfer.files.length) acceptFile(event.dataTransfer.files[0]);
  });

  clearBtn.addEventListener('click', function (event) {
    event.preventDefault();
    state.proof = null;
    fileInput.value = '';
    previewImg.removeAttribute('src');
    dropPreview.hidden = true;
    dropEmpty.hidden = false;
    clearBtn.hidden = true;
  });

  /* ------------------------------------------------------------- envoi */

  var sending = $('[data-sending]');
  var submitBtn = $('[data-submit]');

  var buildPayload = function () {
    var pay = (CFG.PAYMENT || {})[state.method] || {};
    return {
      action: 'book',
      ref: state.ref,
      name: state.name,
      email: state.email,
      phone: state.phone,
      adults: state.adults,
      children: state.children,
      infants: state.infants,
      qty: state.adults + state.children,
      guests: state.adults + state.children + state.infants,
      priceAdult: PRICE_ADULT,
      priceChild: PRICE_CHILD,
      notes: state.notes,
      method: state.method,
      methodLabel: pay.label || state.method,
      payRef: state.payRef,
      amount: totals().total,
      currency: CFG.CURRENCY || 'PHP',
      proof: state.proof ? { data: state.proof.data, mime: state.proof.mime, filename: state.proof.filename } : null,
      pageUrl: location.href
    };
  };

  /* Apps Script n'accepte pas les requetes preflight CORS : on envoie donc un
     corps text/plain (requete "simple"). Si la lecture de la reponse echoue
     malgre tout, on rejoue en no-cors — la reservation part quand meme et la
     reference a ete generee cote client, donc elle reste affichable. */
  var post = function (payload) {
    return fetch(CFG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow'
    })
      .then(function (response) { return response.json(); })
      .catch(function () {
        return fetch(CFG.API_URL, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload)
        }).then(function () { return { ok: true, ref: payload.ref, blind: true }; });
      });
  };

  var showDone = function (ref) {
    $('[data-done-name]').textContent = state.name.split(' ')[0] || state.name;
    $('[data-done-email]').textContent = state.email;
    $('[data-done-ref]').textContent = ref;
    goTo(4);
  };

  var submit = function () {
    var payRef = $('#bk-payref');
    var terms = $('#bk-terms');

    payRef.classList.remove('is-invalid');

    if (payRef.value.trim().length < 4) {
      payRef.classList.add('is-invalid');
      showError(3, 'Please copy the transaction or reference number from your payment receipt.');
      payRef.focus();
      return;
    }

    if (!state.proof) {
      showError(3, 'Please add the screenshot of your payment so the organiser can check it.');
      return;
    }

    if (!terms.checked) {
      showError(3, 'Please tick the confirmation box before submitting.');
      return;
    }

    state.payRef = payRef.value.trim();
    showError(3, '');

    /* mode demo : aucune URL d'API configuree */
    if (!CFG.API_URL || CFG.API_URL.indexOf('script.google.com') === -1) {
      showDone(state.ref);
      return;
    }

    sending.hidden = false;
    submitBtn.disabled = true;
    state.sent = true;

    post(buildPayload())
      .then(function (result) {
        sending.hidden = true;
        submitBtn.disabled = false;

        if (result && result.ok === false) {
          state.sent = false;
          showError(3, result.error || 'Something went wrong on our side. Please try again in a moment.');
          return;
        }

        showDone((result && result.ref) || state.ref);
      })
      .catch(function () {
        sending.hidden = true;
        submitBtn.disabled = false;
        state.sent = false;
        showError(3,
          'We could not reach the booking server. Check your connection and try again — ' +
          'if it keeps failing, send your screenshot to ' + ((CFG.CONTACT || {}).phone1 || 'the organiser') + '.');
      });
  };

  submitBtn.addEventListener('click', submit);

  /* ------------------------------------------------------------- ecouteurs */

  $$('[data-goto]').forEach(function (button) {
    button.addEventListener('click', function () {
      var target = Number(button.dataset.goto);
      if (target > state.step && state.step === 1 && !validateDetails()) return;
      goTo(target);
    });
  });

  /* Empeche la perte d'une saisie en cours si l'onglet est ferme par erreur. */
  window.addEventListener('beforeunload', function (event) {
    if (state.step > 1 && state.step < 4 && !state.sent) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  /* -------------------------------------------------------------- demarrage */

  applyMethod('gcash');
  refreshTotals();

})();
