<?php
/**
 * =============================================================================
 *  AFRO BRUNCH — ENVOI DU MESSAGE DE REMERCIEMENT
 * =============================================================================
 *  Script d'administration, protege par la cle staff.
 *
 *    ?action=list&staff=...                   liste les destinataires, n'envoie rien
 *    ?action=test&staff=...&to=a@b.com        envoie a une ou plusieurs adresses
 *                                             (separees par des virgules)
 *    ?action=send&staff=...&confirm=SEND      envoi reel a tous les clients confirmes
 *
 *  L'envoi reel est idempotent : chaque adresse servie est consignee dans la
 *  table « thanks_sent », et une seconde execution ne la resservira pas. Un
 *  envoi interrompu peut donc etre relance sans risque de doublon.
 * =============================================================================
 */

declare(strict_types=1);

const CONFIG_PATH = '/home/afrobrunch/afrobrunch-config.php';
$CFG = file_exists(CONFIG_PATH) ? require CONFIG_PATH : null;
if (!$CFG) { http_response_code(500); exit('Configuration introuvable.'); }

require __DIR__ . '/lib/Exception.php';
require __DIR__ . '/lib/PHPMailer.php';
require __DIR__ . '/lib/SMTP.php';

use PHPMailer\PHPMailer\PHPMailer;

header('Content-Type: text/plain; charset=utf-8');

$staff = $_GET['staff'] ?? '';
if (!hash_equals((string) $CFG['staff_key'], (string) $staff)) {
    http_response_code(403);
    exit("Cle staff invalide.\n");
}

$pdo = new PDO('sqlite:' . $CFG['data_dir'] . '/afrobrunch.sqlite');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->exec('CREATE TABLE IF NOT EXISTS thanks_sent (
    email TEXT PRIMARY KEY,
    sent_at TEXT NOT NULL
)');

const GOLD = '#D9B871';
const CARD = '#1D1811';

/** Prenom seul, en capitale initiale : « BILE LUC STEPHANE » devient « Bile ». */
function first_name(string $full): string
{
    $bit = trim(explode(' ', trim($full))[0] ?? '');
    $bit = rtrim($bit, '.');
    return $bit === '' ? '' : mb_convert_case(mb_strtolower($bit), MB_CASE_TITLE, 'UTF-8');
}

function body_for(string $name): string
{
    global $CFG;
    $hello = $name !== '' ? 'Hello ' . htmlspecialchars($name, ENT_QUOTES, 'UTF-8') . ',' : 'Hello,';

    return '<div style="margin:0;padding:24px 12px;background:#0d0a07;'
        . 'font-family:Helvetica,Arial,sans-serif;">'
        . '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" '
        . 'style="max-width:600px;margin:0 auto;background:' . CARD . ';'
        . 'border-top:3px solid ' . GOLD . ';">'
        . '<tr><td style="padding:34px 30px 30px;">'

        . '<p style="margin:0 0 6px;font-size:12px;letter-spacing:4px;'
        . 'text-transform:uppercase;color:' . GOLD . ';">Afro Brunch</p>'

        . '<h1 style="margin:0 0 20px;font-size:26px;line-height:1.25;color:#fff;'
        . 'font-weight:normal;">Thank you for being there</h1>'

        . '<div style="font-size:15px;line-height:1.7;color:#d8cec0;">'
        . '<p style="margin:0 0 16px;">' . $hello . '</p>'
        . '<p style="margin:0 0 16px;">On September 27 you sat at one long table with '
        . 'seventy-four other people, and between us we went through more than twenty '
        . 'African dishes. Thank you for coming hungry, for sitting with strangers, and for '
        . 'making the first Afro Brunch what it was.</p>'
        . '<p style="margin:0 0 16px;">We are already working on the next one. The date is '
        . 'not set yet &mdash; but you were there for the first, so you will hear about it '
        . 'before anyone else.</p>'
        . '<p style="margin:0 0 22px;">Until then: come hungry, leave happy.</p>'

        . '<p style="margin:0 0 4px;font-size:13px;letter-spacing:3px;'
        . 'text-transform:uppercase;color:' . GOLD . ';">Afro Brunch</p>'
        . '<p style="margin:0;font-size:14px;color:#b9ad9d;">'
        . htmlspecialchars((string) $CFG['phone1'], ENT_QUOTES, 'UTF-8') . ' / '
        . htmlspecialchars((string) $CFG['phone2'], ENT_QUOTES, 'UTF-8') . '</p>'
        . '</div>'

        . '</td></tr>'
        . '<tr><td style="padding:18px 30px 26px;border-top:1px solid rgba(217,184,113,.15);'
        . 'font-size:12px;line-height:1.6;color:#7d7469;">'
        . 'You are receiving this because you booked a seat at Afro Brunch 2026. '
        . 'Reply to this email if you would rather not hear about the next edition.'
        . '</td></tr></table></div>';
}

