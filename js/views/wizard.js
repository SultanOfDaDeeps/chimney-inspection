'use strict';

// Guided "what's wrong?" flow: component -> problem -> measurements -> repair, filtered by
// system type. Mostly taps; only a few relevant choices are shown at a time. Typing is only
// needed for a custom problem/repair, an unusual size, or an optional note.
const ProblemWizard = (() => {
  const esc = U.esc;
  const order = cat => { const i = CATEGORIES.findIndex(([c]) => c.toLowerCase() === cat.toLowerCase()); return i < 0 ? 999 : i; };
  const STATUSES = [['', 'No status'], ['confirmed', 'Confirmed'], ['suspected', 'Suspected'], ['further', 'Needs evaluation']];
  const LABELS = { component: 'Component', problem: 'Problem', sizes: 'Measurements', repairs: 'Repair' };

  // prefill: { category, findingId, hint } — values the user already confirmed from a photo.
  // known: { [label lowercased]: { value, unit } } — measurements already entered on this estimate.
  function open({ systemType, prefill = {}, photoId = null, known = {} }) {
    return new Promise(async resolve => {
      const [allF, allR, sizeLib] = await Promise.all([Store.catalog('findings'), Store.catalog('repairs'), Sizes.all()]);
      const findings = allF.filter(f => Store.appliesTo(f, systemType)).sort((a, b) => a.code.localeCompare(b.code));
      const repairs = allR.filter(r => Store.appliesTo(r, systemType)).sort((a, b) => a.code.localeCompare(b.code));
      const cats = [...new Set(findings.map(f => f.category).filter(Boolean))].sort((a, b) => order(a) - order(b) || a.localeCompare(b));
      const match = c => cats.find(x => x.toLowerCase() === String(c || '').trim().toLowerCase());
      const photoUrl = photoId ? await Photos.url(photoId, 'thumb') : null;

      const st = {
        step: 'component', category: match(prefill.category) || '', otherCategory: '',
        finding: null, custom: null, status: '', checked: new Set(), customRepair: null, note: '',
        more: 0, showMore: false, sizes: {}, fromEarlier: new Set(), sizesSeeded: false, repairsSeeded: false,
      };
      if (!match(prefill.category) && prefill.category) st.otherCategory = prefill.category;
      let done = false;

      const types = () => Sizes.forCategory(sizeLib, st.category);
      const names = () => ['component', 'problem', 'repairs', ...(types().length ? ['sizes'] : [])];
      // Measurements the chosen problem and repairs actually use come first; the rest wait behind "More measurements".
      const isRelevant = () => {
        const labels = [...(st.finding ? st.finding.fields : []), ...repairs.filter(r => st.checked.has(r.id)).flatMap(r => r.fields)].map(f => f.label);
        const rel = new Set(types().filter(t => labels.some(l => Sizes.match([t], l)) || st.sizes[t.label]).map(t => t.label));
        if (!rel.size && types().length) rel.add(types()[0].label);
        return t => rel.has(t.label);
      };
      const photoSide = photoUrl ? `<img class="wiz-photo" src="${esc(photoUrl)}" alt="Photo for this problem">` : '';
      const hint = prefill.hint ? `<p class="hint">From photo (confirmed): ${esc(prefill.hint)}</p>` : '';
      const problemName = () => (st.finding ? st.finding.name : st.custom ? st.custom.name : '');

      function stepComponent() {
        return `<h3>Which component?</h3>${hint}
          <div class="chips">${cats.map(c => `<button type="button" class="chip ${c === st.category ? 'selected' : ''}" data-cat="${esc(c)}">${esc(c)}${c === match(prefill.category) ? ' <span class="tag cust-tag">photo</span>' : ''}</button>`).join('')}</div>
          <div class="other-row"><label for="wz-other" class="label-like">Other component</label>
            <input id="wz-other" value="${esc(st.otherCategory)}" placeholder="Type a component…"><button type="button" data-go="other">Next</button></div>`;
      }

      function stepProblem() {
        const list = findings.filter(f => f.category === st.category);
        return `<h3>What's wrong with the ${esc(st.category)}?</h3>${hint}
          <ul class="pick-list">${list.map(f => `<li><button type="button" class="pick ${prefill.findingId === f.id || (st.finding && st.finding.id === f.id) ? 'suggested' : ''}" data-finding="${esc(f.id)}">
            <strong>${esc(f.name)}</strong>${prefill.findingId === f.id ? ' <span class="tag cust-tag">photo</span>' : ''}
            <span class="pick-desc">${esc(f.description)}</span></button></li>`).join('')
            || '<li class="muted small">No catalog problems for this component yet — describe it below.</li>'}</ul>
          <details class="sub" ${list.length ? '' : 'open'}><summary>Something else</summary><div class="sub-body">
            <div class="field"><label for="wz-fname">Problem name</label><input id="wz-fname" value="${esc(st.custom?.name || '')}"></div>
            <div class="field"><label for="wz-fdesc">Customer-facing description</label><textarea id="wz-fdesc" rows="2">${esc(st.custom?.description || '')}</textarea></div>
            <button type="button" data-go="custom-finding">Next</button>
          </div></details>
          <div class="field compact"><span class="label-like">Status <span class="opt">optional</span></span>
            <div class="seg" role="radiogroup" aria-label="Finding status">
              ${STATUSES.map(([v, l]) => `<label class="seg-btn small"><input type="radio" name="wz-status" value="${v}" ${st.status === v ? 'checked' : ''}> ${l}</label>`).join('')}
            </div></div>`;
      }

      // Measurements for this component: tap a standard size or type an unusual one. All optional.
      function stepSizes() {
        const rel = isRelevant();
        const row = (t, ti) => {
          const cur = st.sizes[t.label] ? st.sizes[t.label].value : '';
          const custom = cur && !t.options.includes(cur);
          return `<div class="size-row"><span class="label-like">${esc(t.label)}${t.unit ? ` <span class="opt">${esc(t.unit)}</span>` : ''}
              ${st.fromEarlier.has(t.label) && cur ? '<span class="tag cust-tag">from earlier in this estimate</span>' : ''}</span>
            <div class="chips">${t.options.map(o => `<button type="button" class="chip small ${o === cur ? 'selected' : ''}" data-size="${ti}" data-val="${esc(o)}" aria-pressed="${o === cur}">${esc(o)}</button>`).join('')}
              <input class="size-other" data-size-other="${ti}" placeholder="Other" aria-label="Other ${esc(t.label)}" value="${custom ? esc(cur) : ''}" inputmode="decimal"></div></div>`;
        };
        const all = types().map((t, ti) => [t, ti]);
        // At most two up front: the ones this repair uses (or already filled); everything else waits.
        const main = all.filter(([t]) => rel(t)).slice(0, 2);
        const more = all.filter(entry => !main.includes(entry));
        return `<h3>Measurements <span class="opt">optional</span></h3>
          <p class="muted small">The sizes used for ${esc(problemName() || 'this item')}. Tap one, type an unusual size, or skip.</p>
          ${main.map(([t, ti]) => row(t, ti)).join('')}
          ${more.length ? (st.showMore ? `<h4>More measurements</h4>${more.map(([t, ti]) => row(t, ti)).join('')}`
            : `<button type="button" class="small" data-go="more-sizes">More measurements (${more.length})</button>`) : ''}`;
      }

      function stepRepairs() {
        const suggestedIds = new Set(st.finding ? st.finding.relatedIds : []);
        const suggested = repairs.filter(r => suggestedIds.has(r.id));
        const sameCat = repairs.filter(r => !suggestedIds.has(r.id) && r.category === st.category);
        const rest = repairs.filter(r => !suggestedIds.has(r.id) && r.category !== st.category);
        // Preselect only when the catalog links exactly one repair to this problem; the user still confirms.
        if (!st.repairsSeeded) { st.repairsSeeded = true; if (suggested.length === 1) st.checked.add(suggested[0].id); }
        const row = r => `<li><label class="pick check-pick"><input type="checkbox" value="${esc(r.id)}" ${st.checked.has(r.id) ? 'checked' : ''}>
          <span><strong>${esc(r.name)}</strong>
          <span class="pick-desc">${esc(r.description)}</span></span></label></li>`;
        const group = (title, list) => (list.length ? `<h4>${esc(title)}</h4><ul class="pick-list">${list.map(row).join('')}</ul>` : '');
        const showSame = st.more >= 1 || !suggested.length;
        const showRest = st.more >= 2;
        const moreBtn = !showSame && sameCat.length ? `<button type="button" class="small" data-go="more">More ${esc(st.category)} options (${sameCat.length})</button>`
          : !showRest && rest.length ? `<button type="button" class="small" data-go="more">Show other components' repairs (${rest.length})</button>` : '';
        return `<h3>Recommended repair</h3>
          <p class="muted small">For: <strong>${esc(problemName())}</strong> (${esc(st.category)}).
            ${suggested.length === 1 && st.checked.has(suggested[0].id) ? 'The one repair linked to this problem is preselected — uncheck it if it isn\'t needed.' : 'Check what you recommend.'}</p>
          ${group('Suggested', suggested)}
          ${showSame ? group(suggested.length ? `More ${st.category} options` : `${st.category} repairs`, sameCat) : ''}
          ${showRest ? group('Other repairs', rest) : ''}
          ${moreBtn}
          <details class="sub" ${st.customRepair ? 'open' : ''}><summary>Custom repair</summary><div class="sub-body">
            <div class="field"><label for="wz-rname">Repair name</label><input id="wz-rname" value="${esc(st.customRepair?.name || '')}"></div>
            <div class="field"><label for="wz-rdesc">Customer-facing description</label><textarea id="wz-rdesc" rows="2">${esc(st.customRepair?.description || '')}</textarea></div>
          </div></details>
          <div class="field"><label for="wz-note">Short note <span class="opt">optional, customer sees</span></label>
            <input id="wz-note" value="${esc(st.note)}" placeholder="e.g. Matches existing brick color"></div>`;
      }

      const STEPS = { component: stepComponent, problem: stepProblem, sizes: stepSizes, repairs: stepRepairs };

      U.modal({
        title: 'Add a problem',
        wide: true,
        body: `<div class="wiz"><ol class="wiz-steps"></ol><div class="wiz-main"><div class="wiz-side">${photoSide}</div><div class="wiz-body"></div></div>
          <p class="form-error" role="alert" hidden></p>
          <div class="modal-actions"><button type="button" data-go="back">← Back</button><span class="spacer"></span>
            <button type="button" data-close>Cancel</button>
            <button type="button" data-go="skip-sizes" hidden>Skip measurements</button>
            <button type="button" class="primary" data-go="next" hidden>Next →</button>
            <button type="button" class="primary" data-go="finish" hidden>Add to estimate</button></div></div>`,
        onMount: (dlg, close) => {
          const $ = s => U.$(s, dlg);
          const err = m => { $('.form-error').textContent = m || ''; $('.form-error').hidden = !m; };
          const go = step => {
            if (step === 'sizes' && !st.sizesSeeded) {
              st.sizesSeeded = true;
              // Reuse measurements already entered on this estimate (shown and editable, never hidden).
              for (const t of types()) {
                const k = [t.label, ...(t.aliases || [])].map(l => l.toLowerCase()).find(l => known[l]);
                if (k) { st.sizes[t.label] = { label: t.label, unit: known[k].unit || t.unit, value: known[k].value }; st.fromEarlier.add(t.label); }
              }
            }
            st.step = step; draw();
          };
          const afterProblem = () => go('repairs');
          const isLast = () => st.step === names()[names().length - 1];
          const draw = () => {
            err('');
            const ns = names();
            $('.wiz-steps').innerHTML = ns.map((n, i) => `<li class="${n === st.step ? 'current' : ns.indexOf(st.step) > i ? 'done' : ''}">${LABELS[n]}</li>`).join('');
            $('.wiz-body').innerHTML = STEPS[st.step]();
            $('[data-go=back]').hidden = st.step === 'component';
            $('[data-go=next]').hidden = st.step !== 'repairs' || isLast();
            $('[data-go=skip-sizes]').hidden = st.step !== 'sizes';
            $('[data-go=finish]').hidden = !isLast() || st.step === 'component' || st.step === 'problem';
            const first = $('.wiz-body .chip.selected, .wiz-body .pick.suggested, .wiz-body button, .wiz-body input');
            first && first.focus({ preventScroll: true });
            $('.wiz-body').scrollIntoView({ block: 'nearest' });
          };
          const setSize = (ti, value) => {
            const t = types()[ti];
            st.fromEarlier.delete(t.label);
            if (value) st.sizes[t.label] = { label: t.label, unit: t.unit, value };
            else delete st.sizes[t.label];
          };
          const readCustomRepair = () => {
            if (st.step !== 'repairs') return;
            const name = ($('#wz-rname') || {}).value?.trim() || '';
            const description = ($('#wz-rdesc') || {}).value?.trim() || '';
            st.customRepair = name || description ? { name, description } : null;
            st.note = ($('#wz-note') || {}).value?.trim() || '';
          };

          dlg.addEventListener('change', e => {
            if (e.target.name === 'wz-status') st.status = e.target.value;
            if (e.target.dataset.sizeOther !== undefined) setSize(Number(e.target.dataset.sizeOther), e.target.value.trim());
            if (e.target.type === 'checkbox' && st.step === 'repairs') {
              if (e.target.checked) st.checked.add(e.target.value); else st.checked.delete(e.target.value);
            }
          });
          dlg.addEventListener('keydown', e => {
            if (e.key === 'Enter' && e.target.id === 'wz-other') { e.preventDefault(); $('[data-go=other]').click(); }
          });
          dlg.addEventListener('click', e => {
            const cat = e.target.closest('[data-cat]');
            if (cat) {
              if (cat.dataset.cat !== st.category) { st.sizes = {}; st.fromEarlier.clear(); st.sizesSeeded = false; }
              st.category = cat.dataset.cat; go('problem'); return;
            }
            const fb = e.target.closest('[data-finding]');
            if (fb) {
              const f = findings.find(x => x.id === fb.dataset.finding);
              if (!st.finding || st.finding.id !== f.id) { st.checked.clear(); st.repairsSeeded = false; }
              st.finding = f; st.custom = null; afterProblem(); return;
            }
            const sb = e.target.closest('[data-size]');
            if (sb) {
              const t = types()[Number(sb.dataset.size)];
              const same = st.sizes[t.label] && st.sizes[t.label].value === sb.dataset.val;
              setSize(Number(sb.dataset.size), same ? '' : sb.dataset.val);
              draw();
              $(`[data-size="${sb.dataset.size}"][data-val="${CSS.escape(sb.dataset.val)}"]`)?.focus();
              return;
            }
            const btn = e.target.closest('[data-go]');
            if (!btn) return;
            const g = btn.dataset.go;
            if (g === 'other') {
              const v = $('#wz-other').value.trim();
              if (!v) { err('Type the component name, or pick one above.'); $('#wz-other').focus(); return; }
              st.category = match(v) || v; st.otherCategory = v; go('problem');
            }
            if (g === 'custom-finding') {
              const name = $('#wz-fname').value.trim();
              if (!name) { err('Give the problem a short name.'); $('#wz-fname').focus(); return; }
              st.custom = { name, description: $('#wz-fdesc').value.trim() }; st.finding = null; st.checked.clear(); afterProblem();
            }
            if (g === 'next') {
              readCustomRepair();
              if (st.customRepair && !st.customRepair.name) { err('Give the custom repair a name, or clear it.'); $('#wz-rname').focus(); return; }
              go('sizes');
            }
            if (g === 'more-sizes') { st.showMore = true; draw(); }
            if (g === 'skip-sizes') { st.sizes = {}; st.fromEarlier.clear(); finish(); }
            if (g === 'more') { readCustomRepair(); st.more++; draw(); }
            if (g === 'back') {
              readCustomRepair();
              const ns = names();
              go(ns[Math.max(0, ns.indexOf(st.step) - 1)]);
            }
            if (g === 'finish') {
              readCustomRepair();
              if (st.customRepair && !st.customRepair.name) { err('Give the custom repair a name, or clear it.'); $('#wz-rname').focus(); return; }
              finish();
            }
          });
          function finish() {
            done = true;
            close();
            resolve({
              category: st.category, finding: st.finding, custom: st.custom, status: st.status, note: st.note,
              repairs: repairs.filter(r => st.checked.has(r.id)), customRepair: st.customRepair,
              sizes: Object.values(st.sizes),
            });
          }
          draw();
        },
        onClose: () => { if (!done) resolve(null); },
      });
    });
  }

  return { open };
})();

