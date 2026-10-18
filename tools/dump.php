<?php
// Read-only snapshot for tools/ingest.py: roster names, remembered Discord
// names, and what is already loaded. Run as uid 33 inside the container.
declare(strict_types=1);
require '/var/www/html/api/bootstrap.php';
$db = rr_db();
echo json_encode([
    'members' => $db->query('SELECT id, first_name, last_name, status FROM members')->fetchAll(),
    'aliases' => $db->query('SELECT discord_name, member_id FROM aliases')->fetchAll(),
    'shifts'  => $db->query("SELECT discord_name, member_id FROM shifts GROUP BY discord_name, member_id")->fetchAll(),
    'through' => (string)$db->query('SELECT MAX(posted_at) FROM shifts')->fetchColumn(),
]);
