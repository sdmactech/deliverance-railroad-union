#!/usr/bin/env python3
"""Load #railroad-duty-channel posts into the union roster as on-duty shifts.

Input: a TSV of posts, one per line - message id, posted-at (ISO, UTC),
Discord display name, the poster's Discord role (the role icon shown on the
post, may be blank), and the post text with line breaks written as " / ".
Discord time codes are expected with " PT" appended, because they render in
the reading browser's zone (Pacific, on the office Mac).

    ingest.py posts.tsv [--dry-run]

Needs ~/.config/rr-hours.json with actor_member_id and actor_name (who the
office log credits). It reads the roster read-only from the NAS, matches each poster, parses the
time pairs, and pipes an import into the railroad-union container as the web
user (uid 33). Names are matched by:
  1. a remembered Discord name (the aliases table),
  2. the display name with tags stripped ("[Engineer] Augustus Kingsley",
     "(T.A.G.)Mercy Thorne", "Marshal Elias Vance", "A/B", "A | B"),
  3. otherwise, a Railroad Union / Operations / Executives role holder is added
     on Probation; anyone else is held and reported, never added.
A post that names another roster member in its first line ("On Duty (Elias
Vance)") is credited to that member. Real data never lives in this repo.
"""
import base64, json, re, subprocess, sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

HERE = Path(__file__).resolve().parent
SSH = ['ssh', '-o', 'BatchMode=yes', 'mfv']
import os
DOCKER = 'sudo /usr/local/bin/docker exec -i -u 33 {env} ' + os.environ.get('RR_CONTAINER', 'railroad-union') + ' php'
RR_ROLES = {'railroad union', 'railway operations', 'railway executives'}

TZMAP = {'EST': 'America/New_York', 'EDT': 'America/New_York', 'ET': 'America/New_York',
         'CST': 'America/Chicago', 'CDT': 'America/Chicago', 'CT': 'America/Chicago',
         'MST': 'America/Denver', 'MT': 'America/Denver',
         'PST': 'America/Los_Angeles', 'PDT': 'America/Los_Angeles', 'PT': 'America/Los_Angeles',
         'GMT': 'Europe/London', 'BST': 'Europe/London', 'CET': 'Europe/Paris', 'CEST': 'Europe/Paris',
         'EEST': 'Europe/Athens', 'AEST': 'Australia/Brisbane'}
TZ_RE = re.compile(r'\b(EEST|AEST|CEST|BST|GMT|CET|EST|EDT|CST|CDT|MST|PST|PDT|ET|CT|MT|PT)\b', re.I)
TOK = re.compile(r'(?<!\d)(?:(\d{1,2})\s*[:.;]\s*(\d{2})(?::\d{2})?|(\d{1,2})(\d{2})|(\d{1,2}) (\d{2})'
                 r'(?=\s*(?:am|pm|a\.m|p\.m|et|est|cst|pst)\b)|(\d{1,2}))(?!\d)\s*(a\.?m|p\.?m)?', re.I)
TITLES = re.compile(r'^(loa\s*-\s*|marshal|undersheriff|sheriff|deputy|dr\.?|chief|judge|captain)\s+', re.I)


def php(script, env=''):
    cmd = SSH + [DOCKER.format(env=env)]
    r = subprocess.run(cmd, input=script.encode(), capture_output=True)
    if r.returncode:
        raise SystemExit('NAS call failed: ' + r.stderr.decode()[-400:])
    return r.stdout.decode()


def norm(s):
    s = s.lower().replace('’', "'")
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


def candidates(display):
    """Plausible character names inside a Discord display name."""
    s = re.sub(r'[\[(][^\])]*[\])]', ' ', display)          # [Engineer] (R.U.S.I.)
    s = re.sub(r',?\s+(esq\.?|and others)$', '', s.strip(), flags=re.I)
    out = []
    for part in re.split(r'\s*[/|]\s*', s):
        part = TITLES.sub('', part.strip()).strip()
        if part:
            out.append(part)
    return out


def tokens(text):
    s = re.sub(r'\d{1,2}/\d{1,2}(/\d{2,4})?,?', ' ', text)
    s = re.sub(r'(?i)(\d)(am|pm)ct', r'\1\2 ct', s)
    out = []
    for m in TOK.finditer(s):
        if m.group(1): hs, mi, kind = m.group(1), m.group(2), 'colon'
        elif m.group(3): hs, mi, kind = m.group(3), m.group(4), 'four'
        elif m.group(5): hs, mi, kind = m.group(5), m.group(6), 'space'
        else: hs, mi, kind = m.group(7), '00', 'bare'
        ap = (m.group(8) or '').lower()
        if kind == 'bare' and not ap:
            continue
        h, mn = int(hs), int(mi)
        if mn > 59 or h > 24:
            continue
        if ap.startswith('p'): c = [(h % 12) + 12]
        elif ap.startswith('a'): c = [h % 12]
        elif h > 12 or (len(hs) == 2 and hs[0] == '0'): c = [h % 24]
        else: c = [h % 12, (h % 12) + 12]
        out.append((m.group(0).strip(), [x * 60 + mn for x in c]))
    return out


