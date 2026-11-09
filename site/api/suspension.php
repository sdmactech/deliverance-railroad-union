<?php
/**
 * Suspension thread: the reason, and everything the office adds after it.
 * Operations and Executives only, at every endpoint (Mac, 2026-11-08: the
 * status is public, the reason and its files are not).
 *
 * GET  ?member=<id>          -> every suspension on that record, newest first,
 *                               each with its entries and their files
 * GET  ?file=<id>            -> the file itself (images and PDFs inline)
 * POST multipart: suspensionId, body, files[]  -> add an entry
 *
 * Files are stored under the data volume with a random name, outside the
 * read-only web root, so the only way to them is through this script.
 */
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';

$viewer = rr_require_viewer();
$perms  = rr_permissions($viewer);
if (empty($perms['canSeeNotes'])) {
    rr_fail('Suspension records are for Railway Operations and Railway Executives.', 403);
}
$db = rr_db();

/** What may be attached, by the type the file actually is (not its name). */
const RR_SUSP_TYPES = [
    'image/png'       => 'png',
    'image/jpeg'      => 'jpg',
    'image/gif'       => 'gif',
    'image/webp'      => 'webp',
    'application/pdf' => 'pdf',
    'text/plain'      => 'txt',
];
const RR_SUSP_MAX_FILES = 6;

// ------------------------------------------------------------------ file ---
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET' && isset($_GET['file'])) {
    $st = $db->prepare('SELECT * FROM suspension_files WHERE id = ?');
    $st->execute([rr_str($_GET['file'], 40)]);
    $f = $st->fetch();
    if (!$f || !preg_match('/^[a-f0-9]{32}\.[a-z]{3,4}$/', (string)$f['stored'])) rr_fail('No such file.', 404);
    $path = rr_upload_dir() . '/' . $f['stored'];
    if (!is_file($path)) rr_fail('That file is missing from the store.', 404);

    $mime = isset(RR_SUSP_TYPES[$f['mime']]) ? $f['mime'] : 'application/octet-stream';
    // Text is shown as text, never rendered: a .txt cannot become a page.
    // PDFs download rather than open: the sandbox policy below stops Chrome's
    // PDF viewer, and a PDF can carry its own scripts and links.
    $inline = $mime !== 'application/octet-stream' && $mime !== 'application/pdf' && empty($_GET['download']);
    $safe = preg_replace('/[^A-Za-z0-9 ._()-]+/', '_', (string)$f['name']) ?: 'file';
    header('Content-Type: ' . ($mime === 'text/plain' ? 'text/plain; charset=utf-8' : $mime));
    header('Content-Length: ' . filesize($path));
    header('Content-Disposition: ' . ($inline ? 'inline' : 'attachment') . '; filename="' . $safe . '"');
    header('X-Content-Type-Options: nosniff');
    header("Content-Security-Policy: default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
    header('Cache-Control: private, no-store');
    readfile($path);
    exit;
}

// ------------------------------------------------------------------ list ---
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET') {
    $memberId = rr_str($_GET['member'] ?? '', 80);
    $st = $db->prepare('SELECT * FROM suspensions WHERE member_id = ? ORDER BY opened_at DESC');
    $st->execute([$memberId]);
    $susps = $st->fetchAll();

    $entries = $db->prepare('SELECT * FROM suspension_entries WHERE suspension_id = ? ORDER BY at, rowid');
    $files   = $db->prepare('SELECT id, entry_id, name, mime, size FROM suspension_files WHERE member_id = ? ORDER BY rowid');
    $files->execute([$memberId]);
    $byEntry = [];
    foreach ($files->fetchAll() as $f) {
        $byEntry[$f['entry_id']][] = [
            'id' => $f['id'], 'name' => $f['name'], 'mime' => $f['mime'], 'size' => (int)$f['size'],
            'isImage' => strpos((string)$f['mime'], 'image/') === 0,
        ];
    }
    $out = [];
    foreach ($susps as $s) {
        $entries->execute([$s['id']]);
        $list = [];
        foreach ($entries->fetchAll() as $e) {
            $list[] = [
                'id' => $e['id'], 'at' => $e['at'], 'author' => $e['author_name'],
                'kind' => $e['kind'], 'body' => $e['body'], 'files' => $byEntry[$e['id']] ?? [],
            ];
        }
        $out[] = [
            'id' => $s['id'], 'from' => $s['start_date'], 'until' => $s['end_date'],
            'openedAt' => $s['opened_at'], 'openedBy' => $s['opened_by'],
            'liftedAt' => $s['lifted_at'], 'liftedBy' => $s['lifted_by'], 'liftedTo' => $s['lifted_to'],
            'open' => $s['lifted_at'] === '', 'entries' => $list,
        ];
    }
    rr_json(['ok' => true, 'suspensions' => $out,
             'maxBytes' => rr_ini_bytes((string)ini_get('post_max_size')),
             'maxFiles' => RR_SUSP_MAX_FILES, 'types' => array_keys(RR_SUSP_TYPES)]);
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') rr_fail('Method not allowed.', 405);

