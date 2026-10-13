/* Yard Office — Railway Executive tools. */
(function () {
  'use strict';

  let EVENTS = [];
  const $ = function (id) { return document.getElementById(id); };

  // ------------------------------------------------------------- claims ---

  async function loadClaims() {
    let d;
    try { d = await RR.api('api/roster.php?action=claims'); }
    catch (e) { $('claims').innerHTML = '<p class="muted">' + RR.esc(e.message) + '</p>'; return; }

    if (!d.claims.length) {
      $('claims').innerHTML = '<p class="muted">No claims waiting.</p>';
      return;
    }
    $('claims').innerHTML = '<div class="stack">' + d.claims.map(function (c) {
      return '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;'
        + 'padding:11px 13px;border:1px solid var(--edge-soft);border-radius:9px;background:var(--panel-2)">'
        + '<div><strong>' + RR.esc(c.discordName) + '</strong>'
        + '<div class="muted" style="font-size:.82rem">says they are <strong>' + RR.esc(c.memberName) + '</strong>'
        + ' &middot; asked ' + RR.esc(RR.fmtDateTime(c.requestedAt)) + '</div></div>'
        + '<span style="margin-left:auto"></span>'
        + '<button class="btn small danger" data-deny="' + RR.esc(c.discordId) + '">Deny</button>'
        + '<button class="btn small primary" data-ok="' + RR.esc(c.discordId) + '">Approve</button>'
        + '</div>';
    }).join('') + '</div>';

    $('claims').querySelectorAll('[data-ok]').forEach(function (b) {
      b.addEventListener('click', function () { decide(b.getAttribute('data-ok'), 'approve'); });
    });
    $('claims').querySelectorAll('[data-deny]').forEach(function (b) {
      b.addEventListener('click', function () { decide(b.getAttribute('data-deny'), 'deny'); });
    });
  }

  async function decide(discordId, decision) {
    try {
      await RR.post('api/roster.php', { action: 'claim_decide', discordId: discordId, decision: decision });
      RR.toast(decision === 'approve' ? 'Linked.' : 'Denied.');
      await Promise.all([loadClaims(), loadLog()]);
    } catch (e) { RR.toast(e.message, true); }
  }

  // ---------------------------------------------------------------- log ---

  async function loadLog() {
    let d;
    try { d = await RR.api('api/roster.php?action=events&limit=300'); }
    catch (e) {
      $('logBody').innerHTML = '<tr><td colspan="4" class="empty">' + RR.esc(e.message) + '</td></tr>';
      return;
    }
    EVENTS = d.events;
    renderLog();
  }

  const LABELS = {
    'signin': 'signed in', 'signout': 'signed out',
    'member.create': 'added to the roster', 'member.update': 'changed a roster record',
    'member.delete': 'deleted from the roster', 'member.unlink': 'unlinked a Discord account',
    'claim.request': 'claimed a roster record', 'claim.approve': 'approved a claim',
    'claim.deny': 'denied a claim',
    'train.register': 'registered a train', 'train.sell': 'sold a train back',
    'train.remove': 'struck a train', 'train.reinstate': 'reinstated a train',
    'train.update': 'edited a train',
    // Added with the merge, departure and export work - without these the log
    // showed the bare action name, which looked broken.
    'member.merge': 'merged two roster records',
    'train.repossess': 'repossessed a train',
    'train.repossessed': 'repossessed engines on a departure',
    'train.forfeited': 'took engines forfeited on a departure',
    'export': 'downloaded a data export',
    'hours.import': 'loaded on-duty hours from Discord'
  };

  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : (many || one + 's'));
  }

  function summarise(ev) {
    let detail = ev.detail;
    try { detail = JSON.parse(ev.detail); } catch (e) { return RR.esc(String(ev.detail || '')); }
    if (!detail || typeof detail !== 'object') return RR.esc(String(ev.detail || ''));

    if (ev.action === 'member.update') {
      return Object.keys(detail).map(function (k) {
        const pair = detail[k];
        return '<span class="muted">' + RR.esc(k) + ':</span> '
          + RR.esc(pair[0] || '—') + ' &rarr; <strong>' + RR.esc(pair[1] || '—') + '</strong>';
      }).join('<br>');
    }
    if (ev.action === 'hours.import') {
      return plural(detail.shifts || 0, 'new shift')
        + (detail.updated ? ', ' + plural(detail.updated, 'edited shift') + ' refreshed' : '')
        + ' for ' + plural(detail.members || 0, 'member')
        + (detail.through ? ', posts through ' + RR.esc(RR.fmtDate(detail.through)) : '');
    }
    if (ev.action === 'member.delete') {
      const r = detail.record || {};
      return 'removed <strong>' + RR.esc((r.first_name || '') + ' ' + (r.last_name || '')) + '</strong>'
        + (detail.trainsRemoved && detail.trainsRemoved.length
            ? ' and struck ' + plural(detail.trainsRemoved.length, 'train') : '');
    }
    if (ev.action === 'member.merge') {
      const a = detail.absorbed || {};
      return 'absorbed <strong>' + RR.esc((a.first_name || '') + ' ' + (a.last_name || '')) + '</strong>'
        + (detail.trainsMoved && detail.trainsMoved.length
            ? ', moving ' + plural(detail.trainsMoved.length, 'train') + ' across' : '')
        + (detail.fieldsTaken && detail.fieldsTaken.length
            ? ' <span class="muted">(took ' + RR.esc(detail.fieldsTaken.join(', ')) + ')</span>' : '');
    }
    if (ev.action === 'train.repossessed' || ev.action === 'train.forfeited') {
      return '<strong>' + RR.esc((detail.trains || []).join(', ')) + '</strong>'
        + (detail.because ? ' <span class="muted">— ' + RR.esc(detail.because) + '</span>' : '');
    }
    if (ev.action === 'train.repossess') {
      return '<strong>' + RR.esc(detail.name || '') + '</strong>'
        + (detail.reason ? ' <span class="muted">— ' + RR.esc(detail.reason) + '</span>' : '');
    }
    if (ev.action === 'export') {
      return '<span class="muted">' + RR.esc(ev.target || '')
        + (detail.rows !== undefined ? ' · ' + detail.rows + ' rows' : '') + '</span>';
    }
    if (ev.action === 'claim.approve' || ev.action === 'claim.deny') {
      return detail.discordName ? '<strong>' + RR.esc(detail.discordName) + '</strong>' : '';
    }
    if (ev.action === 'signin') {
      const held = Object.keys(detail).filter(function (k) { return detail[k]; });
      return held.length ? '<span class="muted">roles: ' + RR.esc(held.join(', ')) + '</span>' : '';
    }
    if (detail.name) {
      return '<strong>' + RR.esc(detail.name) + '</strong>'
        + (detail.price ? ' <span class="muted">for ' + RR.esc(detail.price) + '</span>' : '');
    }
    return '<span class="muted">' + RR.esc(JSON.stringify(detail)) + '</span>';
  }

  function renderLog() {
    const f = $('logFilter').value;
    const rows = EVENTS.filter(function (e) { return !f || e.action.indexOf(f) === 0; });
    if (!rows.length) {
      $('logBody').innerHTML = '<tr><td colspan="4" class="empty">Nothing logged yet.</td></tr>';
      return;
    }
    $('logBody').innerHTML = rows.map(function (e) {
      return '<tr>'
        + '<td class="muted mono" style="white-space:nowrap">' + RR.esc(RR.fmtDateTime(e.at)) + '</td>'
        + '<td>' + RR.esc(e.actor_name || '—') + '</td>'
        + '<td>' + RR.esc(LABELS[e.action] || e.action) + '</td>'
        + '<td style="font-size:.84rem">' + summarise(e) + '</td>'
        + '</tr>';
    }).join('');
  }

  // --------------------------------------------------------------- boot ---

  RR.boot('yard').then(function (me) {
    if (!me.permissions.canYard) {
      document.querySelector('main.page').innerHTML =
        '<div class="notice bad"><strong>The Yard Office is for Railway Operations '
        + 'and Railway Executives.</strong> Your Discord account holds neither role.</div>';
      return;
    }
    $('logFilter').addEventListener('change', renderLog);
    loadClaims(); loadLog();
  });
})();
