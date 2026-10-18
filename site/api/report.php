<?php
/**
 * Daily Report: on-duty hours by day, and for each day every driver's share.
 *
 * GET ?start=YYYY-MM-DD&end=YYYY-MM-DD
 *   -> { days: { date: { minutes, drivers:[{id,name,minutes,shifts,share}],
 *                         shifts:[...] } }, coveredThrough, lastRun }
 *
 * Operations and Executives only, the same bar as the hours themselves
 * (Mac, 2026-10-17). A day is the shift's own date, as posted.
 */
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';

$viewer = rr_require_viewer();
$perms  = rr_permissions($viewer);
if (empty($perms['canSeeHours'])) {
    rr_fail('The Daily Report is for Railway Operations and Railway Executives.', 403);
}

$db    = rr_db();
$today = new DateTimeImmutable(rr_now_date());
$start = rr_date(rr_str($_GET['start'] ?? '', 20)) ?: $today->sub(new DateInterval('P45D'))->format('Y-m-d');
$end   = rr_date(rr_str($_GET['end'] ?? '', 20))   ?: $today->format('Y-m-d');
if ($end < $start) [$start, $end] = [$end, $start];

$st = $db->prepare("SELECT s.*, m.first_name, m.last_name FROM shifts s
                    JOIN members m ON m.id = s.member_id
                    WHERE s.shift_date BETWEEN ? AND ?
                    ORDER BY s.shift_date, s.posted_at, s.id");
$st->execute([$start, $end]);

$days = [];
foreach ($st as $r) {
    $d = $r['shift_date'];
    if (!isset($days[$d])) $days[$d] = ['minutes' => 0, 'drivers' => [], 'shifts' => []];
    $mins = $r['minutes'] === null ? null : (int)$r['minutes'];
    $id   = $r['member_id'];
    if (!isset($days[$d]['drivers'][$id])) {
        $days[$d]['drivers'][$id] = ['id' => $id,
            'name' => trim($r['first_name'] . ' ' . $r['last_name']), 'minutes' => 0, 'shifts' => 0];
    }
    $days[$d]['drivers'][$id]['shifts']++;
    if ($mins !== null) {
        $days[$d]['drivers'][$id]['minutes'] += $mins;
        $days[$d]['minutes'] += $mins;
    }
    $days[$d]['shifts'][] = [
        'id' => $r['id'], 'memberId' => $id,
        'name' => trim($r['first_name'] . ' ' . $r['last_name']),
        'timeIn' => $r['time_in'], 'timeOut' => $r['time_out'], 'tz' => $r['tz'],
        'minutes' => $mins, 'note' => $r['note'], 'raw' => $r['raw'],
        'postedAt' => $r['posted_at'], 'discordName' => $r['discord_name'],
    ];
}

// Each driver's share of the day's hours, biggest first. Shares add to 100.
foreach ($days as $d => &$day) {
    $drivers = array_values($day['drivers']);
    usort($drivers, function ($a, $b) { return $b['minutes'] <=> $a['minutes'] ?: strcmp($a['name'], $b['name']); });
    foreach ($drivers as &$x) {
        $x['share'] = $day['minutes'] > 0 ? round($x['minutes'] * 100 / $day['minutes'], 1) : 0;
    }
    unset($x);
    $day['drivers'] = $drivers;
}
unset($day);

$meta = $db->query('SELECT MAX(posted_at) FROM shifts')->fetchColumn();
$run  = $db->query('SELECT at, through, posts, inserted, updated, added, held FROM scrape_runs ORDER BY id DESC LIMIT 1')->fetch();

rr_json([
    'ok'             => true,
    'start'          => $start,
    'end'            => $end,
    'days'           => (object)$days,
    'coveredThrough' => (string)$meta,
    'lastRun'        => $run ?: null,
]);
