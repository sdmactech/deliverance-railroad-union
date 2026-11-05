<?php
/**
 * Rail Yard (v2): the office's view of the fleet. Operations + Executives.
 *
 * GET  -> arrivals (registered in the last 30 days), attention (what somebody
 *         has to act on), fleet counts, and the weekly Top 10 drivers.
 * POST {action:'taken', trainId}   -> the train was taken back in game
 * POST {action:'untaken', trainId} -> undo that (executives)
 *
 * Attention, most urgent first:
 *   reclaim   forfeited or repossessed on the site, not yet taken back in game
 *   departed  owner has left (Quit, Fired, ...) but the train is still active
 *   orphan    active train whose owner is not on the roster
 *   loa       owner on leave; the train sits idle (information only)
 */
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';

$viewer = rr_require_viewer();
$perms  = rr_permissions($viewer);
if (empty($perms['canYard'])) rr_fail('The Rail Yard is for Operations and Executives.', 403);

$db = rr_db();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    $in = rr_input();
    $action = (string)($in['action'] ?? '');
    $st = $db->prepare('SELECT * FROM trains WHERE id = ?');
    $st->execute([rr_str($in['trainId'] ?? '', 40)]);
    $train = $st->fetch();
    if (!$train) rr_fail('No such train.', 404);

    if ($action === 'taken') {
        if (!in_array($train['status'], ['forfeited', 'repossessed'], true)) {
            rr_fail('Only a forfeited or repossessed train can be taken back.', 409);
        }
        if ($train['taken_back_at'] !== '') rr_fail('Already marked as taken back.', 409);
        $db->prepare('UPDATE trains SET taken_back_at = ?, taken_back_by = ? WHERE id = ?')
           ->execute([rr_now(), (string)$viewer['name'], $train['id']]);
        rr_log_event('train.taken_back', $train['id'], ['name' => $train['name'], 'owner' => $train['owner_id']]);
        rr_json(['ok' => true]);
    }
    if ($action === 'untaken') {
        rr_require_manager();
        $db->prepare("UPDATE trains SET taken_back_at = '', taken_back_by = '' WHERE id = ?")->execute([$train['id']]);
        rr_log_event('train.taken_back_undo', $train['id'], ['name' => $train['name']]);
        rr_json(['ok' => true]);
    }
    rr_fail('Unknown action.', 400);
}

// ------------------------------------------------------------------ read ---

$members = [];
foreach ($db->query('SELECT id, first_name, last_name, status, grade, loa_start FROM members') as $m) {
    $members[$m['id']] = $m;
}
$name = function (string $id) use ($members): string {
    return isset($members[$id]) ? trim($members[$id]['first_name'] . ' ' . $members[$id]['last_name']) : '';
};

/** "Station: Rhodes / Top Speed: 40 MPH" style lines out of the registration note. */
$specs = function (string $note): array {
    $out = [];
    foreach (preg_split('/\r?\n|\s\/\s/', $note) as $line) {
        if (preg_match('/^\s*(Station|Top Speed|Fuel Max|Water Max|Passenger[^:]*|Flatbed[^:]*|Cargo[^:]*)\s*:\s*(.+)$/i', $line, $m)) {
            $k = strtolower(trim($m[1]));
            $key = str_starts_with($k, 'station') ? 'station'
                 : (str_starts_with($k, 'top') ? 'speed'
                 : (str_starts_with($k, 'fuel') ? 'fuel'
                 : (str_starts_with($k, 'water') ? 'water'
                 : (str_starts_with($k, 'passenger') ? 'passenger' : 'cargo'))));
            $out[$key] = trim($m[2]);
        }
    }
    return $out;
};

$departed = ['Quit', 'Fired', 'Terminated', 'Banned', 'Released'];
$trains = $db->query('SELECT * FROM trains ORDER BY registered_at DESC')->fetchAll();

$arrivals = [];
$attention = [];
$recent = [];
$recentCut = gmdate('Y-m-d\TH:i:s', time() - 14 * 86400);
$fleet = ['active' => 0, 'sold' => 0, 'repossessed' => 0, 'forfeited' => 0, 'removed' => 0, 'owners' => 0];
$owners = [];
$cut = gmdate('Y-m-d\TH:i:s', time() - 30 * 86400);

