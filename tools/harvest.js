// Run in the #railroad-duty-channel tab (Discord web). Call __rrHarvest() after
// every scroll; it accumulates posts in window.__rr. __rrTSV(sinceIso) builds
// the TSV (id, ts, author, role, text) for posts at/after sinceIso and returns
// [rows, chars, hash]. Discord time codes get " PT" appended (they render in
// this Mac's zone). Quoted reply text and invisible characters are removed;
// posts with no digits are left out.
window.__rr = window.__rr || {};
window.__rrHarvest = function () {
  document.querySelectorAll('li[id^="chat-messages-"]').forEach(function (li) {
    const id = li.id.split('-').pop();
    const t = li.querySelector('h3 time, [class*="header"] time') || li.querySelector('time');
    const un = li.querySelector('[id^="message-username-"] [class*="username"]');
    const ri = li.querySelector('[class*="header"] [class*="roleIcon"]');
    const c = li.querySelector('[id^="message-content-"]:not([class*="repliedText"])');
    let text = null;
    if (c) {
      const k = c.cloneNode(true);
      // The "(edited)" marker is ALSO a "timestamp" span, and its hidden text
      // is the edit time ("Saturday, October 17, 2026 at 5:20 PM"). Read as
      // part of the post it becomes a fake time out. Remove it first.
      k.querySelectorAll('[class*="edited"]').forEach(function (e) {
        const wrap = e.closest('[class*="timestamp"]');
        (wrap && k.contains(wrap) ? wrap : e).remove();
      });
      k.querySelectorAll('time').forEach(function (s) { s.remove(); });
      // What is left in a "timestamp" span is a Discord time code, rendered
      // in this Mac's zone.
      k.querySelectorAll('[class*="timestamp"]').forEach(function (s) { s.textContent = s.textContent + ' PT'; });
      text = k.innerText.replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '')
        .replace(/\s*\(edited\)/g, '').replace(/\s*\n\s*/g, ' / ').replace(/[\t]/g, ' ').trim();
    }
    const p = window.__rr[id] || {};
    window.__rr[id] = {
      ts: t ? t.getAttribute('datetime') : p.ts,
      author: un ? un.textContent.replace(/, Server Tag.*$/, '') : p.author,
      role: ri ? (ri.getAttribute('aria-label') || ri.alt || '').replace('Role icon, ', '') : (p.role || ''),
      text: text !== null ? text : p.text
    };
  });
  const ts = Object.values(window.__rr).map(function (m) { return m.ts; }).filter(Boolean).sort();
  return [Object.keys(window.__rr).length, ts[0], ts[ts.length - 1]];
};
window.__rrTSV = function (sinceIso) {
  const ids = Object.keys(window.__rr).filter(function (i) { return i.length >= 17; })
    .sort(function (a, b) { return BigInt(a) < BigInt(b) ? -1 : 1; });
  let last = null, lastRole = '';
  const rows = [];
  ids.forEach(function (id) {
    const m = window.__rr[id];
    if (m.author) { last = m.author; lastRole = m.role || ''; }
    if (!m.ts || m.ts < sinceIso) return;
    // Only posts that could hold a time: announcements and chatter are not
    // shifts, and the importer would skip them anyway.
    if (!/\d/.test(m.text || '')) return;
    // Instructions that show the time-code format ("<t:1792283283:T>",
    // "paste code here") are not shifts.
    if (/<t:\d+|paste code/i.test(m.text || '')) return;
    rows.push([id, m.ts, m.author || last, m.role || lastRole, m.text || ''].join('\t'));
  });
  const s = rows.join('\n');
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  window.__rrS = s;
  return [rows.length, s.length, h];
};
