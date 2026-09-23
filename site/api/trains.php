<?php
/**
 * Train Registration.
 *
 * A conductor/engineer may hold any number of active registrations. A train
 * leaves the books one of two ways:
 *   sell   - sold back to the government by its owner (or a manager)
 *   remove - struck by a Railway Executive
 * Neither erases the row; both keep the registration in the record so the
 * chain of custody for a locomotive name survives.
 */
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$db     = rr_db();

function rr_owner_names(PDO $db): array
{
    $map = [];
    foreach ($db->query('SELECT id, first_name, last_name, grade FROM members') as $m) {
        $map[$m['id']] = [
            'name'  => trim($m['first_name'] . ' ' . $m['last_name']),
            'grade' => (int)$m['grade'],
        ];
    }
    return $map;
}

if ($method === 'GET') {
    $viewer = rr_require_viewer();
    $perms  = rr_permissions($viewer);
    $action = (string)($_GET['action'] ?? 'list');

    if ($action === 'list') {
        $scope = (string)($_GET['scope'] ?? 'active');
        $owner = rr_str($_GET['owner'] ?? '', 80);
        if ($owner === 'me') $owner = (string)($perms['memberId'] ?? '');

        $sql  = 'SELECT * FROM trains WHERE 1=1';
        $args = [];
        if ($scope === 'active') { $sql .= " AND status = 'active'"; }
        elseif ($scope !== 'all') { $sql .= ' AND status = ?'; $args[] = $scope; }
        if ($owner !== '') { $sql .= ' AND owner_id = ?'; $args[] = $owner; }
        $sql .= ' ORDER BY name COLLATE NOCASE';

        $st = $db->prepare($sql);
        $st->execute($args);
        $names = rr_owner_names($db);
        $out = [];
        foreach ($st->fetchAll() as $r) {
            $t = rr_train_public($r);
            $t['ownerName']  = $names[$r['owner_id']]['name'] ?? '(unassigned)';
            $t['ownerGrade'] = $names[$r['owner_id']]['grade'] ?? null;
            $t['isMine']     = ($perms['memberId'] !== null && $r['owner_id'] === $perms['memberId']);
            $out[] = $t;
        }
        rr_json(['ok' => true, 'trains' => $out]);
    }
    rr_fail('Unknown action.', 400);
}

if ($method !== 'POST') rr_fail('Method not allowed.', 405);

$viewer = rr_require_viewer();
$perms  = rr_permissions($viewer);
$in     = rr_input();
$action = (string)($in['action'] ?? '');

/** True when the viewer owns this registration or is a Railway Executive. */
function rr_may_touch(array $train, array $perms): bool
{
    if (!empty($perms['manager'])) return true;
    return $perms['memberId'] !== null && $train['owner_id'] === $perms['memberId'];
}

function rr_load_train(PDO $db, string $id): array
{
    $st = $db->prepare('SELECT * FROM trains WHERE id = ?');
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) rr_fail('No such train registration.', 404);
    return $row;
}

