'use strict';

// Customer-facing preview: the final document exactly as the customer will see it.
// Built only from Customer.model(), which excludes private data; prices and the discount appear
// only when switched on in the editor.
const PreviewView = (() => {
  const esc = U.esc;

  // What the estimate contains, shown before you copy it or save the PDF.
  function visibilityHtml(est, m, hidden) {
    const p = m.pricing;
    const shownMedia = m.photos.length;
    const priceText = !p.shown ? 'Hidden — the estimate says pricing is not included'
      : p.package ? (p.packagePrice != null ? `Shown — ${p.packageName}: ${U.fmtMoney(p.packagePrice)}` : 'Shown, but no package price is entered')
        : (p.itemTotal != null ? `Shown — item prices, total ${U.fmtMoney(p.itemTotal)}` : 'Shown, but no item prices are entered');
    const discText = p.discount ? `Shown — ${p.discount.label}${p.discount.amount != null ? `: −${U.fmtMoney(p.discount.amount)}` : ''}`
      : est.discount.category ? `Hidden — ${est.discount.category} recorded privately` : 'None';
    const row = (label, value, on) => `<li class="${on ? 'on' : 'off'}"><span class="vis-label">${esc(label)}</span><span>${esc(value)}</span></li>`;
    return `<section class="visibility no-print" aria-label="What the customer will see">
      <div class="vis-head"><h2>What the customer will see</h2>
</div>
      <ul>
        ${row('Format', p.package ? `One package — “${p.packageName}”` : 'Individual items', true)}
        ${row('Prices', priceText, p.shown)}
        ${row('Discount', discText, !!p.discount)}
        ${row('Photos & videos', `${shownMedia} shown${hidden ? ` · ${hidden} hidden` : ''}`, shownMedia > 0)}
        ${row('Private notes', 'Never in the customer document; only in your private copy, or in a PDF if you tick them', false)}
      </ul>
    </section>`;
  }

// Save a PDF to this device for your own records. Private details are left out unless ticked.
function savePdf(est, m) {
  const hasNotes = !!(String(est.clientNote || '').trim() || String(est.internalNotes || '').trim());
  U.modal({
    title: 'Save PDF',
    body: `<p class="lead-text">Saves a PDF of this estimate to this device for your records. Nothing is sent to anyone.</p>
      <div class="option-list">
        <label class="option"><input type="checkbox" id="pdf-notes" ${hasNotes ? '' : 'disabled'}>
          <span><strong>Include private notes</strong><span class="hint">${hasNotes ? 'Client note and internal notes' : 'This estimate has no private notes'}</span></span></label>
        <label class="option"><input type="checkbox" id="pdf-pricing">
          <span><strong>Include internal pricing</strong><span class="hint">Repair prices, package price, discount, and pricing notes</span></span></label>
      </div>
      <p class="hint">Left unticked, the PDF matches this preview. With either one, private details go on a separate last page and every page is marked “Internal copy”.</p>
      <div class="modal-actions"><button type="button" data-close>Cancel</button><button type="button" class="primary" data-act="save">Save PDF</button></div>`,
    onMount: (dlg, close) => {
      U.$('[data-act=save]', dlg).addEventListener('click', async e => {
        if (U.framed) {
          U.toast('This hosted view can’t save files. Open the app from its own web address to save PDFs.', 'error');
          return;
        }
        e.target.disabled = true; e.target.textContent = 'Creating PDF…';
        try {
          const extras = PdfExport.extrasFor(est, { notes: U.$('#pdf-notes', dlg).checked, pricing: U.$('#pdf-pricing', dlg).checked });
          const blob = await PdfExport.build(m, extras);
          U.download(PdfExport.fileName(m, extras.sections.length > 0), blob);
          close();
          U.toast(extras.sections.length ? 'Internal PDF saved to this device' : 'PDF saved to this device');
        } catch (err) {
          e.target.disabled = false; e.target.textContent = 'Save PDF';
          U.toast(`Could not create the PDF: ${err.message}`, 'error');
        }
      });
    },
  });
}

  // The final customer document, and nothing else: no editing, copying, saving, or status
  // actions. Those live in the editor's "After the preview" card.
  async function show(id, mount) {
    const rec = await DB.get('estimates', id);
    if (!rec) {
      mount.innerHTML = `<div class="empty-state"><h2>Estimate not found</h2><a class="btn" href="#/estimates">Back to estimates</a></div>`;
      return;
    }
    const est = Store.normalize(rec);
    const m = Customer.model(est, await Store.settings());
    mount.innerHTML = `
      <div class="preview-bar no-print"><a class="btn" href="#/estimates/${esc(est.id)}">Done</a></div>
      <article class="doc" aria-label="Customer estimate">${Customer.html(m, { photos: true })}</article>`;
    Photos.hydrate(mount, 'full');
    PreviewView.lastViewed = est.id;
    const prevTitle = document.title;
    document.title = [est.number, m.client.name, m.title].filter(Boolean).join(' – ');
    PreviewView._restoreTitle = () => { document.title = prevTitle; };
  }

  function leave() { if (PreviewView._restoreTitle) PreviewView._restoreTitle(); }

  return { show, leave, visibilityHtml, savePdf, lastViewed: null };
})();
