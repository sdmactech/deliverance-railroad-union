/* Deliverance Railroad Union — Train Registration page.
 *
 * The page markup shipped without this script, so the tab rendered no
 * navigation (RR.boot never ran) and the register sat on "Loading..." forever.
 *
 * Permission shape, matching api/trains.php:
 *   register  any linked member, for themselves; executives for anybody
 *   sell      the owner, or an executive - sells the engine back to the state
 *   strike    executives only
 *   reinstate executives only
 */
(function () {
  'use strict';

  let TRAINS = [], MEMBERS = [], PERMS = {}, ME = null;

  function $(id) { return document.getElementById(id); }

  function scope() { return $('scope').value; }

  async function load() {
    const d = await RR.api('api/trains.php?action=list&scope=' + encodeURIComponent(scope()));
    TRAINS = d.trains;
    render();
  }

  // Only needed so an executive can register on somebody else's behalf.
  async function loadMembers() {
    if (!PERMS.manager) return;
    try {
      const d = await RR.api('api/roster.php?action=list');
      MEMBERS = d.members.filter(function (m) { return m.status !== 'Released'; });
    } catch (e) { MEMBERS = []; }
  }

  // ---------------------------------------------------------------- view ---

  // How a registration ended. Mac's wording: sold back, repossessed from the
  // owner, or forfeited when they quit. 'removed' is an office correction.
  const STANDING = {
    active:      ['active',      'Active'],
    sold:        ['sold',        'Sold back'],
    repossessed: ['repossessed', 'Repossessed'],
    forfeited:   ['forfeited',   'Forfeited'],
    removed:     ['removed',     'Struck']
  };

  function standing(t) {
    const s = STANDING[t.status] || ['ghost', t.status];
    let out = '<span class="badge ' + s[0] + '">' + RR.esc(s[1]) + '</span>';
    if (t.status === 'sold' && t.soldPrice) {
      out += ' <span class="muted">$' + RR.esc(t.soldPrice) + '</span>';
    }
    if ((t.status === 'repossessed' || t.status === 'forfeited') && t.removedAt) {
      out += '<br><span class="muted" style="font-size:.74rem">'
           + RR.esc(RR.fmtDate(t.removedAt)) + '</span>';
    }
    return out;
  }

  function actionsFor(t) {
    const mine = t.isMine;
    const btns = [];
    if (t.status === 'active' && (mine || PERMS.manager)) {
      btns.push('<button class="btn small" data-sell="' + RR.esc(t.id) + '">Sell back</button>');
    }
    if (t.status === 'active' && PERMS.manager) {
      btns.push('<button class="btn small" data-repo="' + RR.esc(t.id) + '">Repossess</button>');
      btns.push('<button class="btn small danger" data-strike="' + RR.esc(t.id) + '">Strike</button>');
    }
    if (t.status !== 'active' && PERMS.manager) {
      btns.push('<button class="btn small" data-reinstate="' + RR.esc(t.id) + '">Reinstate</button>');
    }
    return btns.join(' ');
  }

  function visible() {
    const q = $('q').value.trim().toLowerCase();
    if (!q) return TRAINS;
    return TRAINS.filter(function (t) {
      return (t.name + ' ' + t.ownerName).toLowerCase().indexOf(q) !== -1;
    });
  }

  function render() {
    const rows = visible();
    $('countLine').textContent = rows.length
      ? rows.length + (rows.length === 1 ? ' registration' : ' registrations')
      : 'Nothing on the register for that.';

    $('trainBody').innerHTML = rows.length
      ? rows.map(function (t) {
          return '<tr' + (t.isMine ? ' class="mine"' : '') + '>'
            + '<td class="name-cell"><strong>' + RR.esc(t.name) + '</strong>'
            +   (t.note ? '<span>' + RR.esc(t.note) + '</span>' : '')
            + '</td>'
            + '<td>' + RR.esc(t.ownerName) + '</td>'
            + '<td>' + RR.esc(RR.fmtDate(t.registeredAt)) + '</td>'
            + '<td>' + standing(t) + '</td>'
            + '<td class="right">' + actionsFor(t) + '</td>'
            + '</tr>';
        }).join('')
      : '<tr><td colspan="5" class="empty">Nothing on the register for that.</td></tr>';

    wire();
    renderMine();
  }

  function renderMine() {
    const card = $('mineCard');
    if (!PERMS.memberId) {
      card.classList.add('hide');
      return;
    }
    card.classList.remove('hide');
    const mine = TRAINS.filter(function (t) { return t.isMine; });
    const active = mine.filter(function (t) { return t.status === 'active'; });
    $('mineLine').textContent = active.length
      ? active.length + (active.length === 1 ? ' engine' : ' engines') + ' registered to you'
      : 'Nothing registered to you in this view.';
    $('mineList').innerHTML = mine.length
      ? '<div class="inline-list">' + mine.map(function (t) {
          return '<span class="badge ghost">' + RR.esc(t.name) + ' &middot; ' + t.status + '</span>';
        }).join(' ') + '</div>'
      : '';
  }

  function wire() {
    const body = $('trainBody');
    const bind = function (attr, fn) {
      body.querySelectorAll('[' + attr + ']').forEach(function (b) {
        b.addEventListener('click', function () { fn(b.getAttribute(attr)); });
      });
    };
    bind('data-sell', sell);
    bind('data-repo', repossess);
    bind('data-strike', strike);
    bind('data-reinstate', reinstate);
  }

  function find(id) { return TRAINS.find(function (t) { return t.id === id; }); }

  // ------------------------------------------------------------- actions ---

  function sell(id) {
    const t = find(id); if (!t) return;
    const dlg = RR.modal(
      '<div class="modal-head"><h2>Sell back to the government</h2>'
      + '<p class="sub">' + RR.esc(t.name) + '</p></div>'
      + '<div class="modal-body">'
      + '<p class="muted">The registration is closed and the name is freed for reuse. '
      +   'Nothing is destroyed — it stays on the register as sold.</p>'
      + '<label class="field"><span>Price paid</span>'
      +   '<input id="sPrice" placeholder="e.g. 750" autofocus></label>'
      + '</div>'
      + '<div class="modal-foot"><span class="spacer"></span>'
      + '<button class="btn" data-close>Cancel</button>'
      + '<button class="btn primary" id="sellBtn">Sell back</button></div>'
    );
    dlg.querySelector('#sellBtn').addEventListener('click', async function () {
      try {
        await RR.post('api/trains.php', {
          action: 'sell', trainId: id, price: dlg.querySelector('#sPrice').value
        });
        dlg.close(); RR.toast('Sold back to the government.'); await load();
      } catch (e) { RR.toast(e.message, true); }
    });
  }

  function repossess(id) {
    const t = find(id); if (!t) return;
    const dlg = RR.modal(
      '<div class="modal-head"><h2>Repossess ' + RR.esc(t.name) + '</h2>'
      + '<p class="sub">Taken from ' + RR.esc(t.ownerName) + ' by the union.</p></div>'
      + '<div class="modal-body">'
      + '<p class="muted">The engine comes off them and off the active register. It stays '
      +   'in the record and can be reinstated, and the name frees up for reuse.</p>'
      + '<label class="field"><span>Reason (goes on the record)</span>'
      +   '<input id="rWhy" placeholder="Unpaid dues, misconduct&hellip;" autofocus></label>'
      + '</div>'
      + '<div class="modal-foot"><span class="spacer"></span>'
      + '<button class="btn" data-close>Cancel</button>'
      + '<button class="btn danger" id="repoBtn">Repossess</button></div>'
    );
    dlg.querySelector('#repoBtn').addEventListener('click', async function () {
      try {
        await RR.post('api/trains.php', {
          action: 'repossess', trainId: id, reason: dlg.querySelector('#rWhy').value
        });
        dlg.close(); RR.toast('Repossessed.'); await load();
      } catch (e) { RR.toast(e.message, true); }
    });
  }

  async function strike(id) {
    const t = find(id); if (!t) return;
    const ok = await RR.confirmDanger('Strike this registration?',
      '<p><strong>' + RR.esc(t.name) + '</strong> comes off the active register. '
      + 'It stays in the record and can be reinstated.</p>', 'Strike');
    if (!ok) return;
    try {
      await RR.post('api/trains.php', { action: 'delete', trainId: id });
      RR.toast('Struck from the register.'); await load();
    } catch (e) { RR.toast(e.message, true); }
  }

  async function reinstate(id) {
    try {
      await RR.post('api/trains.php', { action: 'reinstate', trainId: id });
      RR.toast('Back on the register.'); await load();
    } catch (e) { RR.toast(e.message, true); }
  }

  function openRegister() {
    const ownerField = PERMS.manager
      ? '<label class="field"><span>Registered to</span><select id="rOwner">'
        + '<option value="me">Me</option>'
        + MEMBERS.map(function (m) {
            return '<option value="' + RR.esc(m.id) + '">' + RR.esc(m.name) + '</option>';
          }).join('')
        + '</select></label>'
      : '';

    const dlg = RR.modal(
      '<div class="modal-head"><h2>Register a train</h2>'
      + '<p class="sub">One active registration per name.</p></div>'
      + '<div class="modal-body">'
      + '<label class="field"><span>Train name</span><input id="rName" autofocus></label>'
      + ownerField
      + '<label class="field"><span>Note</span><textarea id="rNote"></textarea></label>'
      + '</div>'
      + '<div class="modal-foot"><span class="spacer"></span>'
      + '<button class="btn" data-close>Cancel</button>'
      + '<button class="btn primary" id="regBtn">Register</button></div>'
    );
    dlg.querySelector('#regBtn').addEventListener('click', async function () {
      try {
        await RR.post('api/trains.php', {
          action: 'register',
          name: dlg.querySelector('#rName').value,
          ownerId: PERMS.manager ? dlg.querySelector('#rOwner').value : 'me',
          note: dlg.querySelector('#rNote').value
        });
        dlg.close(); RR.toast('Registered.'); await load();
      } catch (e) { RR.toast(e.message, true); }
    });
  }

  // --------------------------------------------------------------- boot ---

  RR.boot('trains').then(async function (me) {
    ME = me;
    PERMS = me.permissions;

    // Registering needs a roster name to hang the train on.
    const reg = $('registerBtn');
    if (PERMS.memberId || PERMS.manager) {
      reg.addEventListener('click', openRegister);
    } else {
      reg.classList.add('hide');
    }

    $('q').addEventListener('input', render);
    $('scope').addEventListener('change', function () { load().catch(showError); });

    await loadMembers();
    try { await load(); } catch (e) { showError(e); }
  });

  function showError(e) {
    $('trainBody').innerHTML =
      '<tr><td colspan="5" class="empty">' + RR.esc(e.message) + '</td></tr>';
  }
})();
