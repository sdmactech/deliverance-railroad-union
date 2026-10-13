<?php
/**
 * Deliverance Railroad Union — shared bootstrap.
 *
 * Owns the SQLite store, the schema, the signed-in session, and the permission
 * model. Every other file in api/ starts by requiring this.
 *
 * Permission model (settled with Mac 2026-09-22):
 *   Discord decides WHAT YOU MAY DO. The roster decides WHAT RANK YOU ARE.
 *     - "Railroad Union"      -> the door. No role, no entry.
 *     - "Railroad Operations" -> staff. Hire, edit records, promote to 2.
 *     - "Railway Executives"  -> manager. Delete, unlink, office, grade 3+.
 *   A roster grade of 3+ without the Railway Executives role does NOT get
 *   manager powers. Discord is the only thing that grants them.
 */

declare(strict_types=1);

if (PHP_VERSION_ID < 70400) {
    http_response_code(500);
    exit('PHP 7.4+ required.');
}

// ---------------------------------------------------------------- config ----

function rr_data_dir(): string
{
    $env = getenv('RAILROAD_DATA_DIR');
    if (is_string($env) && $env !== '') return rtrim($env, '/');
    return '/volume1/docker/railroad-union/data';
}

function rr_config(): array
{
    static $cfg = null;
    if ($cfg !== null) return $cfg;

    $path = rr_data_dir() . '/config.php';
    if (!is_file($path)) {
        rr_fail('Configuration file is missing. The site has not been set up yet.', 500);
    }
    $loaded = require $path;
    if (!is_array($loaded)) {
        rr_fail('Configuration file is malformed.', 500);
    }
    $cfg = $loaded + [
        'site_name'      => 'Deliverance Railroad Union',
        'short_name'     => 'DRU',
        'public_url'     => '',
        'guild_id'       => '',
        'client_id'      => '',
        'client_secret'  => '',
        'role_union'     => '',
        'role_operations'=> '',
        'role_executives'=> '',
        'timezone'       => 'America/Los_Angeles',
        'db_path'        => rr_data_dir() . '/railroad.sqlite3',
        'session_days'   => 30,
    ];
    return $cfg;
}

function rr_cfg(string $key, $default = null)
{
    $c = rr_config();
    return array_key_exists($key, $c) ? $c[$key] : $default;
}

// ------------------------------------------------------------- responses ----

function rr_json($payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function rr_fail(string $message, int $status = 400): void
{
    rr_json(['ok' => false, 'error' => $message], $status);
}

function rr_now(): string
{
    return gmdate('c');
}

// -------------------------------------------------------------- database ----

function rr_db(): PDO
{
    static $db = null;
    if ($db instanceof PDO) return $db;

    $path = (string)rr_cfg('db_path');
    $dir  = dirname($path);
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    if (!is_dir($dir) || !is_writable($dir)) {
        rr_fail('Data directory is not writable: ' . $dir, 500);
    }

    $db = new PDO('sqlite:' . $path, null, null, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_TIMEOUT            => 10,
    ]);
    $db->exec('PRAGMA journal_mode = WAL');
    $db->exec('PRAGMA foreign_keys = ON');
    $db->exec('PRAGMA busy_timeout = 10000');
    rr_migrate($db);
    return $db;
}

