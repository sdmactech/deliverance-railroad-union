/* Deliverance Railroad Union — shared front-end plumbing.
   Every page calls RR.boot() first; it resolves once the viewer is known. */

(function () {
  'use strict';

  const RR = {
    me: null,          // { signedIn, viewer, permissions, member, claim }
    _bootPromise: null
  };

  // ------------------------------------------------------------ fetching ---

  async function api(path, opts) {
    const res = await fetch(path, Object.assign({
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    }, opts || {}));

    let body = null;
    try { body = await res.json(); } catch (e) { /* non-JSON error page */ }

    if (!res.ok || (body && body.ok === false)) {
      const msg = (body && body.error) || ('Request failed (' + res.status + ')');
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return body;
  }

  function post(path, payload) {
    return api(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  // -------------------------------------------------------------- output ---

  function esc(v) {
    if (v === null || v === undefined) return '';
    return String(v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function toast(message, bad) {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.className = bad ? 'show bad' : 'show';
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.className = ''; }, bad ? 5200 : 2800);
  }

  /** "2026-09-22T18:04:00+00:00" -> "Sep 22, 2026" in ranch-local time. */
  function fmtDate(iso) {
    if (!iso) return '';
    // A bare YYYY-MM-DD parses as UTC midnight, which renders as the PREVIOUS
    // day anywhere west of Greenwich - an LOA starting 2026-09-14 showed as
    // Sep 13. Pin it to local midnight instead. Full timestamps are untouched.
    const s = String(iso);
    const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T00:00:00') : new Date(s);
    if (isNaN(d)) return s;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function fmtDateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return String(iso);
    return d.toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit'
    });
  }

  function statusBadge(status) {
    const cls = String(status || '').toLowerCase();
    return '<span class="badge ' + esc(cls) + '">' + esc(status) + '</span>';
  }

  function gradeBadge(grade, title) {
    return '<span class="badge grade g' + Number(grade) + '" title="' + esc(title) + '">'
         + Number(grade) + ' &middot; ' + esc(title) + '</span>';
  }

  // ------------------------------------------------------------- chrome ---

  const LOCO = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">'
    + '<path d="M3 16h15a2 2 0 0 0 2-2v-1.5a3.5 3.5 0 0 0-3.5-3.5H13V6.5A1.5 1.5 0 0 0 11.5 5H6a1 1 0 0 0-1 1v10z" '
    + 'stroke="#d9a441" stroke-width="1.5" stroke-linejoin="round"/>'
    + '<path d="M7 5V3M7 3h3" stroke="#d9a441" stroke-width="1.5" stroke-linecap="round"/>'
    + '<circle cx="8" cy="18.5" r="2" stroke="#d9a441" stroke-width="1.5"/>'
    + '<circle cx="16" cy="18.5" r="2" stroke="#d9a441" stroke-width="1.5"/>'
    + '<path d="M2 20h20" stroke="#8a6a2c" stroke-width="1.5" stroke-linecap="round"/></svg>';

  function avatarUrl(viewer) {
    if (viewer && viewer.avatar && viewer.discordId) {
      return 'https://cdn.discordapp.com/avatars/' + viewer.discordId + '/' + viewer.avatar + '.png?size=64';
    }
    return 'https://cdn.discordapp.com/embed/avatars/0.png';
  }

  function renderChrome(current) {
    const host = document.getElementById('railTop');
    if (!host) return;
    const p = RR.me.permissions || {};
    const v = RR.me.viewer || {};

    const links = [
      { href: 'index.html',  label: 'Roster',  key: 'roster' },
      { href: 'trains.html', label: 'Train Registration', key: 'trains' }
    ];
    if (p.manager) {
      links.push({
        href: 'yard.html', label: 'Yard Office', key: 'yard',
        badge: Number(RR.me.pendingClaims || 0)
      });
    }

    const chips = [];
    if (v.roles && v.roles.executives) chips.push('<span class="badge grade">Railway Executive</span>');
    else if (v.roles && v.roles.operations) chips.push('<span class="badge office">Operations</span>');
    if (p.grade !== null && p.grade !== undefined) {
      chips.push('<span class="badge ghost">Grade ' + Number(p.grade) + '</span>');
    }

    host.innerHTML =
      '<div class="rail-top-inner">'
      + '<a class="brand" href="index.html">'
      +   '<span class="brand-mark emblem"><img src="assets/emblem-64.png" alt="" /></span>'
      +   '<span class="brand-text"><strong>Deliverance Railroad</strong><span>Union Office</span></span>'
      + '</a>'
      + '<nav class="rail-nav">' + links.map(function (l) {
          const cls = [l.key === current ? 'current' : '', l.badge ? 'flagged' : ''].filter(Boolean);
          return '<a href="' + l.href + '"' + (cls.length ? ' class="' + cls.join(' ') + '"' : '') + '>'
               + esc(l.label)
               + (l.badge
                   ? '<span class="nav-badge" title="' + l.badge + ' claim'
                     + (l.badge === 1 ? '' : 's') + ' waiting on a manager">' + l.badge + '</span>'
                   : '')
               + '</a>';
        }).join('') + '</nav>'
      + '<div class="who">'
      +   '<img class="who-avatar" src="' + esc(avatarUrl(v)) + '" alt="" />'
      +   '<div><div class="who-name">' + esc(v.name || '') + '</div>'
      +   '<div class="who-sub role-chips">' + chips.join(' ') + '</div></div>'
      +   '<button class="btn small" id="signOutBtn" type="button">Sign out</button>'
      + '</div></div>';

    const out = document.getElementById('signOutBtn');
    if (out) out.addEventListener('click', async function () {
      try { await post('api/me.php', { action: 'logout' }); } catch (e) {}
      window.location.replace('login.html');
    });
  }

  /** Shown until a member links their Discord account to a roster name. */
  function renderClaimBanner() {
    const host = document.getElementById('claimBanner');
    if (!host) return;
    const me = RR.me;
    if (me.member) { host.innerHTML = ''; return; }

    if (me.claim && me.claim.status === 'pending') {
      host.innerHTML = '<div class="notice warn"><strong>Your roster claim is waiting on a Railway Executive.</strong> '
        + 'Once it is approved you can register trains under your name.</div>';
      return;
    }
    host.innerHTML = '<div class="notice warn">'
      + '<strong>Your Discord account is not linked to a roster name yet.</strong> '
      + 'Claim your record so the office knows who you are and you can register trains.'
      + '<div><button class="btn primary" id="claimBtn" type="button">Claim my record</button></div></div>';

    document.getElementById('claimBtn').addEventListener('click', openClaimDialog);
  }

  async function openClaimDialog() {
    let list;
    try {
      list = await api('api/roster.php?action=unclaimed');
    } catch (e) { return toast(e.message, true); }

    const opts = list.members.map(function (m) {
      return '<option value="' + esc(m.id) + '">' + esc(m.name) + ' — ' + esc(m.gradeTitle) + '</option>';
    }).join('');

    const html =
      '<div class="modal-head"><h2>Claim your roster record</h2>'
      + '<p class="sub">Pick the name you go by in county. A Railway Executive approves the link.</p></div>'
      + '<div class="modal-body">'
      + '<label class="field"><span>Your name on the roster</span>'
      + '<select id="claimPick">' + (opts || '<option value="">No unclaimed names left</option>') + '</select></label>'
      + '<p class="muted" style="font-size:.84rem">Not listed? A Railway Executive has to add you to the roster first.</p>'
      + '</div>'
      + '<div class="modal-foot"><span class="spacer"></span>'
      + '<button class="btn" data-close>Cancel</button>'
      + '<button class="btn primary" id="claimSend">Send claim</button></div>';

    const dlg = modal(html);
    dlg.querySelector('#claimSend').addEventListener('click', async function () {
      const id = dlg.querySelector('#claimPick').value;
      if (!id) return toast('Nothing to claim.', true);
      try {
        await post('api/roster.php', { action: 'claim', memberId: id });
        dlg.close();
        toast('Claim sent. A Railway Executive will confirm it.');
        await RR.refresh();
        renderClaimBanner();
      } catch (e) { toast(e.message, true); }
    });
  }

  // -------------------------------------------------------------- modal ---

  function modal(innerHtml) {
    const dlg = document.createElement('dialog');
    dlg.className = 'rr-modal';
    dlg.innerHTML = innerHtml;
    document.body.appendChild(dlg);
    dlg.addEventListener('close', function () { dlg.remove(); });
    dlg.addEventListener('click', function (ev) {
      if (ev.target.hasAttribute && ev.target.hasAttribute('data-close')) dlg.close();
    });
    dlg.showModal();
    return dlg;
  }

  function confirmDanger(title, body, confirmLabel) {
    return new Promise(function (resolve) {
      const dlg = modal(
        '<div class="modal-head"><h2>' + esc(title) + '</h2></div>'
        + '<div class="modal-body">' + body + '</div>'
        + '<div class="modal-foot"><span class="spacer"></span>'
        + '<button class="btn" data-close>Cancel</button>'
        + '<button class="btn danger" id="yesBtn">' + esc(confirmLabel || 'Delete') + '</button></div>'
      );
      let done = false;
      dlg.querySelector('#yesBtn').addEventListener('click', function () {
        done = true; dlg.close(); resolve(true);
      });
      dlg.addEventListener('close', function () { if (!done) resolve(false); });
    });
  }

  // --------------------------------------------------------------- boot ---

  async function refresh() {
    RR.me = await api('api/me.php');
    return RR.me;
  }

  /** Resolves only when a signed-in union member is confirmed. */
  function boot(currentPage) {
    if (RR._bootPromise) return RR._bootPromise;
    RR._bootPromise = (async function () {
      let me;
      try {
        me = await refresh();
      } catch (e) {
        window.location.replace('login.html?err=offline');
        return new Promise(function () {});
      }
      if (!me.signedIn) {
        window.location.replace('login.html');
        return new Promise(function () {});
      }
      renderChrome(currentPage);
      renderClaimBanner();
      return me;
    })();
    return RR._bootPromise;
  }

  Object.assign(RR, {
    api: api, post: post, esc: esc, toast: toast,
    fmtDate: fmtDate, fmtDateTime: fmtDateTime,
    statusBadge: statusBadge, gradeBadge: gradeBadge,
    modal: modal, confirmDanger: confirmDanger,
    boot: boot, refresh: refresh, renderClaimBanner: renderClaimBanner
  });

  window.RR = RR;
})();