def shifts_in(text):
    t = tokens(text)
    res = []
    for k in range(0, len(t), 2):
        if k + 1 >= len(t):
            res.append((t[k][0], '', None, 'No time out posted yet'))
            break
        best = None
        for a in t[k][1]:
            for b in t[k + 1][1]:
                d = (b - a) % 1440
                if d > 0 and (best is None or d < best):
                    best = d
        if best is None:
            res.append((t[k][0], t[k + 1][0], None, 'Time out is the same as time in'))
        else:
            res.append((t[k][0], t[k + 1][0], best, 'Long shift as posted - check the post' if best > 360 else ''))
    return res


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    dry = '--dry-run' in sys.argv
    posts = []
    for line in Path(sys.argv[1]).read_text().splitlines():
        if line.strip():
            mid, ts, author, role, text = (line.split('\t') + [''] * 5)[:5]
            posts.append(dict(id=mid, ts=ts, author=author, role=role, text=text))

    snap = json.loads(php((HERE / 'dump.php').read_text()))
    members = {m['id']: m for m in snap['members']}
    by_name = {norm(m['first_name'] + ' ' + m['last_name']): m['id'] for m in snap['members']}
    alias = {a['discord_name']: a['member_id'] for a in snap['aliases']}
    # Names matched in earlier loads - but only where the display name could
    # be that member. A shift posted on someone else's behalf ("Posting for
    # Augustus Kingsley" by Mercy Thorne) must not teach "Mercy Thorne ->
    # Augustus Kingsley"; it did once (2026-10-19).
    seen = {}
    for s in snap['shifts']:
        seen.setdefault(s['discord_name'].lower(), set()).add(s['member_id'])
    for name, mids in seen.items():
        if name in alias or len(mids) != 1:
            continue
        mid = next(iter(mids))
        m = members.get(mid)
        if m and any(norm(m['last_name']) and norm(m['last_name']) in norm(c) for c in candidates(name)):
            alias[name] = mid

    new, new_alias, held, notes, out = {}, {}, [], [], []

    def match(author, role):
        key = author.lower()
        if norm(author) in by_name:                   # the poster's own roster name wins
            return by_name[norm(author)]
        if key in alias and alias[key] in members:
            return alias[key]
        for c in candidates(author):
            if norm(c) in by_name:
                new_alias[key] = by_name[norm(c)]
                return by_name[norm(c)]
        if role.lower() in RR_ROLES:
            c = candidates(author)
            name = c[-1] if c else author
            parts = name.split(' ', 1)
            first, last = (parts + [''])[:2]
            mid = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
            if mid not in members and mid not in new:
                new[mid] = dict(id=mid, first=first, last=last,
                                note=f'Added by the nightly duty-channel import on {datetime.now():%Y-%m-%d}. Discord name: {author}.')
            new_alias[key] = mid
            return mid
        return None

    for p in posts:
        found = shifts_in(p['text'])
        if not found:
            continue                                  # chatter, reminders, "On Duty" alone
        mid = match(p['author'], p['role'])
        first_line = p['text'].split(' / ')[0]
        for name_key, other in by_name.items():      # "On Duty (Elias Vance)"
            if (other != mid and len(name_key) > 5 and re.search(r'on ?duty', first_line, re.I)
                    and name_key in norm(first_line)):
                mid = other
                break
        if not mid:
            if p['author'] not in held:
                held.append(p['author'])
            continue
        tz = 'PT' if re.search(r'\d PT\b', p['text']) else ''
        m = TZ_RE.search(p['text'])
        tz = tz or (m.group(1).upper() if m else '')
        zone = ZoneInfo(TZMAP.get(tz, 'America/Los_Angeles'))
        day = datetime.fromisoformat(p['ts'].replace('Z', '+00:00')).astimezone(zone).date()
        for k, (tin, tout, mins, note) in enumerate(found):
            if not note and re.search(r'\best\b', p['text'], re.I) and re.search(r'\bcst\b', p['text'], re.I):
                note = 'Post mixes EST and CST'
            out.append(dict(id=f"{p['id']}-{k + 1}", member_id=mid, source_id=p['id'], posted_at=p['ts'],
                            shift_date=day.isoformat(), time_in=tin, time_out=tout, tz=tz, minutes=mins,
                            note=note, raw=p['text'], discord_name=p['author']))
            if note:
                notes.append(f"{day} {p['author']}: {note}")

    # An open shift (no time out) followed within four hours by another post
    # from the same driver was re-posted, not a second shift: one driver
    # re-posted with Discord time codes (seen 2026-10-17). Keep only the later one.
    def ts(x): return datetime.fromisoformat(x['posted_at'].replace('Z', '+00:00'))
    keep = []
    for s in out:
        if s['minutes'] is None and not s['time_out'] and any(
                o is not s and o['member_id'] == s['member_id'] and 0 < (ts(o) - ts(s)).total_seconds() <= 4 * 3600
                for o in out):
            notes.append(f"{s['shift_date']} {s['discord_name']}: open shift re-posted, kept the later post")
            continue
        keep.append(s)
    out = keep

    # Who the office log credits with the import. Private, per machine.
    cfg = json.loads((Path.home() / '.config' / 'rr-hours.json').read_text())
    payload = dict(actor_member_id=cfg['actor_member_id'], actor_name=cfg['actor_name'],
                   new=list(new.values()), aliases=new_alias, shifts=out, held=held, notes=notes,
                   posts=len(posts), through=max([p['ts'] for p in posts] + [snap['through']]))
    script = (HERE / 'import.tpl.php').read_text().replace(
        '__PAYLOAD__', base64.b64encode(json.dumps(payload).encode()).decode())
    result = json.loads(php(script, '-e DRY_RUN=1' if dry else '').strip().splitlines()[-1])
    report = dict(result=result, added=[n['first'] + ' ' + n['last'] for n in new.values()],
                  held=held, flagged=notes, posts=len(posts))
    print(json.dumps(report, indent=1))


if __name__ == '__main__':
    main()
