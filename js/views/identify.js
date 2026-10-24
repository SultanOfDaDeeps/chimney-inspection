'use strict';

// Optional identification lookup for a component. The search runs in a new browser tab;
// the app itself fetches nothing. You paste back identification sources, record what they
// say, and explicitly confirm a match before anything is applied to the component.
// Research stays internal: it is never shown in the customer preview.
const IdentifyDialog = (() => {
  const esc = U.esc;

  // Rejects links that look like stores, listings, or price pages.
  const SHOPPING = /(amazon\.|ebay\.|walmart\.|homedepot\.|lowes\.|menards\.|etsy\.|alibaba|aliexpress|wayfair|chimneylinerdepot|tbm=shop|[?&/](shop|store|cart|checkout|buy|pricing|price|prices|deals?|sale)([/?&#.=_-]|$)|shopping)/i;

  function isShoppingUrl(u) { return SHOPPING.test(u); }

  function buildTerms(c) {
    return [c.manufacturer, c.systemType, c.model, c.partId, c.category || '', 'chimney']
      .map(s => String(s || '').trim()).filter(Boolean)
      .filter((s, i, a) => a.findIndex(x => x.toLowerCase() === s.toLowerCase()) === i).join(' ');
  }

  // Query steers toward documentation and away from shopping pages.
  const searchUrl = (terms, docs) => 'https://duckduckgo.com/?q=' + encodeURIComponent(
    `${terms} ${docs ? 'installation manual filetype:pdf' : '(manual OR specifications OR installation)'} -price -buy -shop -sale -cart`);

  function open(component, onSaved) {
    const work = U.clone(component.ident);
    if (!work.terms) work.terms = buildTerms(component);
    const hasIds = component.manufacturer || component.systemType || component.model || component.serial || component.partId;

    U.modal({
      title: `Identify: ${Store.componentLabel(component)}`,
      wide: true,
      body: `
        <div class="notice">
          Lookup is optional and only helps identify the system or component. It does not diagnose a problem or choose a repair.
          Searches open in a new tab; this app does not fetch, store, or show prices, quotes, listings, or availability.
        </div>
        <h3>Entered identifiers</h3>
        <p>${hasIds ? esc([['Manufacturer', component.manufacturer], ['Type', component.systemType], ['Model', component.model], ['Serial', component.serial], ['Part', component.partId]]
          .filter(x => x[1]).map(x => `${x[0]}: ${x[1]}`).join(' · ')) : '<span class="muted">None entered yet — add a manufacturer, model, or part number on the component first for better results.</span>'}</p>

        <div class="field"><label for="id-terms">Search terms</label><input id="id-terms" value="${esc(work.terms)}"></div>
        <div class="btn-row">
          <button type="button" data-act="search">Search the web ↗</button>
          <button type="button" data-act="search-docs">Search for documentation (PDF) ↗</button>
        </div>

        <h3>Identification sources</h3>
        <p class="muted small">Paste links to manufacturer pages, listings in product documentation, or installation manuals. Store and listing links are not accepted.</p>
        <ul class="src-list" id="id-sources"></ul>
        <div class="src-add">
          <input id="id-url" type="url" placeholder="https://…" aria-label="Source URL">
          <input id="id-label" placeholder="Short label (optional)" aria-label="Source label">
          <button type="button" data-act="add-src">Add source</button>
        </div>
        <p class="form-error" id="id-err" role="alert" hidden></p>

        <h3>What the sources indicate</h3>
        <div class="grid3">
          <div class="field"><label for="id-man">Manufacturer</label><input id="id-man" value="${esc(work.manufacturer)}"></div>
          <div class="field"><label for="id-fam">Product family / system</label><input id="id-fam" value="${esc(work.productFamily)}"></div>
          <div class="field"><label for="id-type">Component type</label><input id="id-type" value="${esc(work.componentType)}"></div>
        </div>
        <div class="field is-private"><label for="id-notes">Research notes <span class="tag private-tag">Private</span></label>
          <textarea id="id-notes" rows="2" placeholder="Identification details only — do not record prices.">${esc(work.notes)}</textarea></div>

        <fieldset class="field">
          <legend>Match status</legend>
          <label class="check"><input type="radio" name="id-status" value="" ${!work.status ? 'checked' : ''}> Not decided yet</label>
          <label class="check"><input type="radio" name="id-status" value="confirmed" ${work.status === 'confirmed' ? 'checked' : ''}> I confirm this matches the component on site</label>
          <label class="check"><input type="radio" name="id-status" value="uncertain" ${work.status === 'uncertain' ? 'checked' : ''}> Uncertain — keep identifiers as entered</label>
        </fieldset>

        <div id="id-apply" hidden>
          <h3>Apply confirmed match to the component</h3>
          <p class="muted small">Choose which values to copy into the component fields. Nothing is changed unless you check it.</p>
          <div id="id-apply-list"></div>
        </div>

        <div class="modal-actions">
          <button type="button" data-close>Cancel</button>
          <button type="button" class="primary" data-act="save">Save</button>
        </div>`,
      onMount: (dlg, close) => {
        const $ = s => U.$(s, dlg);
        const err = $('#id-err');
        const showErr = m => { err.textContent = m; err.hidden = !m; };

        const drawSources = () => {
          $('#id-sources').innerHTML = work.sources.map((s, i) => `<li>
            <a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.label || s.url)}</a>
            <span class="muted small">${esc(new URL(s.url).hostname)}</span>
            <button type="button" class="icon-btn" data-act="rm-src" data-i="${i}" aria-label="Remove source">✕</button></li>`).join('')
            || '<li class="muted small">No sources yet.</li>';
        };

        const applyRows = () => [
          ['manufacturer', 'Manufacturer', $('#id-man').value.trim()],
          ['systemType', 'System / product type', $('#id-fam').value.trim()],
          ['category', 'Component', $('#id-type').value.trim()],
        ].filter(([k, , v]) => v && v !== component[k]);

        const drawApply = () => {
          const status = dlg.querySelector('input[name=id-status]:checked').value;
          const rows = applyRows();
          $('#id-apply').hidden = status !== 'confirmed' || !rows.length;
          $('#id-apply-list').innerHTML = rows.map(([k, label, v]) => `<label class="check">
            <input type="checkbox" data-apply="${k}"> ${esc(label)}: <strong>${esc(v)}</strong>
            <span class="muted small">(currently ${component[k] ? `“${esc(component[k])}”` : 'empty'})</span></label>`).join('');
        };

        drawSources();
        drawApply();
        dlg.addEventListener('input', e => { if (['id-man', 'id-fam', 'id-type'].includes(e.target.id)) drawApply(); });
        dlg.addEventListener('change', e => { if (e.target.name === 'id-status') drawApply(); });

        const addSource = () => {
          const raw = $('#id-url').value.trim();
          let u;
          try { u = new URL(raw); } catch (e) { showErr('Enter a full link starting with https://'); return; }
          if (!/^https?:$/.test(u.protocol)) { showErr('Only http(s) links are allowed.'); return; }
          if (isShoppingUrl(u.href)) { showErr('That looks like a store, listing, or price page. Only identification sources are kept.'); return; }
          if (work.sources.some(s => s.url === u.href)) { showErr('That source is already listed.'); return; }
          work.sources.push({ url: u.href, label: $('#id-label').value.trim() });
          $('#id-url').value = ''; $('#id-label').value = '';
          showErr('');
          drawSources();
          $('#id-url').focus();
        };
        $('#id-url').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addSource(); } });

        dlg.addEventListener('click', e => {
          const b = e.target.closest('[data-act]');
          if (!b) return;
          const act = b.dataset.act;
          if (act === 'search' || act === 'search-docs') {
            const terms = $('#id-terms').value.trim();
            if (!terms) { showErr('Enter some search terms first.'); return; }
            window.open(searchUrl(terms, act === 'search-docs'), '_blank', 'noopener,noreferrer');
          }
          if (act === 'add-src') addSource();
          if (act === 'rm-src') { work.sources.splice(Number(b.dataset.i), 1); drawSources(); }
          if (act === 'save') {
            const status = dlg.querySelector('input[name=id-status]:checked').value;
            if (status === 'confirmed' && !work.sources.length) { showErr('Add at least one source link before confirming a match.'); return; }
            Object.assign(work, {
              terms: $('#id-terms').value.trim(),
              manufacturer: $('#id-man').value.trim(),
              productFamily: $('#id-fam').value.trim(),
              componentType: $('#id-type').value.trim(),
              notes: $('#id-notes').value,
              status,
              confirmedAt: status === 'confirmed' ? (work.confirmedAt || new Date().toISOString()) : '',
            });
            if (status === 'confirmed') {
              const values = Object.fromEntries(applyRows().map(([k, , v]) => [k, v]));
              U.$$('[data-apply]', dlg).forEach(cb => { if (cb.checked) component[cb.dataset.apply] = values[cb.dataset.apply]; });
            }
            component.ident = work;
            close();
            onSaved();
            U.toast('Identification saved');
          }
        });
        $('#id-terms').focus();
      },
    });
  }

  return { open, isShoppingUrl };
})();