if ($action === 'register') {
    $name = rr_str($in['name'] ?? '', 120);
    if ($name === '') rr_fail('A train name is required.');

    $ownerId = rr_str($in['ownerId'] ?? '', 80);
    if ($ownerId === '' || $ownerId === 'me') $ownerId = (string)($perms['memberId'] ?? '');
    if ($ownerId === '') {
        rr_fail('Link your Discord account to a roster name before registering a train.', 409);
    }
    // Registering for somebody else is a manager action.
    if ($ownerId !== ($perms['memberId'] ?? null) && empty($perms['manager'])) {
        rr_fail('Only Railway Executives can register a train to someone else.', 403);
    }
    $chk = $db->prepare('SELECT id, status FROM members WHERE id = ?');
    $chk->execute([$ownerId]);
    $owner = $chk->fetch();
    if (!$owner) rr_fail('No such roster record.', 404);
    if ($owner['status'] === 'Released') rr_fail('That member has been released from the union.', 409);

    $id = rr_uuid();
    try {
        $st = $db->prepare('INSERT INTO trains (id, name, owner_id, status, note, registered_at, registered_by)
                            VALUES (?,?,?,?,?,?,?)');
        $st->execute([$id, $name, $ownerId, 'active', rr_str($in['note'] ?? '', 300),
                      rr_now(), (string)$viewer['name']]);
    } catch (PDOException $e) {
        if (strpos($e->getMessage(), 'UNIQUE') !== false) {
            rr_fail('A train named "' . $name . '" is already registered and active.', 409);
        }
        throw $e;
    }
    rr_log_event('train.register', $id, ['name' => $name, 'owner' => $ownerId]);
    rr_json(['ok' => true, 'id' => $id]);
}

if ($action === 'sell') {
    $train = rr_load_train($db, rr_str($in['trainId'] ?? '', 40));
    if (!rr_may_touch($train, $perms)) rr_fail('That is not your train.', 403);
    if ($train['status'] !== 'active') rr_fail('That registration is not active.', 409);

    $price = rr_str($in['price'] ?? '', 20);
    $st = $db->prepare("UPDATE trains SET status='sold', sold_at=?, sold_price=?, sold_by=? WHERE id=?");
    $st->execute([rr_now(), $price, (string)$viewer['name'], $train['id']]);
    rr_log_event('train.sell', $train['id'], ['name' => $train['name'], 'price' => $price]);
    rr_json(['ok' => true]);
}

if ($action === 'delete') {
    rr_require_manager();
    $train = rr_load_train($db, rr_str($in['trainId'] ?? '', 40));
    $st = $db->prepare("UPDATE trains SET status='removed', removed_at=?, removed_by=? WHERE id=?");
    $st->execute([rr_now(), (string)$viewer['name'], $train['id']]);
    rr_log_event('train.remove', $train['id'], ['name' => $train['name'], 'owner' => $train['owner_id']]);
    rr_json(['ok' => true]);
}

if ($action === 'repossess') {
    // Taking a train off its owner is a union act, not the owner's own - so
    // unlike 'sell', the owner cannot do this to themselves.
    rr_require_manager();
    $train = rr_load_train($db, rr_str($in['trainId'] ?? '', 40));
    if ($train['status'] !== 'active') rr_fail('That registration is not active.', 409);
    $why = rr_str($in['reason'] ?? '', 200);

    $st = $db->prepare("UPDATE trains SET status='repossessed', removed_at=?, removed_by=?,
                        note = CASE WHEN ? = '' THEN note
                                    WHEN note = '' THEN ? ELSE note || ' — ' || ? END
                        WHERE id=?");
    $st->execute([rr_now(), (string)$viewer['name'], $why, $why, $why, $train['id']]);
    rr_log_event('train.repossess', $train['id'],
                 ['name' => $train['name'], 'from' => $train['owner_id'], 'reason' => $why]);
    rr_json(['ok' => true]);
}

if ($action === 'reinstate') {
    rr_require_manager();
    $train = rr_load_train($db, rr_str($in['trainId'] ?? '', 40));
    if ($train['status'] === 'active') rr_fail('That registration is already active.', 409);
    try {
        $st = $db->prepare("UPDATE trains SET status='active', sold_at='', sold_price='', sold_by='',
                            removed_at='', removed_by='' WHERE id=?");
        $st->execute([$train['id']]);
    } catch (PDOException $e) {
        if (strpos($e->getMessage(), 'UNIQUE') !== false) {
            rr_fail('Another active registration already uses that name.', 409);
        }
        throw $e;
    }
    rr_log_event('train.reinstate', $train['id'], ['name' => $train['name']]);
    rr_json(['ok' => true]);
}

if ($action === 'update') {
    $train = rr_load_train($db, rr_str($in['trainId'] ?? '', 40));
    if (!rr_may_touch($train, $perms)) rr_fail('That is not your train.', 403);

    $name = array_key_exists('name', $in) ? rr_str($in['name'], 120) : $train['name'];
    if ($name === '') rr_fail('A train name is required.');
    $note = array_key_exists('note', $in) ? rr_str($in['note'], 300) : $train['note'];

    $ownerId = $train['owner_id'];
    if (array_key_exists('ownerId', $in) && rr_str($in['ownerId'], 80) !== $train['owner_id']) {
        if (empty($perms['manager'])) rr_fail('Only Railway Executives can reassign a train.', 403);
        $ownerId = rr_str($in['ownerId'], 80);
        $chk = $db->prepare('SELECT id FROM members WHERE id = ?');
        $chk->execute([$ownerId]);
        if (!$chk->fetch()) rr_fail('No such roster record.', 404);
    }

    try {
        $st = $db->prepare('UPDATE trains SET name=?, note=?, owner_id=? WHERE id=?');
        $st->execute([$name, $note, $ownerId, $train['id']]);
    } catch (PDOException $e) {
        if (strpos($e->getMessage(), 'UNIQUE') !== false) {
            rr_fail('Another active registration already uses that name.', 409);
        }
        throw $e;
    }
    $changed = [];
    if ($name !== $train['name'])        $changed['name']  = [$train['name'], $name];
    if ($note !== $train['note'])        $changed['note']  = [$train['note'], $note];
    if ($ownerId !== $train['owner_id']) $changed['owner'] = [$train['owner_id'], $ownerId];
    if ($changed) rr_log_event('train.update', $train['id'], $changed);
    rr_json(['ok' => true, 'changed' => array_keys($changed)]);
}

rr_fail('Unknown action.', 400);
