// PDF edge cases, built through the app's own PdfExport and checked with poppler and pypdf:
// an empty estimate, a large one (many repairs and photos), and text with PDF syntax characters,
// accents, typographic punctuation, emoji, and non-Latin script.
//
// Run: node tests/pdf.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { serve, launch, check, failed, ROOT } from './harness.mjs';

const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-pdf-'));
const { server, url } = await serve();
const { browser, page, errors } = await launch(url);
const jpg = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'chimney.jpg')).toString('base64');

// Builds a PDF for an estimate prepared by `setup` (run in the page) and returns its file path.
async function build(name, setup, arg) {
  const b64 = await page.evaluate(async ([src, a, img]) => {
    const fn = new Function('a', 'img', `return (${src})(a, img);`);
    const est = Store.normalize(await fn(a, img));
    await DB.put('estimates', est);
    const blob = await PdfExport.build(Customer.model(est, await Store.settings()), PdfExport.extrasFor(est, {}));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }, [setup.toString(), arg, jpg]);
  const file = path.join(OUT, `${name}.pdf`);
  fs.writeFileSync(file, Buffer.from(b64, 'base64'));
  return file;
}
const pagesOf = f => Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [f]).toString())[1]);
const textOf = f => execFileSync('pdftotext', [f, '-']).toString();
const pypdf = f => execFileSync('python3', ['-c', 'import sys,pypdf; r=pypdf.PdfReader(sys.argv[1], strict=True); print(len(r.pages)); [p.extract_text() for p in r.pages]', f]).toString().trim();

console.log('Empty estimate');
const empty = await build('empty', async () => Store.createEstimate({ name: 'Empty Client', date: '2026-10-24', phone: '', email: '', jobAddress: '' }));
check(pagesOf(empty) === 1, 'opens as one page');
const et = textOf(empty);
check(et.includes('Empty Client') && et.includes('Estimate') && !et.includes('Proposed Work'), 'shows the header and no empty sections');
check(pypdf(empty) === '1', 'pypdf parses it in strict mode');

console.log('Large estimate');
const big = await build('large', async (n, img) => {
  const e = await Store.createEstimate({ name: 'Big Job', date: '2026-10-24', phone: '', email: '', jobAddress: '9 Long Rd' });
  e.system.type = 'wood';
  const blob = await (await fetch(`data:image/jpeg;base64,${img}`)).blob();
  const photoIds = [];
  for (let i = 0; i < 12; i++) photoIds.push(await Photos.importFile(new File([blob], `p${i}.jpg`, { type: 'image/jpeg' }), e.id));
  const repairs = (await Store.catalog('repairs')).filter(r => Store.appliesTo(r, 'wood')).slice(0, n);
  const finds = (await Store.catalog('findings')).filter(f => Store.appliesTo(f, 'wood'));
  e.components = repairs.map((r, i) => ({ ...Store.newComponent(), category: r.category,
    findings: [{ ...Store.findingSnapshot(finds[i % finds.length]), status: 'confirmed', note: `Observed during visit, item ${i + 1}.`,
      photos: i < 12 ? [{ id: photoIds[i], caption: `Photo ${i + 1}`, include: true }] : [],
      repairs: [Store.repairSnapshot(r)] }] }));
  e.title = 'Full Chimney Restoration';
  return e;
}, 15);
const bigPages = pagesOf(big);
const bt = textOf(big);
const imgCount = execFileSync('pdfimages', ['-list', big]).toString().trim().split('\n').length - 2;
check(bigPages >= 6, `runs to ${bigPages} pages`);
check(imgCount === 12, `embeds all 12 photos (${imgCount})`);
check(bt.includes(`Page ${bigPages} of ${bigPages}`) && (bt.match(/Page \d+ of \d+/g) || []).length === bigPages, 'every page is numbered');
check((bt.match(/Full Chimney Restoration/g) || []).length >= bigPages, 'every page footer names the project');
check(pypdf(big) === String(bigPages), 'pypdf parses it in strict mode');
check(fs.statSync(big).size < 15e6, `file size is reasonable (${(fs.statSync(big).size / 1048576).toFixed(1)} MB)`);
execFileSync('pdftoppm', ['-r', '40', '-png', big, path.join(OUT, 'large')]);
check(fs.readdirSync(OUT).filter(f => f.startsWith('large-')).length === bigPages, 'every page renders to an image');

console.log('Special characters');
const sp = await build('special', async () => {
  const e = await Store.createEstimate({ name: 'Zoë O’Brien (Smith) \\ “Jr.”', date: '2026-10-24', phone: '', email: 'zoe@example.com', jobAddress: '5 Café Ln — Apt #2' });
  e.title = 'Crown (Rebuild) & Cap — 100% Done';
  e.scopeText = 'Intro line with parens (like this), a backslash \\ and 50% off.\n\nCrown Work\nWhat we found: Crack ½" wide — see photo 🔥 and 煙突.\nWhat we’ll do: Seal it.';
  e.components = [{ ...Store.newComponent(), category: 'Crown', findings: [{ ...Store.findingSnapshot(null), name: 'Crack', repairs: [{ ...Store.repairSnapshot(null), name: 'Seal' }] }] }];
  return e;
});
const st = textOf(sp);
check(pypdf(sp) === String(pagesOf(sp)), 'PDF syntax characters don’t break the file (pypdf strict)');
check(st.includes('Zoë O’Brien (Smith) \\ “Jr.”'), 'accents, curly quotes, parentheses, and backslash print correctly');
check(st.includes('Crown (Rebuild) & Cap — 100% Done') && st.includes('5 Café Ln — Apt #2'), 'title and address print correctly');
check(st.includes('Crack ½" wide — see photo') && !st.includes('🔥'), 'unsupported characters (emoji, 煙突) are left out, as documented');

check(!errors.length, `no console errors (${errors.join(' / ')})`);
await browser.close();
server.close();
console.log(failed() ? `\n${failed()} check(s) failed` : '\nAll checks passed');
process.exit(failed() ? 1 : 0);
