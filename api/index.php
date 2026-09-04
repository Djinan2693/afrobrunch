<?php
/**
 * =============================================================================
 *  AFRO BRUNCH — BACKEND DE RESERVATION
 * =============================================================================
 *  POST /api/                              {"action":"book", ...}
 *  GET  /api/?action=validate&ref=&token=  lien de l'email organisateur
 *  GET  /api/?action=reject&ref=&token=    idem
 *  GET  /api/?action=verify&ref=           verification publique
 *  GET  /api/?action=find&email=[&name=]   retrouver un numero perdu
 *  GET  /api/?action=checkin&ref=&staff=   pointage a l'entree
 *  GET  /api/?action=export&staff=         export CSV lisible par Excel
 *
 *  Donnees et captures de paiement : /home/afrobrunch/data, hors public_html.
 * =============================================================================
 */

declare(strict_types=1);

const CONFIG_PATH = '/home/afrobrunch/afrobrunch-config.php';

$CFG = file_exists(CONFIG_PATH) ? require CONFIG_PATH : null;
if (!$CFG) {
    http_response_code(500);
    exit('Configuration introuvable.');
}

require __DIR__ . '/lib/Exception.php';
require __DIR__ . '/lib/PHPMailer.php';
require __DIR__ . '/lib/SMTP.php';

use PHPMailer\PHPMailer\PHPMailer;

/* Le site et l'API partagent le domaine, mais la copie GitHub Pages sert de
   miroir : on autorise donc les appels croises. */
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type');
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

const GOLD = '#D9B871';
const CARD = '#1D1811';


/* ==========================================================================
 *  OUTILS
 * ======================================================================== */

function cfg(string $key, $default = null)
{
    global $CFG;
    return $CFG[$key] ?? $default;
}

function money(int $amount): string
{
    return cfg('currency_symbol', '?') . number_format($amount);
}

function esc($v): string
{
    return htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8');
}

function now(): string
{
    return (new DateTime('now', new DateTimeZone('Asia/Manila')))->format('d/m/Y H:i');
}

/** Signe une action pour une reference : le lien ne vaut que pour ce couple. */
function signature(string $ref, string $action): string
{
    $raw = hash_hmac('sha256', $action . ':' . $ref, (string) cfg('secret'), true);
    return substr(rtrim(strtr(base64_encode($raw), '+/', '-_'), '='), 0, 24);
}

function action_url(string $action, string $ref): string
{
    return cfg('api_url') . '?action=' . $action
        . '&ref=' . rawurlencode($ref)
        . '&token=' . rawurlencode(signature($ref, $action));
}

function normalize_ref($ref): string
{
    $ref = strtoupper(trim((string) $ref));
    return preg_match('/^AB26-[A-Z0-9]{4,10}$/', $ref) ? $ref : '';
}

function json_out(array $data, ?string $callback = null): void
{
    $json = json_encode($data, JSON_UNESCAPED_UNICODE);
    if ($callback && preg_match('/^[A-Za-z_$][A-Za-z0-9_$]*$/', $callback)) {
        header('Content-Type: application/javascript; charset=utf-8');
        echo $callback . '(' . $json . ');';
        return;
    }
    header('Content-Type: application/json; charset=utf-8');
    echo $json;
}

/** Ramene un nombre de billets envoye par le navigateur dans [0, max]. */
function clamp_count($value): int
{
    $n = (int) $value;
    return $n < 0 ? 0 : min((int) cfg('max_tickets', 10), $n);
}

function log_line(string $message): void
{
    @file_put_contents(
        cfg('data_dir') . '/afrobrunch.log',
        '[' . date('c') . '] ' . $message . "\n",
        FILE_APPEND
    );
}


/* ==========================================================================
 *  BASE DE DONNEES
 * ======================================================================== */