function rr_migrate(PDO $db): void
{
    $db->exec("
        CREATE TABLE IF NOT EXISTS members (
            id               TEXT PRIMARY KEY,
            first_name       TEXT NOT NULL DEFAULT '',
            last_name        TEXT NOT NULL DEFAULT '',
            grade            INTEGER NOT NULL DEFAULT 0,
            status           TEXT NOT NULL DEFAULT 'Probation',
            office           TEXT NOT NULL DEFAULT '',
            agency           TEXT NOT NULL DEFAULT '',
            po               TEXT NOT NULL DEFAULT '',
            trainee          TEXT NOT NULL DEFAULT '',
            probation_date   TEXT NOT NULL DEFAULT '',
            can_train_after  TEXT NOT NULL DEFAULT '',
            loa_start        TEXT NOT NULL DEFAULT '',
            note             TEXT NOT NULL DEFAULT '',
            discord_id       TEXT NOT NULL DEFAULT '',
            discord_name     TEXT NOT NULL DEFAULT '',
            last_roles       TEXT NOT NULL DEFAULT '',
            roles_checked_at TEXT NOT NULL DEFAULT '',
            created_at       TEXT NOT NULL DEFAULT '',
            updated_at       TEXT NOT NULL DEFAULT ''
        )
    ");
    $db->exec("CREATE UNIQUE INDEX IF NOT EXISTS members_discord
               ON members(discord_id) WHERE discord_id <> ''");
    // Added after the table shipped; ALTER is the only way onto a live row set.
    $cols = [];
    foreach ($db->query('PRAGMA table_info(members)') as $c) $cols[] = $c['name'];
    if (!in_array('loa_start', $cols, true)) {
        $db->exec("ALTER TABLE members ADD COLUMN loa_start TEXT NOT NULL DEFAULT ''");
    }

    $db->exec("
        CREATE TABLE IF NOT EXISTS trains (
            id             TEXT PRIMARY KEY,
            name           TEXT NOT NULL,
            owner_id       TEXT NOT NULL DEFAULT '',
            status         TEXT NOT NULL DEFAULT 'active',
            note           TEXT NOT NULL DEFAULT '',
            registered_at  TEXT NOT NULL DEFAULT '',
            registered_by  TEXT NOT NULL DEFAULT '',
            sold_at        TEXT NOT NULL DEFAULT '',
            sold_price     TEXT NOT NULL DEFAULT '',
            sold_by        TEXT NOT NULL DEFAULT '',
            removed_at     TEXT NOT NULL DEFAULT '',
            removed_by     TEXT NOT NULL DEFAULT ''
        )
    ");
    $db->exec("CREATE INDEX IF NOT EXISTS trains_owner ON trains(owner_id)");
    // One ACTIVE registration per train name. Sold or removed names free up.
    $db->exec("CREATE UNIQUE INDEX IF NOT EXISTS trains_active_name
               ON trains(name COLLATE NOCASE) WHERE status = 'active'");

    $db->exec("
        CREATE TABLE IF NOT EXISTS claims (
            discord_id    TEXT PRIMARY KEY,
            discord_name  TEXT NOT NULL DEFAULT '',
            member_id     TEXT NOT NULL DEFAULT '',
            status        TEXT NOT NULL DEFAULT 'pending',
            requested_at  TEXT NOT NULL DEFAULT '',
            decided_at    TEXT NOT NULL DEFAULT '',
            decided_by    TEXT NOT NULL DEFAULT ''
        )
    ");

    $db->exec("
        CREATE TABLE IF NOT EXISTS events (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            at          TEXT NOT NULL,
            actor_id    TEXT NOT NULL DEFAULT '',
            actor_name  TEXT NOT NULL DEFAULT '',
            action      TEXT NOT NULL,
            target      TEXT NOT NULL DEFAULT '',
            detail      TEXT NOT NULL DEFAULT ''
        )
    ");
    $db->exec("CREATE INDEX IF NOT EXISTS events_at ON events(at DESC)");

    // On-duty shifts, one row per in/out pair. Loaded from the Discord duty
    // channel (2026-10-08); the post's message id is kept in source_id so a
    // re-import tops up without duplicating. minutes is NULL when the post has
    // no usable time out. Office-only, like the roster note.
    $db->exec("
        CREATE TABLE IF NOT EXISTS shifts (
            id            TEXT PRIMARY KEY,
            member_id     TEXT NOT NULL,
            source        TEXT NOT NULL DEFAULT 'discord',
            source_id     TEXT NOT NULL DEFAULT '',
            posted_at     TEXT NOT NULL DEFAULT '',
            shift_date    TEXT NOT NULL DEFAULT '',
            time_in       TEXT NOT NULL DEFAULT '',
            time_out      TEXT NOT NULL DEFAULT '',
            tz            TEXT NOT NULL DEFAULT '',
            minutes       INTEGER,
            note          TEXT NOT NULL DEFAULT '',
            raw           TEXT NOT NULL DEFAULT '',
            discord_name  TEXT NOT NULL DEFAULT '',
            imported_at   TEXT NOT NULL DEFAULT ''
        )
    ");
    $db->exec("CREATE INDEX IF NOT EXISTS shifts_member ON shifts(member_id, shift_date DESC)");
}

/** Nothing is ever hard-deleted without a trace; every write lands here. */
function rr_log_event(string $action, string $target = '', $detail = ''): void
{
    try {
        $me = rr_viewer();
        $st = rr_db()->prepare(
            'INSERT INTO events (at, actor_id, actor_name, action, target, detail)
             VALUES (?, ?, ?, ?, ?, ?)'
        );
        $st->execute([
            rr_now(),
            (string)($me['discordId'] ?? ''),
            (string)($me['name'] ?? ''),
            $action,
            $target,
            is_string($detail) ? $detail : json_encode($detail, JSON_UNESCAPED_SLASHES),
        ]);
    } catch (Throwable $e) {
        // Logging must never take down a write that already succeeded.
    }
}

// ---------------------------------------------------------------- people ----

function rr_slug(string $s): string
{
    $s = strtolower(trim($s));
    $s = preg_replace('/[^a-z0-9]+/', '-', $s) ?? '';
    return trim($s, '-');
}

function rr_member_slug(string $first, string $last): string
{
    $slug = rr_slug($first . ' ' . $last);
    return $slug !== '' ? $slug : 'member-' . substr(bin2hex(random_bytes(4)), 0, 8);
}

const RR_GRADES = [
    0 => 'Probation',
    1 => 'Conductor / Engineer',
    2 => 'Chief Engineer / Operations Supervisor',
    3 => 'Railroad Superintendent',
    4 => 'Railroad Union President',
    5 => 'Founder',
];

const RR_STATUSES = [
    'Probation', 'Hired', 'Government', 'LOA',
    'Quit', 'Fired', 'Terminated', 'Banned', 'Released',
];

/**
 * Departures nobody outside the executive needs to see on the roster. Mac,
 * 2026-09-23: "Anyone with Quit, Terminated, Fired, or Banned will not show in
 * the roster list - UNLESS you are Executive." Filtered in the QUERY, so a
 * non-executive is never sent the row at all. LOA and Released are not here:
 * LOA is a temporary absence and Released predates this list.
 */
const RR_PRIVATE_STATUSES = ['Quit', 'Fired', 'Terminated', 'Banned'];

/** Disciplinary endings are an executive act, like deleting. */
const RR_DISCIPLINARY_STATUSES = ['Fired', 'Terminated', 'Banned'];

/**
 * What becomes of a registration. Mac, 2026-09-23: "Trains can be Sold, or
 * repossessed from the owner or taken when they quit."
 *   active       on the register, in service
 *   sold         the owner sold it back to the government
 *   repossessed  taken off the owner by the union
 *   forfeited    given up when they left of their own accord
 *   removed      struck from the register, an office correction
 * Trains are never merged - only members are.
 */
const RR_TRAIN_STATUSES = ['active', 'sold', 'repossessed', 'forfeited', 'removed'];

/**
 * A member leaving takes their engines with them, one way or the other: walk
 * out and you forfeit them, get thrown out and they are repossessed. Returns
 * null for a status that is not a departure.
 */
function rr_train_disposition(string $memberStatus): ?string
{
    if (in_array($memberStatus, RR_DISCIPLINARY_STATUSES, true)) return 'repossessed';
    if ($memberStatus === 'Quit' || $memberStatus === 'Released') return 'forfeited';
    return null;
}

function rr_grade_title(int $g): string
{
    return RR_GRADES[$g] ?? ('Grade ' . $g);
}

/** Probation runs seven days; the sheet's own dates all follow that rule. */
function rr_train_after(string $probationDate): string
{
    $probationDate = trim($probationDate);
    if ($probationDate === '') return '';
    try {
        $d = new DateTimeImmutable($probationDate);
        return $d->add(new DateInterval('P7D'))->format('Y-m-d');
    } catch (Throwable $e) {
        return '';
    }
}

// --------------------------------------------------------------- session ----

function rr_session_start(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) return;
    $days = (int)rr_cfg('session_days', 30);
    $life = $days * 86400;
    session_set_cookie_params([
        'lifetime' => $life,
        'path'     => '/',
        'httponly' => true,
        'samesite' => 'Lax',
        'secure'   => (($_SERVER['HTTPS'] ?? '') !== '' && ($_SERVER['HTTPS'] ?? '') !== 'off'),
    ]);
    session_name('RRUNION');
    session_start();
}

/**
 * The signed-in viewer, or null. Shape:
 *   discordId, name, avatar, roles{union,operations,executives}, memberId
 */
function rr_viewer(): ?array
{
    rr_session_start();
    $v = $_SESSION['viewer'] ?? null;
    if (!is_array($v) || empty($v['discordId'])) return null;
    return $v;
}

function rr_require_viewer(): array
{
    $v = rr_viewer();
    if ($v === null) {
        rr_fail('Not signed in.', 401);
    }
    if (empty($v['roles']['union'])) {
        rr_fail('You are not in the Railroad Union.', 403);
    }
    return $v;
}

/** The roster row linked to the viewer, or null if they have not claimed one. */
function rr_viewer_member(?array $viewer = null): ?array
{
    $viewer = $viewer ?? rr_viewer();
    if ($viewer === null) return null;
    $st = rr_db()->prepare('SELECT * FROM members WHERE discord_id = ? LIMIT 1');
    $st->execute([(string)$viewer['discordId']]);
    $row = $st->fetch();
    return $row ?: null;
}

/**
 * What this viewer may do. Discord roles are authoritative for permission;
 * the roster grade only raises the edit bar, never the delete bar.
 */
function rr_permissions(?array $viewer = null): array
{
    $viewer = $viewer ?? rr_viewer();
    if ($viewer === null) {
        return ['signedIn' => false, 'member' => false, 'staff' => false,
                'manager' => false, 'canEdit' => false, 'canHire' => false,
                'canPromote' => false, 'maxGrade' => 0, 'canDelete' => false,
                'canSeeNotes' => false, 'canYard' => false, 'canSeeHours' => false,
                'grade' => null, 'memberId' => null];
    }
    $roles   = $viewer['roles'] ?? [];
    $isUnion = !empty($roles['union']);
    $isStaff = !empty($roles['operations']);
    $isExec  = !empty($roles['executives']);

    $me    = rr_viewer_member($viewer);
    $grade = $me ? (int)$me['grade'] : null;

    // Railroad Operations is the staff tag: those people run the roster day to
    // day, so they hire, maintain records and promote. Rank 2 on the roster
    // does the same once their Discord is linked. Railway Executives is what
    // unlocks deleting, the office field, and minting another executive.
    $canRun = $isExec || $isStaff || ($grade !== null && $grade >= 2);

    return [
        'signedIn'   => true,
        'member'     => $isUnion,
        'staff'      => $isStaff,
        'manager'    => $isExec,
        'canEdit'    => $canRun,
        'canHire'    => $canRun,
        'canPromote' => $canRun,
        // How far up the ladder this viewer may move somebody.
        'maxGrade'   => $isExec ? 5 : 2,
        'canDelete'  => $isExec,
        // The roster note is office-only: Operations and Executives, by the
        // Discord role. A roster grade of 2 does not by itself open it.
        'canSeeNotes' => $isStaff || $isExec,
        // The Yard Office - the claim queue and the office log - is staff work.
        // Mac, 2026-09-23: "Yard Office should be for Operations and Executives
        // only - not general union members."
        'canYard'     => $isStaff || $isExec,
        // On-duty hours are office-only too (Mac, 2026-10-08). Withheld at the
        // API, the same way the note is.
        'canSeeHours' => $isStaff || $isExec,
        'grade'      => $grade,
        'memberId'   => $me['id'] ?? null,
    ];
}

function rr_require_manager(): array
{
    $v = rr_require_viewer();
    $p = rr_permissions($v);
    if (empty($p['manager'])) {
        rr_fail('Only Railway Executives can do that.', 403);
    }
    return $v;
}

/** Operations staff and Railway Executives. The Yard Office bar. */
function rr_require_staff(): array
{
    $v = rr_require_viewer();
    $p = rr_permissions($v);
    if (empty($p['canYard'])) {
        rr_fail('The Yard Office is for Railway Operations and Railway Executives.', 403);
    }
    return $v;
}

function rr_require_editor(): array
{
    $v = rr_require_viewer();
    $p = rr_permissions($v);
    if (empty($p['canEdit'])) {
        rr_fail('You do not have permission to change roster records.', 403);
    }
    return $v;
}

// ------------------------------------------------------------------ misc ----

function rr_input(): array
{
    $raw = file_get_contents('php://input');
    $in  = json_decode((string)$raw, true);
    if (!is_array($in)) $in = $_POST ?: [];
    return $in;
}

function rr_str($v, int $max = 500): string
{
    if (!is_scalar($v)) return '';
    $s = trim((string)$v);
    if (function_exists('mb_substr')) return mb_substr($s, 0, $max);
    return substr($s, 0, $max);
}

/** Normalises the sheet's bare "9/18" into a real date. */
function rr_date(string $v): string
{
    $v = trim($v);
    if ($v === '') return '';
    if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $v)) return $v;
    if (preg_match('#^(\d{1,2})/(\d{1,2})$#', $v, $m)) {
        $year = (int)gmdate('Y');
        return sprintf('%04d-%02d-%02d', $year, (int)$m[1], (int)$m[2]);
    }
    try {
        return (new DateTimeImmutable($v))->format('Y-m-d');
    } catch (Throwable $e) {
        return '';
    }
}

/** Today, in the same YYYY-MM-DD shape the roster's other dates use. */
function rr_now_date(): string
{
    return date('Y-m-d');
}

function rr_uuid(): string
{
    return bin2hex(random_bytes(16));
}

date_default_timezone_set((string)rr_cfg('timezone', 'America/Los_Angeles'));

// ------------------------------------------------------- output shaping ----

/**
 * Shape a members row for the browser. Raw Discord IDs are managers-only;
 * everything else on the roster is visible to any union member.
 */
function rr_member_public(array $r, ?array $perms = null): array
{
    $perms = $perms ?? rr_permissions();
    $isMgr = !empty($perms['manager']);
    $grade = (int)$r['grade'];

    $lastRoles = [];
    if (($r['last_roles'] ?? '') !== '') {
        $decoded = json_decode((string)$r['last_roles'], true);
        if (is_array($decoded)) $lastRoles = $decoded;
    }

    // An office outside the ladder (Governor, Founder) is what people should be
    // shown, not the ladder rank that happens to sit at that grade number.
    $title = ($r['office'] ?? '') !== '' ? (string)$r['office'] : rr_grade_title($grade);

    // The note is office-only. Mac, 2026-09-23: "the Notes on the roster
    // should ONLY be viewable by Operations and Executives." Withheld at the
    // API, not merely hidden in the page - a rank-1 member who opens the
    // network tab must not be able to read it either.
    $seesNotes = !empty($perms['canSeeNotes']);

    $out = [
        'id'             => $r['id'],
        'firstName'      => $r['first_name'],
        'lastName'       => $r['last_name'],
        'name'           => trim($r['first_name'] . ' ' . $r['last_name']),
        'grade'          => $grade,
        'gradeTitle'     => $title,
        'status'         => $r['status'],
        'office'         => $r['office'],
        'agency'         => $r['agency'],
        'po'             => $r['po'],
        'trainee'        => $r['trainee'],
        'probationDate'  => $r['probation_date'],
        'loaStart'       => $r['loa_start'] ?? '',
        'canTrainAfter'  => $r['can_train_after'],
        'note'           => $seesNotes ? $r['note'] : '',
        'notesVisible'   => $seesNotes,
        'discordName'    => $r['discord_name'],
        'linked'         => ($r['discord_id'] ?? '') !== '',
        'lastRoles'      => $lastRoles,
        'rolesCheckedAt' => $r['roles_checked_at'],
        'updatedAt'      => $r['updated_at'],
    ];
    if ($isMgr) {
        $out['discordId'] = $r['discord_id'];
    }
    return $out;
}

function rr_train_public(array $r): array
{
    return [
        'id'           => $r['id'],
        'name'         => $r['name'],
        'ownerId'      => $r['owner_id'],
        'status'       => $r['status'],
        'note'         => $r['note'],
        'registeredAt' => $r['registered_at'],
        'registeredBy' => $r['registered_by'],
        'soldAt'       => $r['sold_at'],
        'soldPrice'    => $r['sold_price'],
        'soldBy'       => $r['sold_by'],
        'removedAt'    => $r['removed_at'],
        'removedBy'    => $r['removed_by'],
    ];
}
