#!/bin/zsh
# Prints the ISO time the nightly scrape should read back to: 36 hours before
# the newest post already loaded, so edits made after a post was loaded are
# picked up too.
through=$(ssh -o BatchMode=yes mfv 'sudo /usr/local/bin/docker exec -u 33 railroad-union php -r "echo (new PDO(\"sqlite:/data/railroad.sqlite3\"))->query(\"SELECT MAX(posted_at) FROM shifts\")->fetchColumn();"' 2>/dev/null)
python3 -c "
from datetime import datetime, timedelta
t = datetime.fromisoformat('$through'.replace('Z','+00:00')) - timedelta(hours=36)
print(t.strftime('%Y-%m-%dT%H:%M:%S.000Z'))"
