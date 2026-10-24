'use strict';

// Estimates list: search, status filter, open / preview / duplicate / delete.
const EstimatesView = (() => {
  const esc = U.esc;
  let state = { q: '', status: '' };

  const searchFields = e => [
    e.number, e.title, e.customer.name, e.customer.phone, e.customer.email, e.jobAddress, e.clientNote,
    ...e.components.flatMap(c => [
      c.category, c.location, c.appliance, c.manufacturer, c.systemType, c.model, c.partId,
      ...c.findings.flatMap(f => [f.code, f.name, ...f.repairs.flatMap(r => [r.code, r.name])]),
    ]),
  ];

  async function show(mount) {
    const all = (await DB.getAll('estimates')).map(Store.normalize)
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    mount.innerHTML = `
      <div class="page-head">
        <h1>Estimates</h1>
        <div class="actions"><button class="primary" data-action="new" title="Shortcut: N">+ New estimate</button></div>
      </div>
      <div class="toolbar">
        <label class="search">
          <span class="sr-only">Search estimates</span>
          <input type="search" id="est-q" placeholder="Search customer, address, code, component…  ( / )" value="${esc(state.q)}">
        </label>
        <label>
          <span class="sr-only">Status</span>
          <select id="est-status">
            <option value="">All statuses</option>
            <option value="draft" ${state.status === 'draft' ? 'selected' : ''}>Draft</option>
            <option value="presented" ${state.status === 'presented' ? 'selected' : ''}>Presented</option>
          </select>
        </label>
      </div>
      <div id="est-list"></div>`;

    const list = U.$('#est-list', mount);
    const renderList = () => {
      const rows = all.filter(e => (!state.status || e.status === state.status) && U.matches(state.q, searchFields(e)));
      if (!all.length) {
        list.innerHTML = `<div class="empty-state">
          <h2>No estimates yet</h2>
          <p>Start one while you're talking with the customer — you only need a name and a date to begin.</p>
          <button class="primary" data-action="new">+ New estimate</button></div>`;
        return;
      }
      if (!rows.length) {
        list.innerHTML = `<div class="empty-state"><p>No estimates match your search.</p></div>`;
        return;
      }
      list.innerHTML = `<ul class="est-list">${rows.map(e => {
        const nF = e.components.reduce((n, c) => n + c.findings.length, 0);
        const nR = e.components.reduce((n, c) => n + c.findings.reduce((m, f) => m + f.repairs.length, 0), 0);
        const comps = [...new Set(e.components.map(c => c.category).filter(Boolean))].join(', ');
        return `<li class="est-row">
          <a class="est-main" href="#/estimates/${esc(e.id)}">
            <span class="est-title">${esc(e.customer.name || 'Unnamed customer')}${e.title ? ` · <span class="muted">${esc(e.title)}</span>` : ''}</span>
            <span class="est-sub">${esc(e.jobAddress || 'No address')} · ${esc(U.fmtDate(e.date))} · ${esc(e.number)}</span>
            <span class="est-sub">${nF} finding${nF === 1 ? '' : 's'}, ${nR} repair${nR === 1 ? '' : 's'}${comps ? ` · ${esc(comps)}` : ''}</span>
          </a>
          ${String(e.clientNote || '').trim() ? '<span class="tag private-tag" title="Has a private note">Private note</span>' : ''}
          <span class="badge ${esc(e.status)}">${e.status === 'presented' ? 'Presented' : 'Draft'}</span>
          <div class="row-actions">
            <a class="btn small" href="#/estimates/${esc(e.id)}/preview">Preview</a>
            <button class="small" data-action="dup" data-id="${esc(e.id)}">Duplicate</button>
            <button class="small danger" data-action="del" data-id="${esc(e.id)}">Delete</button>
          </div>
        </li>`;
      }).join('')}</ul>`;
    };
    renderList();

    U.$('#est-q', mount).addEventListener('input', e => { state.q = e.target.value; renderList(); });
    U.$('#est-status', mount).addEventListener('change', e => { state.status = e.target.value; renderList(); });
    mount.addEventListener('click', async e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const { action, id } = btn.dataset;
      if (action === 'new') openNew();
      if (action === 'dup') {
        const copy = await Store.duplicateEstimate(id);
        U.toast(`Duplicated as ${copy.number}`);
        location.hash = `#/estimates/${copy.id}`;
      }
      if (action === 'del') {
        const est = all.find(x => x.id === id);
        if (!await U.confirm(`Delete estimate ${est.number} for ${est.customer.name || 'unnamed customer'}? This also deletes its photos and cannot be undone.`)) return;
        await Store.deleteEstimate(id);
        all.splice(all.indexOf(est), 1);
        renderList();
        U.toast('Estimate deleted');
      }
    });
  }

  // Step 1 of the workflow: customer + job basics, then straight into the editor.
  function openNew() {
    U.modal({
      title: 'New estimate',
      body: `<form id="new-est" novalidate>
        <div class="grid2">
          <div class="field"><label for="ne-name">Customer name <span class="req">*</span></label>
            <input id="ne-name" name="name" required autocomplete="off"></div>
          <div class="field"><label for="ne-date">Date <span class="req">*</span></label>
            <input id="ne-date" name="date" type="date" required value="${U.today()}"></div>
          <div class="field"><label for="ne-phone">Phone</label><input id="ne-phone" name="phone" type="tel" autocomplete="off"></div>
          <div class="field"><label for="ne-email">Email</label><input id="ne-email" name="email" type="email" autocomplete="off"></div>
          <div class="field span2"><label for="ne-addr">Job address</label><input id="ne-addr" name="jobAddress" autocomplete="off"></div>
        </div>
        <p class="hint">Next you'll choose the system type. The project title is generated once the problems and repairs are in.</p>
        <p class="form-error" role="alert" hidden></p>
        <div class="modal-actions"><button type="button" data-close>Cancel</button><button class="primary" type="submit">Start estimate</button></div>
      </form>`,
      onMount: (dlg, close) => {
        const form = U.$('#new-est', dlg);
        U.$('#ne-name', dlg).focus();
        form.addEventListener('submit', async ev => {
          ev.preventDefault();
          const data = Object.fromEntries(new FormData(form).entries());
          for (const k in data) data[k] = data[k].trim();
          const errors = [];
          form.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
          if (!data.name) { errors.push('Enter the customer name.'); form.name.setAttribute('aria-invalid', 'true'); }
          if (!data.date) { errors.push('Choose a date.'); form.date.setAttribute('aria-invalid', 'true'); }
          if (data.email && !form.email.checkValidity()) { errors.push('Email address looks incomplete.'); form.email.setAttribute('aria-invalid', 'true'); }
          const err = U.$('.form-error', form);
          if (errors.length) { err.textContent = errors.join(' '); err.hidden = false; form.querySelector('[aria-invalid]').focus(); return; }
          const est = await Store.createEstimate(data);
          close();
          location.hash = `#/estimates/${est.id}`;
        });
      },
    });
  }

  return { show, openNew };
})();
