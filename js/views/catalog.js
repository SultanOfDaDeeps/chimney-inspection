'use strict';

// Catalog management for findings and repair recommendations.
// Estimates copy catalog text when an item is added, so edits here never touch saved estimates.
const CatalogView = (() => {
  const esc = U.esc;
  const LABEL = { findings: 'Findings', repairs: 'Repair recommendations', sizes: 'Sizes' };
  const ONE = { findings: 'finding', repairs: 'repair' };
  const KIND = { findings: 'FND', repairs: 'FIX' };
  const OTHER = { findings: 'repairs', repairs: 'findings' };
  const state = { findings: { q: '', cat: '', sys: '' }, repairs: { q: '', cat: '', sys: '' } };
  const sysBadge = i => (i.appliesTo.length ? i.appliesTo : ['wood', 'gas'])
    .map(t => `<span class="badge sys-${t}">${esc((SYSTEM_TYPES.find(([v]) => v === t) || [t, t])[1])}</span>`).join(' ');

  const tabs = store => `<nav class="tabs" aria-label="Catalog">
    ${['findings', 'repairs', 'sizes'].map(s => `<a href="#/catalog/${s}" ${s === store ? 'aria-current="page" class="active"' : ''}>${LABEL[s]}</a>`).join('')}
  </nav>`;

  async function showList(store, mount) {
    const [items, others] = await Promise.all([Store.catalog(store), Store.catalog(OTHER[store])]);
    items.sort((a, b) => a.code.localeCompare(b.code));
    const otherById = Object.fromEntries(others.map(o => [o.id, o]));
    const cats = [...new Set(items.map(i => i.category).filter(Boolean))].sort();
    const st = state[store];
    mount.innerHTML = `
      <div class="page-head">
        <h1>Catalog</h1>
        <div class="actions"><a class="btn primary" href="#/catalog/${store}/new">+ New ${ONE[store]}</a></div>
      </div>
      ${tabs(store)}
      <p class="muted small">${store === 'findings'
        ? 'Findings describe what you observed. Link them to the repairs you usually propose.'
        : 'Repair recommendations describe proposed work. Use internal detail fields for anything the customer should not see.'}
        Changes here never alter estimates you have already saved.</p>
      <div class="toolbar">
        <label class="search"><span class="sr-only">Search ${LABEL[store]}</span>
          <input type="search" id="cat-q" value="${esc(st.q)}" placeholder="Search code, name, description…  ( / )"></label>
        <label><span class="sr-only">Category</span>
          <select id="cat-f"><option value="">All components</option>
            ${cats.map(c => `<option ${c === st.cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
        <label><span class="sr-only">System type</span>
          <select id="cat-sys"><option value="">All systems</option>
            ${SYSTEM_TYPES.map(([v, l]) => `<option value="${v}" ${v === st.sys ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <div id="cat-list"></div>`;

    const list = U.$('#cat-list', mount);
    const draw = () => {
      const rows = items.filter(i => (!st.cat || i.category === st.cat) && Store.appliesTo(i, st.sys)
        && U.matches(st.q, [i.code, i.name, i.description, i.category, i.systemType, i.privateNotes]));
      if (!items.length) {
        list.innerHTML = `<div class="empty-state"><h2>No ${LABEL[store].toLowerCase()} yet</h2>
          <p>Create reusable entries so estimates take seconds to build.</p>
          <a class="btn primary" href="#/catalog/${store}/new">+ New ${ONE[store]}</a></div>`;
        return;
      }
      if (!rows.length) { list.innerHTML = '<div class="empty-state"><p>No entries match.</p></div>'; return; }
      // Group by component category for scanning.
      const groups = {};
      rows.forEach(r => { (groups[r.category || 'Uncategorized'] ||= []).push(r); });
      list.innerHTML = Object.keys(groups).sort().map(g => `
        <h3 class="group-head">${esc(g)}</h3>
        <ul class="cat-list">${groups[g].map(i => {
          const rel = i.relatedIds.map(id => otherById[id]).filter(Boolean);
          return `<li><a class="cat-row" href="#/catalog/${store}/${esc(i.id)}">
            <span class="code">${esc(i.code)}</span>
            <span class="cat-main"><span><strong>${esc(i.name)}</strong>${i.systemType ? ` <span class="muted small">· ${esc(i.systemType)}</span>` : ''} ${sysBadge(i)}</span>
              <span class="pick-desc">${esc(i.description)}</span>
              ${rel.length ? `<span class="small muted">→ ${rel.map(r => esc(r.code)).join(', ')}</span>` : ''}</span>
          </a></li>`;
        }).join('')}</ul>`).join('');
    };
    draw();
    U.$('#cat-q', mount).addEventListener('input', e => { st.q = e.target.value; draw(); });
    U.$('#cat-f', mount).addEventListener('change', e => { st.cat = e.target.value; draw(); });
    U.$('#cat-sys', mount).addEventListener('change', e => { st.sys = e.target.value; draw(); });
  }

  async function showItem(store, id, mount) {
    const [items, others] = await Promise.all([Store.catalog(store), Store.catalog(OTHER[store])]);
    const isNew = id === 'new';
    const item = isNew
      ? { id: U.uid(), code: '', name: '', description: '', category: '', systemType: '', fields: [], assumptions: '', exclusions: '', privateNotes: '', relatedIds: [], appliesTo: [], createdAt: new Date().toISOString() }
      : items.find(i => i.id === id);
    if (!item) {
      mount.innerHTML = `<div class="empty-state"><h2>Catalog entry not found</h2><a class="btn" href="#/catalog/${store}">Back to catalog</a></div>`;
      return;
    }
    const prevRelated = [...item.relatedIds];
    const fields = U.clone(item.fields || []);
    const related = new Set(item.relatedIds);
    const cats = new Set(CATEGORIES.map(c => c[0]));
    [...items, ...others].forEach(i => i.category && cats.add(i.category));
    others.sort((a, b) => a.code.localeCompare(b.code));
    const isRepair = store === 'repairs';

    mount.innerHTML = `
      <div class="page-head">
        <div><a class="back" href="#/catalog/${store}">← ${LABEL[store]}</a>
          <h1>${isNew ? `New ${ONE[store]}` : esc(item.code + ' · ' + item.name)}</h1></div>
      </div>
      <form id="cat-form" class="card" novalidate>
        <datalist id="cat-cats">${[...cats].map(c => `<option value="${esc(c)}">`).join('')}</datalist>
        <div class="grid3">
          <div class="field"><label for="ci-cat">Component category <span class="req">*</span></label>
            <input id="ci-cat" name="category" list="cat-cats" required value="${esc(item.category)}"></div>
          <div class="field"><label for="ci-code">Identifier <span class="req">*</span></label>
            <input id="ci-code" name="code" required value="${esc(item.code)}" placeholder="e.g. CRN-${KIND[store]}-01" autocapitalize="characters">
            <small class="hint">Short, unique, searchable.</small></div>
          <div class="field"><label for="ci-sys">Model / system type <span class="opt">optional</span></label>
            <input id="ci-sys" name="systemType" value="${esc(item.systemType)}" placeholder="e.g. Masonry, factory-built"></div>
          <fieldset class="field span3"><legend>Applies to system types</legend>
            <div>${SYSTEM_TYPES.map(([v, l]) => `<label class="check"><input type="checkbox" name="appliesTo" value="${v}" ${item.appliesTo.includes(v) ? 'checked' : ''}> ${l}</label>`).join(' ')}</div>
            <small class="hint">Leave both unchecked to offer it for every system.</small></fieldset>
          <div class="field span3"><label for="ci-name">Name <span class="req">*</span></label>
            <input id="ci-name" name="name" required value="${esc(item.name)}"></div>
          <div class="field span3"><label for="ci-desc">Customer-facing description <span class="req">*</span></label>
            <textarea id="ci-desc" name="description" rows="3" required>${esc(item.description)}</textarea>
            <small class="hint">${isRepair ? 'Describe the proposed work. Avoid promises, timelines, or warranties you would not make on every job.' : 'Describe what is observed — keep the cause and the fix out of the finding.'}</small></div>
          ${isRepair ? `<div class="field span3"><label for="ci-purpose">Why it matters <span class="opt">optional, customer-facing</span></label>
            <textarea id="ci-purpose" name="purpose" rows="2">${esc(item.purpose)}</textarea>
            <small class="hint">One general sentence on what this work does, used in the proposed-work description. Keep it true for every job.</small></div>`
          : `<div class="field span3"><label for="ci-risk">Why it matters <span class="opt">optional, customer-facing</span></label>
            <textarea id="ci-risk" name="risk" rows="2">${esc(item.risk)}</textarea>
            <small class="hint">What this condition can lead to, in general terms. Shown only when the finding is marked Confirmed. Don't state a cause or a code requirement.</small></div>`}
        </div>

        <h3>${isRepair ? 'Detail fields (material, dimensions, finish…)' : 'Measurement fields'} <span class="opt">optional</span></h3>
        <p class="muted small">These appear as empty fields when the item is added to an estimate.${isRepair ? ' Mark a field “Internal” to keep it out of the customer version.' : ''}</p>
        <div id="ci-fields"></div>
        <button type="button" class="small" data-act="add-field">+ Add field</button>

        <div class="grid2">
          <div class="field"><label for="ci-ass">Assumptions <span class="opt">optional</span></label>
            <textarea id="ci-ass" name="assumptions" rows="3">${esc(item.assumptions)}</textarea><small class="hint">One per line. Customer-facing.</small></div>
          <div class="field"><label for="ci-exc">Exclusions <span class="opt">optional</span></label>
            <textarea id="ci-exc" name="exclusions" rows="3">${esc(item.exclusions)}</textarea><small class="hint">One per line. Customer-facing.</small></div>
          <div class="field span2 is-private"><label for="ci-priv">Private notes <span class="tag private-tag">Private</span></label>
            <textarea id="ci-priv" name="privateNotes" rows="2">${esc(item.privateNotes)}</textarea>
            <small class="hint">Copied into the estimate's private note. Never shown to the customer.</small></div>
        </div>

        <h3>Suggested ${OTHER[store] === 'repairs' ? 'repairs for this finding' : 'for these findings'}</h3>
        <input type="search" id="ci-rel-q" placeholder="Filter…" aria-label="Filter related items" class="narrow">
        <div id="ci-rel" class="rel-list"></div>

        <p class="form-error" role="alert" hidden></p>
        <div class="form-actions">
          ${isNew ? '' : '<button type="button" class="danger" data-act="delete">Delete</button>'}
          <span class="spacer"></span>
          <a class="btn" href="#/catalog/${store}">Cancel</a>
          <button type="submit" class="primary">Save ${ONE[store]}</button>
        </div>
      </form>`;

    const form = U.$('#cat-form', mount);
    const fieldsEl = U.$('#ci-fields', mount);
    const drawFields = () => {
      fieldsEl.innerHTML = fields.map((f, i) => `<div class="vrow ${f.internal ? 'is-private' : ''}">
        <input aria-label="Field label" placeholder="Label, e.g. Diameter" data-fi="${i}" data-k="label" value="${esc(f.label)}">
        <input aria-label="Unit" placeholder="Unit" data-fi="${i}" data-k="unit" value="${esc(f.unit)}" class="u">
        ${isRepair ? `<label class="check small"><input type="checkbox" data-fi="${i}" data-k="internal" ${f.internal ? 'checked' : ''}> Internal</label>` : ''}
        <button type="button" class="icon-btn" data-act="rm-field" data-i="${i}" aria-label="Remove field">✕</button></div>`).join('')
        || '<p class="muted small">No fields.</p>';
    };
    const relEl = U.$('#ci-rel', mount);
    const drawRel = () => {
      const q = U.$('#ci-rel-q', mount).value;
      const cat = U.$('#ci-cat', mount).value.trim().toLowerCase();
      const list = others.filter(o => U.matches(q, [o.code, o.name, o.category]))
        .sort((a, b) => (b.category.toLowerCase() === cat) - (a.category.toLowerCase() === cat) || a.code.localeCompare(b.code));
      relEl.innerHTML = list.map(o => `<label class="check"><input type="checkbox" value="${esc(o.id)}" ${related.has(o.id) ? 'checked' : ''}>
        <span class="code">${esc(o.code)}</span> ${esc(o.name)} <span class="muted small">${esc(o.category)}</span></label>`).join('')
        || `<p class="muted small">No ${OTHER[store]} in the catalog yet.</p>`;
    };
    drawFields();
    drawRel();
    U.$('#ci-rel-q', mount).addEventListener('input', drawRel);
    relEl.addEventListener('change', e => { if (e.target.checked) related.add(e.target.value); else related.delete(e.target.value); });
    fieldsEl.addEventListener('input', e => {
      const { fi, k } = e.target.dataset;
      if (fi === undefined) return;
      fields[fi][k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      if (k === 'internal') e.target.closest('.vrow').classList.toggle('is-private', e.target.checked);
    });
    // Suggest the next free code once a category is chosen.
    U.$('#ci-cat', mount).addEventListener('change', e => {
      drawRel();
      const codeEl = U.$('#ci-code', mount);
      if (codeEl.value.trim() || !e.target.value.trim()) return;
      const base = `${prefixFor(e.target.value)}-${KIND[store]}-`;
      let n = 1;
      while (items.some(i => i.code.toUpperCase() === base + String(n).padStart(2, '0'))) n++;
      codeEl.value = base + String(n).padStart(2, '0');
    });

    mount.addEventListener('click', async e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'add-field') {
        fields.push({ label: '', unit: '', internal: false });
        drawFields();
        U.$$('[data-k=label]', fieldsEl).pop().focus();
      }
      if (b.dataset.act === 'rm-field') { fields.splice(Number(b.dataset.i), 1); drawFields(); }
      if (b.dataset.act === 'delete') {
        if (!await U.confirm(`Delete ${item.code} “${item.name}” from the catalog? Saved estimates are not affected.`)) return;
        await Store.deleteCatalogItem(store, item);
        U.toast('Catalog entry deleted');
        location.hash = `#/catalog/${store}`;
      }
    });

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(form);
      const data = Object.fromEntries(fd.entries());
      data.appliesTo = fd.getAll('appliesTo');
      data.code = data.code.trim().toUpperCase().replace(/\s+/g, '-');
      ['name', 'category', 'systemType'].forEach(k => { data[k] = data[k].trim(); });
      const errs = [];
      form.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
      const bad = (name, msg) => { errs.push(msg); form.elements[name].setAttribute('aria-invalid', 'true'); };
      if (!data.category) bad('category', 'Choose a component category.');
      if (!data.code) bad('code', 'Enter an identifier.');
      else if (items.some(i => i.id !== item.id && i.code.toUpperCase() === data.code)) bad('code', `Identifier ${data.code} is already used.`);
      if (!data.name) bad('name', 'Enter a name.');
      if (!data.description.trim()) bad('description', 'Enter a customer-facing description.');
      const err = U.$('.form-error', form);
      if (errs.length) { err.textContent = errs.join(' '); err.hidden = false; form.querySelector('[aria-invalid]').focus(); return; }
      Object.assign(item, data, {
        fields: fields.filter(f => f.label.trim()).map(f => ({ label: f.label.trim(), unit: f.unit.trim(), internal: !!f.internal })),
        relatedIds: [...related],
      });
      await Store.saveCatalogItem(store, item, prevRelated);
      U.toast(`Saved ${item.code}`);
      location.hash = `#/catalog/${store}`;
    });

    if (isNew) U.$('#ci-cat', mount).focus();
  }

  // Size library editor (Catalog → Sizes). Saved estimates keep the sizes they already have.
  async function showSizes(mount) {
    const lib = await Sizes.all();
    const cats = [...new Set([...CATEGORIES.map(c => c[0]), ...lib.map(g => g.category)])];
    mount.innerHTML = `
      <div class="page-head"><h1>Catalog</h1></div>
      ${tabs('sizes')}
      <p class="muted small">Standard sizes appear as quick choices when you add a problem or fill in a measurement for that component.
        A measurement row uses a size list when its label matches the size name or one of its other names. Separate choices with commas.
        Editing this never changes estimates you've already saved.</p>
      <datalist id="size-cats">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
      <form id="sizes-form" novalidate><div id="size-groups"></div>
        <div class="btn-row"><button type="button" data-act="add-group">+ Add component</button></div>
        <p class="form-error" role="alert" hidden></p>
        <div class="form-actions">
          <button type="button" class="danger" data-act="reset">Restore starter sizes</button>
          <span class="spacer"></span><button type="submit" class="primary">Save sizes</button>
        </div>
      </form>`;
    const host = U.$('#size-groups', mount);
    const draw = () => {
      host.innerHTML = lib.map((g, gi) => `<section class="card size-group">
        <div class="item-head"><input aria-label="Component" list="size-cats" data-g="${gi}" data-k="category" value="${esc(g.category)}" class="narrow" placeholder="Component">
          <span class="spacer"></span><button type="button" class="icon-btn danger" data-act="rm-group" data-g="${gi}" aria-label="Remove component">✕</button></div>
        ${g.types.map((t, ti) => `<div class="size-type">
          <input aria-label="Size name" placeholder="Size name, e.g. Flue size" data-g="${gi}" data-t="${ti}" data-k="label" value="${esc(t.label)}">
          <input aria-label="Unit" placeholder="Unit" class="u" data-g="${gi}" data-t="${ti}" data-k="unit" value="${esc(t.unit)}">
          <input aria-label="Choices" placeholder="Choices, comma separated" class="opts" data-g="${gi}" data-t="${ti}" data-k="options" value="${esc(t.options.join(', '))}">
          <input aria-label="Other names" placeholder="Other names (optional)" class="aliases" data-g="${gi}" data-t="${ti}" data-k="aliases" value="${esc((t.aliases || []).join(', '))}">
          <button type="button" class="icon-btn" data-act="rm-type" data-g="${gi}" data-t="${ti}" aria-label="Remove size">✕</button></div>`).join('')}
        <button type="button" class="small" data-act="add-type" data-g="${gi}">+ Add size</button>
      </section>`).join('') || '<div class="empty-state"><p>No sizes yet.</p></div>';
    };
    draw();
    const split = v => [...new Set(v.split(',').map(x => x.trim()).filter(Boolean))];
    host.addEventListener('input', e => {
      const { g, t, k } = e.target.dataset;
      if (g === undefined) return;
      if (t === undefined) lib[g][k] = e.target.value;
      else lib[g].types[t][k] = k === 'options' || k === 'aliases' ? split(e.target.value) : e.target.value;
    });
    mount.addEventListener('click', async e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const { act, g, t } = b.dataset;
      if (act === 'add-group') { lib.push({ category: '', types: [{ label: '', unit: 'in', options: [], aliases: [] }] }); draw(); U.$$('[data-k=category]', host).pop().focus(); }
      if (act === 'rm-group' && await U.confirm(`Remove all sizes for ${lib[g].category || 'this component'}?`)) { lib.splice(g, 1); draw(); }
      if (act === 'add-type') { lib[g].types.push({ label: '', unit: '', options: [], aliases: [] }); draw(); }
      if (act === 'rm-type') { lib[g].types.splice(t, 1); draw(); }
      if (act === 'reset' && await U.confirm('Replace your size lists with the starter sizes?')) {
        await Sizes.save(Sizes.starter()); U.toast('Starter sizes restored');
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      }
    });
    U.$('#sizes-form', mount).addEventListener('submit', async e => {
      e.preventDefault();
      const err = U.$('.form-error', mount);
      const cleaned = lib.map(gr => ({ category: gr.category.trim(), types: gr.types.filter(x => x.label.trim()).map(x => ({ ...x, label: x.label.trim(), unit: x.unit.trim() })) }))
        .filter(gr => gr.category || gr.types.length);
      if (cleaned.some(gr => !gr.category)) { err.textContent = 'Give each group a component name.'; err.hidden = false; return; }
      err.hidden = true;
      await Sizes.save(cleaned);
      U.toast('Sizes saved');
    });
  }

  return { showList, showItem, showSizes };
})();
