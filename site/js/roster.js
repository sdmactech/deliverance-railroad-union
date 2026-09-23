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
  }

  function cols() { return PERMS.canSeeNotes ? 7 : 6; }

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
        + '</td>'
        + '<td class="mono">' + (m.po ? RR.esc(m.po) : '<span class="muted">—</span>') + '</td>'
        + '<td class="num">' + (m.activeTrains || 0) + '</td>'
        + '<td>' + probationCell(m) + '</td>'
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

  function statusOptions(selected) {
    return STATUSES.map(function (v) {
      return '<option value="' + RR.esc(v) + '"' + (v === selected ? ' selected' : '') + '>' + RR.esc(v) + '</option>';
    }).join('');
  }

  async function openMember(id) {
    const m = MEMBERS.find(function (x) { return x.id === id; });
    if (!m) return;

    const canEdit = PERMS.canEdit;
    const isMgr   = PERMS.manager;
    // Operations staff promote and set status, but not on an executive record.
    const canRank = PERMS.canPromote && (isMgr || m.grade <= PERMS.maxGrade);

    let trains = [];
    try {
      const t = await RR.api('api/trains.php?action=list&scope=all&owner=' + encodeURIComponent(id));
      trains = t.trains;
    } catch (e) { /* the record still opens without them */ }

    const trainHtml = trains.length
      ? '<ul class="stack" style="list-style:none;padding:0;margin:6px 0 0">' + trains.map(function (t) {
          return '<li>' + RR.esc(t.name) + ' '
            + '<span class="badge ' + RR.esc(t.status) + '">' + RR.esc(t.status) + '</span></li>';
        }).join('') + '</ul>'
      : '<p class="muted" style="margin:6px 0 0">No trains registered.</p>';

    const readOnly = canEdit ? '' : ' disabled';

    const body =
      '<div class="field-row">'
      + '<label class="field"><span>First name</span><input id="fFirst" value="' + RR.esc(m.firstName) + '"' + readOnly + '></label>'
      + '<label class="field"><span>Last name</span><input id="fLast" value="' + RR.esc(m.lastName) + '"' + readOnly + '></label>'
      + '</div>'
      + '<div class="field-row">'
      + '<label class="field"><span>Grade</span><select id="fGrade"' + (canRank ? '' : ' disabled') + '>' + gradeOptions(m.grade) + '</select></label>'
      + '<label class="field"><span>Status</span><select id="fStatus"' + (canRank ? '' : ' disabled') + '>' + statusOptions(m.status) + '</select></label>'
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
      + '<label class="field"><span>Office (outside the ladder)</span><input id="fOffice" value="' + RR.esc(m.office) + '" placeholder="Governor, Founder&hellip;"' + (isMgr ? '' : ' disabled') + '></label>'
      + '<label class="field"><span>Trainee</span><input id="fTrainee" value="' + RR.esc(m.trainee) + '"' + readOnly + '></label>'
      + (PERMS.canSeeNotes
          ? '<label class="field"><span>Note</span><textarea id="fNote"' + readOnly + '>'
            + RR.esc(m.note) + '</textarea></label>'
          : '')
      + '<h3 style="margin-top:14px">Trains</h3>' + trainHtml
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
          note:      PERMS.canSeeNotes ? dlg.querySelector('#fNote').value : undefined
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
        RR.toast('Removed from the roster' + (r.trainsRemoved ? ' with ' + r.trainsRemoved + ' train(s).' : '.'));
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
      + '<label class="field"><span>Status</span><select id="nStatus">' + statusOptions('Probation') + '</select></label>'
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
    try { await load(); }
    catch (e) {
      document.getElementById('rosterBody').innerHTML =
        '<tr><td colspan="' + cols() + '" class="empty">' + RR.esc(e.message) + '</td></tr>';
    }
  });
})();