// ------------------------------------------------------------- add entry ---
// An upload over post_max_size arrives with $_POST and $_FILES both empty.
if (empty($_POST) && empty($_FILES) && (int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 0) {
    rr_fail('Those files are too large together. Keep a single post under '
        . ini_get('post_max_size') . 'B.', 413);
}
$sid  = rr_str($_POST['suspensionId'] ?? '', 40);
$body = rr_str($_POST['body'] ?? '', 4000);

// Only on a record that is still on the roster (deleted ones are parked).
$st = $db->prepare('SELECT s.* FROM suspensions s JOIN members m ON m.id = s.member_id WHERE s.id = ?');
$st->execute([$sid]);
$susp = $st->fetch();
if (!$susp) rr_fail('No such suspension.', 404);

// Normalise files[] into a flat list.
$incoming = [];
if (isset($_FILES['files']) && is_array($_FILES['files']['name'])) {
    foreach ($_FILES['files']['name'] as $i => $n) {
        if ((int)$_FILES['files']['error'][$i] === UPLOAD_ERR_NO_FILE) continue;
        $incoming[] = [
            'name' => (string)$n, 'tmp' => (string)$_FILES['files']['tmp_name'][$i],
            'error' => (int)$_FILES['files']['error'][$i], 'size' => (int)$_FILES['files']['size'][$i],
        ];
    }
}
if ($body === '' && !$incoming) rr_fail('Write a comment or attach a file.');
if (count($incoming) > RR_SUSP_MAX_FILES) rr_fail('Attach at most ' . RR_SUSP_MAX_FILES . ' files at a time.');

// Check every file before anything is written, so a bad one sinks the post
// rather than leaving half of it on the record.
$finfo = new finfo(FILEINFO_MIME_TYPE);
$ready = [];
foreach ($incoming as $f) {
    if ($f['error'] === UPLOAD_ERR_INI_SIZE || $f['error'] === UPLOAD_ERR_FORM_SIZE) {
        rr_fail($f['name'] . ' is too large (limit ' . ini_get('upload_max_filesize') . 'B).', 413);
    }
    if ($f['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($f['tmp'])) {
        rr_fail($f['name'] . ' did not upload. Try again.', 400);
    }
    $mime = (string)$finfo->file($f['tmp']);
    if (!isset(RR_SUSP_TYPES[$mime])) {
        rr_fail($f['name'] . ' is not a picture, PDF or text file.', 415);
    }
    $ready[] = $f + ['mime' => $mime, 'ext' => RR_SUSP_TYPES[$mime]];
}

$dir = rr_upload_dir();
if (!is_dir($dir) || !is_writable($dir)) rr_fail('The file store is not writable.', 500);

$eid = rr_uuid();
$saved = [];
$db->beginTransaction();
try {
    $db->prepare('INSERT INTO suspension_entries
        (id, suspension_id, member_id, at, author_id, author_name, kind, body)
        VALUES (?,?,?,?,?,?,?,?)')
       ->execute([$eid, $sid, $susp['member_id'], rr_now(), (string)$viewer['discordId'],
                  (string)$viewer['name'], 'comment', $body]);
    $ins = $db->prepare('INSERT INTO suspension_files
        (id, entry_id, member_id, name, stored, mime, size, sha256, at) VALUES (?,?,?,?,?,?,?,?,?)');
    foreach ($ready as $f) {
        $stored = rr_uuid() . '.' . $f['ext'];
        if (!move_uploaded_file($f['tmp'], $dir . '/' . $stored)) throw new RuntimeException('could not store ' . $f['name']);
        @chmod($dir . '/' . $stored, 0640);
        $saved[] = $dir . '/' . $stored;
        $clean = rr_str(basename(str_replace('\\', '/', $f['name'])), 120) ?: ('file.' . $f['ext']);
        $ins->execute([rr_uuid(), $eid, $susp['member_id'], $clean, $stored, $f['mime'],
                       (int)filesize($dir . '/' . $stored), (string)hash_file('sha256', $dir . '/' . $stored), rr_now()]);
    }
    $db->commit();
} catch (Throwable $e) {
    $db->rollBack();
    foreach ($saved as $p) @unlink($p);
    error_log('suspension upload: ' . $e->getMessage());
    rr_fail('Could not save that. Nothing was added.', 500);
}

rr_log_event('suspension.comment', (string)$susp['member_id'], [
    'suspension' => $sid, 'files' => array_column($ready, 'name'), 'chars' => strlen($body),
]);
rr_json(['ok' => true, 'entryId' => $eid, 'files' => count($ready)]);

/** "4M" -> 4194304. */
function rr_ini_bytes(string $v): int
{
    $v = trim($v);
    $n = (int)$v;
    switch (strtoupper(substr($v, -1))) {
        case 'G': $n *= 1024;
        // fall through
        case 'M': $n *= 1024;
        // fall through
        case 'K': $n *= 1024;
    }
    return $n;
}
