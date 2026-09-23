<?php
/**
 * Who is looking at this page.
 * GET  -> { signedIn, authConfigured, viewer, permissions, member, claim }
 * POST {action:"logout"} -> ends the session.
 */
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';

rr_session_start();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    $in = rr_input();
    if ((string)($in['action'] ?? '') === 'logout') {
        rr_log_event('signout');
        $_SESSION = [];
        @session_destroy();
        rr_json(['ok' => true, 'signedIn' => false]);
    }
    rr_fail('Unknown action.', 400);
}

$configured = rr_cfg('client_id') !== '' && rr_cfg('guild_id') !== '' && rr_cfg('role_union') !== '';
$viewer = rr_viewer();

if ($viewer === null) {
    rr_json([
        'ok' => true,
        'signedIn' => false,
        'authConfigured' => $configured,
        'permissions' => rr_permissions(null),
        'siteName' => rr_cfg('site_name'),
    ]);
}

$perms  = rr_permissions($viewer);
$member = rr_viewer_member($viewer);

$claim = null;
$st = rr_db()->prepare('SELECT * FROM claims WHERE discord_id = ? LIMIT 1');
$st->execute([(string)$viewer['discordId']]);
$row = $st->fetch();
if ($row) {
    $claim = [
        'memberId' => $row['member_id'],
        'status'   => $row['status'],
        'requestedAt' => $row['requested_at'],
    ];
}

// Claims sitting in the Yard Office waiting on a manager. Drives the badge
// on the Yard Office tab so nobody's claim sits unnoticed for days.
$pending = 0;
if (!empty($perms['manager'])) {
    $c = rr_db()->query("SELECT COUNT(*) FROM claims WHERE status = 'pending'");
    $pending = (int)$c->fetchColumn();
}

rr_json([
    'ok' => true,
    'signedIn' => true,
    'authConfigured' => $configured,
    'siteName' => rr_cfg('site_name'),
    'pendingClaims' => $pending,
    'viewer' => [
        'discordId' => $viewer['discordId'],
        'name'      => $viewer['name'],
        'username'  => $viewer['username'] ?? '',
        'avatar'    => $viewer['avatar'] ?? '',
        'roles'     => $viewer['roles'],
    ],
    'permissions' => $perms,
    'member' => $member ? rr_member_public($member) : null,
    'claim'  => $claim,
]);
