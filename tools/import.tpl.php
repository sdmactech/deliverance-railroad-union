<?php
// Duty-channel import, run inside the railroad-union container as the web user
// (uid 33, so the SQLite -wal/-shm stay owned by the site):
//   docker exec -i -u 33 [-e DRY_RUN=1] railroad-union php < import.php
// Built by tools/ingest.py, which embeds the payload. Idempotent: a shift is
// keyed on its Discord message id; an edited post refreshes its row.
declare(strict_types=1);
require '/var/www/html/api/bootstrap.php';

$dry = getenv('DRY_RUN') === '1';
$p   = json_decode(base64_decode('__PAYLOAD__'), true);
if (!is_array($p)) { fwrite(STDERR, "bad payload\n"); exit(1); }

$db    = rr_db();
// Who the office log records as doing the import: from the private local
// config the payload was built with, never hard-coded in this repo.
$aSt   = $db->prepare('SELECT discord_id FROM members WHERE id = ?');
$aSt->execute([(string)($p['actor_member_id'] ?? '')]);
$actor = (string)$aSt->fetchColumn();
$actorName = (string)($p['actor_name'] ?? 'Duty-channel import');
$now   = rr_now();
$log   = $db->prepare('INSERT INTO events (at, actor_id, actor_name, action, target, detail) VALUES (?,?,?,?,?,?)');
$ev    = function (string $a, string $t, array $d) use ($log, $actor, $actorName, $now) {
    $log->execute([$now, $actor, $actorName, $a, $t, json_encode($d, JSON_UNESCAPED_SLASHES)]);
};
$out = ['created' => [], 'aliases' => 0, 'inserted' => 0, 'updated' => 0, 'unchanged' => 0];
$db->beginTransaction();

foreach ($p['new'] ?? [] as $m) {
    $chk = $db->prepare('SELECT 1 FROM members WHERE id = ?');
    $chk->execute([$m['id']]);
    if ($chk->fetch()) continue;
    $db->prepare("INSERT INTO members (id, first_name, last_name, grade, status, agency, note, created_at, updated_at)
                  VALUES (?,?,?,0,'Probation',?,?,?,?)")
       ->execute([$m['id'], $m['first'], $m['last'], $m['agency'] ?? '', $m['note'], $now, $now]);
    $ev('member.create', $m['id'], ['name' => trim($m['first'] . ' ' . $m['last']), 'grade' => 0]);
    $out['created'][] = $m['id'];
}

$al = $db->prepare('INSERT OR IGNORE INTO aliases (discord_name, member_id, created_at) VALUES (?,?,?)');
foreach ($p['aliases'] ?? [] as $name => $mid) {
    $al->execute([$name, $mid, $now]);
    $out['aliases'] += $al->rowCount();
}

$ins = $db->prepare("INSERT OR IGNORE INTO shifts
    (id, member_id, source, source_id, posted_at, shift_date, time_in, time_out, tz, minutes, note, raw, discord_name, imported_at)
    VALUES (?,?,'discord',?,?,?,?,?,?,?,?,?,?,?)");
$cur = $db->prepare('SELECT raw, minutes, note FROM shifts WHERE id = ?');
$upd = $db->prepare('UPDATE shifts SET shift_date = ?, time_in = ?, time_out = ?, tz = ?, minutes = ?, note = ?, raw = ?, imported_at = ? WHERE id = ?');
$touched = [];
foreach ($p['shifts'] as $s) {
    $ins->execute([$s['id'], $s['member_id'], $s['source_id'], $s['posted_at'], $s['shift_date'],
        $s['time_in'], $s['time_out'], $s['tz'], $s['minutes'], $s['note'], $s['raw'], $s['discord_name'], $now]);
    if ($ins->rowCount()) { $out['inserted']++; $touched[$s['member_id']] = 1; continue; }
    $cur->execute([$s['id']]);
    $c = $cur->fetch();
    // A row an officer corrected by hand is left alone (its note carries a
    // marker the import never writes).
    if ($c && preg_match('/\((?:corrected|Mac),/', (string)$c['note'])) { $out['unchanged']++; continue; }
    if ($c && $c['raw'] === $s['raw']) { $out['unchanged']++; continue; }
    $upd->execute([$s['shift_date'], $s['time_in'], $s['time_out'], $s['tz'], $s['minutes'], $s['note'], $s['raw'], $now, $s['id']]);
    $out['updated']++; $touched[$s['member_id']] = 1;
}
if ($out['inserted'] || $out['updated']) {
    $ev('hours.import', '', ['shifts' => $out['inserted'], 'updated' => $out['updated'],
        'members' => count($touched), 'through' => $p['through']]);
}
$db->prepare('INSERT INTO scrape_runs (at, through, posts, inserted, updated, added, held, detail) VALUES (?,?,?,?,?,?,?,?)')
   ->execute([$now, $p['through'], (int)($p['posts'] ?? 0), $out['inserted'], $out['updated'],
              implode(', ', $out['created']), implode(', ', $p['held'] ?? []), json_encode($p['notes'] ?? [])]);

if ($dry) { $db->rollBack(); $out['dryRun'] = true; } else { $db->commit(); }
$out['totalShifts'] = (int)$db->query('SELECT COUNT(*) FROM shifts')->fetchColumn();
echo json_encode($out), "\n";