function db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $dir = (string) cfg('data_dir');
    if (!is_dir($dir)) {
        mkdir($dir, 0700, true);
    }
    if (!is_dir($dir . '/proofs')) {
        mkdir($dir . '/proofs', 0700, true);
    }

    $pdo = new PDO('sqlite:' . $dir . '/afrobrunch.sqlite');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->exec('PRAGMA journal_mode = WAL');
    $pdo->exec('
        CREATE TABLE IF NOT EXISTS bookings (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            ref           TEXT UNIQUE NOT NULL,
            created_at    TEXT NOT NULL,
            status        TEXT NOT NULL DEFAULT "PENDING",
            name          TEXT NOT NULL,
            email         TEXT NOT NULL,
            phone         TEXT,
            adults        INTEGER DEFAULT 0,
            children      INTEGER DEFAULT 0,
            infants       INTEGER DEFAULT 0,
            tickets       INTEGER DEFAULT 0,
            guests        INTEGER DEFAULT 0,
            amount        INTEGER DEFAULT 0,
            method        TEXT,
            pay_ref       TEXT,
            proof_file    TEXT,
            notes         TEXT,
            validated_at  TEXT,
            checked_in_at TEXT
        )');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_email ON bookings(email)');

    return $pdo;
}

function get_booking(string $ref): ?array
{
    $st = db()->prepare('SELECT * FROM bookings WHERE ref = ?');
    $st->execute([$ref]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    return $row ?: null;
}

function unique_ref(): string
{
    $alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    for ($try = 0; $try < 20; $try++) {
        $body = '';
        for ($i = 0; $i < 6; $i++) {
            $body .= $alphabet[random_int(0, strlen($alphabet) - 1)];
        }
        $ref = 'AB26-' . $body;
        if (!get_booking($ref)) {
            return $ref;
        }
    }
    return 'AB26-' . strtoupper(base_convert((string) time(), 10, 36));
}


/* ==========================================================================
 *  GABARITS D'EMAIL
 * ======================================================================== */

function email_shell(string $title, string $lead, string $content): string
{
    $e = cfg('event');
    return '<div style="margin:0;padding:24px 12px;background:#0d0a07;'
        . 'font-family:Helvetica,Arial,sans-serif;">'
        . '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" '
        . 'style="max-width:600px;margin:0 auto;background:' . CARD . ';'
        . 'border-top:3px solid ' . GOLD . ';">'
        . '<tr><td style="padding:34px 30px 30px;">'
        . '<p style="margin:0 0 6px;font-size:12px;letter-spacing:4px;'
        . 'text-transform:uppercase;color:' . GOLD . ';">Afro Brunch</p>'
        . '<h1 style="margin:0 0 10px;font-size:26px;line-height:1.25;color:#fff;'
        . 'font-weight:normal;">' . $title . '</h1>'
        . '<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#b9ad9d;">'
        . $lead . '</p>'
        . '<div style="font-size:15px;line-height:1.6;color:#d8cec0;">' . $content . '</div>'
        . '</td></tr>'
        . '<tr><td style="padding:18px 30px 26px;border-top:1px solid rgba(217,184,113,.15);'
        . 'font-size:12px;color:#7d7469;">'
        . esc($e['name']) . ' &middot; ' . esc($e['date']) . ' &middot; ' . esc($e['venue'])
        . '</td></tr></table></div>';
}

function ref_box(string $label, string $ref): string
{
    return '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" '
        . 'style="margin:0 0 22px;"><tr><td align="center" '
        . 'style="padding:20px;border:1px dashed ' . GOLD . ';background:rgba(217,184,113,.06);">'
        . '<div style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:'
        . GOLD . ';margin-bottom:10px;">' . esc($label) . '</div>'
        . '<div style="font-size:30px;letter-spacing:4px;color:' . GOLD . ';'
        . 'font-weight:bold;">' . esc($ref) . '</div></td></tr></table>';
}

function details_table(array $b): string
{
    $rows = [
        ['Name', $b['name']],
        ['Adults', $b['adults'] . ' x ' . money((int) cfg('price_adult'))],
    ];
    if ((int) $b['children'] > 0) {
        $rows[] = ['Children (' . cfg('child_ages') . ')',
            $b['children'] . ' x ' . money((int) cfg('price_child'))];
    }
    if ((int) $b['infants'] > 0) {
        $rows[] = ['Under 7 (free)', (string) $b['infants']];
    }
    $rows[] = ['People at the table', (string) $b['guests']];
    $rows[] = ['Amount', money((int) $b['amount'])];
    $rows[] = ['Email', $b['email']];
    $rows[] = ['Phone', $b['phone']];
    $rows[] = ['Paid with', $b['method']];
    $rows[] = ['Payment ref.', $b['pay_ref']];
    if (!empty($b['notes'])) {
        $rows[] = ['Notes', $b['notes']];
    }

    $html = '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" '
        . 'style="border-collapse:collapse;font-size:14px;">';
    foreach ($rows as [$k, $v]) {
        $html .= '<tr>'
            . '<td style="padding:9px 0;color:#8a8178;'
            . 'border-bottom:1px solid rgba(255,255,255,.06);">' . esc($k) . '</td>'
            . '<td align="right" style="padding:9px 0;color:#efe6d8;font-weight:bold;'
            . 'border-bottom:1px solid rgba(255,255,255,.06);">' . esc($v) . '</td></tr>';
    }
    return $html . '</table>';
}

function button(string $url, string $label, string $bg, string $color, ?string $border = null): string
{
    return '<a href="' . esc($url) . '" style="display:inline-block;padding:14px 26px;'
        . 'background:' . $bg . ';color:' . $color . ';border:2px solid ' . ($border ?: $bg) . ';'
        . 'text-decoration:none;font-size:13px;font-weight:bold;letter-spacing:2px;'
        . 'text-transform:uppercase;">' . esc($label) . '</a>';
}


/* ==========================================================================
 *  ENVOI
 * ======================================================================== */

function mailer(): PHPMailer
{
    $s = cfg('smtp');
    $m = new PHPMailer(true);
    $m->isSMTP();
    $m->Host       = $s['host'];
    $m->Port       = (int) $s['port'];
    $m->SMTPAuth   = true;
    $m->Username   = $s['user'];
    $m->Password   = $s['pass'];
    $m->SMTPSecure = $s['secure'];
    $m->CharSet    = 'UTF-8';
    $m->Timeout    = 20;
    $m->setFrom((string) cfg('from_email'), (string) cfg('from_name'));
    $m->addReplyTo((string) cfg('reply_to'), (string) cfg('from_name'));
    $m->isHTML(true);
    return $m;
}

function mail_buyer_pending(array $b): void
{
    $body = email_shell(
        'Booking received',
        'We have your request for <strong>' . esc($b['name']) . '</strong> &mdash; '
            . (int) $b['tickets'] . ' ticket(s) for ' . esc(cfg('event')['name']) . '.',
        '<p style="margin:0 0 18px;">The organiser is now checking the payment you sent. '
            . 'As soon as it is validated you will receive a second email containing your '
            . '<strong style="color:' . GOLD . ';">reservation number</strong> &mdash; that is '
            . 'the one to show at the door.</p>'
            . ref_box('Your booking reference', $b['ref'])
            . details_table($b)
            . '<p style="margin:22px 0 0;font-size:13px;color:#9b9186;">This is not your entry '
            . 'ticket yet. Keep this email until you receive the confirmation.</p>'
    );

    $m = mailer();
    $m->addAddress($b['email'], $b['name']);
    $m->Subject = 'We received your Afro Brunch booking (' . $b['ref'] . ')';
    $m->Body = $body;
    $m->send();
}

function mail_organizer(array $b, ?string $proofPath): void
{
    $validate = action_url('validate', $b['ref']);
    $reject   = action_url('reject', $b['ref']);

    $proofHtml = $proofPath && is_file($proofPath)
        ? '<img src="cid:proof" alt="Proof of payment" style="max-width:100%;border-radius:8px;'
            . 'border:1px solid rgba(217,184,113,.25);">'
        : '<p style="margin:0;color:#c96b4a;">No screenshot was attached to this booking.</p>';

    $body = email_shell(
        'New booking to validate',
        esc($b['name']) . ' &middot; ' . (int) $b['tickets'] . ' ticket(s) &middot; '
            . money((int) $b['amount']),
        details_table($b)
            . '<p style="margin:26px 0 12px;font-size:13px;letter-spacing:2px;'
            . 'text-transform:uppercase;color:' . GOLD . ';">Proof of payment</p>'
            . $proofHtml
            . '<p style="margin:30px 0 14px;font-size:13px;letter-spacing:2px;'
            . 'text-transform:uppercase;color:' . GOLD . ';">Your decision</p>'
            . '<table role="presentation" cellpadding="0" cellspacing="0"><tr>'
            . '<td style="padding-right:12px;">'
            . button($validate, 'Validate the payment', GOLD, '#14100B') . '</td>'
            . '<td>' . button($reject, 'Reject', 'transparent', '#c96b4a', '#c96b4a')
            . '</td></tr></table>'
            . '<p style="margin:18px 0 0;font-size:12px;color:#8a8178;">Validating sends '
            . esc($b['name']) . ' their reservation number. These links are signed and work '
            . 'only for this booking.</p>'
    );

    $m = mailer();
    foreach ((array) cfg('organizer') as $to) {
        $m->addAddress($to);
    }
    $m->addReplyTo($b['email'], $b['name']);
    $m->Subject = '[Afro Brunch] Validate - ' . $b['name'] . ' - '
        . (int) $b['tickets'] . ' ticket(s) - ' . money((int) $b['amount']);
    $m->Body = $body;

    if ($proofPath && is_file($proofPath)) {
        $m->addEmbeddedImage($proofPath, 'proof', 'proof.jpg');
    }
    $m->send();
}

function mail_buyer_confirmed(array $b): void
{
    $verifyUrl = cfg('site_url') . 'verify.html?ref=' . rawurlencode($b['ref']);
    $e = cfg('event');

    $body = email_shell(
        'You are in &mdash; see you on the 27th',
        'Payment confirmed for <strong>' . esc($b['name']) . '</strong> &middot; '
            . (int) $b['tickets'] . ' ticket(s).',
        ref_box('Your reservation number', $b['ref'])
            . '<p style="margin:0 0 22px;text-align:center;font-size:14px;color:#9b9186;">'
            . 'Give this number at the door &mdash; our team will look it up. '
            . 'No ticket to print, no code to scan.</p>'
            . details_table($b)
            . '<p style="margin:24px 0 12px;font-size:13px;letter-spacing:2px;'
            . 'text-transform:uppercase;color:' . GOLD . ';">Where &amp; when</p>'
            . '<p style="margin:0 0 6px;font-size:16px;color:#efe6d8;">' . esc($e['date']) . '</p>'
            . '<p style="margin:0 0 6px;font-size:16px;color:#efe6d8;">' . esc($e['time']) . '</p>'
            . '<p style="margin:0 0 22px;font-size:16px;color:#efe6d8;">'
            . esc($e['venue']) . ', ' . esc($e['address']) . '</p>'
            . button($verifyUrl, 'Check my reservation', GOLD, '#14100B')
            . '<p style="margin:26px 0 0;font-size:13px;color:#9b9186;">Come hungry. Leave happy. '
            . 'Questions: ' . esc(cfg('phone1')) . ' or ' . esc(cfg('phone2')) . '.</p>'
    );

    $m = mailer();
    $m->addAddress($b['email'], $b['name']);
    $m->Subject = 'Confirmed - your Afro Brunch reservation ' . $b['ref'];
    $m->Body = $body;
    $m->send();
}

function mail_buyer_rejected(array $b): void
{
    $body = email_shell(
        'We could not confirm your payment',
        'Booking ' . esc($b['ref']) . ' for ' . esc($b['name']) . ' has been put on hold.',
        '<p style="margin:0 0 18px;">The organiser could not match your payment with the '
            . 'reference you sent. Nothing is lost &mdash; get in touch and we will sort it '
            . 'out.</p>'
            . details_table($b)
            . '<p style="margin:22px 0 0;">Call or message us on <strong style="color:'
            . GOLD . ';">' . esc(cfg('phone1')) . '</strong> or <strong style="color:'
            . GOLD . ';">' . esc(cfg('phone2')) . '</strong>.</p>'
    );

    $m = mailer();
    $m->addAddress($b['email'], $b['name']);
    $m->Subject = 'About your Afro Brunch booking ' . $b['ref'];
    $m->Body = $body;
    $m->send();
}


/* ==========================================================================
 *  PAGE DE REPONSE APRES UN CLIC DE L'ORGANISATEUR
 * ======================================================================== */

function page(string $title, string $lead, string $note = ''): void
{
    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        . '<meta name="viewport" content="width=device-width,initial-scale=1">'
        . '<title>' . esc($title) . ' - Afro Brunch</title></head>'
        . '<body style="margin:0;min-height:100vh;display:flex;align-items:center;'
        . 'justify-content:center;background:#0d0a07;font-family:Helvetica,Arial,sans-serif;'
        . 'padding:24px;">'
        . '<div style="max-width:460px;width:100%;background:' . CARD . ';'
        . 'border-top:3px solid ' . GOLD . ';padding:40px 30px;text-align:center;">'
        . '<p style="margin:0 0 8px;font-size:12px;letter-spacing:4px;text-transform:uppercase;'
        . 'color:' . GOLD . ';">Afro Brunch</p>'
        . '<h1 style="margin:0 0 14px;font-size:26px;color:#fff;font-weight:normal;">'
        . esc($title) . '</h1>'
        . '<p style="margin:0 0 10px;font-size:16px;line-height:1.6;color:#d8cec0;">'
        . esc($lead) . '</p>'
        . ($note ? '<p style="margin:0;font-size:13px;line-height:1.6;color:#8a8178;">'
            . esc($note) . '</p>' : '')
        . '</div></body></html>';
}


/* ==========================================================================
 *  ACTIONS
 * ======================================================================== */

function do_book(array $p): array
{
    $name  = trim((string) ($p['name'] ?? ''));
    $email = trim((string) ($p['email'] ?? ''));

    if ($name === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        return ['ok' => false, 'error' => 'Name and a valid email address are required.'];
    }

    $adults   = clamp_count($p['adults'] ?? 0);
    $children = clamp_count($p['children'] ?? 0);
    $infants  = clamp_count($p['infants'] ?? 0);
    $tickets  = $adults + $children;
    $guests   = $tickets + $infants;

    if ($tickets < 1) {
        return ['ok' => false, 'error' => 'At least one paying ticket is required.'];
    }

    /* Le montant est toujours recalcule ici : ce que le navigateur annonce
       n'est qu'indicatif et ne doit jamais faire foi. */
    $amount = $adults * (int) cfg('price_adult') + $children * (int) cfg('price_child');

    $ref = normalize_ref($p['ref'] ?? '');
    if ($ref === '' || get_booking($ref)) {
        $ref = unique_ref();
    }

    /* La capture de paiement est rangee hors public_html : elle contient des
       informations bancaires et ne doit jamais etre accessible par URL. */
    $proofFile = null;
    $proofPath = null;
    if (!empty($p['proof']['data'])) {
        $bin = base64_decode((string) $p['proof']['data'], true);
        if ($bin !== false && strlen($bin) < 12 * 1024 * 1024) {
            $proofFile = $ref . '.jpg';
            $proofPath = cfg('data_dir') . '/proofs/' . $proofFile;
            file_put_contents($proofPath, $bin);
        }
    }

    $booking = [
        'ref'        => $ref,
        'created_at' => now(),
        'status'     => 'PENDING',
        'name'       => $name,
        'email'      => $email,
        'phone'      => trim((string) ($p['phone'] ?? '')),
        'adults'     => $adults,
        'children'   => $children,
        'infants'    => $infants,
        'tickets'    => $tickets,
        'guests'     => $guests,
        'amount'     => $amount,
        'method'     => trim((string) ($p['methodLabel'] ?? $p['method'] ?? '')),
        'pay_ref'    => trim((string) ($p['payRef'] ?? '')),
        'proof_file' => $proofFile,
        'notes'      => trim((string) ($p['notes'] ?? '')),
    ];

    $st = db()->prepare('INSERT INTO bookings
        (ref, created_at, status, name, email, phone, adults, children, infants,
         tickets, guests, amount, method, pay_ref, proof_file, notes)
        VALUES (:ref, :created_at, :status, :name, :email, :phone, :adults, :children,
                :infants, :tickets, :guests, :amount, :method, :pay_ref, :proof_file, :notes)');
    $st->execute($booking);

    /* L'enregistrement est fait : un echec d'envoi ne doit jamais perdre
       la reservation, l'organisateur peut toujours la traiter a la main. */
    try {
        mail_buyer_pending($booking);
    } catch (Throwable $e) {
        log_line('mail buyer-pending ' . $ref . ' : ' . $e->getMessage());
    }
    try {
        mail_organizer($booking, $proofPath);
    } catch (Throwable $e) {
        log_line('mail organizer ' . $ref . ' : ' . $e->getMessage());
    }

    return ['ok' => true, 'ref' => $ref];
}

function do_decide(string $action, $refRaw, $token): void
{
    $ref = normalize_ref($refRaw);

    if ($ref === '' || !hash_equals(signature($ref, $action), (string) $token)) {
        page('Invalid link', 'This validation link is not valid or has been altered.');
        return;
    }

    $b = get_booking($ref);
    if (!$b) {
        page('Not found', 'No booking matches ' . $ref . '.');
        return;
    }

    if ($b['status'] !== 'PENDING') {
        page('Already handled', $ref . ' is already marked as ' . $b['status'] . '.',
            $b['validated_at'] ? 'Handled on ' . $b['validated_at'] . '.' : '');
        return;
    }

    if ($action === 'validate') {
        db()->prepare('UPDATE bookings SET status = "CONFIRMED", validated_at = ? WHERE ref = ?')
            ->execute([now(), $ref]);
        $b['status'] = 'CONFIRMED';

        try {
            mail_buyer_confirmed($b);
        } catch (Throwable $e) {
            log_line('mail buyer-confirmed ' . $ref . ' : ' . $e->getMessage());
            page('Confirmed - but the email failed',
                $ref . ' is confirmed and recorded.',
                'The confirmation email could not be sent. Contact ' . $b['email'] . ' directly.');
            return;
        }

        page('Payment validated',
            $b['name'] . ' - ' . $b['tickets'] . ' ticket(s) - ' . $ref,
            'The guest has been emailed their reservation number.');
        return;
    }

    db()->prepare('UPDATE bookings SET status = "CANCELLED", validated_at = ? WHERE ref = ?')
        ->execute([now(), $ref]);
    $b['status'] = 'CANCELLED';

    try {
        mail_buyer_rejected($b);
    } catch (Throwable $e) {
        log_line('mail buyer-rejected ' . $ref . ' : ' . $e->getMessage());
    }

    page('Booking rejected', $ref . ' has been marked as cancelled.',
        $b['name'] . ' has been told the payment could not be matched.');
}

function public_view(array $b): array
{
    return [
        'ref'         => $b['ref'],
        'name'        => $b['name'],
        'qty'         => (int) $b['tickets'],
        'adults'      => (int) $b['adults'],
        'children'    => (int) $b['children'],
        'infants'     => (int) $b['infants'],
        'status'      => $b['status'],
        'confirmedAt' => $b['status'] === 'CONFIRMED' ? (string) $b['validated_at'] : '',
        'checkedIn'   => !empty($b['checked_in_at']),
        'checkedInAt' => (string) $b['checked_in_at'],
    ];
}

function do_verify($refRaw): array
{
    $ref = normalize_ref($refRaw);
    if ($ref === '') {
        return ['ok' => true, 'found' => false];
    }
    $b = get_booking($ref);
    if (!$b) {
        return ['ok' => true, 'found' => false];
    }
    return ['ok' => true, 'found' => true] + public_view($b);
}

/**
 * Retrouve les reservations d'une personne qui a perdu son numero.
 *
 * Pour le public, l'email est obligatoire et doit correspondre exactement :
 * sans cela, n'importe qui pourrait parcourir la liste des invites en tapant
 * des noms au hasard. En mode staff, la recherche par nom seul est ouverte,
 * car c'est ce dont on a besoin a l'entree le jour J.
 */
function do_find(array $q): array
{
    $email   = strtolower(trim((string) ($q['email'] ?? '')));
    $name    = strtolower(trim((string) ($q['name'] ?? '')));
    $isStaff = !empty($q['staff']) && hash_equals((string) cfg('staff_key'), (string) $q['staff']);

    if ($email === '' && !($isStaff && $name !== '')) {
        return ['ok' => false, 'error' => 'Please enter the email address used for the booking.'];
    }

    if ($email !== '') {
        $sql = 'SELECT * FROM bookings WHERE LOWER(email) = ?';
        $args = [$email];
        if ($name !== '') {
            $sql .= ' AND LOWER(name) LIKE ?';
            $args[] = '%' . $name . '%';
        }
    } else {
        $sql = 'SELECT * FROM bookings WHERE LOWER(name) LIKE ?';
        $args = ['%' . $name . '%'];
    }
    $sql .= ' ORDER BY id DESC LIMIT 20';

    $st = db()->prepare($sql);
    $st->execute($args);

    $results = array_map('public_view', $st->fetchAll(PDO::FETCH_ASSOC));
    return ['ok' => true, 'count' => count($results), 'results' => $results];
}

function do_checkin(array $q): array
{
    if (empty($q['staff']) || !hash_equals((string) cfg('staff_key'), (string) $q['staff'])) {
        return ['ok' => false, 'error' => 'Invalid staff key.'];
    }

    $ref = normalize_ref($q['ref'] ?? '');
    $b = $ref === '' ? null : get_booking($ref);
    if (!$b) {
        return ['ok' => true, 'found' => false];
    }

    if ($b['status'] !== 'CONFIRMED') {
        return ['ok' => false, 'error' => 'This booking is ' . $b['status'] . ', not confirmed.'];
    }

    if (empty($b['checked_in_at'])) {
        db()->prepare('UPDATE bookings SET checked_in_at = ? WHERE ref = ?')
            ->execute([now(), $ref]);
    }

    return do_verify($ref);
}

/** Export CSV, ouvrable directement dans Excel. */
function do_export(array $q): void
{
    if (empty($q['staff']) || !hash_equals((string) cfg('staff_key'), (string) $q['staff'])) {
        http_response_code(403);
        exit('Invalid staff key.');
    }

    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="afrobrunch-reservations.csv"');

    $out = fopen('php://output', 'w');
    fwrite($out, "\xEF\xBB\xBF");   // BOM : Excel ouvre alors l'UTF-8 correctement
    fputcsv($out, ['Reference', 'Date', 'Statut', 'Nom', 'Email', 'Telephone',
        'Adultes', 'Enfants', 'Moins de 7', 'Billets', 'Convives', 'Montant',
        'Moyen', 'Ref paiement', 'Notes', 'Valide le', 'Pointe le']);

    $rows = db()->query('SELECT * FROM bookings ORDER BY id');
    foreach ($rows as $b) {
        fputcsv($out, [$b['ref'], $b['created_at'], $b['status'], $b['name'], $b['email'],
            $b['phone'], $b['adults'], $b['children'], $b['infants'], $b['tickets'],
            $b['guests'], $b['amount'], $b['method'], $b['pay_ref'], $b['notes'],
            $b['validated_at'], $b['checked_in_at']]);
    }
    fclose($out);
}


/* ==========================================================================
 *  ROUTAGE
 * ======================================================================== */

try {
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
        $raw = file_get_contents('php://input');
        $payload = json_decode((string) $raw, true);

        if (!is_array($payload) || ($payload['action'] ?? '') !== 'book') {
            json_out(['ok' => false, 'error' => 'Unknown action.']);
            exit;
        }
        json_out(do_book($payload));
        exit;
    }

    $action   = (string) ($_GET['action'] ?? '');
    $callback = $_GET['callback'] ?? null;

    switch ($action) {
        case 'validate':
        case 'reject':
            do_decide($action, $_GET['ref'] ?? '', $_GET['token'] ?? '');
            break;

        case 'verify':
            json_out(do_verify($_GET['ref'] ?? ''), $callback);
            break;

        case 'find':
            json_out(do_find($_GET), $callback);
            break;

        case 'checkin':
            json_out(do_checkin($_GET), $callback);
            break;

        case 'export':
            do_export($_GET);
            break;

        case 'ping':
            json_out(['ok' => true, 'message' => 'Afro Brunch backend is running.'], $callback);
            break;

        default:
            page('Afro Brunch', 'This link is not valid.',
                'Nothing to do here - open the website to book a seat.');
    }
} catch (Throwable $e) {
    log_line('fatal : ' . $e->getMessage());
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST' || isset($_GET['callback'])) {
        json_out(['ok' => false, 'error' => 'Server error. Please try again.']);
    } else {
        http_response_code(500);
        page('Something went wrong', 'Please try the link again in a moment.');
    }
}
