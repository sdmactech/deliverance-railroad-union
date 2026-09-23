<?php
/**
 * Sign in with Discord.
 *
 * ?action=start     -> bounce the visitor to Discord's consent screen
 * ?action=callback  -> Discord sends them back here with a code
 *
 * Scopes: identify + guilds.members.read. The second one is what lets this
 * site read the visitor's roles inside State of Deliverance WITHOUT a bot
 * being a member of that server. The access token is used for the two reads
 * below and then thrown away; nothing Discord-issued is persisted.
 */

declare(strict_types=1);
require __DIR__ . '/bootstrap.php';

const RR_DISCORD_API = 'https://discord.com/api/v10';

/**
 * The origin this request actually arrived on, but only if config recognises
 * it. That lets the same install answer on the LAN address and the public
 * hostname without the redirect_uri drifting out of step with Discord, and
 * stops a spoofed Host header from steering the OAuth round trip somewhere
 * we never approved.
 */
function rr_origin(): string
{
    $fallback = rtrim((string)rr_cfg('public_url'), '/');
    $host = (string)($_SERVER['HTTP_HOST'] ?? '');
    if ($host === '') return $fallback;

    $https  = (($_SERVER['HTTPS'] ?? '') !== '' && ($_SERVER['HTTPS'] ?? '') !== 'off');
    $origin = ($https ? 'https://' : 'http://') . $host;

    $allowed = (array)rr_cfg('allowed_origins', []);
    if ($fallback !== '') $allowed[] = $fallback;
    foreach ($allowed as $a) {
        if (strcasecmp(rtrim((string)$a, '/'), $origin) === 0) return $origin;
    }
    return $fallback;
}

function rr_redirect_uri(): string
{
    $base = rr_origin();
    if ($base === '') {
        rr_fail('public_url is not configured; Discord sign-in cannot work yet.', 500);
    }
    // No query string: Discord matches redirect URIs exactly, and a bare path is
    // one less thing to get out of step with what is registered in the portal.
    return $base . '/api/oauth.php';
}

function rr_bounce(string $page): void
{
    $base = rr_origin();
    header('Location: ' . ($base !== '' ? $base . '/' . $page : '../' . $page));
    exit;
}

function rr_http(string $method, string $url, array $opts = []): array
{
    $ch = curl_init($url);
    $headers = $opts['headers'] ?? [];
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_CUSTOMREQUEST  => $method,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_USERAGENT      => 'DeliveranceRailroadUnion/1.0',
    ]);
    if (isset($opts['form'])) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($opts['form']));
    }
    $body = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $err  = curl_error($ch);
    curl_close($ch);
    if ($body === false) {
        return ['status' => 0, 'json' => null, 'error' => $err];
    }
    return ['status' => $code, 'json' => json_decode((string)$body, true), 'error' => ''];
}

rr_session_start();

// One URL does both legs. Discord comes back carrying ?code= (or ?error=), which
// is what tells us this is the return trip rather than someone starting one.
$action = (isset($_GET['code']) || isset($_GET['error'])) ? 'callback' : (string)($_GET['action'] ?? 'start');

// ------------------------------------------------------------------ start ---
if ($action === 'start') {
    $clientId = (string)rr_cfg('client_id');
    if ($clientId === '') {
        rr_fail('Discord sign-in is not configured yet (missing client_id).', 500);
    }
    $state = bin2hex(random_bytes(16));
    $_SESSION['oauth_state'] = $state;
    $_SESSION['oauth_state_at'] = time();

    $url = RR_DISCORD_API . '/oauth2/authorize?' . http_build_query([
        'client_id'     => $clientId,
        'redirect_uri'  => rr_redirect_uri(),
        'response_type' => 'code',
        'scope'         => 'identify guilds.members.read',
        'state'         => $state,
        'prompt'        => 'none',
    ]);
    header('Location: ' . $url);
    exit;
}

