<?php
/**
 * On-duty hours for one roster member.
 *
 * GET ?action=member&id=<memberId>
 *   -> { shifts:[...], totals:{d14,d30,d60}, coveredThrough, importedAt }
 *
 * Office-only (Railway Operations and Railway Executives), like the roster
 * note: a general member is refused here, so the hours never reach their
 * browser at all. Shifts are loaded from the Discord duty channel; nothing in
 * the site writes to them yet.
 */
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';

$viewer = rr_require_viewer();
$perms  = rr_permissions($viewer);
if (empty($perms['canSeeHours'])) {
    rr_fail('On-duty hours are for Railway Operations and Railway Executives.', 403);
}

$db     = rr_db();
$action = (string)($_GET['action'] ?? 'member');

if ($action === 'member') {
    $id = rr_str($_GET['id'] ?? '', 80);
    if ($id === '') rr_fail('Which member?');

    $st = $db->prepare('SELECT * FROM shifts WHERE member_id = ?
                        ORDER BY shift_date DESC, posted_at DESC, id DESC');
    $st->execute([$id]);

    // Windows count back from today, inclusive, on the shift's own date.
    $today = new DateTimeImmutable(rr_now_date());
    $since = function (int $days) use ($today): string {
        return $today->sub(new DateInterval('P' . ($days - 1) . 'D'))->format('Y-m-d');
    };
    $cut = ['d14' => $since(14), 'd30' => $since(30), 'd60' => $since(60)];
    $totals = ['d14' => 0, 'd30' => 0, 'd60' => 0];
    $counts = ['d14' => 0, 'd30' => 0, 'd60' => 0];

    $shifts = [];
    foreach ($st as $r) {
        $mins = $r['minutes'] === null ? null : (int)$r['minutes'];
        foreach ($cut as $k => $from) {
            if ($r['shift_date'] >= $from) {
                $counts[$k]++;
                if ($mins !== null) $totals[$k] += $mins;
            }
        }
        $shifts[] = [
            'id'          => $r['id'],
            'date'        => $r['shift_date'],
            'postedAt'    => $r['posted_at'],
            'timeIn'      => $r['time_in'],
            'timeOut'     => $r['time_out'],
            'tz'          => $r['tz'],
            'minutes'     => $mins,
            'note'        => $r['note'],
            'raw'         => $r['raw'],
            'discordName' => $r['discord_name'],
        ];
    }

    $meta = $db->query('SELECT MAX(posted_at) AS through, MAX(imported_at) AS imported FROM shifts')->fetch();

    rr_json([
        'ok'             => true,
        'shifts'         => $shifts,
        'totals'         => $totals,
        'counts'         => $counts,
        'coveredThrough' => (string)($meta['through'] ?? ''),
        'importedAt'     => (string)($meta['imported'] ?? ''),
    ]);
}

rr_fail('Unknown action.', 400);
