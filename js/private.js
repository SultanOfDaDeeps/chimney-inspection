'use strict';

// Private copy for the business owner only: the complete estimate plus every internal detail
// (private notes, internal measurements, identification research, pricing). It is built
// separately from Customer.model() and never feeds the customer document.
//
// Delivery goes to ONE fixed WhatsApp number. Without a WhatsApp Business Cloud API account
// (and a server to hold its token) a web app cannot send a message by itself, so the app opens
// WhatsApp with the message already written and you tap Send. The app reports exactly that —
// it never claims a message was delivered.
const PrivateCopy = (() => {
  const NUMBER = '+1 (614) 496-3246';
  const DIGITS = '16144963246';
  const clean = s => String(s ?? '').trim();
  const vals = rows => rows.filter(r => clean(r.value))
    .map(r => `${r.label ? clean(r.label) + ': ' : ''}${clean(r.value)}${r.unit ? ' ' + clean(r.unit) : ''}${r.internal ? ' (internal)' : ''}`);

  function text(est, s) {
    const m = Customer.model(est, s);
    const out = ['PRIVATE COPY — FOR APEX CHIMNEY ONLY. NOT FOR THE CUSTOMER.', ''];
    out.push('=== CUSTOMER DOCUMENT ===', Customer.text(m), '');
    out.push('=== INTERNAL DETAILS ===');
    const add = (label, v) => { if (clean(v)) out.push(`${label}: ${clean(v)}`); };
    add('Status', est.status === 'presented' ? 'Presented' : 'Draft');
    add('Client note (private)', est.clientNote);
    add('Internal notes', est.internalNotes);
    add('Access notes', est.accessNotes);

    // Every item with its private notes and all values, including internal-only rows.
    est.components.filter(c => c.findings.length).forEach(c => {
      out.push('', `— ${Store.componentLabel(c)}`);
      const ids = [['Manufacturer', c.manufacturer], ['Model', c.model], ['Serial', c.serial], ['Part', c.partId]]
        .filter(x => clean(x[1])).map(([k, v]) => `${k} ${clean(v)}`).join(', ');
      if (ids) out.push(`  Identification: ${ids}${c.showIds ? '' : ' (hidden from customer)'}`);
      if (c.ident && (c.ident.status || clean(c.ident.notes))) out.push(`  Lookup: ${[c.ident.status, clean(c.ident.notes)].filter(Boolean).join(' — ')}`);
      c.findings.forEach(f => {
        out.push(`  • ${clean(f.name)}${f.status ? ` (${Store.statusLabel(f.status)})` : ''}`);
        vals(f.measurements).forEach(v => out.push(`    ${v}`));
        if (clean(f.privateNote)) out.push(`    Private note: ${clean(f.privateNote)}`);
        if (clean(f.risk) && f.status !== 'confirmed') out.push(`    Risk wording held back (not Confirmed): ${clean(f.risk)}`);
        const hidden = f.photos.filter(p => !p.include).length;
        if (hidden) out.push(`    ${hidden} photo/video hidden from customer`);
        f.repairs.forEach(r => {
          const price = U.parseMoney(est.pricing.itemPrices[r.id]);
          out.push(`    → ${clean(r.name)}${price != null ? ` — ${U.fmtMoney(price)}` : ''}`);
          vals(r.details).forEach(v => out.push(`      ${v}`));
          if (clean(r.privateNote)) out.push(`      Private note: ${clean(r.privateNote)}`);
        });
      });
    });

    // Internal pricing, whether or not it is shown to the customer.
    const pricing = PdfExport.extrasFor(est, { pricing: true }).sections[0];
    if (pricing) {
      out.push('', `— ${pricing[0]}`);
      if (est.pricing.mode === 'package') add('  Package name', est.pricing.packageName || est.title);
      pricing[1].forEach(r => out.push(`  ${Array.isArray(r) ? `${r[0]}: ${r[1]}` : r}`));
    }
    const generalHidden = est.photos.filter(p => !p.include).length;
    if (generalHidden) out.push('', `${generalHidden} general photo/video hidden from customer`);
    out.push('', `Prepared ${U.fmtDateTime(new Date().toISOString())} · photos and videos are not included in this text.`);
    return out.join('\n');
  }

  const link = body => `https://wa.me/${DIGITS}?text=${encodeURIComponent(body)}`;

  // Record what actually happened. status: opened | shared | confirmed | cancelled | failed.
  const entry = (status, detail = '') => ({ status, detail, number: NUMBER, at: new Date().toISOString() });

  function statusText(pc) {
    if (!pc || !pc.status) return { cls: 'off', text: 'No private copy has been sent for this estimate yet.' };
    const when = U.fmtDateTime(pc.at);
    return {
      opened: { cls: 'warn', text: `WhatsApp was opened with the private copy addressed to ${pc.number} (${when}). Not confirmed sent — tap Send in WhatsApp, then mark it as sent here.` },
      shared: { cls: 'warn', text: `The internal PDF was handed to the share sheet (${when}). The app can’t see which chat you picked; make sure it went only to ${pc.number}, then mark it as sent.` },
      confirmed: { cls: 'ok', text: `You confirmed the private copy was sent to ${pc.number} (${when}).` },
      cancelled: { cls: 'off', text: `Private copy cancelled — nothing was sent (${when}).` },
      failed: { cls: 'err', text: `Private copy failed (${when}): ${pc.detail || 'unknown error'}. Nothing was sent.` },
    }[pc.status] || { cls: 'off', text: '' };
  }

  // Share the internal PDF (with notes and pricing) through the device share sheet, where supported.
  const canSharePdf = () => !U.framed && !!(navigator.canShare && navigator.share)
    && (() => { try { return navigator.canShare({ files: [new File([''], 'x.pdf', { type: 'application/pdf' })] }); } catch { return false; } })();
  async function sharePdf(est, s) {
    const m = Customer.model(est, s);
    const blob = await PdfExport.build(m, PdfExport.extrasFor(est, { notes: true, pricing: true }));
    const file = new File([blob], PdfExport.fileName(m, true), { type: 'application/pdf' });
    await navigator.share({ files: [file], title: `Private copy — ${m.number}` });
  }

  return { NUMBER, DIGITS, text, link, entry, statusText, canSharePdf, sharePdf };
})();