foreach ($trains as $t) {
    $fleet[$t['status']] = ($fleet[$t['status']] ?? 0) + 1;
    $owner = $members[$t['owner_id']] ?? null;
    $row = [
        'id'         => $t['id'],
        'name'       => $t['name'],
        'status'     => $t['status'],
        'ownerId'    => $t['owner_id'],
        'ownerName'  => $name($t['owner_id']),
        'ownerStatus'=> $owner['status'] ?? '',
        'registeredAt' => $t['registered_at'],
        'registeredBy' => $t['registered_by'],
        'removedAt'  => $t['removed_at'],
        'takenBackAt'=> $t['taken_back_at'],
        'takenBackBy'=> $t['taken_back_by'],
        'specs'      => $specs($t['note']),
    ];
    if ($t['status'] === 'active') $owners[$t['owner_id']] = true;
    if ($t['status'] === 'active' && $t['registered_at'] >= $cut && $t['registered_by'] !== 'Roster import') {
        $arrivals[] = $row;
    }

    if ($t['taken_back_at'] !== '' && $t['taken_back_at'] >= $recentCut) $recent[] = $row;
    if (in_array($t['status'], ['forfeited', 'repossessed'], true) && $t['taken_back_at'] === '') {
        $attention[] = $row + ['kind' => 'reclaim', 'since' => $t['removed_at'],
            'why' => ($t['status'] === 'repossessed' ? 'Repossessed' : 'Forfeited')
                     . ($owner ? ' when ' . $name($t['owner_id']) . ' went ' . $owner['status'] : '')
                     . '. Take it back in game, then mark it here.'];
    } elseif ($t['status'] === 'active' && $owner && in_array($owner['status'], $departed, true)) {
        $attention[] = $row + ['kind' => 'departed', 'since' => '',
            'why' => $name($t['owner_id']) . ' is ' . $owner['status'] . ' but this train is still on the register.'];
    } elseif ($t['status'] === 'active' && !$owner) {
        $attention[] = $row + ['kind' => 'orphan', 'since' => '',
            'why' => 'No roster record owns this train.'];
    } elseif ($t['status'] === 'active' && $owner && $owner['status'] === 'LOA') {
        $attention[] = $row + ['kind' => 'loa', 'since' => $owner['loa_start'],
            'why' => $name($t['owner_id']) . ' is on leave; the train is idle.'];
    }
}
$fleet['owners'] = count($owners);

$rank = ['reclaim' => 0, 'departed' => 1, 'orphan' => 2, 'loa' => 3];
usort($attention, function ($a, $b) use ($rank) {
    return [$rank[$a['kind']], $a['name']] <=> [$rank[$b['kind']], $b['name']];
});

// Weekly Top 10, Friday to Thursday - the same weeks as the posters in
// #railroad-general. Hours are office-only, like everywhere else.
$weeks = [];
if (!empty($perms['canSeeHours'])) {
    $tz = new DateTimeZone((string)rr_cfg('timezone', 'America/Los_Angeles'));
    $today = new DateTimeImmutable('today', $tz);
    $back = ((int)$today->format('N') - 5 + 7) % 7;         // days since Friday
    $start = $today->modify("-{$back} days");
    foreach ([0, 1] as $i) {
        $from = $start->modify('-' . (7 * $i) . ' days');
        $to = $from->modify('+6 days');
        $w = "shift_date BETWEEN :f AND :t AND minutes IS NOT NULL";
        $tot = $db->prepare("SELECT COALESCE(SUM(minutes),0), COUNT(*), COUNT(DISTINCT member_id) FROM shifts WHERE $w");
        $tot->execute([':f' => $from->format('Y-m-d'), ':t' => $to->format('Y-m-d')]);
        [$mins, $n, $drivers] = $tot->fetch(PDO::FETCH_NUM);
        $top = $db->prepare("SELECT member_id, SUM(minutes) m, COUNT(*) n FROM shifts WHERE $w
                             GROUP BY member_id ORDER BY m DESC LIMIT 10");
        $top->execute([':f' => $from->format('Y-m-d'), ':t' => $to->format('Y-m-d')]);
        $rows = [];
        foreach ($top as $r) {
            $rows[] = ['memberId' => $r['member_id'], 'name' => $name($r['member_id']) ?: $r['member_id'],
                       'hours' => round($r['m'] / 60, 1), 'shifts' => (int)$r['n']];
        }
        $weeks[] = ['from' => $from->format('Y-m-d'), 'to' => $to->format('Y-m-d'),
                    'current' => $i === 0, 'hours' => round($mins / 60, 1),
                    'shifts' => (int)$n, 'drivers' => (int)$drivers, 'top' => $rows];
    }
}

rr_json([
    'ok'        => true,
    'arrivals'  => $arrivals,
    'attention' => $attention,
    'recent'    => $recent,
    'fleet'     => $fleet,
    'weeks'     => $weeks,
    'canUndo'   => !empty($perms['manager']),
    'canRepossess' => !empty($perms['manager']),
]);
