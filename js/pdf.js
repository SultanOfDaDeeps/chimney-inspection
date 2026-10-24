'use strict';

// Writes a PDF of an estimate on this device — no server and no library. Uses the standard PDF
// fonts (Helvetica, Times) and the estimate's JPEG photos. Text is measured with the
// metric-compatible system fonts (Arial matches Helvetica, Times New Roman matches Times).
// Content comes from Customer.model(); private details are added only when the caller asks.
const PdfExport = (() => {
  const W = 612, H = 792, M = 54, CW = W - 2 * M, BOTTOM = H - M - 18;
  const FONTS = {
    R: ['Helvetica', '400 100px Arial, Helvetica, sans-serif'],
    B: ['Helvetica-Bold', '700 100px Arial, Helvetica, sans-serif'],
    I: ['Helvetica-Oblique', 'italic 400 100px Arial, Helvetica, sans-serif'],
    S: ['Times-Bold', '700 100px "Times New Roman", Times, serif'],
  };
  const C = {
    ink: '0.114 0.114 0.122', muted: '0.431 0.431 0.451', line: '0.89 0.89 0.91', tint: '0.961 0.961 0.969',
    copper: '0.69 0.376 0.165', blue: '0.039 0.4 0.847', red: '0.75 0.16 0.13', green: '0.12 0.48 0.24',
  };
  const ctx = document.createElement('canvas').getContext('2d');

  // ---------- text encoding (WinAnsi, as used by the standard fonts) ----------
  const WIN = { '€': 128, '‚': 130, 'ƒ': 131, '„': 132, '…': 133, '†': 134, '‡': 135, 'ˆ': 136, '‰': 137, 'Š': 138, '‹': 139, 'Œ': 140,
    'Ž': 142, '‘': 145, '’': 146, '“': 147, '”': 148, '•': 149, '–': 150, '—': 151, '˜': 152, '™': 153, 'š': 154, '›': 155, 'œ': 156, 'ž': 158, 'Ÿ': 159 };
  const SUBS = { '−': '-', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8', '→': '->', ' ': ' ', ' ': ' ', ' ': ' ' };
  const plain = str => [...String(str ?? '').replace(/[−⅛⅜⅝⅞→   ]/g, c => SUBS[c])]
    .map(c => { const n = c.charCodeAt(0); return n < 128 || (n >= 160 && n < 256) || WIN[c] ? c : ''; }).join('');
  const latin1 = s => [...s].map(c => String.fromCharCode(WIN[c] || c.charCodeAt(0))).join('');
  const pdfStr = s => `(${latin1(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')})`;
  const width = (s, f, size) => { ctx.font = FONTS[f][1]; return ctx.measureText(s).width / 100 * size; };

  function wrap(text, f, size, maxW) {
    const out = [];
    for (const para of plain(text).split('\n')) {
      if (!para.trim()) { out.push(''); continue; }
      let line = '';
      for (const word of para.split(/ +/)) {
        const next = line ? `${line} ${word}` : word;
        if (width(next, f, size) <= maxW) { line = next; continue; }
        if (line) out.push(line);
        line = word;
        while (width(line, f, size) > maxW) { // a single word longer than the line
          let i = line.length;
          while (i > 1 && width(line.slice(0, i), f, size) > maxW) i--;
          out.push(line.slice(0, i)); line = line.slice(i);
        }
      }
      out.push(line);
    }
    return out;
  }

  // ---------- page layout ----------
  function createDoc() {
    const pages = [];
    const images = [];
    let ops, y;
    const page = () => { ops = []; pages.push(ops); y = M; };
    page();
    const ensure = h => { if (y + h > BOTTOM) page(); };
    const text = (x, baseline, s, f, size, color = 'ink') =>
      ops.push(`BT /${f} ${size} Tf ${C[color]} rg ${x.toFixed(2)} ${(H - baseline).toFixed(2)} Td ${pdfStr(plain(s))} Tj ET`);
    const rect = (x, top, w, h, color) => ops.push(`${C[color]} rg ${x.toFixed(2)} ${(H - top - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
    const rule = (x1, x2, at, color = 'line', lw = 0.75) =>
      ops.push(`${C[color]} RG ${lw} w ${x1.toFixed(2)} ${(H - at).toFixed(2)} m ${x2.toFixed(2)} ${(H - at).toFixed(2)} l S`);

    // A wrapped paragraph that flows across pages.
    function para(s, { f = 'R', size = 10, color = 'ink', x = M, w = CW, lh = 1.45, after = 4 } = {}) {
      if (!String(s ?? '').trim()) return;
      for (const line of wrap(s, f, size, w)) {
        ensure(size * lh);
        text(x, y + size, line, f, size, color);
        y += size * lh;
      }
      y += after;
    }
    // Label on the left, value on the right (prices).
    function row(label, value, { f = 'R', size = 10, color = 'ink', x = M, w = CW, ruleAbove = false } = {}) {
      ensure(size * 1.9);
      if (ruleAbove) rule(x, x + w, y, 'ink', 1);
      const v = plain(value);
      text(x, y + size + 3, label, f, size, color);
      text(x + w - width(v, f, size), y + size + 3, v, f, size, color);
      y += size * 1.9;
    }
    function heading(s, size = 14) {
      ensure(size * 2.6);
      y += size * 0.6;
      text(M, y + size, s, 'S', size);
      y += size * 1.35;
      rule(M, M + CW, y);
      y += 8;
    }
    // A bold lead-in ("What we found:") followed by regular text on the same line.
    function lead(head, s, { size = 10, x = M, w = CW, lh = 1.5, after = 3 } = {}) {
      const lw = width(plain(head) + ' ', 'B', size);
      const words = plain(s).split(/ +/).filter(Boolean);
      let first = '', i = 0;
      while (i < words.length) {
        const next = first ? `${first} ${words[i]}` : words[i];
        if (width(next, 'R', size) > w - lw) break;
        first = next; i++;
      }
      ensure(size * lh);
      text(x, y + size, head, 'B', size);
      if (first) text(x + lw, y + size, first, 'R', size);
      y += size * lh;
      const rest = words.slice(i).join(' ');
      if (rest) para(rest, { size, x, w, lh, after }); else y += after;
    }
    function label(s, color = 'muted', x = M) { ensure(14); text(x, y + 7, s.toUpperCase(), 'B', 7, color); y += 12; }
    function addImage(img) { images.push(img); return images.length - 1; }
    function drawImage(idx, x, top, w, h) {
      ops.push(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${(H - top - h).toFixed(2)} cm /Im${idx} Do Q`);
    }
    return {
      pages, images, text, rect, rule, para, lead, row, heading, label, addImage, drawImage, ensure, width, wrap,
      get y() { return y; }, set y(v) { y = v; }, newPage: page,
    };
  }

  // ---------- images ----------
  async function jpeg(blob) {
    let bmp;
    try { bmp = await createImageBitmap(blob); } catch (e) { return null; }
    const w = bmp.width, h = bmp.height;
    let out = blob;
    if (blob.type !== 'image/jpeg') {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(bmp, 0, 0);
      out = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
    }
    if (bmp.close) bmp.close();
    return { bytes: new Uint8Array(await out.arrayBuffer()), w, h };
  }

  async function loadMedia(list) {
    const out = [];
    for (const md of list || []) {
      const rec = await DB.get('photos', md.id);
      const blob = rec && (md.kind === 'video' ? rec.thumb : rec.blob);
      out.push({ ...md, img: blob ? await jpeg(blob) : null });
    }
    return out;
  }

  // Two per row; videos show their first frame and are labelled as video.
  function mediaGrid(doc, list, x = M, w = CW) {
    if (!list.length) return;
    const gap = 12, cell = (w - gap) / 2;
    for (let i = 0; i < list.length; i += 2) {
      const pair = list.slice(i, i + 2).map(md => {
        const ratio = md.img ? md.img.h / md.img.w : 0.6;
        const h = Math.min(cell * ratio, 190);
        const caption = `${md.kind === 'video' ? 'Video' + (md.caption ? ': ' : ' (see the digital copy)') : ''}${md.caption || ''}`;
        return { md, h, iw: md.img ? h / ratio : cell, caption: doc.wrap(caption, 'R', 8.5, cell) };
      });
      const rowH = Math.max(...pair.map(p => p.h + (p.caption.filter(Boolean).length * 11) + 6));
      doc.ensure(rowH + 6);
      const top = doc.y;
      pair.forEach((p, k) => {
        const cx = x + k * (cell + gap);
        if (p.md.img) doc.drawImage(doc.addImage(p.md.img), cx, top, p.iw, p.h);
        else { doc.rect(cx, top, cell, p.h, 'tint'); doc.text(cx + 8, top + p.h / 2 + 4, 'Video', 'B', 9, 'muted'); }
        p.caption.filter(Boolean).forEach((line, j) => doc.text(cx, top + p.h + 11 + j * 11, line, 'R', 8.5, 'muted'));
      });
      doc.y = top + rowH + 6;
    }
  }

  // ---------- the estimate ----------
  async function build(m, extras) {
    const doc = createDoc();
    const b = m.business;

    // Letterhead: business on the left, "Estimate" with number and date on the right.
    const right = M + CW;
    doc.text(M, doc.y + 18, b.name || 'Apex Chimney', 'S', 18);
    const meta = [['Estimate', 'S', 16, 'ink'], ...Customer.estimateLine(m).map(s => [s, 'R', 9, 'muted'])];
    meta.forEach(([s, f, size, color], i) => doc.text(right - doc.width(plain(s), f, size), doc.y + 16 + (i ? 8 + i * 13 : 0), s, f, size, color));
    let ly = doc.y + 34;
    for (const s of [...(b.address ? b.address.split('\n') : []), b.contact.join('  ·  '), b.license].filter(Boolean)) {
      doc.text(M, ly, s, 'R', 9, 'muted'); ly += 12.5;
    }
    doc.y = Math.max(ly, doc.y + 52) + 4;
    doc.rule(M, right, doc.y);
    doc.rect(M, doc.y - 1, 54, 2.2, 'copper');
    doc.y += 18;

    // Customer and job
    const colW = (CW - 24) / 2, startY = doc.y;
    doc.label('Customer');
    doc.para(m.client.name, { f: 'B', size: 10.5, w: colW, after: 1 });
    [m.client.phone, m.client.email].filter(Boolean).forEach(s => doc.para(s, { size: 9.5, w: colW, after: 0 }));
    const leftEnd = doc.y;
    doc.y = startY;
    const rx = M + colW + 24;
    if (m.address) { doc.label('Job address', 'muted', rx); doc.para(m.address, { x: rx, w: colW, size: 9.5, after: 6 }); }
    if (m.system) { doc.label('System', 'muted', rx); doc.para(m.system, { x: rx, w: colW, size: 9.5, after: 0 }); }
    doc.y = Math.max(leftEnd, doc.y) + 16;

    // Project title and what the estimate covers
    if (m.title) { doc.label('Project'); doc.para(m.title, { f: 'S', size: 19, lh: 1.2, after: 8 }); }
    if (m.notice) doc.para(m.notice, { size: 9, color: 'muted', after: 6 });

    // Package: the offer and the work it brings together
    const pkg = m.pricing && m.pricing.package;
    if (pkg) {
      doc.heading(m.pricing.packageName);
      Customer.packageIntro(m).forEach(t => doc.para(t, { size: 10, after: 3 }));
      doc.label('Included in this package');
      m.pricing.included.forEach((n, i) => doc.para(`${i + 1}.  ${n}`, { size: 10, x: M + 8, w: CW - 8, after: 0 }));
      doc.y += 4;
    }

    // Proposed work, by repair item
    if (m.work) {
      doc.heading('Proposed Work');
      for (const bl of Customer.workBlocks(m.work)) {
        if (bl.heading) { doc.ensure(48); doc.para(bl.heading, { f: 'S', size: 12.5, after: 3 }); }
        const x = bl.heading ? M + 10 : M, w = bl.heading ? CW - 10 : CW;
        bl.lines.forEach(l => (l.label ? doc.lead(`${l.label}:`, l.text, { x, w }) : doc.para(l.text, { size: 10, lh: 1.5, x, w, after: 3 })));
        doc.y += 8;
      }
    }

    // Photos with captions
    // Keep the heading with the first row of photos rather than alone at the foot of a page.
    if (m.photos.length) { doc.ensure(36 + 200); doc.heading('Photos'); mediaGrid(doc, await loadMedia(m.photos)); }

    // Pricing chosen for the customer
    if (m.pricing.shown || m.pricing.discount) {
      doc.heading(pkg ? 'Package Price' : 'Price');
      const w = Math.min(CW, 340);
      Customer.pricingRows(m).forEach(([k, v, cls]) => doc.row(k, v.replace('−', '-'), cls === 'grand' ? { w, f: 'B', size: 11, ruleAbove: true } : { w, color: cls === 'discount' ? 'green' : 'ink' }));
    } else if (m.hasItems) {
      doc.y += 6; doc.para('Pricing is not included in this estimate.', { size: 9.5, color: 'muted' });
    }

    if (m.nextSteps) { doc.heading('Next Steps'); doc.para(m.nextSteps, { size: 10, lh: 1.5 }); }
    if (m.assumptions.length) { doc.heading('This Estimate Assumes', 12); m.assumptions.forEach(a => doc.para(`•  ${a}`, { size: 9.5, after: 1 })); }
    if (m.exclusions.length) { doc.heading('Not Included', 12); m.exclusions.forEach(a => doc.para(`•  ${a}`, { size: 9.5, after: 1 })); }
    if (m.terms.length) { doc.heading('Terms Used in This Estimate', 12); m.terms.forEach(([t, d]) => doc.lead(`${t}:`, d, { size: 9.5 })); }
    if (m.footer) { doc.y += 10; doc.para(m.footer, { size: 9.5, color: 'muted' }); }

    // Private details, only when chosen in the save dialog.
    if (extras && extras.sections.length) {
      doc.newPage();
      doc.para('Private — for your records', { f: 'S', size: 16, color: 'red', after: 2 });
      doc.para('This page is not part of the customer estimate.', { f: 'I', size: 9.5, color: 'muted', after: 10 });
      for (const [title, rows] of extras.sections) {
        doc.label(title, 'red');
        rows.forEach(r => (Array.isArray(r) ? doc.row(r[0], r[1], { size: 9.5 }) : doc.para(r, { size: 10, after: 4 })));
        doc.y += 8;
      }
    }

    // Footers (and an "internal copy" mark when private details are included)
    const n = doc.pages.length;
    const foot = plain([m.number, m.title].filter(Boolean).join('  ·  '));
    doc.pages.forEach((ops, i) => {
      const pageNo = `Page ${i + 1} of ${n}`;
      const t = (x, s, f, size, color) => ops.push(`BT /${f} ${size} Tf ${C[color]} rg ${x.toFixed(2)} ${(M / 2 - 4).toFixed(2)} Td ${pdfStr(plain(s))} Tj ET`);
      t(M, foot.length > 90 ? foot.slice(0, 88) + '…' : foot, 'R', 7.5, 'muted');
      t(M + CW - width(pageNo, 'R', 7.5), pageNo, 'R', 7.5, 'muted');
      if (extras && extras.sections.length) {
        const mark = 'INTERNAL COPY — includes private details';
        ops.push(`BT /B 7.5 Tf ${C.red} rg ${(M + CW - width(plain(mark), 'B', 7.5)).toFixed(2)} ${(H - M / 2 - 4).toFixed(2)} Td ${pdfStr(plain(mark))} Tj ET`);
      }
    });
    return serialize(doc, m.title || 'Repair estimate');
  }

  // ---------- PDF file structure ----------
  function serialize(doc, title) {
    const parts = [];
    const offsets = [];
    let length = 0;
    const enc = s => { const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 0xff; return a; };
    const push = chunk => { const a = typeof chunk === 'string' ? enc(chunk) : chunk; parts.push(a); length += a.length; };
    const obj = (num, body, stream) => {
      offsets[num] = length;
      push(`${num} 0 obj\n${body}\n`);
      if (stream) { push('stream\n'); push(stream); push('\nendstream\n'); }
      push('endobj\n');
    };
    const fontKeys = Object.keys(FONTS);
    const fontNum = k => 3 + fontKeys.indexOf(k);
    const imgBase = 3 + fontKeys.length;
    const pageBase = imgBase + doc.images.length;
    const infoNum = pageBase + doc.pages.length * 2;

    push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, `<< /Type /Pages /Kids [${doc.pages.map((_, i) => `${pageBase + i * 2} 0 R`).join(' ')}] /Count ${doc.pages.length} >>`);
    fontKeys.forEach(k => obj(fontNum(k), `<< /Type /Font /Subtype /Type1 /BaseFont /${FONTS[k][0]} /Encoding /WinAnsiEncoding >>`));
    doc.images.forEach((img, i) => obj(imgBase + i,
      `<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.bytes.length} >>`, img.bytes));
    const fonts = fontKeys.map(k => `/${k} ${fontNum(k)} 0 R`).join(' ');
    const xobjects = doc.images.map((_, i) => `/Im${i} ${imgBase + i} 0 R`).join(' ');
    doc.pages.forEach((ops, i) => {
      const content = enc(ops.join('\n'));
      obj(pageBase + i * 2, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << ${fonts} >>${xobjects ? ` /XObject << ${xobjects} >>` : ''} >> /Contents ${pageBase + i * 2 + 1} 0 R >>`);
      obj(pageBase + i * 2 + 1, `<< /Length ${content.length} >>`, content);
    });
    const d = new Date();
    const stamp = `D:${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    obj(infoNum, `<< /Title ${pdfStr(plain(title))} /Producer (Apex Chimney) /CreationDate (${stamp}) >>`);
    const xref = length;
    let table = `xref\n0 ${infoNum + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= infoNum; i++) table += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    push(table);
    push(`trailer\n<< /Size ${infoNum + 1} /Root 1 0 R /Info ${infoNum} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(parts, { type: 'application/pdf' });
  }

  // Private details for "your records" — only the groups the user ticked.
  function extrasFor(est, { notes, pricing }) {
    const sections = [];
    if (notes) {
      const rows = [];
      if (String(est.clientNote || '').trim()) rows.push(`Client note: ${est.clientNote.trim()}`);
      if (String(est.internalNotes || '').trim()) rows.push(`Internal notes: ${est.internalNotes.trim()}`);
      if (rows.length) sections.push(['Private notes', rows]);
    }
    if (pricing) {
      const ps = Store.priceSummary(est);
      const rows = ps.items.filter(i => i.price != null).map(i => [`${i.name} (${i.component})`, U.fmtMoney(i.price)]);
      if (ps.itemTotal != null) rows.push(['Item total', U.fmtMoney(ps.itemTotal)]);
      if (est.pricing.mode === 'package') rows.push(['Package price', ps.packagePrice != null ? U.fmtMoney(ps.packagePrice) : 'Not entered']);
      if (est.discount.category) rows.push([`${est.discount.category} discount`, ps.discountAmt != null ? `-${U.fmtMoney(ps.discountAmt)}` : 'No amount entered']);
      if (ps.discountAmt != null && ps.subtotal != null) rows.push(['Total after discount', U.fmtMoney(ps.total)]);
      rows.push(['Shown to the customer', `${est.pricing.showPrices ? 'prices' : 'no prices'}, ${est.discount.show && est.discount.category ? 'discount' : 'no discount'}`]);
      if (String(est.pricing.notes || '').trim()) rows.push(`Pricing notes: ${est.pricing.notes.trim()}`);
      sections.push(['Internal pricing', rows]);
    }
    return { sections };
  }

  // An internal copy is named apart so it can't be mistaken for the customer PDF.
  const fileName = (m, internal = false) => `${internal ? 'INTERNAL - ' : ''}${[m.number, m.client.name, m.title].filter(Boolean).join(' - ').replace(/[\\/:*?"<>|]+/g, '').slice(0, 120) || 'Estimate'}.pdf`;

  return { build, extrasFor, fileName };
})();
