/* Rail Yard (v2). Operations + Executives.
   New engines on the register, trains somebody has to act on, and the
   weekly Top 10 drivers (Friday to Thursday, the same weeks as the posters). */
(function () {
  'use strict';
  const $ = function (id) { return document.getElementById(id); };
  const esc = RR.esc;
  let DATA = null;
  let weekIx = 0;

  const KIND = {
    reclaim:  { label: 'Take back in game', short: 'Reclaim' },
    departed: { label: 'Owner has left', short: 'Departed' },
    orphan:   { label: 'No owner on the roster', short: 'Orphan' },
    loa:      { label: 'Owner on leave', short: 'Idle' }
  };

  const ACT = { reclaim: 1, departed: 1, orphan: 1 };
  function urgentCount() { return DATA.attention.filter(function (a) { return ACT[a.kind]; }).length; }

  function fmtRange(from, to) {
    const f = new Date(from + 'T00:00:00'), t = new Date(to + 'T00:00:00');
    const m = function (d) { return d.toLocaleDateString('en-US', { month: 'long' }); };
    return m(f) === m(t)
      ? m(f) + ' ' + f.getDate() + ' – ' + t.getDate()
      : m(f) + ' ' + f.getDate() + ' – ' + m(t) + ' ' + t.getDate();
  }

  function tiles() {
    const f = DATA.fleet;
    const urgent = urgentCount();
    const t = [
      ['On the rails', f.active, f.owners + ' owner' + (f.owners === 1 ? '' : 's')],
      ['New, 30 days', DATA.arrivals.length, 'Engines registered by members'],
      ['To act on', urgent, urgent ? 'Take back, repossess or assign' : 'All clear'],
      ['Off the books', (f.sold || 0) + (f.repossessed || 0) + (f.forfeited || 0) + (f.removed || 0),
        (f.repossessed || 0) + ' repossessed · ' + (f.forfeited || 0) + ' forfeited']
    ];
    $('fleetTiles').innerHTML = t.map(function (x) {
      return '<div class="tile"><span class="tile-label">' + esc(x[0]) + '</span>'
        + '<span class="tile-main" data-count="' + Number(x[1]) + '">0</span>'
        + '<span class="tile-note">' + esc(x[2]) + '</span></div>';
    }).join('');
    const board = $('fleetTiles');
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(function (en) {
        if (en[0].isIntersecting) { io.disconnect(); countUp(board); }
      }, { threshold: 0.4 });
      io.observe(board);
    } else countUp(board);
  }

  /** Split-flap style count up, once, when the board scrolls in. */
  function countUp(root) {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    root.querySelectorAll('[data-count]').forEach(function (el) {
      const to = Number(el.dataset.count);
      if (reduce || !to) { el.textContent = String(to); return; }
      const t0 = performance.now(), dur = 900;
      (function step(now) {
        const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 4);
        el.textContent = String(Math.round(to * e));
        if (k < 1) requestAnimationFrame(step);
      })(t0);
    });
  }

  function attention() {
    const list = DATA.attention;
    const urgent = urgentCount();
    $('attnLine').textContent = urgent ? urgent + ' to act on' : 'All clear';
    const recent = (DATA.recent || []).map(function (a) {
      return '<li class="signal done" data-row="' + esc(a.id) + '">'
        + '<span class="lamp" aria-hidden="true"></span>'
        + '<div><div class="signal-name">' + esc(a.name) + '</div>'
        + '<div class="signal-meta">Taken back in game by ' + esc(a.takenBackBy) + ' · ' + esc(RR.fmtDateTime(a.takenBackAt)) + '</div></div>'
        + '<div class="signal-act">' + RR.statusBadge(a.status)
        + (DATA.canUndo ? '<button class="btn small" data-untaken="' + esc(a.id) + '" data-name="' + esc(a.name) + '">Undo</button>' : '')
        + '</div></li>';
    }).join('');
    const recentBlock = recent ? '<li class="signal-sub">Taken back in the last 14 days</li>' + recent : '';
    if (!list.length) {
      $('attention').innerHTML = '<li class="all-clear"><span class="lamp"></span>'
        + '<span>Every forfeited and repossessed engine has been taken back, and every train has an owner on the roster.</span></li>'
        + recentBlock;
      return;
    }
    $('attention').innerHTML = list.map(function (a) {
      const k = KIND[a.kind];
      let act = '';
      if (a.kind === 'reclaim') {
        act = '<button class="btn small primary" data-taken="' + esc(a.id) + '" data-name="' + esc(a.name) + '">Taken back in game</button>';
      } else if (a.kind === 'departed' && DATA.canRepossess) {
        act = '<button class="btn small danger" data-repo="' + esc(a.id) + '" data-name="' + esc(a.name) + '">Repossess</button>';
      }
      const since = a.since ? ' · since ' + RR.fmtDate(a.since) : '';
      return '<li class="signal ' + a.kind + '" data-row="' + esc(a.id) + '">'
        + '<span class="lamp" aria-hidden="true"></span>'
        + '<div><div class="signal-name">' + esc(a.name) + '</div>'
        + '<div class="signal-meta">' + esc(k.label) + (a.ownerName ? ' · ' + esc(a.ownerName) : '') + esc(since) + '</div>'
        + '<p class="signal-why">' + esc(a.why) + '</p></div>'
        + '<div class="signal-act">' + RR.statusBadge(a.status) + act + '</div>'
        + '</li>';
    }).join('') + recentBlock;
  }

  function leader() {
    const weeks = DATA.weeks || [];
    if (!weeks.length) { $('topCard').closest('div').classList.add('hide'); return; }
    const w = weeks[weekIx];
    $('weekLine').textContent = weekIx === 0 ? 'This week, so far' : 'Last week';
    $('weekTitle').textContent = fmtRange(w.from, w.to);
    $('weekTabs').innerHTML = weeks.map(function (x, i) {
      return '<button class="btn small' + (i === weekIx ? ' dr-view is-on' : ' dr-view') + '" data-week="' + i + '" aria-pressed="' + (i === weekIx) + '">'
        + (i === 0 ? 'This week' : 'Last week') + '</button>';
    }).join('');
    const max = w.top.length ? w.top[0].hours : 1;
    const ol = $('leader');
    ol.classList.remove('go');
    ol.innerHTML = w.top.length ? w.top.map(function (r, i) {
      return '<li><span class="pos">' + (i + 1) + '</span>'
        + '<span class="nm">' + esc(r.name) + ' <small>' + r.shifts + ' shift' + (r.shifts === 1 ? '' : 's') + '</small>'
        + '<span class="bar"><i style="--w:' + (r.hours / max * 100).toFixed(1) + '%;--i:' + i + '"></i></span></span>'
        + '<span class="hrs">' + r.hours.toFixed(1) + ' h</span></li>';
    }).join('') : '<li class="empty" style="display:block">No shifts on the books yet this week.</li>';
    $('weekFoot').textContent = w.hours.toFixed(1) + ' hours · ' + w.shifts + ' shifts · ' + w.drivers + ' drivers';
    requestAnimationFrame(function () { requestAnimationFrame(function () { ol.classList.add('go'); }); });
  }

  function arrivals() {
    const host = $('arrivals');
    if (!DATA.arrivals.length) {
      host.innerHTML = '<section class="card"><p class="empty">No new engines in the last 30 days.</p></section>';
      return;
    }
    host.innerHTML = DATA.arrivals.map(function (a, i) {
      const s = a.specs || {};
      const spec = function (label, v) { return '<div>' + label + '<b>' + esc(v || '—') + '</b></div>'; };
      return '<article class="ticket rv" style="--i:' + i + '">'
        + '<div class="ticket-art"><span class="new">New</span><img src="assets/3d/loco-side.png" alt="" loading="lazy" /></div>'
        + '<div class="ticket-body"><h3>' + esc(a.name) + '</h3>'
        + '<div class="who-line">' + esc(a.ownerName || a.registeredBy) + ' · ' + esc(RR.fmtDate(a.registeredAt)) + '</div>'
        + '<div class="spec-row">' + spec('Station', s.station) + spec('Top speed', s.speed) + spec('Passenger', s.passenger) + '</div>'
        + '</div></article>';
    }).join('');
    RR.reveal(host);
  }

  async function load() {
    DATA = await RR.api('api/railyard.php');
    tiles(); attention(); leader(); arrivals();
    // keep the Rail Yard tab's badge in step with what is on this page
    const urgent = urgentCount();
    const tab = document.querySelector('.rail-nav a[href="railyard.html"]');
    if (tab) {
      const b = tab.querySelector('.nav-badge');
      if (!urgent && b) { b.remove(); tab.classList.remove('flagged'); }
      else if (b) b.textContent = String(urgent);
      else if (urgent) {
        const nb = document.createElement('span');
        nb.className = 'nav-badge'; nb.textContent = String(urgent);
        tab.appendChild(nb); tab.classList.add('flagged');
      }
    }
  }

  document.addEventListener('click', async function (e) {
    const wk = e.target.closest('[data-week]');
    if (wk) { weekIx = Number(wk.dataset.week); leader(); return; }

    const tb = e.target.closest('[data-taken]');
    if (tb) {
      const ok = await RR.confirmDanger('Taken back in game?',
        '<p>Mark <strong>' + esc(tb.dataset.name) + '</strong> as taken back in game. Your name goes on it in the office log.</p>',
        'Yes, it is back');
      if (!ok) return;
      await act(tb, { action: 'taken', trainId: tb.dataset.taken }, 'api/railyard.php', tb.dataset.name + ' is back in the yard.');
      return;
    }

    const ub = e.target.closest('[data-untaken]');
    if (ub) {
      await act(ub, { action: 'untaken', trainId: ub.dataset.untaken }, 'api/railyard.php', ub.dataset.name + ' is back on the list.');
      return;
    }

    const rb = e.target.closest('[data-repo]');
    if (rb) {
      const ok = await RR.confirmDanger('Repossess ' + rb.dataset.name + '?',
        '<p>The owner has left the union. This takes the engine off the register as <strong>repossessed</strong>; it then waits here until somebody takes it back in game.</p>',
        'Repossess');
      if (!ok) return;
      await act(rb, { action: 'repossess', trainId: rb.dataset.repo, reason: 'Owner left the union (Rail Yard)' }, 'api/trains.php', rb.dataset.name + ' repossessed.');
    }
  });

  /** One request at a time per row; the row is busy while it runs, focus comes back to it. */
  async function act(btn, payload, url, done) {
    const li = btn.closest('.signal');
    const id = li && li.dataset.row;
    btn.disabled = true;
    if (li) li.setAttribute('aria-busy', 'true');
    try {
      await RR.post(url, payload);
      RR.toast(done);
      await load();
      const again = id && document.querySelector('.signal[data-row="' + CSS.escape(id) + '"]');
      const target = again ? (again.querySelector('button') || again) : $('attention');
      if (!target.hasAttribute('tabindex') && target.tagName !== 'BUTTON') target.setAttribute('tabindex', '-1');
      target.focus();
    } catch (err) {
      RR.toast(err.message, true);
      btn.disabled = false;
      if (li) li.removeAttribute('aria-busy');
    }
  }

  RR.boot('railyard').then(function (me) {
    if (!me.permissions || !me.permissions.canYard) {
      window.location.replace('index.html');
      return;
    }
    load().catch(function (e) {
      RR.toast(e.message, true);
      $('attention').innerHTML = '<li class="empty">Could not load the yard. <button class="btn small" id="retry">Try again</button></li>';
      $('retry').addEventListener('click', function () { load().catch(function (x) { RR.toast(x.message, true); }); });
    });
  });
})();
