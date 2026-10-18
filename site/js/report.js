/* Daily Report (2026-10-17): a calendar of on-duty hours, and for any day each
   driver's share of it and the shifts behind it. Ported from the Ranch
   Accountant's Daily Report. Operations and Executives only; the API refuses
   everyone else.

   Motion is small and skippable: everything is off under
   prefers-reduced-motion, and the page reads the same either way. */
(function () {
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const state = { view: 'week', anchor: null, selected: null, days: {}, loaded: null, meta: {} };
  const $ = function (id) { return document.getElementById(id); };

  const pad = function (n) { return String(n).padStart(2, '0'); };
  const iso = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const parse = function (s) { const p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
  const addDays = function (d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); };
  const startOfWeek = function (d) { return addDays(d, -d.getDay()); };
  const hrs = function (m) { return (Number(m || 0) / 60).toFixed(1); };
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const longDate = function (k) {
    return parse(k).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  };

  function rangeFor() {
    if (state.view === 'day') return [state.anchor, state.anchor];
    if (state.view === 'week') { const s = startOfWeek(state.anchor); return [s, addDays(s, 6)]; }
    const s = new Date(state.anchor.getFullYear(), state.anchor.getMonth(), 1);
    return [s, new Date(state.anchor.getFullYear(), state.anchor.getMonth() + 1, 0)];
  }

  async function load() {
    const r = rangeFor();
    // A week either side, so flicking back and forth is instant.
    const from = iso(addDays(r[0], -7)), to = iso(addDays(r[1], 7));
    const key = from + '|' + to;
    if (state.loaded === key) return;
    try {
      const res = await RR.api('api/report.php?start=' + from + '&end=' + to);
      state.days = res.days || {};
      state.meta = { through: res.coveredThrough, run: res.lastRun };
      state.loaded = key;
    } catch (err) {
      state.days = {};
      $('drPanel').innerHTML = '<p class="muted">Couldn\'t load the report: ' + RR.esc(err.message) + '</p>';
    }
  }

  function label() {
    const r = rangeFor(), a = r[0], b = r[1];
    if (state.view === 'day') return a.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    if (state.view === 'month') return MONTHS[a.getMonth()] + ' ' + a.getFullYear();
    const same = a.getMonth() === b.getMonth();
    return MONTHS[a.getMonth()] + ' ' + a.getDate() + ' – ' + (same ? '' : MONTHS[b.getMonth()] + ' ') + b.getDate() + ', ' + b.getFullYear();
  }

  function renderSource() {
    const m = state.meta || {};
    let t = 'From #railroad-duty-channel';
    if (m.through) t += ', posts through ' + RR.fmtDateTime(m.through);
    if (m.run && m.run.at) t += '. Last import ' + RR.fmtDateTime(m.run.at);
    $('drSource').textContent = t + '.';
  }

  function renderCalendar() {
    $('drRangeLabel').textContent = label();
    const grid = $('drGrid');
    const r = rangeFor(), a = r[0], b = r[1];
    let first = a, last = b;
    if (state.view === 'month') { first = startOfWeek(a); last = addDays(startOfWeek(b), 6); }
    const cells = [];
    for (let d = first; d <= last; d = addDays(d, 1)) cells.push(new Date(d));
    const peak = Math.max.apply(null, [1].concat(cells.map(function (d) { return (state.days[iso(d)] || {}).minutes || 0; })));
    const todayIso = iso(new Date());
    grid.className = 'dr-grid' + (state.view === 'day' ? ' dr-grid-day' : '');
    grid.innerHTML = (state.view === 'day' ? '' :
      ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(function (n) { return '<div class="dr-dow">' + n + '</div>'; }).join(''))
      + cells.map(function (d, i) {
        const k = iso(d), day = state.days[k];
        const mins = (day && day.minutes) || 0;
        const n = (day && day.drivers && day.drivers.length) || 0;
        const outside = state.view === 'month' && d.getMonth() !== a.getMonth();
        const heat = n ? (0.12 + 0.55 * (mins / peak)) : 0;
        return '<button type="button" class="dr-day' + (state.selected === k ? ' is-sel' : '') + (outside ? ' is-out' : '')
          + (n ? '' : ' is-empty') + (k === todayIso ? ' is-today' : '') + '" data-day="' + k + '"'
          + ' style="--heat:' + heat.toFixed(3) + ';--i:' + i + '"' + (n ? '' : ' aria-disabled="true"') + '>'
          + '<span class="dr-dnum">' + d.getDate() + '</span>'
          + '<span class="dr-dtot">' + (n ? hrs(mins) + ' h' : '—') + '</span>'
          + '<span class="dr-dsub">' + (n ? n + (n === 1 ? ' driver' : ' drivers') : 'no shifts') + '</span></button>';
      }).join('');
  }

  function renderDay() {
    const panel = $('drPanel');
    const k = state.selected, day = k && state.days[k];
    if (!k) { panel.innerHTML = '<p class="muted">Pick a day above.</p>'; return; }
    if (!day || !day.drivers.length) {
      panel.innerHTML = '<p class="muted">No shifts posted on ' + RR.esc(longDate(k)) + '.</p>';
      return;
    }
    const rows = day.drivers.map(function (h, i) {
      return '<div class="dr-row" style="--i:' + i + '">'
        + '<div class="dr-who"><strong>' + RR.esc(h.name) + '</strong><span>' + h.shifts + (h.shifts === 1 ? ' shift' : ' shifts') + '</span></div>'
        + '<div class="dr-bar"><i style="--w:' + h.share + '%"></i></div>'
        + '<div class="dr-pct"><strong data-count="' + h.share + '">0</strong><span>' + hrs(h.minutes) + ' h</span></div>'
        + '</div>';
    }).join('');
    const shifts = day.shifts.map(function (s) {
      const flag = s.note ? ' <span class="shift-flag" title="' + RR.esc(s.note) + '">!</span>' : '';
      return '<tr class="shift-row' + (s.note ? ' flagged' : '') + '" title="Show the post">'
        + '<td>' + RR.esc(s.name) + '</td>'
        + '<td>' + RR.esc(s.timeIn) + '</td>'
        + '<td>' + (s.timeOut ? RR.esc(s.timeOut) : '<span class="muted">&mdash;</span>') + '</td>'
        + '<td>' + RR.esc(s.tz) + '</td>'
        + '<td class="num">' + (s.minutes === null ? '<span class="muted">&mdash;</span>' : hrs(s.minutes)) + flag + '</td>'
        + '</tr>'
        + '<tr class="shift-post hide"><td colspan="5">'
        + (s.note ? '<div class="shift-note">' + RR.esc(s.note) + '</div>' : '')
        + '<div class="shift-raw">' + RR.esc(String(s.raw || '').split(' / ').join('\n')) + '</div>'
        + '<div class="muted shift-meta">Posted ' + RR.esc(RR.fmtDateTime(s.postedAt))
        + (s.discordName ? ' by ' + RR.esc(s.discordName) : '') + '</div>'
        + '</td></tr>';
    }).join('');
    const n = day.drivers.length;
    panel.innerHTML =
      '<div class="dr-daytitle"><h3>' + RR.esc(longDate(k)) + '</h3>'
      + '<p><strong>' + hrs(day.minutes) + ' hours</strong> on duty by <strong>' + n + '</strong> driver' + (n === 1 ? '' : 's')
      + '. Each bar is that driver\'s share of the day.</p></div>'
      + '<div class="dr-stack">' + day.drivers.map(function (h, i) {
          return '<i style="--w:' + h.share + '%;--i:' + i + '" title="' + RR.esc(h.name) + ' ' + h.share + '%"></i>';
        }).join('') + '</div>'
      + '<div class="dr-rows">' + rows + '</div>'
      + '<h3 style="margin-top:18px">Shifts</h3>'
      + '<div class="table-wrap"><table class="rr hours dr-shifts">'
      + '<thead><tr><th>Driver</th><th>Time in</th><th>Time out</th><th>Zone</th><th class="num">Hours</th></tr></thead>'
      + '<tbody>' + shifts + '</tbody></table></div>'
      + '<p class="muted hours-src">Times are as the driver posted them. Tap a shift to see the post.</p>';
    Array.prototype.forEach.call(panel.querySelectorAll('tr.shift-row'), function (tr) {
      tr.addEventListener('click', function () {
        tr.nextElementSibling.classList.toggle('hide');
        tr.classList.toggle('open');
      });
    });
    requestAnimationFrame(function () {
      panel.querySelectorAll('.dr-bar i, .dr-stack i').forEach(function (el) { el.classList.add('go'); });
      panel.querySelectorAll('[data-count]').forEach(countUp);
    });
  }

  function countUp(el) {
    const target = Number(el.dataset.count || 0);
    if (REDUCED) { el.textContent = target.toFixed(1) + '%'; return; }
    const t0 = performance.now(), dur = 620;
    const step = function (now) {
      const p = Math.min(1, (now - t0) / dur);
      el.textContent = (target * (1 - Math.pow(1 - p, 3))).toFixed(1) + '%';
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  async function refresh(keepSel) {
    await load();
    renderSource();
    if (!keepSel) {
      const r = rangeFor();
      if (state.selected) {
        const s = parse(state.selected);
        if (s < r[0] || s > r[1]) state.selected = null;
      }
      if (!state.selected) {
        let best = null, bestMin = 0;
        for (let d = r[0]; d <= r[1]; d = addDays(d, 1)) {
          const m = (state.days[iso(d)] || {}).minutes || 0;
          if (m > bestMin) { bestMin = m; best = iso(d); }
        }
        state.selected = best;
      }
    }
    renderCalendar();
    renderDay();
  }

  function shift(dir) {
    if (state.view === 'day') state.anchor = addDays(state.anchor, dir);
    else if (state.view === 'week') state.anchor = addDays(state.anchor, 7 * dir);
    else state.anchor = new Date(state.anchor.getFullYear(), state.anchor.getMonth() + dir, 1);
    refresh();
  }

  RR.boot('report').then(function (me) {
    if (!me || !me.permissions || !me.permissions.canSeeHours) {
      document.querySelector('main.page').innerHTML =
        '<section class="card"><p class="muted">The Daily Report is for Railway Operations and Railway Executives.</p></section>';
      return;
    }
    // Opens on the week containing YESTERDAY, with yesterday selected - the
    // day the office wants to review is the one that just finished.
    const y = addDays(new Date(), -1);
    state.anchor = y; state.selected = iso(y);
    $('drPrev').addEventListener('click', function () { shift(-1); });
    $('drNext').addEventListener('click', function () { shift(1); });
    $('drToday').addEventListener('click', function () {
      state.anchor = addDays(new Date(), -1); state.selected = iso(state.anchor); refresh(true);
    });
    document.querySelectorAll('.dr-view').forEach(function (b) {
      b.addEventListener('click', function () {
        state.view = b.dataset.view;
        document.querySelectorAll('.dr-view').forEach(function (x) { x.classList.toggle('is-on', x === b); });
        if (state.selected) state.anchor = parse(state.selected);
        refresh(true);
      });
    });
    $('drGrid').addEventListener('click', function (e) {
      const cell = e.target.closest('.dr-day');
      if (!cell || cell.getAttribute('aria-disabled') === 'true') return;
      state.selected = cell.dataset.day;
      renderCalendar(); renderDay();
    });
    refresh(true);
  });
})();
