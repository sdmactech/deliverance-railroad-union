<?php
/**
 * Deliverance Railroad Union — configuration.
 *
 * THIS IS THE EXAMPLE COPY, with the one secret removed. The real file lives
 * at /volume1/docker/railroad-union/data/config.php — OUTSIDE the web root, so
 * the web server can never serve it — mode 0640, owned by the web user.
 *
 * The Discord IDs below are the real ones and are deliberately left in: they
 * are all public identifiers (the client_id appears in every OAuth URL, and
 * the guild and role IDs are visible to any member of the server), and leaving
 * them in lets you verify for yourself that this app only ever looks at YOUR
 * guild and YOUR three roles. The client secret is the only value that is
 * actually secret, and it is not in this bundle.
 */
return [
    'site_name'   => 'Deliverance Railroad Union',
    'short_name'  => 'DRU',
    'public_url'  => 'http://sodrailway.mytunnel.org:19188',

    // --- Discord application (OAuth2 only — there is NO BOT) ---
    'client_id'     => '1552059873011834920',
    'client_secret' => 'REDACTED-SET-ON-THE-SERVER-ONLY',   // <-- the only secret

    // The one guild this app will look at. A member of any other server is
    // refused, because the membership lookup is scoped to this ID.
    'guild_id' => '1435866159374274715',

    // The three roles the app understands. Nothing else about a member's
    // roles is stored or acted on.
    'role_union'      => '1436963147750703245', // "Railroad Union"  - the door
    'role_operations' => '1538626722004602960', // "Railway Operations" - staff
    'role_executives' => '1437964081452810260', // "Railway Executives" - manager

    // Sessions last a day, on purpose: roles are only read at sign-in, so a
    // short session means a role you remove in Discord stops mattering fast.
    'session_days' => 1,

    'timezone' => 'America/Los_Angeles',
    'db_path'  => '/data/railroad.sqlite3',

    // Origins the OAuth redirect is allowed to come back to.
    'allowed_origins' => [
        'http://sodrailway.mytunnel.org:19188',
        'http://MFV.local:8086',
    ],
];
