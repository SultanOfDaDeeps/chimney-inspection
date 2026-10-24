'use strict';

// Estimate editor. Inputs carry data-bind="<path into the estimate>" and update the in-memory
// estimate directly; changes autosave after a short pause. Structural changes re-render.
const EditorView = (() => {
  const esc = U.esc;
  let est = null;
  let root = null;
  let saveTimer = null;
  let dirty = false;
  const openKeys = new Set(); // <details> sections the user opened, kept open across re-renders
  const otherRows = new Set(); // measurement rows switched from the size list to manual entry
  const shownRows = new Set(); // empty measurement/detail rows the user opened from "More"
  let sizeLib = [];
  let lastSettings = {}; // for building the private copy synchronously on click
  let justPreviewed = false;

  const STATUSES = [['', 'No status'], ['confirmed', 'Confirmed'], ['suspected', 'Suspected'], ['further', 'Needs further evaluation']];

  // ---------- saving ----------
  function setSaveState(text, cls = '') {
    const el = root && U.$('.save-state', root);
    if (el) { el.textContent = text; el.className = `save-state ${cls}`; }
  }

  function scheduleSave() {
    dirty = true;
    setSaveState('Unsaved changes…', 'pending');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 700);
  }

  async function flush() {
    clearTimeout(saveTimer);
    if (!est || !dirty) return;
    dirty = false;
    est.updatedAt = new Date().toISOString();
    try {
      await DB.put('estimates', U.clone(est));
      setSaveState(`Saved ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`, 'ok');
    } catch (err) {
      dirty = true;
      setSaveState('Save failed', 'error');
      U.toast(`Could not save: ${err.message}`, 'error');
    }
  }

  // Reason the estimate can't be presented yet (title/scope), or ''.
  function presentBlocker(e) {
    if (!e.title.trim()) return 'Write or enter a project title before presenting.';
    if (!e.scopeText.trim()) return 'Write and review the proposed work description before presenting.';
    return '';
  }

  // ---------- small render helpers ----------
  const idFor = path => 'b_' + path.replace(/[^\w]/g, '_');

  function field(label, path, opts = {}) {
    const value = U.getPath(est, path) ?? '';
    const id = idFor(path);
    const attrs = `id="${id}" data-bind="${esc(path)}" ${opts.required ? 'required aria-required="true"' : ''} ${opts.placeholder ? `placeholder="${esc(opts.placeholder)}"` : ''} ${opts.list ? `list="${opts.list}"` : ''} ${opts.maxlength ? `maxlength="${opts.maxlength}"` : ''} ${opts.inputmode ? `inputmode="${opts.inputmode}"` : ''}`;
    let control;
    if (opts.textarea) control = `<textarea ${attrs} rows="${opts.rows || 2}">${esc(value)}</textarea>`;
    else if (opts.options) control = `<select ${attrs}>${opts.options.map(([v, l]) => `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    else control = `<input ${attrs} type="${opts.type || 'text'}" value="${esc(value)}" autocomplete="off">`;
    const tag = opts.private ? ' <span class="tag private-tag">Private</span>' : (opts.customer ? ' <span class="tag cust-tag">Customer sees</span>' : '');
    return `<div class="field ${opts.cls || ''} ${opts.private ? 'is-private' : ''}">
      <label for="${id}">${esc(label)}${opts.required ? ' <span class="req">*</span>' : ''}${tag}</label>
      ${control}${opts.hint ? `<small class="hint">${esc(opts.hint)}</small>` : ''}
      ${opts.required ? `<small class="field-error" data-err-for="${id}" hidden>Required</small>` : ''}
    </div>`;
  }

  const check = (label, path) => {
    const id = idFor(path);
    return `<label class="check" for="${id}"><input type="checkbox" id="${id}" data-bind="${esc(path)}" ${U.getPath(est, path) ? 'checked' : ''}> ${esc(label)}</label>`;
  };

  const details = (key, summary, inner, extraCls = '') =>
    `<details class="sub ${extraCls}" data-key="${esc(key)}" ${openKeys.has(key) ? 'open' : ''}><summary>${summary}</summary><div class="sub-body">${inner}</div></details>`;

  const moveBtns = (arr, i, len, what) => `
    <button type="button" class="icon-btn" data-action="move" data-arr="${arr}" data-i="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move ${what} up">↑</button>
    <button type="button" class="icon-btn" data-action="move" data-arr="${arr}" data-i="${i}" data-dir="1" ${i === len - 1 ? 'disabled' : ''} aria-label="Move ${what} down">↓</button>`;

  // Rows whose label matches a size type get a list of standard sizes plus "Other…".
  function valueControl(r, p, type) {
    const label = esc(r.label || 'Value');
    const other = !type || otherRows.has(p) || (r.value && !type.options.includes(r.value));
    if (other) {
      return `<span class="v-wrap"><input aria-label="${label}" placeholder="${type ? 'Enter size' : 'Value'}" data-bind="${p}.value" value="${esc(r.value)}" class="v">${type
        ? `<button type="button" class="icon-btn" data-action="size-list" data-path="${p}" aria-label="Choose from standard sizes" title="Standard sizes">☰</button>` : ''}</span>`;
    }
    return `<select class="v" aria-label="${label}" data-size="${p}">
      <option value="">Select size…</option>
      ${type.options.map(o => `<option ${o === r.value ? 'selected' : ''}>${esc(o)}</option>`).join('')}
      <option value="__other">Other…</option></select>`;
  }

  function valueRows(arrPath, kind, category) {
    const rows = U.getPath(est, arrPath);
    const isDetail = kind === 'detail';
    const types = Sizes.forCategory(sizeLib, category);
    // Show rows that have a value or that you just opened; empty rows wait under "More".
    const visible = (r, i) => String(r.value).trim() || shownRows.has(`${arrPath}.${i}`) || otherRows.has(`${arrPath}.${i}`);
    const hiddenRows = rows.map((r, i) => [r, i]).filter(([r, i]) => !visible(r, i));
    const body = rows.map((r, i) => {
      if (!visible(r, i)) return '';
      const p = `${arrPath}.${i}`;
      const type = Sizes.match(types, r.label);
      return `<div class="vrow ${r.internal ? 'is-private' : ''}">
        <input aria-label="${isDetail ? 'Detail' : 'Measurement'} label" placeholder="Label" data-bind="${p}.label" value="${esc(r.label)}">
        ${valueControl(r, p, type)}
        <input aria-label="Unit" placeholder="Unit" data-bind="${p}.unit" value="${esc(r.unit)}" class="u">
        ${isDetail ? `<label class="check small" title="Internal details are never shown to the customer"><input type="checkbox" data-bind="${p}.internal" ${r.internal ? 'checked' : ''}> Internal</label>` : ''}
        <button type="button" class="icon-btn" data-action="remove-row" data-arr="${arrPath}" data-i="${i}" aria-label="Remove row">✕</button>
      </div>`;
    }).join('');
    // One-tap rows for this component's size types that aren't on the item yet.
    const unused = types.filter(t => !rows.some(r => Sizes.match([t], r.label)));
    const key = `${arrPath}:more`;
    const moreCount = hiddenRows.length + unused.length;
    return `${body.trim() ? `<div class="vrows">${body}</div>` : ''}
      <div class="btn-row tight">
        <details class="more-sizes" data-key="${esc(key)}" ${openKeys.has(key) ? 'open' : ''}><summary class="btn small">${isDetail ? 'More details' : 'More measurements'}${moreCount ? ` (${moreCount})` : ''}</summary>
          <div class="btn-row tight">
            ${hiddenRows.map(([r, i]) => `<button type="button" class="small chip" data-action="show-row" data-path="${arrPath}.${i}">+ ${esc(r.label || 'Value')}</button>`).join('')}
            ${unused.map(t => `<button type="button" class="small chip" data-action="add-size" data-arr="${arrPath}" data-label="${esc(t.label)}" data-unit="${esc(t.unit)}">+ ${esc(t.label)}</button>`).join('')}
            <button type="button" class="small" data-action="add-row" data-arr="${arrPath}" data-kind="${kind}">+ Other ${isDetail ? 'detail' : 'measurement'}</button>
          </div></details></div>`;
  }

  // Every place media can be attached: general, each finding, each repair.
  function mediaTargets() {
    const out = [['photos', 'General (not tied to an item)']];
    est.components.forEach((c, ci) => c.findings.forEach((f, fi) => {
      const fp = `components.${ci}.findings.${fi}`;
      out.push([`${fp}.photos`, `${Store.componentLabel(c)} — ${f.name || 'finding'}`]);
      f.repairs.forEach((r, ri) => out.push([`${fp}.repairs.${ri}.photos`, `${Store.componentLabel(c)} — ${r.name || 'repair'}`]));
    }));
    return out;
  }

  function mediaThumb(ph) {
    if (ph.kind !== 'video') return `<img data-photo-id="${esc(ph.id)}" alt="${esc(ph.caption || 'Photo')}">`;
    return ph.playable === false
      ? `<div class="media-file"><span class="media-icon">🎬</span><span class="small">${esc(ph.name || 'Video')}</span>
          <span class="hint">Can't preview this format in this browser — it's saved${ph.size ? ` (${esc(Photos.fmtSize(ph.size))})` : ''}.</span></div>`
      : `<div class="video-thumb"><video data-video-id="${esc(ph.id)}" muted playsinline preload="metadata" aria-label="${esc(ph.caption || 'Video')}"></video><span class="play-badge">▶</span></div>`;
  }

  function photoGrid(arrPath, scopeLabel) {
    const list = U.getPath(est, arrPath);
    const targets = mediaTargets();
    return `<div class="photo-grid">${list.map((ph, i) => {
      const p = `${arrPath}.${i}`;
      return `<figure class="photo ${ph.include ? '' : 'excluded'}">
        ${mediaThumb(ph)}
        <input aria-label="Caption" placeholder="Caption (optional)" data-bind="${p}.caption" value="${esc(ph.caption)}">
        <label class="check small"><input type="checkbox" data-bind="${p}.include" ${ph.include ? 'checked' : ''}> Show to customer</label>
        <select class="small-select" aria-label="Attached to" data-move="${p}">${targets.map(([v, l]) => `<option value="${esc(v)}" ${v === arrPath ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
        <div class="photo-actions">
          <button type="button" class="small" data-action="replace-media" data-arr="${arrPath}" data-i="${i}">Replace</button>
          <button type="button" class="icon-btn danger" data-action="remove-photo" data-arr="${arrPath}" data-i="${i}" aria-label="Remove ${ph.kind === 'video' ? 'video' : 'photo'}">✕</button>
        </div>
      </figure>`;
    }).join('')}</div>
    <button type="button" class="small" data-action="add-photos" data-arr="${arrPath}">📷 Add photos or videos${scopeLabel ? ` ${esc(scopeLabel)}` : ''}</button>`;
  }

  // ---------- section renderers ----------
  function repairHtml(r, p, i, len, cat) {
    const arr = p.replace(/\.\d+$/, '');
    return `<div class="repair" id="r-${esc(r.id)}">
      <div class="item-head">
        <span class="kind repair-kind">Repair</span>
        <span class="item-title">${esc(r.name || 'Untitled repair')}</span>
        <span class="spacer"></span>${moveBtns(arr, i, len, 'repair')}
        <button type="button" class="icon-btn danger" data-action="remove" data-arr="${arr}" data-i="${i}" data-what="repair" aria-label="Remove repair">✕</button>
      </div>
      <div class="grid2">
        ${field('Repair name', `${p}.name`, { customer: true })}
        ${field('Note for this job', `${p}.note`, { customer: true, placeholder: 'Optional' })}
        ${field('Customer-facing description', `${p}.description`, { textarea: true, rows: 2, cls: 'span2', customer: true })}
        ${field('Why it matters', `${p}.purpose`, { textarea: true, rows: 1, cls: 'span2', customer: true, placeholder: 'Optional — one general sentence on what this work does' })}
      </div>
      <div class="label-like">Material, dimensions, finish</div>
      ${valueRows(`${p}.details`, 'detail', cat)}
      <div class="label-like">Photos & videos</div>
      ${photoGrid(`${p}.photos`, 'to this repair')}
      ${details(`${r.id}:ae`, 'Assumptions & exclusions' + (r.assumptions || r.exclusions ? ' •' : ''), `<div class="grid2">
        ${field('Assumptions', `${p}.assumptions`, { textarea: true, customer: true, hint: 'One per line' })}
        ${field('Exclusions', `${p}.exclusions`, { textarea: true, customer: true, hint: 'One per line' })}</div>`)}
      ${details(`${r.id}:pn`, 'Private notes' + (r.privateNote ? ' •' : ''), field('Private note (materials, suppliers, crew)', `${p}.privateNote`, { textarea: true, private: true }), 'private-sub')}
    </div>`;
  }

  // One line that lets a collapsed item be scanned: status, repairs, key sizes, media.
  function itemSummary(f) {
    const vals = [...f.measurements, ...f.repairs.flatMap(r => r.details)]
      .filter(v => !v.internal && String(v.value).trim())
      .map(v => `${v.label ? v.label + ' ' : ''}${v.value}${v.unit ? ' ' + v.unit : ''}`);
    const media = f.photos.length + f.repairs.reduce((n, r) => n + r.photos.length, 0);
    return [
      Store.statusLabel(f.status),
      f.repairs.length ? f.repairs.map(r => r.name || 'Repair').join(', ') : 'No repair yet',
      ...[...new Set(vals)].slice(0, 2),
      media ? `${media} photo${media === 1 ? '' : 's'}/video${media === 1 ? '' : 's'}` : '',
    ].filter(Boolean).join(' · ');
  }

  // Each item (a finding and its repairs) collapses to its title and a one-line summary.
  function findingHtml(f, p, i, len, cat) {
    const arr = p.replace(/\.\d+$/, '');
    const key = `item:${f.id}`;
    return `<details class="finding item" id="f-${esc(f.id)}" data-key="${esc(key)}" ${openKeys.has(key) ? 'open' : ''}>
      <summary class="item-sum">
        <span class="chev" aria-hidden="true"></span>
        <span class="sum-main">
          <span class="item-title">${esc(f.name || 'Untitled finding')}</span>
          <span class="sum-sub" data-live="sum">${esc(itemSummary(f))}</span>
        </span>
        <span class="sum-actions">${moveBtns(arr, i, len, 'item')}
          <button type="button" class="icon-btn danger" data-action="remove" data-arr="${arr}" data-i="${i}" data-what="finding" aria-label="Remove item">✕</button></span>
      </summary>
      <div class="item-body">
        <div class="grid2">
          ${field('Finding', `${p}.name`, { customer: true })}
          ${field('Status', `${p}.status`, { options: STATUSES, hint: 'Optional' })}
          ${field('Customer-facing description', `${p}.description`, { textarea: true, rows: 2, cls: 'span2', customer: true })}
          ${field('Project note', `${p}.note`, { textarea: true, rows: 1, cls: 'span2', customer: true, placeholder: 'Optional short note specific to this job' })}
          ${field('Why it matters', `${p}.risk`, { textarea: true, rows: 1, cls: 'span2', customer: true,
            placeholder: 'Optional — what this condition can lead to', hint: 'Shown to the customer only when the status is Confirmed.' })}
        </div>
        <div class="label-like">Measurements</div>
        ${valueRows(`${p}.measurements`, 'measure', cat)}
        <div class="label-like">Photos & videos</div>
        ${photoGrid(`${p}.photos`, 'to this finding')}
        ${details(`${f.id}:ae`, 'Assumptions & exclusions' + (f.assumptions || f.exclusions ? ' •' : ''), `<div class="grid2">
          ${field('Assumptions', `${p}.assumptions`, { textarea: true, customer: true, hint: 'One per line' })}
          ${field('Exclusions', `${p}.exclusions`, { textarea: true, customer: true, hint: 'One per line' })}</div>`)}
        ${details(`${f.id}:pn`, 'Private notes' + (f.privateNote ? ' •' : ''), field('Private note', `${p}.privateNote`, { textarea: true, private: true }), 'private-sub')}
        <div class="repairs">
          <h4>Proposed repairs</h4>
          ${f.repairs.map((r, ri) => repairHtml(r, `${p}.repairs.${ri}`, ri, f.repairs.length, cat)).join('') || '<p class="muted small">No repair selected for this finding yet.</p>'}
          <button type="button" class="small" data-action="add-repair" data-path="${p}">+ Add repair</button>
        </div>
      </div>
    </details>`;
  }

  function identSummary(c) {
    const s = c.ident;
    if (s.status === 'confirmed') return `<span class="badge presented">Match confirmed</span> ${esc([s.manufacturer, s.productFamily].filter(Boolean).join(' · '))} <span class="muted small">(${s.sources.length} source${s.sources.length === 1 ? '' : 's'})</span>`;
    if (s.status === 'uncertain') return `<span class="badge">Uncertain — kept as entered</span>`;
    if (s.sources.length || s.notes) return `<span class="badge">Research saved, not confirmed</span>`;
    return '<span class="muted small">No lookup done. Identifiers are used exactly as entered.</span>';
  }

  function componentHtml(c, ci, len) {
    const p = `components.${ci}`;
    const ids = [c.location, c.appliance, c.manufacturer, c.model].map(s => String(s || '').trim()).filter(Boolean).join(' · ');
    if (!c.category.trim()) openKeys.add(`${c.id}:ids`); // a new, unnamed component opens its details
    return `<article class="comp" id="c-${esc(c.id)}">
      <header class="comp-head">
        <div class="comp-title"><h3>${esc(Store.componentLabel(c))}</h3>${ids ? `<span class="muted small">${esc(ids)}</span>` : ''}</div>
        <span class="spacer"></span>${moveBtns('components', ci, len, 'component')}
        <button type="button" class="icon-btn danger" data-action="remove" data-arr="components" data-i="${ci}" data-what="component" aria-label="Remove component">✕</button>
      </header>
      <div class="findings">
        ${c.findings.map((f, fi) => findingHtml(f, `${p}.findings.${fi}`, fi, c.findings.length, c.category)).join('')
          || '<p class="empty-inline">No findings yet for this component. Add the issue you observed.</p>'}
      </div>
      <div class="comp-foot">
        <button type="button" class="small" data-action="add-finding" data-i="${ci}">+ Add finding</button>
        ${details(`${c.id}:ids`, 'Component details', `
          <div class="grid3">
            ${field('Component', `${p}.category`, { list: 'cat-list', placeholder: 'Crown, flue liner, damper…', customer: true })}
            ${field('Location / which chimney', `${p}.location`, { placeholder: 'e.g. Main chimney, north side' })}
            ${field('Appliance', `${p}.appliance`, { placeholder: 'e.g. Wood stove, gas insert' })}
            ${field('Manufacturer', `${p}.manufacturer`)}
            ${field('System / product type', `${p}.systemType`)}
            ${field('Model number', `${p}.model`)}
            ${field('Serial number', `${p}.serial`)}
            ${field('Part identifier', `${p}.partId`)}
            <div class="field">${check('Show identifiers to customer', `${p}.showIds`)}</div>
          </div>
          <div class="ident-row">
            <div class="ident-status">${identSummary(c)}</div>
            <button type="button" class="small" data-action="identify" data-i="${ci}">Look up / confirm identification…</button>
          </div>`, 'comp-details')}
      </div>
    </article>`;
  }

  // A gas system needs its manufacturer and model before problems are added.
  function systemGate() {
    const s = est.system;
    if (!s.type) return 'Choose the system type first.';
    if (s.type === 'gas' && (!s.manufacturer.trim() || !s.model.trim())) return 'Enter the gas system manufacturer and model first.';
    return '';
  }

  function systemHtml() {
    const s = est.system;
    return `<section class="card" id="sec-system" aria-labelledby="h-sys">
      <h2 id="h-sys"><span class="num">2</span> System type</h2>
      <div class="seg big" role="radiogroup" aria-label="System type">
        ${SYSTEM_TYPES.map(([v, l]) => `<label class="seg-btn"><input type="radio" name="sys-type" value="${v}" data-bind="system.type" ${s.type === v ? 'checked' : ''}> ${l}</label>`).join('')}
      </div>
      ${s.type === 'gas' ? `<div class="grid3 gas-ids">
        ${field('Manufacturer', 'system.manufacturer', { required: true, customer: true })}
        ${field('Model', 'system.model', { required: true, customer: true })}
        <div class="field"><span class="label-like">From the rating label</span>
          <button type="button" data-action="read-label">📷 Read label from photo</button></div>
      </div>` : ''}
      ${!s.type ? '<p class="hint">Wood continues straight to the problem questions. Gas asks for the manufacturer and model first.</p>' : ''}
    </section>`;
  }

  // The single most useful next action, shown as the main button (header and phone bottom bar).
  function nextStep() {
    if (!est.customer.name.trim() || !est.date) return { label: 'Next: client details', action: 'goto', target: '#sec-client' };
    if (systemGate()) return { label: 'Next: system type', action: 'goto', target: '#sec-system' };
    if (!est.components.some(c => c.findings.length)) return { label: 'Next: add a problem', action: 'add-problem' };
    if (!est.title.trim() || !est.scopeText.trim()) return { label: 'Next: write title & description', action: 'generate' };
    return { label: 'Preview', href: `#/estimates/${est.id}/preview` };
  }

  function ctaHtml() {
    const n = nextStep();
    return n.href ? `<a class="btn primary" href="${esc(n.href)}">${esc(n.label)}</a>`
      : `<button type="button" class="primary" data-action="${n.action}" ${n.target ? `data-target="${n.target}"` : ''}>${esc(n.label)}</button>`;
  }

  function stepsHtml() {
    const done = [!!est.customer.name.trim() && !!est.date, !systemGate(), est.components.some(c => c.findings.length), !!(est.title.trim() && est.scopeText.trim())];
    return [['#sec-client', 'Client'], ['#sec-system', 'System'], ['#sec-items', 'Problems'], ['#sec-review', 'Wording']]
      .map(([t, l], i) => `<button type="button" class="step ${done[i] ? 'done' : ''}" data-action="goto" data-target="${t}">${done[i] ? '✓' : i + 1} ${l}</button>`).join('')
      + `<a class="step" href="#/estimates/${esc(est.id)}/preview">Preview</a>`;
  }

  // Refresh the step bar and next-step buttons after edits that change progress.
  function refreshProgress() {
    if (!root) return;
    U.$$('[data-live=cta]', root).forEach(el => { el.innerHTML = ctaHtml(); });
    const steps = U.$('[data-live=steps]', root);
    if (steps) steps.innerHTML = stepsHtml();
  }

  // ---------- private client note ----------
  const nameKey = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const phoneKey = s => String(s || '').replace(/\D/g, '').slice(-10);
  // The same client's notes on other estimates (matched by name or phone), so earlier details are easy to find.
  function otherClientNotes(all) {
    const n = nameKey(est.customer.name), p = phoneKey(est.customer.phone);
    return all.filter(x => x.id !== est.id && String(x.clientNote || '').trim() && x.customer
      && ((n && nameKey(x.customer.name) === n) || (p.length >= 7 && phoneKey(x.customer.phone) === p)))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }

  function clientNoteHtml(all) {
    const others = otherClientNotes(all);
    return `<div class="private-note">
      ${field('Private note', 'clientNote', { textarea: true, rows: 2, private: true,
        placeholder: 'For you only — e.g. daughter Sarah handles scheduling; prefers a text before arriving' })}
      <div class="note-meta">
        <span class="hint">Never shown to the customer, and never included in copied text, photos, or the PDF (unless you choose to include private notes when saving).</span>
        ${est.clientNote ? '<button type="button" class="small danger" data-action="delete-note">Delete note</button>' : ''}
      </div>
      ${others.length ? details('other-notes', `Private notes from ${others.length} other estimate${others.length === 1 ? '' : 's'} for this client`,
        `<ul class="note-list">${others.map(x => `<li><a href="#/estimates/${esc(x.id)}">${esc(x.number)} · ${esc(U.fmtDate(x.date))}</a>
          <p class="pre">${esc(x.clientNote)}</p></li>`).join('')}</ul>`, 'private-sub') : ''}
    </div>`;
  }

  // ---------- optional pricing & discount (private unless shown) ----------
  function customerSeesText() {
    const ps = Store.priceSummary(est);
    const parts = [];
    if (est.pricing.showPrices) {
      parts.push(est.pricing.mode === 'package'
        ? (ps.packagePrice != null ? `the package price (${U.fmtMoney(ps.packagePrice)})` : 'the package, without a price (none entered)')
        : (ps.priced.length ? `item prices for ${ps.priced.length} of ${ps.items.length} repairs` : 'no prices (none entered)'));
    } else parts.push('no prices');
    if (est.discount.show && est.discount.category) {
      parts.push(`the ${est.discount.category.toLowerCase()} discount${ps.discountAmt != null ? ` (−${U.fmtMoney(ps.discountAmt)})` : ''}`);
    } else parts.push('no discount');
    return `Customer will see ${parts.join(' and ')}.`;
  }

  function pricingHtml(s) {
    const p = est.pricing, d = est.discount;
    const ps = Store.priceSummary(est);
    const pkg = p.mode === 'package';
    const money = (label, path, opts = {}) => field(label, path, { ...opts, inputmode: 'decimal', placeholder: opts.placeholder || '$0' });
    const open = openKeys.has('pricing') || p.showPrices || d.category || p.packagePrice || Object.values(p.itemPrices).some(v => String(v).trim());
    return `<details class="card sub-card pricing-card" id="sec-pricing" data-key="pricing" ${open ? 'open' : ''}>
      <summary><h2>Pricing & discount <span class="opt">optional</span></h2>
        <span class="tag private-tag">Private unless shown</span></summary>
      <p class="muted small">Prices and discounts stay private. They appear on the customer estimate only if you turn on a “Show” switch.</p>
      <span class="label-like">Present the work as</span>
      <div class="seg" role="radiogroup" aria-label="Present the work as">
        <label class="seg-btn"><input type="radio" name="price-mode" value="items" data-bind="pricing.mode" ${!pkg ? 'checked' : ''}> Individual items</label>
        <label class="seg-btn"><input type="radio" name="price-mode" value="package" data-bind="pricing.mode" ${pkg ? 'checked' : ''}> One package</label>
      </div>
      ${ps.items.length ? `<div class="price-table">
        <span class="label-like">Repair prices <span class="opt">${pkg ? 'private — used to work out the package price' : 'private'}</span></span>
        ${ps.items.map(i => `<div class="price-row"><span><strong>${esc(i.name || 'Repair')}</strong> <span class="muted small">${esc(i.component)}</span></span>
          <input aria-label="Price for ${esc(i.name)}" data-bind="pricing.itemPrices.${esc(i.id)}" value="${esc(p.itemPrices[i.id] || '')}" inputmode="decimal" placeholder="$0" class="money"></div>`).join('')}
        <div class="price-row total"><span>Item total</span><strong data-live="item-total">${ps.itemTotal != null ? esc(U.fmtMoney(ps.itemTotal)) : '—'}</strong></div>
      </div>` : '<p class="muted small">Add repairs to price them.</p>'}
      ${pkg ? `<div class="grid2">
        ${field('Package name', 'pricing.packageName', { placeholder: est.title || 'e.g. Chimney Crown & Cap Package', customer: true })}
        <div class="field">${money('Package price', 'pricing.packagePrice')}
          ${ps.itemTotal != null ? `<button type="button" class="small" data-action="use-item-total">Use item total (${esc(U.fmtMoney(ps.itemTotal))})</button>` : ''}</div>
      </div>` : ''}
      ${field('Pricing notes', 'pricing.notes', { textarea: true, rows: 2, private: true, placeholder: 'Materials, labor, how you reached the price' })}
      <div class="switch-row">${check('Show prices on the customer estimate', 'pricing.showPrices')}</div>

      <span class="label-like">Discount <span class="opt">optional</span></span>
      <div class="grid3">
        <div class="field"><label for="b_discount_category">Category</label>
          <select id="b_discount_category" data-bind="discount.category"><option value="">None</option>
            ${[...new Set([...s.discountCategories, d.category].filter(Boolean))].map(c => `<option ${c === d.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
        <div class="field"><label for="b_discount_amount">Amount <span class="opt">only if you choose</span></label>
          <div class="v-wrap"><input id="b_discount_amount" data-bind="discount.amount" value="${esc(d.amount)}" inputmode="decimal" placeholder="Leave blank for none" ${d.category ? '' : 'disabled'}>
            <select aria-label="Discount unit" data-bind="discount.unit" class="unit-select" ${d.category ? '' : 'disabled'}>
              <option value="$" ${d.unit === '$' ? 'selected' : ''}>$</option><option value="%" ${d.unit === '%' ? 'selected' : ''}>%</option></select></div></div>
        <div class="field switch-field">${d.category ? check('Show discount on the customer estimate', 'discount.show') : '<span class="hint">Choose a category to add a discount. Edit categories in Settings.</span>'}</div>
      </div>
      <p class="customer-sees" data-live="customer-sees">${esc(customerSeesText())}</p>
    </details>`;
  }

  // Live totals while typing amounts (no re-render, so focus stays put).
  function refreshPricing() {
    const ps = Store.priceSummary(est);
    const t = U.$('[data-live=item-total]', root);
    if (t) t.textContent = ps.itemTotal != null ? U.fmtMoney(ps.itemTotal) : '—';
    const cs = U.$('[data-live=customer-sees]', root);
    if (cs) cs.textContent = customerSeesText();
  }

  // After the preview: your own records and the private WhatsApp copy, kept apart from the customer document.
  function hiddenMedia() {
    return est.photos.filter(p => !p.include).length + est.components.reduce((n, c) => n + c.findings.reduce((k, f) => k
      + [...f.photos, ...f.repairs.flatMap(r => r.photos)].filter(p => !p.include).length, 0), 0);
  }
  function privateStatusHtml() {
    const st = PrivateCopy.statusText(est.privateCopy);
    return `<p class="pc-status ${st.cls}" data-live="pc-status" role="status">${esc(st.text)}</p>`;
  }
  function deliverHtml(settings) {
    const m = Customer.model(est, settings);
    const open = justPreviewed || openKeys.has('deliver');
    return `<details class="card sub-card ${justPreviewed ? 'flash' : ''}" id="sec-deliver" data-key="deliver" ${open ? 'open' : ''}>
      <summary><h2>After the preview</h2></summary>
      ${justPreviewed ? '<p class="notice">Preview created. Send yourself the private copy below if you want one.</p>' : ''}
      ${PreviewView.visibilityHtml(est, m, hiddenMedia())}
      <div class="btn-row">
        <button type="button" data-action="save-pdf">Save PDF</button>
        <button type="button" data-action="copy-customer">Copy customer text</button>
      </div>
      <div class="private-copy is-private">
        <h3>Private copy to WhatsApp <span class="tag private-tag">Private</span></h3>
        <p class="muted small">The complete estimate with private notes, internal details, and pricing — for you only, never part of the customer document. Goes only to <strong>${esc(PrivateCopy.NUMBER)}</strong>.</p>
        ${privateStatusHtml()}
        <div class="btn-row">
          <a class="btn primary" data-wa href="${esc(PrivateCopy.link(''))}" target="_blank" rel="noopener">Open WhatsApp with private copy</a>
          <button type="button" data-action="copy-private">Copy private text</button>
          ${PrivateCopy.canSharePdf() ? '<button type="button" data-action="share-private-pdf">Share internal PDF…</button>' : ''}
          ${est.privateCopy && ['opened', 'shared'].includes(est.privateCopy.status) ? '<button type="button" data-action="private-sent">I sent it</button><button type="button" data-action="private-not-sent">Not sent</button>' : ''}
        </div>
        <p class="hint">WhatsApp opens with the message already written to ${esc(PrivateCopy.NUMBER)}; you tap Send. Automatic sending needs a WhatsApp Business account — see the README.</p>
        <details class="pc-text" data-key="pc-text" ${openKeys.has('pc-text') ? 'open' : ''}><summary class="small">Review the private text</summary>
          <textarea readonly rows="10" data-live="pc-text">${esc(PrivateCopy.text(est, settings))}</textarea></details>
      </div>
    </details>`;
  }

  async function render() {
    const cats = new Set(CATEGORIES.map(c => c[0]));
    const [findings, repairs, aiOn, lib, settings, allEstimates] = await Promise.all([
      Store.catalog('findings'), Store.catalog('repairs'), AI.configured(), Sizes.all(), Store.settings(), DB.getAll('estimates'),
    ]);
    sizeLib = lib;
    lastSettings = settings;
    [...findings, ...repairs].forEach(i => i.category && cats.add(i.category));
    const gate = systemGate();
    const scopeLen = est.scopeText.length;
    const generated = !!est.generated.scope;
    const y = window.scrollY;
    if (est.photos.length) openKeys.add('gen-photos');
    root.innerHTML = `
      <datalist id="cat-list">${[...cats].map(c => `<option value="${esc(c)}">`).join('')}</datalist>
      <div class="page-head sticky-head">
        <div class="head-main">
          <div>
            <a href="#/estimates" class="back">← Estimates</a>
            <h1><span data-live="heading">${esc(est.customer.name || 'Unnamed client')}</span>
              <span class="badge ${esc(est.status)}">${est.status === 'presented' ? 'Presented' : 'Draft'}</span></h1>
            <div class="muted small">${esc(est.number)}${est.presentedAt && est.status === 'presented' ? ` · presented ${esc(U.fmtDateTime(est.presentedAt))}` : ''}
              · <span class="save-state ok" aria-live="polite">Saved</span></div>
          </div>
          <div class="actions">
            <span class="cta-desktop" data-live="cta">${ctaHtml()}</span>
            <details class="more">
              <summary class="btn" aria-label="More actions">More ▾</summary>
              <div class="menu">
                <a class="btn" href="#/estimates/${esc(est.id)}/preview">Preview</a>
                <button type="button" data-action="toggle-status">${est.status === 'presented' ? 'Back to draft' : 'Mark as presented'}</button>
                <button type="button" data-action="duplicate">Duplicate</button>
                <button type="button" class="danger" data-action="delete-estimate">Delete</button>
              </div>
            </details>
          </div>
        </div>
        <nav class="steps" aria-label="Estimate steps" data-live="steps">${stepsHtml()}</nav>
      </div>

      <section class="card" id="sec-client" aria-labelledby="h-cust">
        <h2 id="h-cust"><span class="num">1</span> Client & job</h2>
        <div class="grid3">
          ${field('Client name', 'customer.name', { required: true })}
          ${field('Phone', 'customer.phone', { type: 'tel' })}
          ${field('Email', 'customer.email', { type: 'email' })}
          ${field('Job address', 'jobAddress', { cls: 'span2' })}
          ${field('Date', 'date', { type: 'date', required: true })}
        </div>
        ${clientNoteHtml(allEstimates)}
      </section>

      ${systemHtml()}

      <section class="card" id="sec-items" aria-labelledby="h-items">
        <h2 id="h-items"><span class="num">3</span> What's wrong?</h2>
        <div class="big-actions">
          <button type="button" class="primary" data-action="add-problem" ${gate ? 'aria-disabled="true"' : ''}>+ Add a problem</button>
          <button type="button" data-action="photo-problem" data-capture="1" ${gate ? 'aria-disabled="true"' : ''}>📷 Take photo</button>
          <button type="button" data-action="photo-problem" ${gate ? 'aria-disabled="true"' : ''}>⬆ Upload photo</button>
        </div>
        <p class="hint">${gate ? esc(gate) : aiOn
          ? 'Photos get suggestions for the component, label, and visible condition — you confirm each one.'
          : 'Photo analysis is off (Settings → Photo analysis): photos are attached and you pick the component and problem.'}</p>
        ${est.components.map((c, ci) => componentHtml(c, ci, est.components.length)).join('')
          || '<p class="empty-inline">No problems added yet.</p>'}
        <div class="btn-row items-tools">
          <button type="button" class="small" data-action="add-component">+ Add a component manually</button>
          ${est.components.some(c => c.findings.length) ? `<span class="spacer"></span>
          <button type="button" class="small" data-action="expand-all">Expand all</button>
          <button type="button" class="small" data-action="collapse-all">Collapse all</button>` : ''}
        </div>
        ${details('gen-photos', `Other photos (${est.photos.length})`, `
          <p class="muted small">Photos not tied to a problem, such as a rating label. Uncheck “Show to customer” to keep one private.</p>
          ${photoGrid('photos', '')}`)}
      </section>

      <section class="card" id="sec-review" aria-labelledby="h-review">
        <h2 id="h-review"><span class="num">4</span> Title & proposed work</h2>
        <p class="muted small">When the problems and repairs are in, write the title and the customer description from your selections. Nothing is added that you didn't select or enter — review and edit freely.</p>
        <button type="button" class="${generated ? '' : 'primary'}" data-action="generate">${generated ? '↻ Rewrite from selections' : '✎ Write title & description'}</button>
        <div class="grid2 review-fields">
          ${field('Project title', 'title', { cls: 'span2', customer: true })}
          ${field('Proposed work description', 'scopeText', { textarea: true, rows: 12, cls: 'span2', customer: true })}
        </div>
        <div class="scope-meta">
          <span class="char-count" data-live="scope-count" aria-live="polite">${scopeLen.toLocaleString()} characters</span>
          <a class="btn" href="#/estimates/${esc(est.id)}/preview">Preview →</a>
        </div>
      </section>

      ${deliverHtml(settings)}

      ${pricingHtml(settings)}

      <details class="card is-private sub-card" data-key="internal" ${openKeys.has('internal') || est.internalNotes ? 'open' : ''}>
        <summary><h2 id="h-int">Internal notes <span class="tag private-tag">Private</span></h2></summary>
        ${field('Notes for yourself (never shown to the customer)', 'internalNotes', { textarea: true, rows: 3, private: true })}
        ${field('Estimate number', 'number')}
        ${est.accessNotes ? field('Access notes (kept from earlier version, not shown to the customer)', 'accessNotes', { textarea: true, rows: 2, private: true }) : ''}
      </details>

      <div class="mobile-bar no-print" data-live="cta">${ctaHtml()}</div>`;
    window.scrollTo(0, y);
    Photos.hydrate(root, 'thumb');
  }

  // ---------- guided problem + photo flows ----------
  const usableFindings = async () => (await Store.catalog('findings')).filter(f => Store.appliesTo(f, est.system.type));

  function categoryList(findings) {
    const cats = new Set(CATEGORIES.map(c => c[0]));
    findings.forEach(f => f.category && cats.add(f.category));
    return [...cats];
  }

  // Measurements already entered on this estimate, offered (visibly) when the same measurement comes up again.
  function knownSizes() {
    const known = {};
    est.components.forEach(c => c.findings.forEach(f => [...f.measurements, ...f.repairs.flatMap(r => r.details)].forEach(row => {
      if (!row.internal && String(row.value).trim() && row.label.trim()) known[row.label.trim().toLowerCase()] = { value: row.value, unit: row.unit };
    })));
    return known;
  }

  // Add the wizard result as a finding (+ repairs) under the matching component.
  function addProblem(res, photoEntry, confirmedIds = {}) {
    let c = est.components.find(x => x.category.trim().toLowerCase() === res.category.toLowerCase());
    if (!c) {
      c = est.components.find(x => !x.category.trim() && !x.findings.length);
      if (!c) { c = Store.newComponent(); est.components.push(c); }
      c.category = res.category;
    }
    if (confirmedIds.manufacturer && !c.manufacturer) c.manufacturer = confirmedIds.manufacturer;
    if (confirmedIds.model && !c.model) c.model = confirmedIds.model;
    const f = Store.findingSnapshot(res.finding);
    if (res.custom) { f.name = res.custom.name; f.description = res.custom.description; }
    f.status = res.status;
    f.note = res.note;
    if (photoEntry) f.photos.push(photoEntry);
    f.repairs.push(...res.repairs.map(r => Store.repairSnapshot(r)));
    if (res.customRepair) {
      const r = Store.repairSnapshot(null);
      Object.assign(r, res.customRepair);
      f.repairs.push(r);
    }
    // Put each chosen size on every matching measurement/detail row; if none match, record it on the finding.
    for (const s of res.sizes || []) {
      const rows = [...f.measurements, ...f.repairs.flatMap(r => r.details)].filter(row => Sizes.match([{ ...s, aliases: [] }], row.label)
        || Sizes.match(Sizes.forCategory(sizeLib, res.category).filter(t => t.label === s.label), row.label));
      if (!rows.length) f.measurements.push({ label: s.label, unit: s.unit, value: s.value });
      rows.forEach(row => { row.value = s.value; if (!row.unit) row.unit = s.unit; });
    }
    c.findings.push(f);
    openKeys.add(`item:${f.id}`); // a new item opens so it can be checked
    return f;
  }

  function gateOrWarn() {
    const g = systemGate();
    if (!g) return false;
    U.toast(g, 'error');
    focusIn('#sec-system');
    return true;
  }

  async function guidedProblem() {
    if (gateOrWarn()) return;
    const res = await ProblemWizard.open({ systemType: est.system.type, known: knownSizes() });
    if (!res) return;
    const f = addProblem(res, null);
    scheduleSave(); await flush(); await render(); focusIn(`#f-${f.id}`);
    U.toast('Problem added. Add another, or write the title & description when done.');
  }

  function pickOneImage(capture) {
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      if (capture) input.setAttribute('capture', 'environment');
      input.addEventListener('change', () => resolve((input.files || [])[0] || null));
      input.addEventListener('cancel', () => resolve(null));
      input.click();
    });
  }

  async function importOne(capture) {
    const file = await pickOneImage(capture);
    if (!file) return null;
    try { return await Photos.importFile(file, est.id); } catch (err) { U.toast(err.message, 'error'); return null; }
  }

  async function photoProblem(capture) {
    if (gateOrWarn()) return;
    const photoId = await importOne(capture);
    if (!photoId) return;
    const findings = await usableFindings();
    const categories = categoryList(findings);
    const entry = { id: photoId, caption: '', include: true };
    let prefill = {};
    let confirmedIds = {};
    if (await AI.configured()) {
      const analysis = await PhotoReview.analyze(photoId, { mode: 'component', systemType: est.system.type, categories, findings });
      if (analysis) {
        const review = await PhotoReview.open({ photoId, analysis, findings, categories,
          rows: ['component', 'manufacturer', 'model', 'condition', 'finding_code'] });
        if (review) {
          const a = review.accepted;
          const hit = a.finding_code && findings.find(f => f.code === a.finding_code);
          prefill = { category: a.component || (hit && hit.category), findingId: hit && hit.id, hint: a.condition };
          confirmedIds = { manufacturer: a.manufacturer, model: a.model };
          // Kept with the photo for your records; never shown to the customer.
          entry.analysis = { ...analysis, decisions: review.decisions };
        }
      }
    } else {
      U.toast('Photo analysis is not set up — choose the component and problem manually.');
    }
    const res = await ProblemWizard.open({ systemType: est.system.type, prefill, photoId, known: knownSizes() });
    if (!res) {
      est.photos.push({ ...entry, include: false });
      scheduleSave(); await flush(); await render();
      U.toast('Photo kept under General photos (hidden from the customer).');
      return;
    }
    const f = addProblem(res, entry, confirmedIds);
    scheduleSave(); await flush(); await render(); focusIn(`#f-${f.id}`);
  }

  async function readLabel() {
    const photoId = await importOne(false);
    if (!photoId) return;
    const entry = { id: photoId, caption: 'Rating label', include: false };
    est.photos.push(entry);
    if (!(await AI.configured())) {
      scheduleSave(); await flush(); await render();
      U.toast('Photo analysis is not set up — the label photo is saved; enter the manufacturer and model manually.');
      focusIn('#sec-system .gas-ids');
      return;
    }
    const analysis = await PhotoReview.analyze(photoId, { mode: 'label', systemType: 'gas', categories: categoryList([]), findings: [] });
    if (analysis) {
      const review = await PhotoReview.open({ photoId, analysis, rows: ['manufacturer', 'model'] });
      if (review) {
        entry.analysis = { ...analysis, decisions: review.decisions };
        if (review.accepted.manufacturer) est.system.manufacturer = review.accepted.manufacturer;
        if (review.accepted.model) est.system.model = review.accepted.model;
      }
    }
    scheduleSave(); await flush(); await render(); focusIn('#sec-system .gas-ids');
  }

  async function generateTitleScope() {
    const comps = est.components.filter(c => c.findings.length);
    if (!comps.length) { U.toast('Add at least one problem first.', 'error'); return; }
    const edited = (est.title && est.title !== est.generated.title) || (est.scopeText && est.scopeText !== est.generated.scope);
    if (edited && !await U.confirm('Replace your edited title and description with newly written text?')) return;
    const title = Generate.title(est);
    const text = Generate.scope(est, { businessName: (await Store.settings()).businessName });
    est.title = title; est.scopeText = text;
    est.generated = { title, scope: text };
    scheduleSave(); await render(); focusIn('#sec-review .review-fields');
  }

  // ---------- pickers ----------
  function pickFinding(component) {
    return new Promise(async resolve => {
      const items = (await usableFindings()).sort((a, b) => a.code.localeCompare(b.code));
      const cat = (component.category || '').trim().toLowerCase();
      const hasCat = cat && items.some(i => i.category.toLowerCase() === cat);
      let done = false;
      U.modal({
        title: 'Select a finding',
        wide: true,
        body: `
          <div class="toolbar">
            <label class="search"><span class="sr-only">Search findings</span><input type="search" id="pk-q" placeholder="Search code, name, description…"></label>
            ${hasCat ? `<label class="check"><input type="checkbox" id="pk-cat" checked> Only “${esc(component.category)}”</label>` : ''}
          </div>
          <ul class="pick-list" id="pk-list"></ul>
          <div class="modal-actions"><button type="button" data-pick="custom">Write a custom finding</button><button type="button" data-close>Cancel</button></div>
          <p class="muted small">Press Enter in the search box to choose the first match.</p>`,
        onMount: (dlg, close) => {
          const q = U.$('#pk-q', dlg), list = U.$('#pk-list', dlg), only = U.$('#pk-cat', dlg);
          let shown = [];
          const draw = () => {
            shown = items.filter(i => (!only || !only.checked || i.category.toLowerCase() === cat)
              && U.matches(q.value, [i.code, i.name, i.description, i.category, i.systemType]));
            list.innerHTML = shown.map(i => `<li><button type="button" class="pick" data-pick="${esc(i.id)}">
              <span class="code">${esc(i.code)}</span> <strong>${esc(i.name)}</strong> <span class="muted small">${esc(i.category)}${i.systemType ? ' · ' + esc(i.systemType) : ''}</span>
              <span class="pick-desc">${esc(i.description)}</span></button></li>`).join('')
              || '<li class="muted">No catalog findings match. Write a custom finding or add one to the catalog.</li>';
          };
          draw();
          q.addEventListener('input', draw);
          only && only.addEventListener('change', draw);
          q.addEventListener('keydown', e => { if (e.key === 'Enter' && shown[0]) { e.preventDefault(); done = true; close(); resolve(shown[0]); } });
          dlg.addEventListener('click', e => {
            const b = e.target.closest('[data-pick]');
            if (!b) return;
            done = true;
            close();
            resolve(b.dataset.pick === 'custom' ? 'custom' : items.find(i => i.id === b.dataset.pick));
          });
          q.focus();
        },
        onClose: () => { if (!done) resolve(null); },
      });
    });
  }

  function pickRepairs(finding) {
    return new Promise(async resolve => {
      const items = (await Store.catalog('repairs')).filter(r => Store.appliesTo(r, est.system.type)).sort((a, b) => a.code.localeCompare(b.code));
      const source = finding.sourceId ? await DB.get('findings', finding.sourceId) : null;
      const suggestedIds = new Set(source ? source.relatedIds || [] : []);
      const suggested = items.filter(i => suggestedIds.has(i.id));
      const rest = items.filter(i => !suggestedIds.has(i.id));
      let done = false;
      const row = i => `<li><label class="pick check-pick">
        <input type="checkbox" value="${esc(i.id)}">
        <span><span class="code">${esc(i.code)}</span> <strong>${esc(i.name)}</strong> <span class="muted small">${esc(i.category)}</span>
        <span class="pick-desc">${esc(i.description)}</span></span></label></li>`;
      U.modal({
        title: `Proposed repairs for: ${finding.name || 'finding'}`,
        wide: true,
        body: `
          <p class="muted small">Check one or more repairs. Nothing is selected for you — suggestions come from the catalog links you set up.</p>
          <label class="search"><span class="sr-only">Search repairs</span><input type="search" id="pr-q" placeholder="Search repairs…"></label>
          <div id="pr-lists"></div>
          <div class="modal-actions">
            <button type="button" data-act="custom">Add a custom repair</button>
            <button type="button" data-close>Skip for now</button>
            <button type="button" class="primary" data-act="add">Add selected</button>
          </div>`,
        onMount: (dlg, close) => {
          const q = U.$('#pr-q', dlg), lists = U.$('#pr-lists', dlg);
          const checked = new Set();
          const draw = () => {
            const m = i => U.matches(q.value, [i.code, i.name, i.description, i.category]);
            const s = suggested.filter(m), r = rest.filter(m);
            lists.innerHTML = `
              ${s.length ? `<h4>Suggested for this finding</h4><ul class="pick-list">${s.map(row).join('')}</ul>` : ''}
              <h4>${s.length ? 'All other repairs' : 'Repairs'}</h4>
              <ul class="pick-list">${r.map(row).join('') || '<li class="muted">No matches.</li>'}</ul>`;
            U.$$('input[type=checkbox]', lists).forEach(cb => { cb.checked = checked.has(cb.value); });
          };
          draw();
          q.addEventListener('input', draw);
          lists.addEventListener('change', e => { if (e.target.checked) checked.add(e.target.value); else checked.delete(e.target.value); });
          dlg.addEventListener('click', e => {
            const b = e.target.closest('[data-act]');
            if (!b) return;
            const picked = items.filter(i => checked.has(i.id));
            if (b.dataset.act === 'custom') picked.push('custom');
            done = true;
            close();
            resolve(picked);
          });
          (U.$('input[type=checkbox]', lists) || q).focus();
        },
        onClose: () => { if (!done) resolve([]); },
      });
    });
  }

  const mediaEntry = m => ({ id: m.id, caption: '', include: true, kind: m.kind, name: m.name, size: m.size, playable: m.playable });

  function pickFiles(multiple) {
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*,video/*';
      input.multiple = multiple;
      input.addEventListener('change', () => resolve(Array.from(input.files || [])));
      input.addEventListener('cancel', () => resolve([]));
      input.click();
    });
  }

  async function importAll(files) {
    const out = [];
    for (const f of files) {
      try { out.push(await Photos.importMedia(f, est.id)); } catch (err) { U.toast(err.message, 'error'); }
    }
    return out;
  }

  async function addPhotos(arrPath) {
    const files = await pickFiles(true);
    if (!files.length) return;
    U.toast(`Saving ${files.length} file${files.length === 1 ? '' : 's'}…`);
    const added = await importAll(files);
    if (!added.length) return;
    U.getPath(est, arrPath).push(...added.map(mediaEntry));
    scheduleSave(); await flush(); await render();
    const unplayable = added.filter(m => !m.playable).length;
    U.toast(`Added ${added.length} file${added.length === 1 ? '' : 's'}${unplayable ? ` — ${unplayable} video${unplayable === 1 ? '' : 's'} can't be previewed in this browser but ${unplayable === 1 ? 'is' : 'are'} saved` : ''}`);
  }

  async function replaceMedia(arrPath, i) {
    const [file] = await pickFiles(false);
    if (!file) return;
    const [m] = await importAll([file]);
    if (!m) return;
    const list = U.getPath(est, arrPath);
    const old = list[i];
    list[i] = { ...mediaEntry(m), caption: old.caption, include: old.include };
    await Photos.remove([old.id]);
    scheduleSave(); await flush(); await render();
    U.toast('File replaced');
  }

  // "Attached to" select: move a photo/video to another estimate item.
  async function moveMedia(fromPath, toArr) {
    const fromArr = fromPath.replace(/\.\d+$/, '');
    const i = Number(fromPath.split('.').pop());
    const [entry] = U.getPath(est, fromArr).splice(i, 1);
    U.getPath(est, toArr).push(entry);
    scheduleSave(); await flush(); await render();
    U.toast('Moved');
  }

  function focusIn(selector) {
    const el = U.$(selector, root);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const target = U.$('input, textarea, select', el);
    target && target.focus({ preventScroll: true });
  }

  function validateRequired(showAll) {
    let ok = true;
    for (const el of U.$$('[required]', root)) {
      const empty = !String(el.value).trim();
      if (empty) ok = false;
      const msg = U.$(`[data-err-for="${el.id}"]`, root);
      if (showAll || el.dataset.touched) {
        el.toggleAttribute('aria-invalid', empty);
        if (msg) msg.hidden = !empty;
      }
    }
    return ok;
  }

  // ---------- actions ----------
  async function onAction(btn) {
    const a = btn.dataset.action;
    const arr = btn.dataset.arr ? U.getPath(est, btn.dataset.arr) : null;
    const i = Number(btn.dataset.i);

    if (a === 'add-component') {
      const c = Store.newComponent();
      est.components.push(c);
      scheduleSave(); await render(); focusIn(`#c-${c.id}`);
    }

    if (a === 'remove') {
      const item = arr[i];
      const what = btn.dataset.what;
      const findingMedia = f => [...f.photos, ...f.repairs.flatMap(r => r.photos)];
      const photoIds = (what === 'component' ? item.findings.flatMap(findingMedia)
        : what === 'finding' ? findingMedia(item) : item.photos || []).map(p => p.id);
      const hasContent = what === 'component' ? item.findings.length : true;
      if (hasContent && !await U.confirm(`Remove this ${what}${photoIds.length ? ` and its ${photoIds.length} photo/video file(s)` : ''}?`)) return;
      arr.splice(i, 1);
      await Photos.remove(photoIds);
      scheduleSave(); await render();
    }

    if (a === 'move') {
      const j = i + Number(btn.dataset.dir);
      if (j < 0 || j >= arr.length) return;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      scheduleSave(); await render();
    }

    if (a === 'add-finding') {
      const c = est.components[i];
      const pick = await pickFinding(c);
      if (!pick) return;
      const f = Store.findingSnapshot(pick === 'custom' ? null : pick);
      if (!c.category && pick !== 'custom') c.category = pick.category;
      c.findings.push(f);
      openKeys.add(`item:${f.id}`);
      scheduleSave(); await render();
      if (pick !== 'custom') {
        const repairs = await pickRepairs(f);
        repairs.forEach(r => f.repairs.push(Store.repairSnapshot(r === 'custom' ? null : r)));
        if (repairs.length) { scheduleSave(); await render(); }
      }
      focusIn(`#f-${f.id}`);
    }

    if (a === 'add-repair') {
      const f = U.getPath(est, btn.dataset.path);
      const repairs = await pickRepairs(f);
      if (!repairs.length) return;
      const snaps = repairs.map(r => Store.repairSnapshot(r === 'custom' ? null : r));
      f.repairs.push(...snaps);
      scheduleSave(); await render(); focusIn(`#r-${snaps[0].id}`);
    }

    if (a === 'add-row') {
      arr.push(btn.dataset.kind === 'detail' ? { label: '', value: '', unit: '', internal: false } : { label: '', value: '', unit: '' });
      shownRows.add(`${btn.dataset.arr}.${arr.length - 1}`);
      scheduleSave(); await render();
      const rows = U.$$(`[data-bind^="${btn.dataset.arr}."][data-bind$=".label"]`, root);
      rows.length && rows[rows.length - 1].focus();
    }

    if (a === 'add-size') {
      const row = { label: btn.dataset.label, value: '', unit: btn.dataset.unit };
      if (/\.details$/.test(btn.dataset.arr)) row.internal = false;
      arr.push(row);
      shownRows.add(`${btn.dataset.arr}.${arr.length - 1}`);
      scheduleSave(); await render();
      U.$(`[data-size="${btn.dataset.arr}.${arr.length - 1}"]`, root)?.focus();
    }

    if (a === 'show-row') {
      shownRows.add(btn.dataset.path);
      await render();
      U.$(`[data-size="${btn.dataset.path}"], [data-bind="${btn.dataset.path}.value"]`, root)?.focus();
    }

    if (a === 'size-list') {
      otherRows.delete(btn.dataset.path);
      U.setPath(est, `${btn.dataset.path}.value`, '');
      scheduleSave(); await render();
      U.$(`[data-size="${btn.dataset.path}"]`, root)?.focus();
    }

if (a === 'goto') focusIn(btn.dataset.target);

if (a === 'expand-all' || a === 'collapse-all') {
  const open = a === 'expand-all';
  U.$$('details.item', root).forEach(d => { d.open = open; if (open) openKeys.add(d.dataset.key); else openKeys.delete(d.dataset.key); });
}

    if (a === 'use-item-total') {
      const t = Store.priceSummary(est).itemTotal;
      if (t == null) return;
      est.pricing.packagePrice = String(t);
      scheduleSave(); await render(); U.$('[data-bind="pricing.packagePrice"]', root)?.focus();
    }

    if (a === 'delete-note') {
      if (!(await U.confirm('Delete this private note?', 'Delete note'))) return;
      est.clientNote = '';
      scheduleSave(); await flush(); await render();
      U.toast('Private note deleted');
    }

    if (a === 'remove-row') { arr.splice(i, 1); scheduleSave(); await render(); }

    if (a === 'add-photos') addPhotos(btn.dataset.arr);
    if (a === 'replace-media') replaceMedia(btn.dataset.arr, i);

    if (a === 'remove-photo') {
      if (!await U.confirm('Remove this file?')) return;
      const [ph] = arr.splice(i, 1);
      await Photos.remove([ph.id]);
      scheduleSave(); await render();
    }

    if (a === 'add-problem') guidedProblem();
    if (a === 'photo-problem') photoProblem(!!btn.dataset.capture);
    if (a === 'read-label') readLabel();
    if (a === 'generate') generateTitleScope();

    if (a === 'identify') {
      const c = est.components[i];
      IdentifyDialog.open(c, () => { scheduleSave(); render(); });
    }

    if (a === 'save-pdf') { await flush(); PreviewView.savePdf(est, Customer.model(est, await Store.settings())); return; }
    if (a === 'copy-customer') {
      const ok = await U.copyText(Customer.text(Customer.model(est, lastSettings)));
      U.toast(ok ? 'Customer text copied' : 'Copy failed', ok ? '' : 'error');
      return;
    }
    if (a === 'copy-private') {
      // For pasting into WhatsApp yourself, e.g. if a very long message doesn't arrive whole through the link.
      const ok = await U.copyText(PrivateCopy.text(est, lastSettings));
      U.toast(ok ? 'Private text copied — paste it only into your own chat' : 'Copy failed', ok ? '' : 'error');
      return;
    }
    if (a === 'share-private-pdf') {
      await flush();
      try {
        await PrivateCopy.sharePdf(est, await Store.settings());
        est.privateCopy = PrivateCopy.entry('shared');
      } catch (err) {
        est.privateCopy = err && err.name === 'AbortError' ? PrivateCopy.entry('cancelled') : PrivateCopy.entry('failed', err.message);
      }
      scheduleSave(); await flush(); await render(); return;
    }
    if (a === 'private-sent' || a === 'private-not-sent') {
      est.privateCopy = a === 'private-sent' ? PrivateCopy.entry('confirmed') : PrivateCopy.entry('cancelled');
      scheduleSave(); await flush(); await render();
      U.toast(a === 'private-sent' ? 'Marked as sent' : 'Marked as not sent');
      return;
    }
    if (a === 'toggle-status') {
      if (est.status === 'draft') {
        const nF = est.components.reduce((n, c) => n + c.findings.length, 0);
        if (!validateRequired(true)) { U.toast('Customer name and date are required before presenting.', 'error'); U.$('[aria-invalid]', root)?.focus(); return; }
        if (!nF) { U.toast('Add at least one finding before presenting.', 'error'); return; }
        const scopeErr = presentBlocker(est);
        if (scopeErr) { U.toast(scopeErr, 'error'); focusIn('#sec-review .review-fields'); return; }
        est.status = 'presented';
        est.presentedAt = new Date().toISOString();
      } else {
        est.status = 'draft';
      }
      scheduleSave(); await flush(); await render();
      U.toast(est.status === 'presented' ? 'Marked as presented' : 'Moved back to draft');
    }

    if (a === 'duplicate') {
      await flush();
      const copy = await Store.duplicateEstimate(est.id);
      U.toast(`Duplicated as ${copy.number}`);
      location.hash = `#/estimates/${copy.id}`;
    }

    if (a === 'delete-estimate') {
      if (!await U.confirm(`Delete estimate ${est.number}? This also deletes its photos and cannot be undone.`)) return;
      clearTimeout(saveTimer); dirty = false;
      await Store.deleteEstimate(est.id);
      est = null;
      U.toast('Estimate deleted');
      location.hash = '#/estimates';
    }
  }

  // A standard size was chosen from the list ("Other…" switches the row to manual entry).
  async function pickSize(select, path) {
    const row = U.getPath(est, path);
    if (select.value === '__other') {
      otherRows.add(path);
      row.value = '';
      scheduleSave(); await render();
      U.$(`[data-bind="${path}.value"]`, root)?.focus();
      return;
    }
    row.value = select.value;
    refreshSummary(path);
    if (!row.unit) {
      const comp = est.components[Number(path.split('.')[1])];
      const type = Sizes.match(Sizes.forCategory(sizeLib, comp.category), row.label);
      if (type) { row.unit = type.unit; const u = U.$(`[data-bind="${path}.unit"]`, root); if (u) u.value = type.unit; }
    }
    scheduleSave();
  }

// Keep a collapsed item's summary line current while its fields are edited.
function refreshSummary(path) {
  const m = /^components\.(\d+)\.findings\.(\d+)/.exec(path);
  const f = m && est.components[m[1]] && est.components[m[1]].findings[m[2]];
  const el = f && U.$(`#f-${f.id} [data-live=sum]`, root);
  if (el) el.textContent = itemSummary(f);
}

// Update the problem buttons' enabled state while gas manufacturer/model are typed.
  function refreshGate() {
    const g = systemGate();
    U.$$('#sec-items .big-actions button', root).forEach(b => b.toggleAttribute('aria-disabled', !!g));
    const hint = U.$('#sec-items .big-actions + .hint', root);
    if (hint && g) hint.textContent = g;
    else if (hint && /first\.$/.test(hint.textContent)) hint.textContent = 'Ready — add the problems you found.';
  }

  // ---------- mount ----------
  async function show(id, mount) {
    const rec = await DB.get('estimates', id);
    if (!rec) {
      mount.innerHTML = `<div class="empty-state"><h2>Estimate not found</h2><p>It may have been deleted.</p><a class="btn" href="#/estimates">Back to estimates</a></div>`;
      return;
    }
    est = Store.normalize(rec);
    dirty = false;
    root = mount;
    justPreviewed = PreviewView.lastViewed === id;
    PreviewView.lastViewed = null;
    await render();
    if (justPreviewed) { justPreviewed = false; U.$('#sec-deliver', root)?.scrollIntoView({ block: 'start' }); }
    if (!est.system.type) U.$('input[name=sys-type]', root)?.focus();

    const onEdit = e => {
      const el = e.target;
      const path = el.dataset && el.dataset.bind;
      if (!path) return;
      U.setPath(est, path, el.type === 'checkbox' ? el.checked : el.value);
      if (path === 'customer.name') U.$('[data-live=heading]', root).textContent = el.value || 'Unnamed client';
      if (/^(customer\.name|date|title|scopeText|system\.)/.test(path)) setTimeout(refreshProgress);
      // Pricing: the mode and discount category change which fields show; amounts just update totals.
      if (path === 'pricing.mode' || path === 'discount.category') {
        if (path === 'discount.category' && !el.value) est.discount.show = false;
        scheduleSave();
        render().then(() => U.$(`[data-bind="${path}"]${el.type === 'radio' ? `[value="${el.value}"]` : ''}`, root)?.focus());
        return;
      }
      if (/^(pricing|discount)\./.test(path)) setTimeout(refreshPricing);
      if (path === 'scopeText') {
        const n = el.value.length;
        const out = U.$('[data-live=scope-count]', root);
        out.textContent = `${n.toLocaleString()} characters`;
      }
      // System type changes which questions follow, so redraw that part.
      if (path === 'system.type' || /^system\.(manufacturer|model)$/.test(path)) {
        scheduleSave();
        if (path === 'system.type') render().then(() => U.$(`input[name=sys-type][value=${el.value}]`, root)?.focus());
        else refreshGate();
        return;
      }
      if (/photos\.\d+\.include$/.test(path)) el.closest('figure').classList.toggle('excluded', !el.checked);
      if (/\.internal$/.test(path)) el.closest('.vrow').classList.toggle('is-private', el.checked);
      // Keep card headings in sync without re-rendering (which would steal focus).
      if (/\.findings\.\d+(\.repairs\.\d+)?\.name$/.test(path)) {
        const card = el.closest('.repair, .finding');
        const t = card && U.$(':scope > .item-head .item-title, :scope > summary .item-title', card);
        if (t) t.textContent = el.value || 'Untitled';
      }
      refreshSummary(path);
      if (/^components\.\d+\.(category|location)$/.test(path)) {
        U.$('.comp-head h3', el.closest('.comp')).textContent = Store.componentLabel(U.getPath(est, path.split('.').slice(0, 2).join('.')));
      }
      scheduleSave();
    };
    root.addEventListener('input', e => { if (e.target.type !== 'checkbox' && e.target.tagName !== 'SELECT') onEdit(e); });
    root.addEventListener('change', e => {
      const sizePath = e.target.dataset && e.target.dataset.size;
      if (sizePath) { pickSize(e.target, sizePath); return; }
      if (e.target.dataset && e.target.dataset.move) { moveMedia(e.target.dataset.move, e.target.value); return; }
      if (e.target.type === 'checkbox' || e.target.tagName === 'SELECT') onEdit(e);
    });
    root.addEventListener('focusout', e => { if (e.target.required) { e.target.dataset.touched = '1'; validateRequired(false); } });
    root.addEventListener('click', e => {
      const wa = e.target.closest('[data-wa]');
      if (wa) {
        try {
          wa.href = PrivateCopy.link(PrivateCopy.text(est, lastSettings));
          est.privateCopy = PrivateCopy.entry('opened');
        } catch (err) {
          e.preventDefault();
          est.privateCopy = PrivateCopy.entry('failed', err.message);
        }
        scheduleSave(); flush().then(render);
        return;
      }
      const btn = e.target.closest('[data-action]');
      if (btn && root.contains(btn)) {
        e.preventDefault();
        const menu = btn.closest('details.more');
        if (menu) menu.open = false;
        onAction(btn);
      }
    });
    root.addEventListener('toggle', e => {
      const d = e.target;
      if (d.tagName !== 'DETAILS' || !d.dataset.key) return;
      if (d.open) openKeys.add(d.dataset.key); else openKeys.delete(d.dataset.key);
    }, true);
  }

  function leave() { return flush().then(() => { est = null; root = null; }); }

  return { show, flush, leave, presentBlocker };
})();