function send_to(string $email, string $name): void
{
    global $CFG;
    $m = new PHPMailer(true);
    $m->isSMTP();
    $m->Host       = $CFG['smtp']['host'];
    $m->Port       = (int) $CFG['smtp']['port'];
    $m->SMTPAuth   = true;
    $m->Username   = $CFG['smtp']['user'];
    $m->Password   = $CFG['smtp']['pass'];
    $m->SMTPSecure = $CFG['smtp']['secure'];
    $m->CharSet    = 'UTF-8';
    $m->Timeout    = 20;
    $m->setFrom($CFG['from_email'], $CFG['from_name']);
    $m->addReplyTo($CFG['reply_to'], $CFG['from_name']);
    $m->isHTML(true);
    $m->addAddress($email, $name !== '' ? $name : $email);
    $m->Subject = 'Thank you for being there — Afro Brunch';
    $m->Body = body_for($name);
    $m->send();
}

/** Clients confirmes, dedoublonnes sur l'adresse. */
function recipients(PDO $pdo): array
{
    $out = [];
    $rows = $pdo->query('SELECT name, email FROM bookings
                         WHERE status = "CONFIRMED" ORDER BY id');
    foreach ($rows as $r) {
        $e = strtolower(trim((string) $r['email']));
        if ($e !== '' && !isset($out[$e])) {
            $out[$e] = first_name((string) $r['name']);
        }
    }
    return $out;
}

$action = $_GET['action'] ?? 'list';
$list = recipients($pdo);

if ($action === 'list') {
    $done = $pdo->query('SELECT email FROM thanks_sent')->fetchAll(PDO::FETCH_COLUMN);
    echo count($list) . " destinataire(s) unique(s), " . count($done) . " deja servi(s)\n\n";
    foreach ($list as $e => $n) {
        echo (in_array($e, $done, true) ? '  [deja] ' : '  [  a envoyer ] ')
            . str_pad($e, 38) . $n . "\n";
    }
    exit;
}

if ($action === 'test') {
    $to = array_filter(array_map('trim', explode(',', (string) ($_GET['to'] ?? ''))));
    if (!$to) exit("Parametre « to » manquant.\n");
    foreach ($to as $email) {
        $name = $list[strtolower($email)] ?? first_name((string) ($_GET['name'] ?? ''));
        try {
            send_to($email, $name);
            echo "  envoye  -> $email" . ($name ? " ($name)" : "") . "\n";
        } catch (Throwable $e) {
            echo "  ECHEC   -> $email : " . $e->getMessage() . "\n";
        }
    }
    echo "\nLes envois de test ne sont pas consignes : l'envoi groupe les resservira.\n";
    exit;
}

if ($action === 'send') {
    if (($_GET['confirm'] ?? '') !== 'SEND') {
        exit("Ajoutez &confirm=SEND pour declencher l'envoi reel.\n");
    }

    $done = $pdo->query('SELECT email FROM thanks_sent')->fetchAll(PDO::FETCH_COLUMN);
    $mark = $pdo->prepare('INSERT OR IGNORE INTO thanks_sent (email, sent_at) VALUES (?, ?)');
    $ok = $skip = $fail = 0;

    foreach ($list as $email => $name) {
        if (in_array($email, $done, true)) { $skip++; continue; }
        try {
            send_to($email, $name);
            $mark->execute([$email, date('d/m/Y H:i')]);
            $ok++;
            echo "  envoye  -> $email\n";
            usleep(700000);   // on espace les envois, pour ne pas ressembler a du publipostage brutal
        } catch (Throwable $e) {
            $fail++;
            echo "  ECHEC   -> $email : " . $e->getMessage() . "\n";
        }
    }
    echo "\n$ok envoye(s), $skip deja servi(s) et ignore(s), $fail echec(s)\n";
    exit;
}

echo "Action inconnue. Utilisez list, test ou send.\n";
