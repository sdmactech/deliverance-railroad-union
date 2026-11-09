/* Roster page. */
(function () {
  'use strict';

  let MEMBERS = [], GRADES = {}, STATUSES = [], PERMS = {};

  const $ = function (id) { return document.getElementById(id); };

  async function load() {
    const data = await RR.api('api/roster.php?action=list');
    MEMBERS  = data.members;
    GRADES   = data.grades;
    STATUSES = data.statuses;
    fillFilters();
    renderTiles();
    render();
  }

  function today() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function suspensionDates(m) {
    return 'since ' + RR.esc(RR.fmtDate(m.suspendedFrom))
      + (m.suspendedUntil ? '<br><span class="' + (m.suspendedUntil < today() ? 'suspension-over' : '') + '">'
        + (m.suspendedUntil < today() ? 'ended ' : 'until ') + RR.esc(RR.fmtDate(m.suspendedUntil)) + '</span>' : '');
  }

  function fillFilters() {
    const g = $('gradeFilter');
    if (g.options.length > 1) return;
    Object.keys(GRADES).forEach(function (k) {
      g.insertAdjacentHTML('beforeend',
        '<option value="' + k + '">' + k + ' — ' + RR.esc(GRADES[k]) + '</option>');
    });
    const s = $('statusFilter');
    STATUSES.forEach(function (v) {
      s.insertAdjacentHTML('beforeend', '<option value="' + RR.esc(v) + '">' + RR.esc(v) + '</option>');
    });
  }

  // Everyone whose time with the union has ended. Non-executives are never
  // sent the disciplinary ones at all, so for them this is just 'Released'.
  const DEPARTED = ['Quit', 'Fired', 'Terminated', 'Banned', 'Released'];
  const DISCIPLINARY = ['Fired', 'Terminated', 'Banned'];

  /** Office-only rehire flag, shown as a badge. '' means not decided. */
  function rehireBadge(v) {
    if (v === 'yes') return '<span class="badge rehire-yes">Rehire: Yes</span>';
    if (v === 'no')  return '<span class="badge rehire-no">Rehire: No</span>';
    return '';
  }
  function departed(m) { return DEPARTED.indexOf(m.status) !== -1; }

  function renderTiles() {
    const live = MEMBERS.filter(function (m) { return !departed(m); });
    const counts = {};
    let trains = 0, unlinked = 0, gone = 0;
    MEMBERS.forEach(function (m) {
      counts[m.status] = (counts[m.status] || 0) + 1;
      trains += m.activeTrains || 0;
      if (!m.linked && !departed(m)) unlinked++;
      if (departed(m)) gone++;
    });
    const n = function (k) { return counts[k] || 0; };

    const tiles = [
      ['On the books', live.length, MEMBERS.length + ' records total'],
      ['Hired', n('Hired'), 'Grade 1 and up'],
      ['On probation', n('Probation'), 'Grade 0'],
      ['Government', n('Government'), 'Agency drivers'],
      ['Trains registered', trains, 'Active registrations'],
      ['Not yet linked', unlinked, 'No Discord account claimed']
    ];
    if (n('LOA')) tiles.push(['On leave', n('LOA'), 'Away, still on the books']);
    if (n('Suspended')) tiles.push(['Suspended', n('Suspended'), 'Off duty, still on the books']);
    if (PERMS.manager && gone) {
      tiles.push(['Departed', gone, 'Hidden from everyone but executives']);
    }

    $('tiles').innerHTML = tiles.map(function (t) {
      return '<article class="tile"><span class="tile-label">' + RR.esc(t[0]) + '</span>'
           + '<strong class="tile-main">' + t[1] + '</strong>'
           + '<span class="tile-note">' + RR.esc(t[2]) + '</span></article>';
    }).join('');
  }

  // Two table layouts. Operations and Executives get the Note column; for
  // anyone else it is removed from the header, the rows and the colspans - and
  // the API does not send the text either, so there is nothing to leak.
  function applyLayout() {
    const show = !!PERMS.canSeeNotes;
    document.querySelectorAll('.note-col').forEach(function (el) {
      el.classList.toggle('hide', !show);
    });
    // Last on duty is for one viewer; the API only sends it to them.
    document.querySelectorAll('.duty-col').forEach(function (el) {
      el.classList.toggle('hide', !PERMS.canSeeLastDuty);
    });
  }

  function cols() { return 6 + (PERMS.canSeeNotes ? 1 : 0) + (PERMS.canSeeLastDuty ? 1 : 0); }

  /** "2026-10-14" -> "Oct 14 · 3 days ago", against today's local date. */
  function lastDutyCell(d) {
    if (!d) return '<span class="muted">never</span>';
    const p = d.split('-').map(Number);
    const then = new Date(p[0], p[1] - 1, p[2]);
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const days = Math.round((now - then) / 86400000);
    const ago = days <= 0 ? 'today' : days === 1 ? 'yesterday' : days + ' days ago';
    return '<span class="' + (days >= 14 ? 'duty-stale' : '') + '">'
      + RR.esc(then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))
      + '<br><span class="muted" style="font-size:.74rem">' + ago + '</span></span>';
  }

  function visible() {
    const q      = $('q').value.trim().toLowerCase();
    const grade  = $('gradeFilter').value;
    const status = $('statusFilter').value;
    const hideGone = $('hideDeparted').checked;

    return MEMBERS.filter(function (m) {
      if (hideGone && departed(m) && status === '') return false;
      if (grade !== '' && String(m.grade) !== grade) return false;
      if (status !== '' && m.status !== status) return false;
      if (q) {
        const hay = [m.name, m.po, PERMS.canSeeNotes ? m.note : '',
                     m.discordName, m.office, m.agency, m.gradeTitle]
          .join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function probationCell(m) {
    if (!m.probationDate) return '<span class="muted">—</span>';
    const clear = m.canTrainAfter ? new Date(m.canTrainAfter + 'T00:00:00') : null;
    const done  = clear && clear <= new Date();
    return '<span class="mono">' + RR.esc(m.probationDate) + '</span><br>'
      + '<span class="muted" style="font-size:.76rem">'
      + (m.canTrainAfter ? (done ? 'clear since ' : 'can train after ') + RR.esc(m.canTrainAfter) : '')
      + '</span>';
  }

  function render() {
    const rows = visible();
    $('countLine').textContent = rows.length === MEMBERS.length
      ? MEMBERS.length + ' on the roster'
      : rows.length + ' of ' + MEMBERS.length + ' shown';

    if (!rows.length) {
      $('rosterBody').innerHTML = '<tr><td colspan="' + cols() + '" class="empty">Nobody matches that.</td></tr>';
      return;
    }

    $('rosterBody').innerHTML = rows.map(function (m) {
      const extras = [];
      if (m.office) extras.push('<span class="badge office">' + RR.esc(m.office) + '</span>');
      if (m.agency) extras.push('<span class="badge ghost">' + RR.esc(m.agency) + '</span>');
      if (m.rehire && departed(m)) extras.push(rehireBadge(m.rehire));
      return '<tr class="row-click" data-id="' + RR.esc(m.id) + '">'
        + '<td class="name-cell"><strong>' + RR.esc(m.name) + '</strong>'
        +   '<span>' + (m.linked ? RR.esc(m.discordName) : '<em>not linked</em>') + '</span>'
        +   (extras.length ? '<div class="inline-list" style="margin-top:4px">' + extras.join('') + '</div>' : '')
        + '</td>'
        + '<td>' + RR.gradeBadge(m.grade, m.gradeTitle) + '</td>'
        + '<td>' + RR.statusBadge(m.status)
        +   (m.status === 'LOA' && m.loaStart
              ? '<br><span class="muted" style="font-size:.74rem">since '
                + RR.esc(RR.fmtDate(m.loaStart)) + '</span>' : '')
        + (m.status === 'Suspended' ? '<br><span class="muted suspension-dates">' + suspensionDates(m) + '</span>' : '')
        + '</td>'
        + '<td class="mono">' + (m.po ? RR.esc(m.po) : '<span class="muted">—</span>') + '</td>'
        + '<td class="num">' + (m.activeTrains || 0) + '</td>'
        + '<td>' + probationCell(m) + '</td>'
        + (PERMS.canSeeLastDuty ? '<td class="duty-col">' + lastDutyCell(m.lastOnDuty) + '</td>' : '')
        + (PERMS.canSeeNotes
            ? '<td class="muted note-col" style="max-width:220px">' + RR.esc(m.note || '') + '</td>'
            : '')
        + '</tr>';
    }).join('');

    Array.prototype.forEach.call($('rosterBody').querySelectorAll('tr[data-id]'), function (tr) {
      tr.addEventListener('click', function () { openMember(tr.getAttribute('data-id')); });
    });
  }

  // ------------------------------------------------------------- detail ---

  // Staff only see the rungs they are allowed to move somebody to, plus
  // whatever rung that person already sits on.
  function gradeOptions(selected) {
    const cap = PERMS.manager ? 99 : (PERMS.maxGrade == null ? 0 : PERMS.maxGrade);
    return Object.keys(GRADES).filter(function (k) {
      return Number(k) <= cap || String(selected) === k;
    }).map(function (k) {
      return '<option value="' + k + '"' + (String(selected) === k ? ' selected' : '') + '>'
           + k + ' — ' + RR.esc(GRADES[k]) + '</option>';
    }).join('');
  }

  function statusOptions(selected, adding) {
    // Operations are not offered the disciplinary endings, but a record that
    // already carries one must still show it.
    const list = selected && STATUSES.indexOf(selected) === -1 ? STATUSES.concat([selected]) : STATUSES;
    return list.filter(function (v) {
      return v !== 'Suspended' || (!adding && (PERMS.canSeeNotes || selected === 'Suspended'));
    }).map(function (v) {
      return '<option value="' + RR.esc(v) + '"' + (v === selected ? ' selected' : '') + '>' + RR.esc(v) + '</option>';
    }).join('');
  }

  /** "245" minutes -> "4.1" hours. */
  function hrs(mins) { return (mins / 60).toFixed(1); }

  /**
   * On-duty hours, office-only. Three running totals, then every shift with the
   * times exactly as the driver posted them; a row opens to show the post.
   */
  function hoursHtml(h) {
    const head = '<h3 style="margin-top:14px">On-duty hours</h3>';
    if (!h) return head + '<p class="muted" style="margin:6px 0 0">Hours could not be loaded.</p>';
    if (!h.shifts.length) {
      return head + '<p class="muted" style="margin:6px 0 0">No shifts logged in the duty channel'
        + (h.coveredThrough ? ' through ' + RR.esc(RR.fmtDate(h.coveredThrough)) : '') + '.</p>';
    }
    const tile = function (label, k) {
      const n = h.counts[k];
      return '<div class="tile"><span class="tile-label">' + label + '</span>'
        + '<span class="tile-main">' + hrs(h.totals[k]) + ' h</span>'
        + '<span class="tile-note">' + n + ' shift' + (n === 1 ? '' : 's') + '</span></div>';
    };
    const rows = h.shifts.map(function (s) {
      const flag = s.note ? ' <span class="shift-flag" title="' + RR.esc(s.note) + '">!</span>' : '';
      return '<tr class="shift-row' + (s.note ? ' flagged' : '') + '" title="Show the post">'
        + '<td>' + RR.esc(RR.fmtDate(s.date)) + '</td>'
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
    return head
      + '<div class="tiles hours-tiles">' + tile('Last 14 days', 'd14') + tile('Last 30 days', 'd30') + tile('Last 60 days', 'd60') + '</div>'
      + '<div class="table-wrap"><table class="rr hours">'
      + '<thead><tr><th>Date</th><th>Time in</th><th>Time out</th><th>Zone</th><th class="num">Hours</th></tr></thead>'
      + '<tbody>' + rows + '</tbody></table></div>'
      + '<p class="muted hours-src">From #railroad-duty-channel, posts through '
      + RR.esc(RR.fmtDateTime(h.coveredThrough)) + '. Times are as the driver posted them. Tap a shift to see the post.</p>';
  }

  // Large pictures are resized before they go into the office record.
  async function suspensionFile(file) {
    if (!file.type.startsWith('image/') || file.size <= 1.5 * 1024 * 1024) return file;
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      await new Promise(function (resolve, reject) {
        img.onload = resolve;
        img.onerror = function () { reject(new Error('Could not read ' + file.name + '.')); };
        img.src = url;
      });
      const scale = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(function (resolve) { canvas.toBlob(resolve, 'image/jpeg', 0.85); });
      if (!blob) throw new Error('Could not resize ' + file.name + '.');
      return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
    } finally { URL.revokeObjectURL(url); }
  }

  async function loadSuspensions(root, member) {
    try {
      const data = await RR.api('api/suspension.php?member=' + encodeURIComponent(member.id));
      root.classList.toggle('hide', !data.suspensions.length && member.status !== 'Suspended');
      root.innerHTML = '<h3>Suspension record</h3>' + data.suspensions.map(function (s) {
        return '<article class="suspension"><h4>' + RR.esc(RR.fmtDate(s.from))
          + (s.until ? ' until ' + RR.esc(RR.fmtDate(s.until)) : ', no end date set') + '</h4>'
          + '<p class="muted">' + (s.open ? 'Open' : 'Lifted by ' + RR.esc(s.liftedBy) + ' on '
            + RR.esc(RR.fmtDateTime(s.liftedAt)) + ' to ' + RR.esc(s.liftedTo)) + '</p>'
          + s.entries.map(function (e) {
            return '<div class="suspension-entry' + (e.kind !== 'comment' ? ' system' : '') + '">'
              + '<div class="suspension-meta">' + RR.esc(e.author) + ' · ' + RR.esc(RR.fmtDateTime(e.at)) + '</div>'
              + '<div class="suspension-body">' + RR.esc(e.body) + '</div>'
              + '<div class="suspension-files">' + e.files.map(function (f) {
                const url = 'api/suspension.php?file=' + encodeURIComponent(f.id);
                return '<a class="suspension-file" href="' + url + '" target="_blank" rel="noopener">'
                  + (f.isImage ? '<img src="' + url + '" alt="' + RR.esc(f.name) + '" loading="lazy">' : '')
                  + '<span>' + RR.esc(f.name) + '</span></a>';
              }).join('') + '</div></div>';
          }).join('')
          + '<form class="suspension-form" data-suspension="' + RR.esc(s.id) + '">'
          + '<label class="field"><span>Add a comment (office only)</span><textarea name="body" maxlength="4000"></textarea></label>'
          + '<label class="field"><span>Pictures, PDFs or text files</span><input type="file" name="files" multiple accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain"></label>'
          + '<button class="btn small" type="submit">Add to record</button></form></article>';
      }).join('');
      root.querySelectorAll('form').forEach(function (form) {
        form.addEventListener('submit', async function (event) {
          event.preventDefault();
          const button = form.querySelector('button');
          button.disabled = true;
          try {
            const chosen = Array.from(form.elements.files.files);
            if (chosen.length > data.maxFiles) throw new Error('Attach at most ' + data.maxFiles + ' files at a time.');
            const files = await Promise.all(chosen.map(suspensionFile));
            if (data.maxBytes > 0 && files.reduce(function (n, f) { return n + f.size; }, 0) > data.maxBytes) {
              throw new Error('Those files are too large together. Keep a single post under ' + (data.maxBytes / 1024 / 1024).toFixed(1) + ' MB.');
            }
            const body = form.elements.body.value.trim();
            if (!body && !files.length) throw new Error('Write a comment or attach a file.');
            const payload = new FormData();
            payload.append('suspensionId', form.dataset.suspension);
            payload.append('body', body);
            files.forEach(function (f) { payload.append('files[]', f); });
            const response = await fetch('api/suspension.php', { method: 'POST', credentials: 'same-origin', body: payload });
            const result = await response.json();
            if (!response.ok || !result.ok) throw new Error(result.error || 'Request failed (' + response.status + ')');
            RR.toast('Added to the record.');
            await loadSuspensions(root, member);
          } catch (e) { RR.toast(e.message, true); }
          finally { button.disabled = false; }
        });
      });
    } catch (e) { RR.toast(e.message, true); }
  }

  async function openMember(id) {
    const m = MEMBERS.find(function (x) { return x.id === id; });
    if (!m) return;

    const isMgr   = PERMS.manager;
    // Fired, Terminated and Banned records are the executive's to change,
    // rehiring included. Operations can read them.
    const locked  = !isMgr && DISCIPLINARY.indexOf(m.status) !== -1;
    const canEdit = PERMS.canEdit && !locked;
    // Operations staff promote and set status, but not on an executive record.
    const canRank = PERMS.canPromote && !locked && (isMgr || m.grade <= PERMS.maxGrade);

    let trains = [];
    let hours = null;
    const hoursReq = PERMS.canSeeHours
      ? RR.api('api/hours.php?action=member&id=' + encodeURIComponent(id)).catch(function () { return null; })
      : Promise.resolve(null);
    try {
      const t = await RR.api('api/trains.php?action=list&scope=all&owner=' + encodeURIComponent(id));
      trains = t.trains;
    } catch (e) { /* the record still opens without them */ }
    hours = await hoursReq;

    const trainHtml = trains.length
      ? '<ul class="stack" style="list-style:none;padding:0;margin:6px 0 0">' + trains.map(function (t) {
          return '<li>' + RR.esc(t.name) + ' '
            + '<span class="badge ' + RR.esc(t.status) + '">' + RR.esc(t.status) + '</span></li>';
        }).join('') + '</ul>'
      : '<p class="muted" style="margin:6px 0 0">No trains registered.</p>';

    const readOnly = canEdit ? '' : ' disabled';

    const body =
      (locked
        ? '<p class="notice">' + RR.esc(m.status) + ' &mdash; only Railway Executives can change this record, including hiring them back.</p>'
        : '')
      + '<div class="field-row">'
      + '<label class="field"><span>First name</span><input id="fFirst" value="' + RR.esc(m.firstName) + '"' + readOnly + '></label>'
      + '<label class="field"><span>Last name</span><input id="fLast" value="' + RR.esc(m.lastName) + '"' + readOnly + '></label>'
      + '</div>'
      + '<div class="field-row">'
      + '<label class="field"><span>Grade</span><select id="fGrade"' + (canRank ? '' : ' disabled') + '>' + gradeOptions(m.grade) + '</select></label>'
      + '<label class="field"><span>Status</span><select id="fStatus"' + (canRank && (PERMS.canSeeNotes || m.status !== 'Suspended') ? '' : ' disabled') + '>' + statusOptions(m.status) + '</select></label>'
      + '</div>'
      + '<div class="field-row">'
      + '<label class="field"><span>PO box</span><input id="fPo" value="' + RR.esc(m.po) + '" placeholder="e.g. 1481"' + readOnly + '></label>'
      + '<label class="field"><span>Government agency</span><input id="fAgency" value="' + RR.esc(m.agency) + '" placeholder="Law, DOJ&hellip;"' + readOnly + '></label>'
      + '</div>'
      + '<div class="field-row">'
      + '<label class="field"><span>Date on probation</span><input id="fProb" type="date" value="' + RR.esc(m.probationDate) + '"' + readOnly + '></label>'
      + '<label class="field"><span>Can train after</span><input id="fAfter" type="date" value="' + RR.esc(m.canTrainAfter) + '"' + readOnly + '></label>'
      + '</div>'
      + '<label class="field' + (m.status === 'LOA' ? '' : ' hide') + '" id="fLoaWrap">'
      +   '<span>On leave since</span>'
      +   '<input id="fLoa" type="date" value="' + RR.esc(m.loaStart || '') + '"'
      +   (canRank ? '' : ' disabled') + '></label>'
      + (PERMS.canSeeNotes
          ? '<div id="fSuspWrap" class="' + (m.status === 'Suspended' ? '' : 'hide') + '"><div class="field-row">'
            + '<label class="field"><span>Suspended from</span><input id="fSuspFrom" type="date" value="' + RR.esc(m.suspendedFrom || '') + '"' + (canRank ? '' : ' disabled') + '></label>'
            + '<label class="field"><span>Until (optional)</span><input id="fSuspUntil" type="date" value="' + RR.esc(m.suspendedUntil || '') + '"' + (canRank ? '' : ' disabled') + '></label></div>'
            + (m.status !== 'Suspended' ? '<label class="field"><span>Reason for the suspension (office only)</span><textarea id="fSuspReason" maxlength="4000"></textarea></label>' : '') + '</div>'
          : (m.status === 'Suspended' ? '<p class="suspension-dates">' + suspensionDates(m) + '</p>' : ''))
      + '<label class="field"><span>Office (outside the ladder)</span><input id="fOffice" value="' + RR.esc(m.office) + '" placeholder="Governor, Founder&hellip;"' + (isMgr ? '' : ' disabled') + '></label>'
      + '<label class="field"><span>Trainee</span><input id="fTrainee" value="' + RR.esc(m.trainee) + '"' + readOnly + '></label>'
      + (PERMS.canSeeNotes
          ? '<label class="field"><span>Rehire eligible</span><select id="fRehire"' + readOnly + '>'
            + [['', 'Not decided'], ['yes', 'Yes - can be rehired'], ['no', 'No - do not rehire']].map(function (o) {
                return '<option value="' + o[0] + '"' + ((m.rehire || '') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
              }).join('')
            + '</select></label>'
            + '<label class="field"><span>Note</span><textarea id="fNote"' + readOnly + ' placeholder="Why they left, and whether they can come back&hellip;">'
            + RR.esc(m.note) + '</textarea></label>'
          : '')
      + (PERMS.canSeeNotes ? '<section id="suspensionRecord" class="hide"></section>' : '')
      + '<h3 style="margin-top:14px">Trains</h3>' + trainHtml
      + (PERMS.canSeeHours ? hoursHtml(hours) : '')
      + '<h3 style="margin-top:14px">Discord</h3>'
      + '<p class="muted" style="margin:4px 0 0;font-size:.86rem">'
      +   (m.linked
            ? RR.esc(m.discordName) + (m.rolesCheckedAt ? ' — roles last read ' + RR.esc(RR.fmtDateTime(m.rolesCheckedAt)) : '')
            : 'No Discord account linked.')
      + '</p>';

    const foot =
      (isMgr && m.linked ? '<button class="btn" id="unlinkBtn">Unlink Discord</button>' : '')
      + (isMgr ? '<button class="btn" id="mergeBtn">Merge&hellip;</button>' : '')
      + (isMgr ? '<button class="btn danger" id="delBtn">Delete</button>' : '')
      + '<span class="spacer"></span><button class="btn" data-close>Close</button>'
      + (canEdit ? '<button class="btn primary" id="saveBtn">Save</button>' : '');

    const dlg = RR.modal(
      '<div class="modal-head"><h2>' + RR.esc(m.name) + '</h2>'
      + '<p class="sub">' + RR.esc(m.gradeTitle) + '</p></div>'
      + '<div class="modal-body">' + body + '</div>'
      + '<div class="modal-foot">' + foot + '</div>'
    );

    if (PERMS.canSeeNotes) loadSuspensions(dlg.querySelector('#suspensionRecord'), m);
    const suspWrap = dlg.querySelector('#fSuspWrap');
    if (suspWrap) dlg.querySelector('#fStatus').addEventListener('change', function () {
      const on = this.value === 'Suspended';
      suspWrap.classList.toggle('hide', !on);
      const from = dlg.querySelector('#fSuspFrom'), reason = dlg.querySelector('#fSuspReason');
      if (on && !from.value) from.value = today();
      if (reason) reason.required = on;
    });

    // A shift row opens to show the duty-channel post it came from.
    Array.prototype.forEach.call(dlg.querySelectorAll('tr.shift-row'), function (tr) {
      tr.addEventListener('click', function () {
        const det = tr.nextElementSibling;
        if (det && det.classList.contains('shift-post')) {
          det.classList.toggle('hide');
          tr.classList.toggle('open');
        }
      });
    });

    // The leave date only belongs on screen while the member is on leave.
    const st = dlg.querySelector('#fStatus'), loaWrap = dlg.querySelector('#fLoaWrap');
    if (st && loaWrap) {
      st.addEventListener('change', function () {
        const on = st.value === 'LOA';
        loaWrap.classList.toggle('hide', !on);
        const f = dlg.querySelector('#fLoa');
        if (on && f && !f.value) f.value = new Date().toISOString().slice(0, 10);
      });
    }

    // Keep the probation window honest: moving the start date moves the clear date.
    const prob = dlg.querySelector('#fProb'), after = dlg.querySelector('#fAfter');
    if (prob && after && canEdit) {
      prob.addEventListener('change', function () {
        if (!prob.value) { after.value = ''; return; }
        const d = new Date(prob.value + 'T00:00:00');
        d.setDate(d.getDate() + 7);
        after.value = d.toISOString().slice(0, 10);
      });
    }

    const save = dlg.querySelector('#saveBtn');
    if (save) save.addEventListener('click', async function () {
      if (dlg.querySelector('#fStatus').value === 'Suspended' && PERMS.canSeeNotes) {
        const from = dlg.querySelector('#fSuspFrom'), reason = dlg.querySelector('#fSuspReason');
        from.required = true;
        if (!from.reportValidity() || (reason && !reason.reportValidity())) return;
      }
      save.disabled = true;
      try {
        const r = await RR.post('api/roster.php', {
          action: 'update', memberId: m.id,
          firstName: dlg.querySelector('#fFirst').value,
          lastName:  dlg.querySelector('#fLast').value,
          grade:     Number(dlg.querySelector('#fGrade').value),
          status:    dlg.querySelector('#fStatus').value,
          office:    dlg.querySelector('#fOffice').value,
          agency:    dlg.querySelector('#fAgency').value,
          po:        dlg.querySelector('#fPo').value,
          trainee:   dlg.querySelector('#fTrainee').value,
          probationDate: dlg.querySelector('#fProb').value,
          canTrainAfter: dlg.querySelector('#fAfter').value,
          loaStart:  dlg.querySelector('#fLoa') ? dlg.querySelector('#fLoa').value : '',
          suspendedFrom: PERMS.canSeeNotes ? dlg.querySelector('#fSuspFrom').value : undefined,
          suspendedUntil: PERMS.canSeeNotes ? dlg.querySelector('#fSuspUntil').value : undefined,
          suspendReason: dlg.querySelector('#fSuspReason') ? dlg.querySelector('#fSuspReason').value : undefined,
          note:      PERMS.canSeeNotes ? dlg.querySelector('#fNote').value : undefined,
          rehire:    PERMS.canSeeNotes ? dlg.querySelector('#fRehire').value : undefined
        });
        dlg.close();
        // Say so out loud when a status change took somebody's engines.
        const took = (r && r.trainsTaken) || [];
        RR.toast(took.length
          ? 'Saved. ' + took.length + ' engine' + (took.length === 1 ? '' : 's') + ' '
            + (r.disposition === 'repossessed' ? 'repossessed' : 'forfeited')
            + ': ' + took.join(', ')
          : 'Saved.');
        await load();
      } catch (e) { RR.toast(e.message, true); save.disabled = false; }
    });

    const mergeB = dlg.querySelector('#mergeBtn');
    if (mergeB) mergeB.addEventListener('click', function () { openMerge(m, dlg); });

    const unlink = dlg.querySelector('#unlinkBtn');
    if (unlink) unlink.addEventListener('click', async function () {
      const ok = await RR.confirmDanger('Unlink Discord account',
        '<p>' + RR.esc(m.name) + ' will be separated from <strong>' + RR.esc(m.discordName)
        + '</strong>. Their roster record and trains stay exactly as they are. They can claim a record again.</p>',
        'Unlink');
      if (!ok) return;
      try {
        await RR.post('api/roster.php', { action: 'unlink', memberId: m.id });
        dlg.close(); RR.toast('Unlinked.'); await load();
      } catch (e) { RR.toast(e.message, true); }
    });

    const del = dlg.querySelector('#delBtn');
    if (del) del.addEventListener('click', async function () {
      const active = trains.filter(function (t) { return t.status === 'active'; });
      const ok = await RR.confirmDanger('Delete ' + m.name + ' from the roster',
        '<p>This removes the record from the roster.</p>'
        + (active.length
            ? '<p class="notice warn" style="margin:10px 0 0">Their <strong>' + active.length
              + '</strong> active train registration' + (active.length === 1 ? '' : 's')
              + ' will be struck at the same time.</p>'
            : '')
        + '<p class="muted" style="margin-top:10px;font-size:.85rem">The full record is written to the office log, '
        + 'so a mistake can be reversed by hand.</p>',
        'Delete from roster');
      if (!ok) return;
      try {
        const r = await RR.post('api/roster.php', { action: 'delete', memberId: m.id });
        dlg.close();
        RR.toast('Removed from the roster'
          + (r.trainsRemoved
              ? ' with ' + r.trainsRemoved + ' train' + (r.trainsRemoved === 1 ? '' : 's') + '.'
              : '.'));
        await load();
      } catch (e) { RR.toast(e.message, true); }
    });
  }

  // -------------------------------------------------------------- merge ---

  // Fold a duplicate into this record. The record the executive opened is the
  // one that SURVIVES; the one they pick here is absorbed and removed.
  function openMerge(keep, parent) {
    const others = MEMBERS
      .filter(function (x) { return x.id !== keep.id; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });

    const dlg = RR.modal(
      '<div class="modal-head"><h2>Merge into ' + RR.esc(keep.name) + '</h2>'
      + '<p class="sub">The record you pick is absorbed and removed.</p></div>'
      + '<div class="modal-body">'
      + '<div class="notice" style="margin:0 0 12px">'
      +   '<strong>' + RR.esc(keep.name) + '</strong> is kept. Any blank field on it is '
      +   'filled from the other record, the higher grade wins, an unclaimed Discord '
      +   'link is taken over, and every train moves across. Both records go into the '
      +   'office log in full, so this can be undone by hand.'
      + '</div>'
      + '<label class="field"><span>Record to absorb</span><select id="mPick">'
      +   others.map(function (x) {
            return '<option value="' + RR.esc(x.id) + '">' + RR.esc(x.name)
                 + ' &mdash; ' + RR.esc(x.gradeTitle) + ' (' + RR.esc(x.status) + ')'
                 + (x.activeTrains ? ' · ' + x.activeTrains + ' train' + (x.activeTrains === 1 ? '' : 's') : '')
                 + '</option>';
          }).join('')
      + '</select></label>'
      + '</div>'
      + '<div class="modal-foot"><span class="spacer"></span>'
      + '<button class="btn" data-close>Cancel</button>'
      + '<button class="btn danger" id="mergeGo">Merge</button></div>'
    );

    dlg.querySelector('#mergeGo').addEventListener('click', async function () {
      const pick = dlg.querySelector('#mPick').value;
      const who  = MEMBERS.find(function (x) { return x.id === pick; });
      const ok = await RR.confirmDanger('Merge and remove ' + (who ? who.name : 'that record') + '?',
        '<p><strong>' + RR.esc(who ? who.name : '') + '</strong> will be removed and folded into '
        + '<strong>' + RR.esc(keep.name) + '</strong>. This cannot be undone from the page.</p>',
        'Merge');
      if (!ok) return;
      try {
        const r = await RR.post('api/roster.php', {
          action: 'merge', keepId: keep.id, mergeId: pick
        });
        dlg.close(); if (parent) parent.close();
        RR.toast('Merged. ' + r.trainsMoved + ' train' + (r.trainsMoved === 1 ? '' : 's') + ' moved across.');
        await load();
      } catch (e) { RR.toast(e.message, true); }
    });
  }

  // ------------------------------------------------------------- export ---

  // Railway Executives only. Plain <a download> links so the browser handles
  // the save dialog and the session cookie rides along; no blob juggling.
  function openExport() {
    const item = function (what, label, note) {
      return '<a class="btn dl-option" href="api/export.php?what=' + what + '" download>'
           + '<strong>' + label + '</strong><span>' + note + '</span></a>';
    };
    RR.modal(
      '<div class="modal-head"><h2>Data download</h2>'
      + '<p class="sub">Everything the office holds, straight off the books.</p></div>'
      + '<div class="modal-body"><div class="stack">'
      +   item('roster', 'Roster &mdash; CSV',
              'Every record with grade, status, PO box, dates and Discord link. Opens in Numbers or Excel.')
      +   item('trains', 'Train registrations &mdash; CSV',
              'Every train, who it is registered to, and its sale or removal history.')
      +   item('backup', 'Full backup &mdash; JSON',
              'Members, trains, claims and the whole office log. This is the one to keep.')
      + '</div></div>'
      + '<div class="modal-foot"><span class="spacer"></span>'
      + '<button class="btn" data-close>Close</button></div>'
    );
  }

  // ---------------------------------------------------------------- add ---

  function openAdd() {
    const dlg = RR.modal(
      '<div class="modal-head"><h2>Add to the roster</h2>'
      + '<p class="sub">New hires start on probation at grade 0.</p></div>'
      + '<div class="modal-body">'
      + '<div class="field-row">'
      + '<label class="field"><span>First name</span><input id="nFirst" autofocus></label>'
      + '<label class="field"><span>Last name</span><input id="nLast"></label>'
      + '</div>'
      + '<div class="field-row">'
      + '<label class="field"><span>Grade</span><select id="nGrade">' + gradeOptions(0) + '</select></label>'
      + '<label class="field"><span>Status</span><select id="nStatus">' + statusOptions('Probation', true) + '</select></label>'
      + '</div>'
      + '<div class="field-row">'
      + '<label class="field"><span>PO box</span><input id="nPo"></label>'
      + '<label class="field"><span>Date on probation</span><input id="nProb" type="date"></label>'
      + '</div>'
      + '<label class="field hide" id="nLoaWrap"><span>On leave since</span>'
      +   '<input id="nLoa" type="date"></label>'
      + (PERMS.canSeeNotes
          ? '<label class="field"><span>Note</span><textarea id="nNote"></textarea></label>'
          : '')
      + '</div>'
      + '<div class="modal-foot"><span class="spacer"></span>'
      + '<button class="btn" data-close>Cancel</button>'
      + '<button class="btn primary" id="createBtn">Add</button></div>'
    );

    const nSt = dlg.querySelector('#nStatus'), nWrap = dlg.querySelector('#nLoaWrap');
    nSt.addEventListener('change', function () {
      const on = nSt.value === 'LOA';
      nWrap.classList.toggle('hide', !on);
      const f = dlg.querySelector('#nLoa');
      if (on && !f.value) f.value = new Date().toISOString().slice(0, 10);
    });

    dlg.querySelector('#createBtn').addEventListener('click', async function () {
      try {
        await RR.post('api/roster.php', {
          action: 'create',
          firstName: dlg.querySelector('#nFirst').value,
          lastName:  dlg.querySelector('#nLast').value,
          grade:     Number(dlg.querySelector('#nGrade').value),
          status:    dlg.querySelector('#nStatus').value,
          po:        dlg.querySelector('#nPo').value,
          probationDate: dlg.querySelector('#nProb').value,
          loaStart:  dlg.querySelector('#nLoa').value,
          note:      PERMS.canSeeNotes ? dlg.querySelector('#nNote').value : undefined
        });
        dlg.close(); RR.toast('Added to the roster.'); await load();
      } catch (e) { RR.toast(e.message, true); }
    });
  }

  // --------------------------------------------------------------- boot ---

  RR.boot('roster').then(async function (me) {
    PERMS = me.permissions;
    applyLayout();
    if (PERMS.canHire) {
      const b = document.getElementById('addMemberBtn');
      b.classList.remove('hide');
      b.addEventListener('click', openAdd);
    }
    if (PERMS.manager) {
      const x = document.getElementById('exportBtn');
      x.classList.remove('hide');
      x.addEventListener('click', openExport);
    }
    ['q', 'gradeFilter', 'statusFilter', 'hideDeparted'].forEach(function (id) {
      document.getElementById(id).addEventListener('input', render);
      document.getElementById(id).addEventListener('change', render);
    });
    try {
      await load();
      const member = new URLSearchParams(window.location.search).get('member');
      if (member) await openMember(member);
    }
    catch (e) {
      document.getElementById('rosterBody').innerHTML =
        '<tr><td colspan="' + cols() + '" class="empty">' + RR.esc(e.message) + '</td></tr>';
    }
  });
})();
