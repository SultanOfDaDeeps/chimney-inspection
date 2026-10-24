'use strict';

// Business details, estimate wording, and backup / restore.
const SettingsView = (() => {
  const esc = U.esc;

  async function show(mount) {
    const s = await Store.settings();
    const ai = await AI.config();
    const aiMode = await AI.mode();
    const f = (name, label, opts = {}) => `<div class="field ${opts.cls || ''}"><label for="s-${name}">${label}</label>
      ${opts.textarea ? `<textarea id="s-${name}" name="${name}" rows="${opts.rows || 3}">${esc(s[name])}</textarea>`
        : `<input id="s-${name}" name="${name}" type="${opts.type || 'text'}" value="${esc(s[name])}">`}
      ${opts.hint ? `<small class="hint">${esc(opts.hint)}</small>` : ''}</div>`;

    mount.innerHTML = `
      <div class="page-head"><h1>Settings</h1></div>
      <form id="settings" class="card" novalidate>
        <h2>Business details</h2>
        <p class="muted small">Shown in the header of the customer estimate. Leave anything blank to omit it.</p>
        <div class="grid3">
          ${f('businessName', 'Business name', { cls: 'span2' })}
          ${f('contactName', 'Your name')}
          ${f('phone', 'Phone', { type: 'tel' })}
          ${f('email', 'Email', { type: 'email' })}
          ${f('website', 'Website')}
          ${f('address', 'Business address', { textarea: true, rows: 2, cls: 'span2' })}
          ${f('license', 'License / certification', { hint: 'Optional' })}
        </div>
        <h2>Estimate wording</h2>
        <div class="grid3">
          ${f('numberPrefix', 'Estimate number prefix', { hint: 'e.g. EST → EST-2026-0001' })}
          ${f('notice', 'Coverage notice (shown near the top of every estimate)', { textarea: true, rows: 3, cls: 'span3', hint: 'Explains that only the listed items are addressed. “Pricing is not included” is added unless you show prices on that estimate.' })}
          ${f('footer', 'Closing note (optional)', { textarea: true, rows: 2, cls: 'span3', hint: 'e.g. how to reach you with questions.' })}
        </div>
        <h2>Discount categories</h2>
        <div class="field"><label for="s-discountCategories">One per line</label>
          <textarea id="s-discountCategories" name="discountCategories" rows="4">${esc(s.discountCategories.join('\n'))}</textarea>
          <small class="hint">Offered on each estimate's discount picker. Amounts are entered per estimate, only when you choose.</small></div>
        <p class="form-error" role="alert" hidden></p>
        <div class="form-actions"><span class="spacer"></span><button class="primary" type="submit">Save settings</button></div>
      </form>

      ${aiMode === 'hosted' ? `<section class="card">
        <h2>Photo analysis <span class="opt">optional</span></h2>
        <p class="small">✓ Photo analysis is on in this hosted page. It uses Claude on your claude.ai account, so no API key is needed;
          the first time, you're asked to allow this page to use Claude.</p>
        <p class="small muted">Each analysis sends the photo plus your catalog's component and finding names; customer details are not sent.
          Suggestions are never used until you confirm them.</p>
      </section>` : `<form id="ai-settings" class="card" novalidate>
        <h2>Photo analysis <span class="opt">optional</span></h2>
        <p class="small">With an Anthropic API key, photos get suggestions for the component, label (manufacturer/model), and visible condition,
          which you confirm or correct. Without one, photos are still attached and you choose everything manually.</p>
        <p class="small muted">The photo and your catalog's finding names are sent to Anthropic's API for each analysis; customer details are not.
          The key is stored only in this browser and is not included in backups. Usage is billed to your Anthropic account.</p>
        <div class="grid3">
          <div class="field span2"><label for="ai-key">Anthropic API key</label>
            <input id="ai-key" name="apiKey" type="password" autocomplete="off" spellcheck="false" placeholder="${ai.apiKey ? 'Saved — enter a new key to replace it' : 'sk-ant-…'}"></div>
          <div class="field"><label for="ai-model">Model</label>
            <select id="ai-model" name="model">${AI.MODELS.map(([v, l]) => `<option value="${v}" ${v === ai.model ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
        </div>
        <p class="small" id="ai-status">${ai.apiKey ? '✓ Photo analysis is on.' : 'Photo analysis is off.'}</p>
        <p class="form-error" role="alert" hidden></p>
        <div class="form-actions">
          ${ai.apiKey ? '<button type="button" class="danger" data-act="ai-remove">Remove key</button>' : ''}
          <span class="spacer"></span><button class="primary" type="submit">Save photo analysis</button>
        </div>
      </form>`}

      <section class="card">
        <h2>Data & backup</h2>
        <p class="small">All data is stored in this browser on this device (IndexedDB). Clearing site data or switching browsers will not carry it over — export a backup regularly.</p>
        <p class="small muted" id="storage-info">Checking storage…</p>
        <div class="btn-row">
          <button type="button" data-act="export">Export backup (.json)</button>
          <button type="button" data-act="import">Restore from backup…</button>
        </div>
      </section>`;

    const form = U.$('#settings', mount);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      const err = U.$('.form-error', form);
      if (data.email && !form.email.checkValidity()) { err.textContent = 'Email address looks incomplete.'; err.hidden = false; form.email.focus(); return; }
      err.hidden = true;
      if (!data.numberPrefix.trim()) data.numberPrefix = 'EST';
      if (!data.notice.trim()) data.notice = Store.DEFAULT_SETTINGS.notice;
      data.discountCategories = [...new Set(data.discountCategories.split('\n').map(x => x.trim()).filter(Boolean))];
      await Store.saveSettings({ ...s, ...data });
      U.toast('Settings saved');
    });

    if (navigator.storage && navigator.storage.estimate) {
      const [est, persisted] = await Promise.all([navigator.storage.estimate(), navigator.storage.persisted ? navigator.storage.persisted() : false]);
      U.$('#storage-info', mount).textContent = `Using about ${(est.usage / 1048576).toFixed(1)} MB. ${persisted ? 'Storage is marked persistent.' : 'Browser may clear this data under storage pressure — keep backups.'}`;
    } else U.$('#storage-info', mount).textContent = '';

    mount.addEventListener('click', async e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'export') exportBackup();
      if (b.dataset.act === 'import') importBackup();
      if (b.dataset.act === 'ai-remove') {
        if (!await U.confirm('Remove the API key and turn off photo analysis?')) return;
        await AI.saveConfig({ ...ai, apiKey: '' });
        U.toast('Photo analysis turned off');
        window.dispatchEvent(new HashChangeEvent('hashchange')); // re-render with a fresh view
      }
    });

    U.$('#ai-settings', mount)?.addEventListener('submit', async e => {
      e.preventDefault();
      const key = U.$('#ai-key', mount).value.trim();
      const errEl = U.$('#ai-settings .form-error', mount);
      if (key && !/^sk-ant-\S{10,}$/.test(key)) {
        errEl.textContent = 'That doesn’t look like an Anthropic API key (it starts with sk-ant-).'; errEl.hidden = false; return;
      }
      errEl.hidden = true;
      await AI.saveConfig({ ...ai, model: U.$('#ai-model', mount).value, apiKey: key || ai.apiKey });
      U.toast(key ? 'Photo analysis is on' : 'Saved');
      window.dispatchEvent(new HashChangeEvent('hashchange')); // re-render with a fresh view
    });
  }

  async function exportBackup() {
    U.toast('Preparing backup…');
    try {
      const [estimates, findings, repairs, photos, meta] = await Promise.all(
        ['estimates', 'findings', 'repairs', 'photos', 'meta'].map(s => DB.getAll(s)));
      const photoData = [];
      for (const p of photos) {
        photoData.push({ ...p, blob: p.blob ? await Photos.blobToDataURL(p.blob) : null, thumb: p.thumb ? await Photos.blobToDataURL(p.thumb) : null });
      }
      // The photo-analysis API key never leaves this browser.
      const out = { app: 'chimney-estimator', version: 2, exportedAt: new Date().toISOString(), estimates, findings, repairs,
        meta: meta.filter(m => m.key !== 'ai'), photos: photoData };
      const res = await U.saveFile(`chimney-estimator-backup-${U.today()}.json`, new Blob([JSON.stringify(out)], { type: 'application/json' }));
      U.toast(res === 'declined' ? 'Backup not saved' : `Backup saved (${estimates.length} estimates, ${photos.length} photos and videos)`);
    } catch (err) {
      U.toast(`Backup failed: ${err.message}`, 'error');
    }
  }

  // Checks a parsed backup before anything is replaced; returns a problem description or ''.
  function backupProblem(data) {
    if (!data || data.app !== 'chimney-estimator') return 'That file is not a backup from this app.';
    for (const k of ['estimates', 'findings', 'repairs', 'photos']) {
      if (!Array.isArray(data[k])) return `The backup is incomplete (no ${k} list).`;
      if (data[k].some(r => !r || typeof r.id !== 'string' || !r.id)) return `The backup has a damaged ${k} entry.`;
    }
    if (data.meta !== undefined && (!Array.isArray(data.meta) || data.meta.some(m => !m || typeof m.key !== 'string'))) return 'The backup has damaged settings.';
    return '';
  }

  function importBackup() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      let data;
      try { data = JSON.parse(await file.text()); } catch (e) { U.toast('That file is not valid JSON.', 'error'); return; }
      const problem = backupProblem(data);
      if (problem) { U.toast(problem, 'error'); return; }
      if (!await U.confirm(`Replace ALL current data with this backup from ${U.fmtDateTime(data.exportedAt) || 'an unknown date'}? (${data.estimates.length} estimates, ${data.findings.length + data.repairs.length} catalog entries, ${data.photos.length} photos and videos)`)) return;
      try {
        const photos = [];
        for (const p of data.photos) {
          photos.push({ ...p, blob: p.blob ? await Photos.dataURLToBlob(p.blob) : null, thumb: p.thumb ? await Photos.dataURLToBlob(p.thumb) : null });
        }
        const aiCfg = await DB.get('meta', 'ai'); // keep this browser's API key across the restore
        // One transaction: if any write fails, the current data is left exactly as it was.
        await DB.replaceAll({
          estimates: data.estimates, findings: data.findings, repairs: data.repairs, photos,
          meta: [...(data.meta || []).filter(m => m.key !== 'ai'), ...(aiCfg ? [aiCfg] : [])],
        });
        // Reload so start-up migrations run on the restored (possibly older) data.
        location.hash = '#/estimates';
        location.reload();
      } catch (err) {
        U.toast(`Restore failed — your current data was not changed. ${err.message || ''}`, 'error');
      }
    });
    input.click();
  }

  return { show };
})();