// Shows photo-analysis suggestions and asks the user to confirm, correct, or ignore each one.
// Resolves with only the values the user accepted (corrected values replace suggestions).
const PhotoReview = (() => {
  const esc = U.esc;
  const CONF = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' };

  function open({ photoId, analysis, rows, findings = [], categories = [] }) {
    return new Promise(async resolve => {
      const url = await Photos.url(photoId, 'thumb');
      const items = rows.filter(k => analysis[k] && (analysis[k].value || '').trim());
      let done = false;
      const LABEL = { component: 'Component', manufacturer: 'Manufacturer', model: 'Model', condition: 'Visible condition', finding_code: 'Suggested problem' };
      const control = k => {
        const v = analysis[k].value;
        if (k === 'finding_code') {
          return `<select id="pr-${k}" aria-label="${LABEL[k]}"><option value="">— none —</option>${findings.map(f => `<option value="${esc(f.code)}" ${f.code === v ? 'selected' : ''}>${esc(f.code)} — ${esc(f.name)}</option>`).join('')}</select>`;
        }
        return `<input id="pr-${k}" value="${esc(v)}" aria-label="${LABEL[k]}" ${k === 'component' ? 'list="pr-cats"' : ''}>`;
      };
      U.modal({
        title: 'Review photo suggestions',
        wide: true,
        body: `<datalist id="pr-cats">${categories.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
          <div class="wiz-main"><div class="wiz-side"><img class="wiz-photo" src="${esc(url || '')}" alt="Analyzed photo"></div><div>
          <div class="notice small">These are suggestions from image analysis, not a diagnosis. A photo alone can't establish what is wrong.
            Confirm, correct, or ignore each one — only what you confirm is used.</div>
          ${analysis.photo_clear === false ? `<div class="notice warn-box"><strong>The photo is unclear.</strong> ${esc(analysis.unclear_reason || '')} Choose the component and problem manually.</div>` : ''}
          ${analysis.label_text ? `<p class="small"><span class="label-like">Label text read:</span> <span class="pre">${esc(analysis.label_text)}</span></p>` : ''}
          ${items.length ? items.map(k => `<fieldset class="sugg" data-k="${k}">
            <legend>${LABEL[k]} <span class="badge conf-${esc(analysis[k].confidence)}">${CONF[analysis[k].confidence] || ''}</span></legend>
            ${control(k)}
            <p class="hint">${esc(analysis[k].explanation)}</p>
            <div class="seg">
              <label class="seg-btn small"><input type="radio" name="d-${k}" value="use"> Confirm</label>
              <label class="seg-btn small"><input type="radio" name="d-${k}" value="ignore"> Ignore</label>
            </div></fieldset>`).join('') : '<p class="muted">No usable suggestions came back for this photo.</p>'}
          </div></div>
          <p class="form-error" role="alert" hidden></p>
          <div class="modal-actions"><button type="button" data-close>Cancel</button><button type="button" class="primary" data-act="ok">Continue</button></div>`,
        onMount: (dlg, close) => {
          // Editing a suggestion counts as correcting it, so mark it confirmed.
          dlg.addEventListener('input', e => {
            const fs = e.target.closest('.sugg');
            if (fs && e.target.type !== 'radio') U.$('input[value=use]', fs).checked = true;
          });
          dlg.addEventListener('change', e => {
            const fs = e.target.closest('.sugg');
            if (fs && e.target.tagName === 'SELECT') U.$('input[value=use]', fs).checked = true;
          });
          dlg.addEventListener('click', e => {
            if (!e.target.closest('[data-act=ok]')) return;
            const undecided = items.filter(k => !dlg.querySelector(`input[name=d-${k}]:checked`));
            const errEl = U.$('.form-error', dlg);
            if (undecided.length) {
              errEl.textContent = `Confirm or ignore each suggestion (${undecided.map(k => LABEL[k]).join(', ')}).`;
              errEl.hidden = false;
              dlg.querySelector(`input[name=d-${undecided[0]}]`).focus();
              return;
            }
            const accepted = {};
            const decisions = {};
            for (const k of items) {
              const use = dlg.querySelector(`input[name=d-${k}]:checked`).value === 'use';
              const val = U.$(`#pr-${k}`, dlg).value.trim();
              decisions[k] = !use ? 'ignored' : val === analysis[k].value ? 'confirmed' : 'corrected';
              if (use && val) accepted[k] = val;
            }
            done = true;
            close();
            resolve({ accepted, decisions });
          });
          const first = U.$('.sugg input, .sugg select, [data-act=ok]', dlg);
          first && first.focus();
        },
        onClose: () => { if (!done) resolve(null); },
      });
    });
  }

  // Small blocking "analyzing" dialog with a cancel button. Resolves with the result,
  // or null (cancelled) — errors are shown and also resolve null.
  function analyze(photoId, ctx) {
    return new Promise(resolve => {
      const ctrl = new AbortController();
      let settled = false;
      const m = U.modal({
        title: 'Analyzing photo…',
        body: `<p>Looking for the component, any readable label, and visible condition.</p>
          <div class="spinner" aria-hidden="true"></div>
          <div class="modal-actions"><button type="button" data-close>Cancel and choose manually</button></div>`,
        onClose: () => { if (!settled) { settled = true; ctrl.abort(); resolve(null); } },
      });
      AI.analyzePhoto(photoId, { ...ctx, signal: ctrl.signal }).then(r => {
        if (settled) return;
        settled = true; m.close(); resolve(r);
      }, err => {
        if (settled) return;
        settled = true; m.close();
        if (err.name !== 'AbortError') U.toast(err.message, 'error');
        resolve(null);
      });
    });
  }

  return { open, analyze };
})();
