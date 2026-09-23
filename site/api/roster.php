<?php
/**
 * The Roster — union personnel, and the Discord-to-roster linking that makes
 * "my trains" possible.
 *
 * Grade and status changes are managers-only even for rank-2 editors, because
 * they are the thing the permission model itself reads.
 */
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$db     = rr_db();

// ------------------------------------------------------------------ reads ---
if ($method === 'GET') {
    $viewer = rr_require_viewer();
    $perms  = rr_permissions($viewer);
    $action = (string)($_GET['action'] ?? 'list');

    if ($action === 'list') {
        // Departed members are withheld from the QUERY, not filtered in the
        // page, so a non-executive is never sent the row at all.
        $sql  = 'SELECT * FROM members';
        $args = [];
        if (empty($perms['manager'])) {
            $sql .= ' WHERE status NOT IN (' . implode(',', array_fill(0, count(RR_PRIVATE_STATUSES), '?')) . ')';
            $args = RR_PRIVATE_STATUSES;
        }
        $sql .= ' ORDER BY grade DESC, last_name COLLATE NOCASE, first_name COLLATE NOCASE';
        $st = $db->prepare($sql);
        $st->execute($args);
        $rows = $st->fetchAll();
        $counts = [];
        foreach ($db->query("SELECT owner_id, COUNT(*) c FROM trains
                             WHERE status = 'active' GROUP BY owner_id") as $t) {
            $counts[$t['owner_id']] = (int)$t['c'];
        }
        $out = [];
        foreach ($rows as $r) {
            $m = rr_member_public($r, $perms);
            $m['activeTrains'] = $counts[$r['id']] ?? 0;
            $out[] = $m;
        }
        // Only an executive may hand out a disciplinary ending, so only an
        // executive is offered one in the dropdown.
        $offer = empty($perms['manager'])
            ? array_values(array_diff(RR_STATUSES, RR_DISCIPLINARY_STATUSES))
            : RR_STATUSES;
        rr_json(['ok' => true, 'members' => $out, 'grades' => RR_GRADES,
                 'statuses' => $offer, 'privateStatuses' => RR_PRIVATE_STATUSES]);
    }

    if ($action === 'unclaimed') {
        // Names nobody has linked a Discord account to yet — the claim menu.
        $rows = $db->query("SELECT id, first_name, last_name, grade, status FROM members
                            WHERE discord_id = '' AND status NOT IN
                                  ('Released','Quit','Fired','Terminated','Banned')
                            ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE")
                   ->fetchAll();
        $out = array_map(function ($r) {
            return [
                'id'    => $r['id'],
                'name'  => trim($r['first_name'] . ' ' . $r['last_name']),
                'grade' => (int)$r['grade'],
                'gradeTitle' => rr_grade_title((int)$r['grade']),
                'status'=> $r['status'],
            ];
        }, $rows);
        rr_json(['ok' => true, 'members' => $out]);
    }

    if ($action === 'claims') {
        rr_require_staff();
        $rows = $db->query("SELECT c.*, m.first_name, m.last_name
                            FROM claims c LEFT JOIN members m ON m.id = c.member_id
                            WHERE c.status = 'pending' ORDER BY c.requested_at")->fetchAll();
        $out = array_map(function ($r) {
            return [
                'discordId'   => $r['discord_id'],
                'discordName' => $r['discord_name'],
                'memberId'    => $r['member_id'],
                'memberName'  => trim(($r['first_name'] ?? '') . ' ' . ($r['last_name'] ?? '')),
                'requestedAt' => $r['requested_at'],
            ];
        }, $rows);
        rr_json(['ok' => true, 'claims' => $out]);
    }

    if ($action === 'events') {
        rr_require_staff();
        $limit = min(500, max(1, (int)($_GET['limit'] ?? 200)));
        $st = $db->prepare('SELECT * FROM events ORDER BY id DESC LIMIT ?');
        $st->bindValue(1, $limit, PDO::PARAM_INT);
        $st->execute();
        rr_json(['ok' => true, 'events' => $st->fetchAll()]);
    }

    rr_fail('Unknown action.', 400);
}

if ($method !== 'POST') {
    rr_fail('Method not allowed.', 405);
}

// ----------------------------------------------------------------- writes ---
$in     = rr_input();
$action = (string)($in['action'] ?? '');

/** A union member asking to be linked to a roster name. */
if ($action === 'claim') {
    $viewer = rr_require_viewer();
    $memberId = rr_str($in['memberId'] ?? '', 80);

    $st = $db->prepare('SELECT * FROM members WHERE discord_id = ? LIMIT 1');
    $st->execute([(string)$viewer['discordId']]);
    if ($st->fetch()) rr_fail('Your Discord account is already linked to a roster record.', 409);

    $st = $db->prepare("SELECT * FROM members WHERE id = ? AND discord_id = '' LIMIT 1");
    $st->execute([$memberId]);
    $target = $st->fetch();
    if (!$target) rr_fail('That roster record is not available to claim.', 404);

    $st = $db->prepare(
        "INSERT INTO claims (discord_id, discord_name, member_id, status, requested_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(discord_id) DO UPDATE SET
           member_id    = excluded.member_id,
           discord_name = excluded.discord_name,
           status       = 'pending',
           requested_at = excluded.requested_at,
           decided_at   = '',
           decided_by   = ''"
    );
    $st->execute([
        (string)$viewer['discordId'], (string)$viewer['name'],
        $memberId, 'pending', rr_now(),
    ]);
    rr_log_event('claim.request', $memberId, ['name' => $viewer['name']]);
    rr_json(['ok' => true, 'status' => 'pending']);
}

/** Manager approving or denying a claim. */
if ($action === 'claim_decide') {
    // Approving a claim links a Discord account to a roster name - roster work,
    // which is what Operations is for. Unlinking one again stays executive.
    $viewer = rr_require_staff();
    $discordId = rr_str($in['discordId'] ?? '', 40);
    $decision  = (string)($in['decision'] ?? '');
    if (!in_array($decision, ['approve', 'deny'], true)) rr_fail('Decision must be approve or deny.');

    $st = $db->prepare("SELECT * FROM claims WHERE discord_id = ? AND status = 'pending'");
    $st->execute([$discordId]);
    $claim = $st->fetch();
    if (!$claim) rr_fail('No pending claim for that account.', 404);

    if ($decision === 'approve') {
        $chk = $db->prepare("SELECT id FROM members WHERE id = ? AND discord_id = ''");
        $chk->execute([$claim['member_id']]);
        if (!$chk->fetch()) rr_fail('That roster record has since been linked to someone else.', 409);

        $up = $db->prepare('UPDATE members SET discord_id = ?, discord_name = ?, updated_at = ? WHERE id = ?');
        $up->execute([$discordId, (string)$claim['discord_name'], rr_now(), $claim['member_id']]);
    }
    $up = $db->prepare('UPDATE claims SET status = ?, decided_at = ?, decided_by = ? WHERE discord_id = ?');
    $up->execute([$decision === 'approve' ? 'approved' : 'denied', rr_now(), (string)$viewer['name'], $discordId]);

    rr_log_event('claim.' . $decision, (string)$claim['member_id'], ['discordName' => $claim['discord_name']]);
    rr_json(['ok' => true]);
}

/** Manager linking or unlinking a Discord account directly. */
if ($action === 'unlink') {
    rr_require_manager();
    $memberId = rr_str($in['memberId'] ?? '', 80);
    $st = $db->prepare('SELECT * FROM members WHERE id = ?');
    $st->execute([$memberId]);
    $m = $st->fetch();
    if (!$m) rr_fail('No such roster record.', 404);

    $up = $db->prepare("UPDATE members SET discord_id = '', last_roles = '', roles_checked_at = '', updated_at = ? WHERE id = ?");
    $up->execute([rr_now(), $memberId]);
    $db->prepare('DELETE FROM claims WHERE discord_id = ?')->execute([(string)$m['discord_id']]);
    rr_log_event('member.unlink', $memberId, ['was' => $m['discord_name']]);
    rr_json(['ok' => true]);
}

if ($action === 'create') {
    $viewer = rr_require_editor();
    $perms  = rr_permissions($viewer);
    $first = rr_str($in['firstName'] ?? '', 60);
    $last  = rr_str($in['lastName'] ?? '', 60);
    if ($first === '' && $last === '') rr_fail('A first or last name is required.');

    $id = rr_member_slug($first, $last);
    $chk = $db->prepare('SELECT id FROM members WHERE id = ?');
    $chk->execute([$id]);
    if ($chk->fetch()) rr_fail('Someone with that name is already on the roster.', 409);

    // Staff hire onto the working ladder; only an executive mints an executive.
    $grade  = max(0, min((int)$perms['maxGrade'], (int)($in['grade'] ?? 0)));
    $status = in_array((string)($in['status'] ?? ''), RR_STATUSES, true) ? (string)$in['status'] : 'Probation';
    if (empty($perms['manager']) && in_array($status, RR_DISCIPLINARY_STATUSES, true)) {
        rr_fail('Only Railway Executives can fire, terminate or ban somebody.', 403);
    }
    $loa = $status === 'LOA'
        ? (rr_date(rr_str($in['loaStart'] ?? '', 40)) ?: rr_now_date()) : '';
    $prob   = rr_date(rr_str($in['probationDate'] ?? '', 40));
    $after  = rr_date(rr_str($in['canTrainAfter'] ?? '', 40));
    if ($after === '' && $prob !== '') $after = rr_train_after($prob);

    $st = $db->prepare('INSERT INTO members
        (id, first_name, last_name, grade, status, office, agency, po, trainee,
         probation_date, can_train_after, loa_start, note, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    $st->execute([
        $id, $first, $last, $grade, $status,
        empty($perms['manager']) ? '' : rr_str($in['office'] ?? '', 60),
        rr_str($in['agency'] ?? '', 60),
        rr_str($in['po'] ?? '', 20), rr_str($in['trainee'] ?? '', 80),
        $prob, $after, $loa,
        empty($perms['canSeeNotes']) ? '' : rr_str($in['note'] ?? '', 500),
        rr_now(), rr_now(),
    ]);
    rr_log_event('member.create', $id, ['name' => trim("$first $last"), 'grade' => $grade]);
    rr_json(['ok' => true, 'id' => $id]);
}

if ($action === 'update') {
    $viewer = rr_require_editor();
    $perms  = rr_permissions($viewer);
    $id     = rr_str($in['memberId'] ?? '', 80);

    $st = $db->prepare('SELECT * FROM members WHERE id = ?');
    $st->execute([$id]);
    $before = $st->fetch();
    if (!$before) rr_fail('No such roster record.', 404);

    // Operations staff hire, promote and set status up to grade 2. Anything at
    // or above Railroad Superintendent, and the office field, stays executive.
    $wantsGrade  = array_key_exists('grade', $in)  && (int)$in['grade'] !== (int)$before['grade'];
    $wantsStatus = array_key_exists('status', $in) && (string)$in['status'] !== (string)$before['status'];
    $wantsOffice = array_key_exists('office', $in) && rr_str($in['office'], 60) !== (string)$before['office'];
    $isMgr       = !empty($perms['manager']);
    $cap         = (int)$perms['maxGrade'];

    if (($wantsGrade || $wantsStatus) && empty($perms['canPromote'])) {
        rr_fail('You do not have permission to change grade or status.', 403);
    }
    if ($wantsOffice && !$isMgr) {
        rr_fail('Only Railway Executives can change the office field.', 403);
    }
    if ($wantsStatus && !$isMgr
        && in_array((string)$in['status'], RR_DISCIPLINARY_STATUSES, true)) {
        rr_fail('Only Railway Executives can fire, terminate or ban somebody.', 403);
    }
    // Staff may maintain an executive's record, but not their rank or standing.
    if (($wantsGrade || $wantsStatus) && !$isMgr && (int)$before['grade'] > $cap) {
        rr_fail('Only Railway Executives can change an executive\'s rank or status.', 403);
    }
    if ($wantsGrade && !$isMgr && (int)$in['grade'] > $cap) {
        rr_fail('Only Railway Executives can promote above grade ' . $cap . '.', 403);
    }

    $fields = [
        'grade'           => $wantsGrade  ? max(0, min($isMgr ? 5 : $cap, (int)$in['grade'])) : (int)$before['grade'],
        'status'          => $wantsStatus && in_array((string)$in['status'], RR_STATUSES, true)
                              ? (string)$in['status'] : (string)$before['status'],
        'office'          => array_key_exists('office', $in)  ? rr_str($in['office'], 60)  : $before['office'],
        'agency'          => array_key_exists('agency', $in)  ? rr_str($in['agency'], 60)  : $before['agency'],
        'po'              => array_key_exists('po', $in)      ? rr_str($in['po'], 20)      : $before['po'],
        'trainee'         => array_key_exists('trainee', $in) ? rr_str($in['trainee'], 80) : $before['trainee'],
        // Cannot write a note you are not allowed to read - otherwise an
        // editor without the Operations role would blank it unseen.
        'note'            => (array_key_exists('note', $in) && !empty($perms['canSeeNotes']))
                              ? rr_str($in['note'], 500) : $before['note'],
        'first_name'      => array_key_exists('firstName', $in) ? rr_str($in['firstName'], 60) : $before['first_name'],
        'last_name'       => array_key_exists('lastName', $in)  ? rr_str($in['lastName'], 60)  : $before['last_name'],
        'probation_date'  => array_key_exists('probationDate', $in)
                              ? rr_date(rr_str($in['probationDate'], 40)) : $before['probation_date'],
    ];
    // An LOA start date only means anything while the member is on LOA; moving
    // them off it clears the date rather than leaving a stale one behind.
    $fields['loa_start'] = $fields['status'] === 'LOA'
        ? (array_key_exists('loaStart', $in)
            ? rr_date(rr_str($in['loaStart'], 40))
            : ((string)$before['status'] === 'LOA' ? (string)($before['loa_start'] ?? '') : rr_now_date()))
        : '';

    $fields['can_train_after'] = array_key_exists('canTrainAfter', $in)
        ? rr_date(rr_str($in['canTrainAfter'], 40))
        : ($fields['probation_date'] !== $before['probation_date']
            ? rr_train_after($fields['probation_date'])
            : $before['can_train_after']);

    $st = $db->prepare('UPDATE members SET
        first_name=:first_name, last_name=:last_name, grade=:grade, status=:status,
        office=:office, agency=:agency, po=:po, trainee=:trainee,
        probation_date=:probation_date, can_train_after=:can_train_after,
        loa_start=:loa_start, note=:note, updated_at=:updated_at WHERE id=:id');
    $fields['updated_at'] = rr_now();
    $fields['id'] = $id;
    $st->execute($fields);

    // Leaving the union takes your engines with you. Walk out and they are
    // forfeited; get thrown out and they are repossessed. Either way it is
    // recorded on the register rather than happening silently.
    $tookTrains = [];
    $disposition = $wantsStatus ? rr_train_disposition((string)$fields['status']) : null;
    if ($disposition !== null && rr_train_disposition((string)$before['status']) === null) {
        $q = $db->prepare("SELECT id, name FROM trains WHERE owner_id = ? AND status = 'active'");
        $q->execute([$id]);
        $tookTrains = $q->fetchAll();
        if ($tookTrains) {
            $db->prepare("UPDATE trains SET status = ?, removed_at = ?, removed_by = ?
                          WHERE owner_id = ? AND status = 'active'")
               ->execute([$disposition, rr_now(), (string)$viewer['name'], $id]);
            rr_log_event('train.' . $disposition, $id, [
                'because' => $fields['status'],
                'trains'  => array_column($tookTrains, 'name'),
            ]);
        }
    }

    $changed = [];
    foreach ($fields as $k => $v) {
        if ($k === 'updated_at' || $k === 'id') continue;
        if ((string)$before[$k] !== (string)$v) $changed[$k] = [(string)$before[$k], (string)$v];
    }
    if ($changed) rr_log_event('member.update', $id, $changed);
    rr_json(['ok' => true, 'changed' => array_keys($changed),
             'trainsTaken' => array_column($tookTrains, 'name'),
             'disposition' => $disposition]);
}

if ($action === 'merge') {
    // Fold one roster record into another. Duplicates happen: somebody is
    // entered twice under a slightly different name, or a fresh record gets
    // created before anyone notices the old one. Executives only.
    rr_require_manager();
    $keepId  = rr_str($in['keepId'] ?? '', 80);
    $mergeId = rr_str($in['mergeId'] ?? '', 80);
    if ($keepId === '' || $mergeId === '') rr_fail('Two records are required.');
    if ($keepId === $mergeId) rr_fail('That is the same record twice.');

    $get = $db->prepare('SELECT * FROM members WHERE id = ?');
    $get->execute([$keepId]);  $keep  = $get->fetch();
    $get->execute([$mergeId]); $merge = $get->fetch();
    if (!$keep || !$merge) rr_fail('No such roster record.', 404);

    // No train-name clash is possible here, and it is worth saying why: the
    // unique index trains_active_name is on the NAME ALONE across the whole
    // register, not per owner, so two records can never both hold an active
    // registration of the same name. Moving trains only rewrites owner_id, so
    // it cannot violate that index whatever the two records own.

    $db->beginTransaction();
    try {
        // Fill only the gaps in the surviving record; never overwrite it.
        $fill = ['first_name', 'last_name', 'office', 'agency', 'po', 'trainee',
                 'probation_date', 'can_train_after', 'loa_start', 'note'];
        $merged = [];
        foreach ($fill as $f) {
            if (trim((string)$keep[$f]) === '' && trim((string)$merge[$f]) !== '') {
                $merged[$f] = (string)$merge[$f];
            }
        }
        // Rank and Discord link: the better of the two wins.
        if ((int)$merge['grade'] > (int)$keep['grade']) $merged['grade'] = (int)$merge['grade'];
        if ((string)$keep['discord_id'] === '' && (string)$merge['discord_id'] !== '') {
            $merged['discord_id']       = (string)$merge['discord_id'];
            $merged['discord_name']     = (string)$merge['discord_name'];
            $merged['last_roles']       = (string)$merge['last_roles'];
            $merged['roles_checked_at'] = (string)$merge['roles_checked_at'];
        }

        $tr = $db->prepare('SELECT id, name, status FROM trains WHERE owner_id = ?');
        $tr->execute([$mergeId]);
        $moved = $tr->fetchAll();

        // Drop the absorbed row FIRST: the unique index on discord_id would
        // otherwise refuse to let the survivor take over the same account.
        $db->prepare('DELETE FROM claims WHERE member_id = ?')->execute([$mergeId]);
        $db->prepare('DELETE FROM members WHERE id = ?')->execute([$mergeId]);
        $db->prepare('UPDATE trains SET owner_id = ? WHERE owner_id = ?')
           ->execute([$keepId, $mergeId]);

        if ($merged) {
            $sets = [];
            foreach ($merged as $k => $v) $sets[] = $k . ' = :' . $k;
            $sets[] = 'updated_at = :updated_at';
            $merged['updated_at'] = rr_now();
            $merged['id'] = $keepId;
            $db->prepare('UPDATE members SET ' . implode(', ', $sets) . ' WHERE id = :id')
               ->execute($merged);
            unset($merged['id'], $merged['updated_at']);
        }
        $db->commit();

        // Both records go into the log in full, so a wrong merge is reversible.
        rr_log_event('member.merge', $keepId, [
            'absorbed'    => $merge,
            'keptBefore'  => $keep,
            'fieldsTaken' => array_keys($merged),
            'trainsMoved' => $moved,
        ]);
        rr_json(['ok' => true, 'keptId' => $keepId,
                 'fieldsTaken' => array_keys($merged), 'trainsMoved' => count($moved)]);
    } catch (Throwable $e) {
        $db->rollBack();
        rr_fail('Merge failed: ' . $e->getMessage(), 500);
    }
}

if ($action === 'delete') {
    rr_require_manager();
    $id = rr_str($in['memberId'] ?? '', 80);
    $st = $db->prepare('SELECT * FROM members WHERE id = ?');
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) rr_fail('No such roster record.', 404);

    $db->beginTransaction();
    try {
        // Their active registrations come off the books with them, not silently.
        $tr = $db->prepare("SELECT id, name FROM trains WHERE owner_id = ? AND status = 'active'");
        $tr->execute([$id]);
        $trains = $tr->fetchAll();
        $me = rr_viewer();
        $db->prepare("UPDATE trains SET status='removed', removed_at=?, removed_by=?
                      WHERE owner_id = ? AND status='active'")
           ->execute([rr_now(), (string)($me['name'] ?? ''), $id]);

        $db->prepare('DELETE FROM claims WHERE member_id = ?')->execute([$id]);
        $db->prepare('DELETE FROM members WHERE id = ?')->execute([$id]);
        $db->commit();

        // The whole record goes into the log so a mistaken delete is recoverable.
        rr_log_event('member.delete', $id, ['record' => $row, 'trainsRemoved' => $trains]);
        rr_json(['ok' => true, 'trainsRemoved' => count($trains)]);
    } catch (Throwable $e) {
        $db->rollBack();
        rr_fail('Delete failed: ' . $e->getMessage(), 500);
    }
}

rr_fail('Unknown action.', 400);