// --------------------------------------------------------------- callback ---
if ($action === 'callback') {
    if (isset($_GET['error'])) {
        rr_bounce('login.html?denied=1');
    }
    $code  = (string)($_GET['code'] ?? '');
    $state = (string)($_GET['state'] ?? '');
    $want  = (string)($_SESSION['oauth_state'] ?? '');
    $at    = (int)($_SESSION['oauth_state_at'] ?? 0);
    unset($_SESSION['oauth_state'], $_SESSION['oauth_state_at']);

    if ($code === '' || $want === '' || !hash_equals($want, $state)) {
        rr_bounce('login.html?err=state');
    }
    if ($at > 0 && (time() - $at) > 900) {
        rr_bounce('login.html?err=expired');
    }

    $tok = rr_http('POST', RR_DISCORD_API . '/oauth2/token', [
        'headers' => ['Content-Type: application/x-www-form-urlencoded'],
        'form'    => [
            'client_id'     => (string)rr_cfg('client_id'),
            'client_secret' => (string)rr_cfg('client_secret'),
            'grant_type'    => 'authorization_code',
            'code'          => $code,
            'redirect_uri'  => rr_redirect_uri(),
        ],
    ]);
    $access = is_array($tok['json']) ? (string)($tok['json']['access_token'] ?? '') : '';
    if ($tok['status'] !== 200 || $access === '') {
        rr_bounce('login.html?err=token');
    }
    $auth = ['Authorization: Bearer ' . $access];

    $meRes = rr_http('GET', RR_DISCORD_API . '/users/@me', ['headers' => $auth]);
    if ($meRes['status'] !== 200 || !is_array($meRes['json'])) {
        rr_bounce('login.html?err=identity');
    }
    $me = $meRes['json'];

    $guildId = (string)rr_cfg('guild_id');
    $memRes  = rr_http('GET', RR_DISCORD_API . '/users/@me/guilds/' . rawurlencode($guildId) . '/member',
                       ['headers' => $auth]);
    if ($memRes['status'] === 404) {
        rr_bounce('login.html?err=notinserver');
    }
    if ($memRes['status'] !== 200 || !is_array($memRes['json'])) {
        rr_bounce('login.html?err=member');
    }
    $held = array_map('strval', (array)($memRes['json']['roles'] ?? []));

    $roles = [
        'union'      => in_array((string)rr_cfg('role_union'), $held, true),
        'operations' => in_array((string)rr_cfg('role_operations'), $held, true),
        'executives' => in_array((string)rr_cfg('role_executives'), $held, true),
    ];

    $display = (string)($memRes['json']['nick'] ?? '');
    if ($display === '') $display = (string)($me['global_name'] ?? '');
    if ($display === '') $display = (string)($me['username'] ?? 'Unknown');

    if (!$roles['union']) {
        $_SESSION['denied'] = ['name' => $display, 'at' => rr_now()];
        rr_bounce('login.html?err=nounion');
    }

    $_SESSION['viewer'] = [
        'discordId' => (string)($me['id'] ?? ''),
        'username'  => (string)($me['username'] ?? ''),
        'name'      => $display,
        'avatar'    => (string)($me['avatar'] ?? ''),
        'roles'     => $roles,
        'signedInAt'=> rr_now(),
    ];
    session_regenerate_id(true);

    // Keep the roster's copy of this person's roles current for display.
    try {
        $db = rr_db();
        $st = $db->prepare('UPDATE members
                            SET discord_name = ?, last_roles = ?, roles_checked_at = ?, updated_at = ?
                            WHERE discord_id = ?');
        $st->execute([
            $display,
            json_encode($roles),
            rr_now(),
            rr_now(),
            (string)($me['id'] ?? ''),
        ]);
    } catch (Throwable $e) {
        // A stale roles cache is not worth refusing a valid sign-in over.
    }

    rr_log_event('signin', (string)($me['id'] ?? ''), $roles);
    rr_bounce('index.html');
}

rr_fail('Unknown action.', 400);
