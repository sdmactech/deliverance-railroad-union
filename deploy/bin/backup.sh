#!/bin/bash
# Deliverance Railroad Union — nightly backup.
#
# Runs inside a sidecar container on the NAS rather than from the Mac: the
# existing ranch job skips whenever /Volumes/docker is not mounted, which is
# any time the Mac is asleep, and this database has other people writing to it.
#
# VACUUM INTO is the safe way to copy a live SQLite file. It takes a read lock,
# writes a defragmented single-file copy, and works correctly in WAL mode -
# unlike cp, which can catch the database mid-write and silently lose the WAL.
set -u
DB=/data/railroad.sqlite3
OUT=/backups
KEEP_DAYS=30
DAY=$(date +%F)
DEST="$OUT/$DAY"
LOG="$OUT/backup.log"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" | tee -a "$LOG"; }

mkdir -p "$DEST"
FILE="$DEST/railroad-$DAY.sqlite3"

php -r '
$src = $argv[1]; $dst = $argv[2];
if (file_exists($dst)) unlink($dst);
$db = new PDO("sqlite:$src", null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$db->exec("VACUUM INTO " . $db->quote($dst));
$chk = $db->query("PRAGMA integrity_check")->fetchColumn();
if ($chk !== "ok") { fwrite(STDERR, "source integrity: $chk\n"); exit(1); }
' "$DB" "$FILE" || { log "FAIL: could not write $FILE"; exit 1; }

# Verify the COPY, not the original - a backup you have not read back is a guess.
COUNTS=$(php -r '
$db = new PDO("sqlite:" . $argv[1], null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
if ($db->query("PRAGMA integrity_check")->fetchColumn() !== "ok") { fwrite(STDERR, "bad copy\n"); exit(1); }
$n = function ($t) use ($db) { return (int)$db->query("SELECT COUNT(*) FROM $t")->fetchColumn(); };
printf("members=%d trains=%d claims=%d events=%d", $n("members"), $n("trains"), $n("claims"), $n("events"));
' "$FILE") || { log "FAIL: copy failed integrity check"; rm -f "$FILE"; exit 1; }

gzip -f "$FILE"
SIZE=$(du -h "$FILE.gz" | cut -f1)
printf 'verified %s integrity=ok %s\n' "$(date -u +%FT%TZ)" "$COUNTS" > "$DEST/.verified"
log "ok $DAY ($COUNTS, $SIZE)"

# Keep a month. Dated directories, so the Mac's Drive sync can pick them up
# with the same globbing it already uses for the ranch backups.
find "$OUT" -maxdepth 1 -type d -name '20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]' -mtime +$KEEP_DAYS \
  -exec rm -rf {} + 2>/dev/null
tail -n 400 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
