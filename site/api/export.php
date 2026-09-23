<?php
/**
 * Data download. Railway Executives only.
 *
 * GET ?what=roster   -> roster.csv
 * GET ?what=trains   -> train-registrations.csv
 * GET ?what=backup   -> everything the office holds, as JSON
 *
 * These are plain downloads, not XHR: the browser follows the link with the
 * session cookie attached, so the response carries Content-Disposition rather
 * than the JSON envelope every other endpoint uses.
 */
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';

rr_require_manager();

$db   = rr_db();
$what = (string)($_GET['what'] ?? 'roster');
$day  = date('Y-m-d');

function rr_send_csv(string $filename, array $header, array $rows): void
{
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    $out = fopen('php://output', 'w');
    // Excel and Numbers both need the BOM to read UTF-8 without mangling it.
    fwrite($out, "\xEF\xBB\xBF");
    fputcsv($out, $header);
    foreach ($rows as $r) fputcsv($out, $r);
    fclose($out);
    exit;
}

if ($what === 'roster') {
    $rows = [];
    $st = $db->query('SELECT * FROM members ORDER BY grade DESC, last_name, first_name');
    foreach ($st as $m) {
        $rows[] = [
            $m['id'], $m['first_name'], $m['last_name'],
            (int)$m['grade'], rr_grade_title((int)$m['grade']),
            $m['office'], $m['status'], $m['po'], $m['agency'], $m['trainee'],
            $m['probation_date'], $m['can_train_after'], $m['loa_start'] ?? '', $m['note'],
            $m['discord_name'], $m['discord_id'],
            $m['roles_checked_at'], $m['created_at'], $m['updated_at'],
        ];
    }
    rr_log_event('export', 'roster', ['rows' => count($rows)]);
    rr_send_csv("deliverance-roster-$day.csv", [
        'ID', 'First name', 'Last name', 'Grade', 'Rank title', 'Office',
        'Status', 'PO box', 'Agency', 'Trainee', 'On probation', 'Can train after', 'LOA since',
        'Note', 'Discord name', 'Discord ID', 'Roles last read', 'Created', 'Updated',
    ], $rows);
}

if ($what === 'trains') {
    $names = [];
    foreach ($db->query('SELECT id, first_name, last_name FROM members') as $m) {
        $names[$m['id']] = trim($m['first_name'] . ' ' . $m['last_name']);
    }
    $rows = [];
    $st = $db->query('SELECT * FROM trains ORDER BY status, name COLLATE NOCASE');
    foreach ($st as $t) {
        $rows[] = [
            $t['name'], $names[$t['owner_id']] ?? $t['owner_id'], $t['status'],
            $t['registered_at'], $t['registered_by'],
            $t['sold_at'], $t['sold_price'], $t['sold_by'],
            $t['removed_at'], $t['removed_by'], $t['note'],
        ];
    }
    rr_log_event('export', 'trains', ['rows' => count($rows)]);
    rr_send_csv("deliverance-trains-$day.csv", [
        'Train', 'Registered to', 'Status', 'Registered', 'Registered by',
        'Sold', 'Sold for', 'Sold by', 'Removed', 'Removed by', 'Note',
    ], $rows);
}

if ($what === 'backup') {
    $dump = function (string $table) use ($db): array {
        return $db->query('SELECT * FROM ' . $table)->fetchAll();
    };
    $payload = [
        'site'       => rr_cfg('site_name'),
        'exportedAt' => rr_now(),
        'exportedBy' => (string)(rr_viewer()['name'] ?? ''),
        'members'    => $dump('members'),
        'trains'     => $dump('trains'),
        'claims'     => $dump('claims'),
        'events'     => $dump('events'),
    ];
    rr_log_event('export', 'backup', ['members' => count($payload['members'])]);
    header('Content-Type: application/json; charset=utf-8');
    header('Content-Disposition: attachment; filename="deliverance-railroad-backup-' . $day . '.json"');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

rr_fail('Unknown export.', 400);
