'use strict';

// The customer-facing estimate. model() copies ONLY customer-facing fields out of an estimate,
// so the preview, copied text, and PDF are all built from the same safe subset:
// no private notes, internal details, identification research, photo analysis, or hidden photos.
//
// Layout, for a homeowner: business letterhead, "Estimate" with number and date, customer and
// job details, project title, proposed work by repair item, photos with captions, then any
// price you chose to show.
const Customer = (() => {
  const esc = U.esc;
  const clean = s => String(s ?? '').trim();
  const lines = s => clean(s).split('\n').map(l => l.trim().replace(/^[-•*]\s*/, '')).filter(Boolean);
  const fmtDate = iso => U.fmtDate(iso);

  // How to go ahead, using the contact details from Settings. No dates or promises.
  function nextSteps(s) {
    const biz = clean(s.businessName) || 'us';
    const reach = [clean(s.phone), clean(s.email)].filter(Boolean).join(' or ');
    return `To move forward, contact ${biz}${reach ? ` at ${reach}` : ''} to approve this estimate and schedule the work. `
      + 'If you have questions about any item in this estimate, we’ll be glad to go over it with you.';
  }

  function model(est, s) {
    const comps = est.components.filter(c => c.findings.length);
    const repairs = comps.flatMap(c => c.findings.flatMap(f => f.repairs));
    const assumptions = new Set(), exclusions = new Set();
    comps.forEach(c => c.findings.forEach(f => {
      [f, ...f.repairs].forEach(x => { lines(x.assumptions).forEach(l => assumptions.add(l)); lines(x.exclusions).forEach(l => exclusions.add(l)); });
    }));
    // Only media marked "Show to customer". An item's media without a caption are captioned
    // with the repair or problem they belong to.
    const media = (list, fallback) => list.filter(p => p.include).map(p => ({
      id: p.id, caption: clean(p.caption) || fallback, kind: p.kind === 'video' ? 'video' : 'photo', playable: p.playable !== false, name: p.name || '',
    }));
    const photos = [
      ...comps.flatMap(c => c.findings.flatMap(f => [
        ...media(f.photos, clean(f.name)),
        ...f.repairs.flatMap(r => media(r.photos || [], Generate.repairTitle(r))),
      ])),
      ...media(est.photos, ''),
    ];
    // Prices and discount are copied in only when their "Show" switch is on; otherwise they never leave the editor.
    const ps = Store.priceSummary(est);
    const showPrices = !!est.pricing.showPrices;
    const showDiscount = !!(est.discount.show && est.discount.category);
    const pkgMode = est.pricing.mode === 'package';
    const itemPrice = Object.fromEntries(ps.priced.map(i => [i.id, i.price]));
    const included = [...new Set(repairs.map(r => Generate.repairTitle(r)).filter(Boolean))];
    const pricing = {
      package: pkgMode && repairs.length > 1,
      packageName: clean(est.pricing.packageName) || clean(est.title) || 'Package',
      // "Apex Chimney is offering a special package for this job" and the work it brings together.
      offer: `${clean(s.businessName) || 'We'} ${clean(s.businessName) ? 'is' : 'are'} offering a special package for this job.`,
      included,
      shown: showPrices,
      packagePrice: showPrices && pkgMode ? ps.packagePrice : null,
      lines: showPrices && !pkgMode ? repairs.filter(r => itemPrice[r.id] != null).map(r => [Generate.repairTitle(r), itemPrice[r.id]]) : [],
      itemTotal: showPrices && !pkgMode ? ps.itemTotal : null,
      discount: showDiscount ? { label: `${clean(est.discount.category)} discount`, amount: ps.discountAmt } : null,
      total: showPrices && showDiscount && ps.discountAmt != null && ps.subtotal != null ? ps.total : null,
    };
    const work = clean(est.scopeText) || (comps.length ? Generate.scope(est, { businessName: s.businessName }) : '');
    const title = clean(est.title);
    return {
      v: 2,
      business: { name: clean(s.businessName), contact: [s.contactName, s.phone, s.email, s.website].map(clean).filter(Boolean), address: clean(s.address), license: clean(s.license) },
      number: est.number, date: est.date, title,
      client: { name: clean(est.customer.name), phone: clean(est.customer.phone), email: clean(est.customer.email) },
      address: clean(est.jobAddress), system: Store.systemLabel(est.system), notice: clean(s.notice),
      hasItems: comps.length > 0,
      work, workIsDraft: !clean(est.scopeText),
      assumptions: [...assumptions], exclusions: [...exclusions],
      // Parts already explained in an "About …" line aren't repeated in the terms list.
      terms: Generate.terms(`${title}\n${work}`).filter(([t]) => !new RegExp(`About (the )?${t}:`, 'i').test(work)),
      nextSteps: comps.length ? nextSteps(s) : '',
      footer: clean(s.footer), photos, pricing,
    };
  }

  // ---------- the proposed-work text, read as repair items ----------
  // Blank lines separate blocks. A short first line with no colon, in a block of several lines,
  // is a repair heading ("Chimney Crown Restoration"); "What we found:", "Why it matters:" and
  // similar lead-ins are labels. Works for text you edited and for older wording.
  const LABEL = /^((?:About|What we found|What we’ll do|What we'll do|Why it matters|How this helps|Measurements|Work details|Note|Equipment|Condition|Proposed work|Included in the package)[^:]{0,70}):\s*/;
  function workBlocks(text) {
    return clean(text).split(/\n\s*\n/).map((block, i) => {
      const ls = block.split('\n').map(l => l.trim()).filter(Boolean);
      const isHead = i > 0 && ls.length > 1 && ls[0].length <= 90 && !ls[0].includes(':') && !/[.!?]$/.test(ls[0]);
      return {
        heading: isHead ? ls[0] : '',
        lines: (isHead ? ls.slice(1) : ls).map(l => { const m = l.match(LABEL); return m ? { label: m[1], text: l.slice(m[0].length) } : { label: '', text: l }; }),
      };
    });
  }

  // ---------- pricing (present only when switched on in the editor) ----------
  const pkg = m => !!(m.pricing && m.pricing.package);
  const pricingShown = m => !!(m.pricing && (m.pricing.shown || m.pricing.discount));
  function pricingRows(m) {
    const p = m.pricing, rows = [];
    if (p.shown && p.package && p.packagePrice != null) rows.push([p.packageName, U.fmtMoney(p.packagePrice)]);
    if (p.shown && !p.package) p.lines.forEach(([k, v]) => rows.push([k, U.fmtMoney(v)]));
    if (p.shown && !p.package && p.itemTotal != null && p.lines.length > 1) rows.push(['Total', U.fmtMoney(p.itemTotal), p.discount ? '' : 'grand']);
    if (p.discount) rows.push([p.discount.label, p.discount.amount != null ? `−${U.fmtMoney(p.discount.amount)}` : 'Applied', 'discount']);
    if (p.total != null) rows.push(['Total after discount', U.fmtMoney(p.total), 'grand']);
    return rows;
  }
  const NUM = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  // Package presentation, built only from the selected work — no amounts or savings claims.
  const packageIntro = m => [
    `The selected work represents a substantial project. ${m.pricing.offer}`,
    `Rather than a list of separate repairs, the ${NUM[m.pricing.included.length] || m.pricing.included.length} repairs below are brought together and completed as one coordinated project.`,
  ];
  const estimateLine = m => [m.number ? `Estimate # ${m.number}` : '', m.date ? `Date: ${fmtDate(m.date)}` : ''].filter(Boolean);

  // ---------- plain text ----------
  function text(m) {
    const b = m.business, out = [];
    out.push(b.name || 'Apex Chimney');
    if (b.address) out.push(b.address.replace(/\n/g, ', '));
    if (b.contact.length) out.push(b.contact.join(' · '));
    if (b.license) out.push(b.license);
    out.push('', 'ESTIMATE', ...estimateLine(m), '');
    out.push(`Customer: ${[m.client.name, m.client.phone, m.client.email].filter(Boolean).join(' · ')}`);
    if (m.address) out.push(`Job address: ${m.address.replace(/\n/g, ', ')}`);
    if (m.system) out.push(`System: ${m.system}`);
    if (m.title) out.push('', `Project: ${m.title}`);
    if (m.notice) out.push('', m.notice);
    if (pkg(m)) out.push('', `PACKAGE: ${m.pricing.packageName.toUpperCase()}`, ...packageIntro(m), 'Included in this package:', ...m.pricing.included.map(n => `• ${n}`));
    if (m.work) {
      out.push('', 'PROPOSED WORK');
      workBlocks(m.work).forEach(bl => {
        out.push('');
        if (bl.heading) out.push(bl.heading.toUpperCase());
        bl.lines.forEach(l => out.push(l.label ? `${l.label}: ${l.text}` : l.text));
      });
    }
    if (m.photos.length) out.push('', 'PHOTOS', ...m.photos.map(p => `• ${p.kind === 'video' ? 'Video' : 'Photo'}${p.caption ? `: ${p.caption}` : ''}`));
    if (pricingShown(m)) out.push('', pkg(m) ? 'PACKAGE PRICE' : 'PRICE', ...pricingRows(m).map(([k, v]) => `${k}: ${v}`));
    else if (m.hasItems) out.push('', 'Pricing is not included in this estimate.');
    if (m.nextSteps) out.push('', 'NEXT STEPS', m.nextSteps);
    if (m.assumptions.length) out.push('', 'THIS ESTIMATE ASSUMES', ...m.assumptions.map(a => `• ${a}`));
    if (m.exclusions.length) out.push('', 'NOT INCLUDED', ...m.exclusions.map(a => `• ${a}`));
    if (m.terms.length) out.push('', 'TERMS USED IN THIS ESTIMATE', ...m.terms.map(([t, d]) => `• ${t}: ${d}`));
    if (m.footer) out.push('', m.footer);
    return out.join('\n');
  }

  // ---------- HTML ----------
  // opts.photos renders photos and videos (the preview); without it they are left out.
  function html(m, opts = {}) {
    const p = s => (s ? `<p class="pre">${esc(s)}</p>` : '');
    const b = m.business;
    const figure = md => `<figure class="${md.kind}">
      ${md.kind === 'video'
        ? (md.playable ? `<video data-video-id="${esc(md.id)}" controls playsinline preload="metadata"></video>`
          : `<div class="media-file"><span class="media-icon">🎬</span><span class="small">${esc(md.name || 'Video')}</span><span class="hint">This video format can't play in this browser.</span></div>`)
        : `<img data-photo-id="${esc(md.id)}" alt="${esc(md.caption || 'Photo')}">`}
      ${md.caption ? `<figcaption>${esc(md.caption)}</figcaption>` : ''}</figure>`;
    return `
      <header class="doc-head">
        <div class="biz">
          <div class="biz-name">${esc(b.name || 'Apex Chimney')}</div>
          ${b.address ? `<div class="pre">${esc(b.address)}</div>` : ''}
          ${b.contact.length ? `<div>${b.contact.map(esc).join(' · ')}</div>` : ''}
          ${b.license ? `<div class="small">${esc(b.license)}</div>` : ''}
        </div>
        <div class="doc-meta">
          <div class="doc-kind">Estimate</div>
          ${estimateLine(m).map(l => `<div>${esc(l)}</div>`).join('')}
        </div>
      </header>

      <section class="doc-parties">
        <div><div class="dl">Customer</div>
          <div><strong>${esc(m.client.name)}</strong></div>
          ${m.client.phone ? `<div>${esc(m.client.phone)}</div>` : ''}
          ${m.client.email ? `<div>${esc(m.client.email)}</div>` : ''}</div>
        <div>
          ${m.address ? `<div class="dl">Job address</div><div class="pre">${esc(m.address)}</div>` : ''}
          ${m.system ? `<div class="dl" style="margin-top:8px">System</div><div>${esc(m.system)}</div>` : ''}
        </div>
      </section>

      ${m.title ? `<div class="dl">Project</div><h1 class="doc-title">${esc(m.title)}</h1>` : ''}
      ${m.notice ? `<p class="doc-notice">${esc(m.notice)}</p>` : ''}

      ${pkg(m) ? `<section class="doc-section pkg-box">
        <h2>${esc(m.pricing.packageName)}</h2>
        ${packageIntro(m).map(t => `<p>${esc(t)}</p>`).join('')}
        <div class="dl">Included in this package</div>
        <ol class="pkg-list">${m.pricing.included.map(n => `<li>${esc(n)}</li>`).join('')}</ol>
      </section>` : ''}

      ${m.work ? `<section class="doc-section doc-work"><h2>Proposed Work</h2>
        ${workBlocks(m.work).map(bl => `<div class="${bl.heading ? 'work-item' : 'work-para'}">
          ${bl.heading ? `<h3 class="doc-item-title">${esc(bl.heading)}</h3>` : ''}
          ${bl.lines.map(l => `<p>${l.label ? `<strong>${esc(l.label)}:</strong> ` : ''}${esc(l.text)}</p>`).join('')}
        </div>`).join('')}
      </section>` : '<p class="muted">No work has been added to this estimate yet.</p>'}

      ${opts.photos && m.photos.length ? `<section class="doc-section"><h2>Photos</h2><div class="doc-photos">${m.photos.map(figure).join('')}</div></section>` : ''}

      ${pricingShown(m) ? `<section class="doc-section doc-pricing">
        <h2>${pkg(m) ? 'Package Price' : 'Price'}</h2>
        <dl class="price-lines">${pricingRows(m).map(([k, v, cls]) => `<div class="${cls || ''}"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
      </section>` : m.hasItems ? '<p class="doc-noprice">Pricing is not included in this estimate.</p>' : ''}

      ${m.nextSteps ? `<section class="doc-section"><h2>Next Steps</h2><p>${esc(m.nextSteps)}</p></section>` : ''}

      ${m.assumptions.length || m.exclusions.length ? `<section class="doc-section">
        ${m.assumptions.length ? `<h2>This Estimate Assumes</h2><ul>${m.assumptions.map(a => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
        ${m.exclusions.length ? `<h2>Not Included</h2><ul>${m.exclusions.map(a => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
      </section>` : ''}

      ${m.terms.length ? `<section class="doc-section doc-terms"><h2>Terms Used in This Estimate</h2>
        <dl>${m.terms.map(([t, d]) => `<div><dt>${esc(t)}</dt><dd>${esc(d)}</dd></div>`).join('')}</dl></section>` : ''}

      ${m.footer ? `<footer class="doc-foot">${p(m.footer)}</footer>` : ''}`;
  }

  return { model, text, html, workBlocks, pricingRows, packageIntro, estimateLine };
})();
