// End-to-end workflow test in Chromium: settings, a new estimate, system type, problems via the
// guided wizard and from a photo, media, title & description, pricing, preview, Save PDF (verified
// with poppler/pypdf), copy text, private WhatsApp link, duplicate/search/delete, backup and restore.
//
// Run: node tests/e2e.mjs   (needs Python 3 with pypdf and poppler-utils for the PDF checks)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { serve, launch, check, failed, ROOT } from './harness.mjs';

const FX = path.join(ROOT, 'tests', 'fixtures');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-e2e-'));
const { server, url } = await serve();
const { browser, context, page, errors } = await launch(url);
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url.replace(/\/$/, '') });

const toast = async () => (await page.locator('#toasts .toast').allTextContents()).join(' | ');
const settle = (ms = 400) => page.waitForTimeout(ms);
async function chooseFiles(trigger, files) {
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), trigger()]);
  await fc.setFiles(files.map(f => path.join(FX, f)));
}
async function waitDownload(trigger) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), trigger()]);
  const file = path.join(OUT, dl.suggestedFilename());
  await dl.saveAs(file);
  return file;
}

try {
  console.log('Settings');
  await page.goto(url + '#/settings'); await settle();
  await page.fill('#s-businessName', 'Apex Chimney Co.');
  await page.fill('#s-phone', '(614) 555-0100');
  await page.fill('#s-email', 'office@example.com');
  await page.fill('#s-address', '1 Main St\nColumbus, OH 43215');
  await page.click('#settings button[type=submit]'); await settle();
  check((await toast()).includes('Settings saved'), 'settings save shows a confirmation');
  await page.fill('#s-email', 'bad@'); await page.click('#settings button[type=submit]');
  check(await page.isVisible('#settings .form-error'), 'invalid email is rejected with a message');
  await page.fill('#s-email', 'office@example.com'); await page.click('#settings button[type=submit]'); await settle();

  console.log('New estimate');
  await page.goto(url + '#/estimates'); await settle();
  await page.click('main [data-action=new]');
  await page.click('#new-est button[type=submit]');
  check(await page.isVisible('#new-est .form-error'), 'empty customer name is rejected');
  await page.fill('#ne-name', 'Jane O’Brien');
  await page.fill('#ne-phone', '614-555-0199');
  await page.fill('#ne-email', 'jane@example.com');
  await page.fill('#ne-addr', '12 Elm St, Columbus, OH 43215');
  await page.click('#new-est button[type=submit]');
  await page.waitForURL(/#\/estimates\/[\w-]+$/);
  const estUrl = page.url();
  check(/#\/estimates\/[\w-]+$/.test(estUrl), 'estimate created and editor opened');

  console.log('System type');
  await page.click('label:has(> input[name=sys-type][value=wood])'); await settle();

  console.log('Guided problem');
  await page.click('[data-action=add-problem]');
  await page.waitForSelector('dialog.modal .wiz');
  await page.click('dialog.modal [data-cat="Crown"]');
  await page.click('dialog.modal [data-finding] >> nth=0');
  await page.waitForSelector('dialog.modal .check-pick input');
  const pre = await page.locator('dialog.modal .check-pick input:checked').count();
  if (!pre) await page.click('dialog.modal .check-pick >> nth=0');
  await page.fill('#wz-note', 'Matches existing crown');
  const next = page.locator('dialog.modal [data-go=next]');
  if (await next.isVisible()) {
    await next.click();
    await page.click('dialog.modal .size-row .chip >> nth=0');
  }
  await page.click('dialog.modal [data-go=finish]');
  await settle(800);
  check((await page.locator('#sec-items .finding').count()) === 1, 'guided problem added one finding');

  console.log('Second problem: masonry with tuck pointing');
  await page.click('[data-action=add-problem]');
  await page.click('dialog.modal [data-cat="Masonry"]');
  await page.click('dialog.modal [data-finding]:has-text("mortar")');
  await page.click('dialog.modal .check-pick:has-text("Major tuck pointing")');
  await page.click('dialog.modal [data-go=finish], dialog.modal [data-go=next]');
  if (await page.locator('dialog.modal [data-go=skip-sizes]').isVisible().catch(() => false)) await page.click('dialog.modal [data-go=skip-sizes]');
  await settle(800);
  check((await page.locator('#sec-items .finding').count()) === 2, 'second problem added');

  console.log('Photo validation and import');
  // Photo analysis is off here (no key, not hosted): the photo is attached and the wizard opens.
  await chooseFiles(() => page.click('[data-action=photo-problem]:not([data-capture])'), ['notes.txt']);
  await settle(600);
  check(/not a photo/i.test(await toast()), 'a non-image file is rejected with a message');
  await chooseFiles(() => page.click('[data-action=photo-problem]:not([data-capture])'), ['broken.jpg']);
  await settle(1200);
  check(/could not be read|format/i.test(await toast()), 'an undecodable image is rejected with a message');
  await chooseFiles(() => page.click('[data-action=photo-problem]:not([data-capture])'), ['chimney.jpg']);
  await page.waitForSelector('dialog.modal .wiz');
  check(await page.isVisible('dialog.modal .wiz-photo'), 'photo shows in the problem wizard');
  await page.click('dialog.modal [data-cat="Chimney cap"]');
  await page.click('dialog.modal [data-finding] >> nth=0');
  await page.click('dialog.modal [data-go=finish], dialog.modal [data-go=next]');
  if (await page.locator('dialog.modal [data-go=skip-sizes]').isVisible().catch(() => false)) await page.click('dialog.modal [data-go=skip-sizes]');
  await settle(1000);
  check((await page.locator('#sec-items .finding').count()) === 3, 'photo problem added');
  const stored = await page.evaluate(async () => {
    const all = await DB.getAll('photos');
    return all.map(p => ({ w: p.width, h: p.height, type: p.blob.type, thumb: !!p.thumb }));
  });
  check(stored.length === 1 && Math.max(stored[0].w, stored[0].h) === 2000 && stored[0].type === 'image/jpeg' && stored[0].thumb,
    `photo stored resized to 2000px JPEG with thumbnail (${JSON.stringify(stored)})`);

  console.log('Add photos to an item');
  await page.click('[data-action=expand-all]').catch(() => {});
  await settle();
  await chooseFiles(() => page.locator('[data-action=add-photos][data-arr*="findings.0.photos"]').first().click(), ['chimney.jpg', 'label.png']);
  await settle(1500);
  check(/Added 2 files/.test(await toast()), 'two photos added to a finding');

  console.log('Title & description');
  await page.click('[data-action=generate]'); await settle(800);
  const title = await page.inputValue('[data-bind=title]');
  const scope = await page.inputValue('[data-bind=scopeText]');
  check(title.length > 5, `title written: "${title}"`);
  check(scope.includes('What we’ll do') || scope.includes("What we'll do"), 'description lists the work');

  console.log('Pricing');
  await page.locator('#sec-pricing summary').click().catch(() => {});
  await settle();
  const prices = page.locator('[data-bind^="pricing.itemPrices."]');
  const nPrices = await prices.count();
  for (let i = 0; i < nPrices; i++) await prices.nth(i).fill(String(400 + i * 100));
  await page.click('label:has(> [data-bind="pricing.showPrices"])'); await settle(1500);

  console.log('Preview');
  await page.goto(estUrl + '/preview'); await page.waitForSelector('article.doc');
  const doc = await page.textContent('article.doc');
  check(doc.includes('Jane O’Brien') && doc.includes(title) && doc.includes('Proposed Work'), 'preview shows customer, title, proposed work');
  check(doc.includes('Total'), 'preview shows prices when switched on');
  check((await page.locator('article.doc img[data-photo-id]').count()) === 3, 'preview shows the three customer photos');
  await page.waitForFunction(() => [...document.querySelectorAll('article.doc img')].every(i => i.complete && i.naturalWidth > 0));
  check(true, 'preview photos load');
  await page.click('.preview-bar a'); await page.waitForSelector('#sec-deliver[open]');

  console.log('Save PDF');
  await page.click('[data-action=save-pdf]');
  const pdf = await waitDownload(() => page.click('dialog.modal [data-act=save]'));
  const info = execFileSync('pdfinfo', [pdf]).toString();
  const pages = Number(/Pages:\s+(\d+)/.exec(info)[1]);
  const txt = execFileSync('pdftotext', ['-layout', pdf, '-']).toString();
  const imgs = execFileSync('pdfimages', ['-list', pdf]).toString().trim().split('\n').length - 2;
  check(pages >= 2, `PDF opens with poppler: ${pages} pages`);
  check(txt.includes('Jane O’Brien') && txt.includes('Apex Chimney Co.') && txt.includes('Proposed Work'), 'PDF has the customer, business, and proposed work');
  check(txt.includes(`Page 1 of ${pages}`) && txt.includes(`Page ${pages} of ${pages}`), 'PDF has page numbers on every page');
  check(imgs === 3, `PDF embeds the three customer photos (${imgs})`);
  check(!/Internal copy|INTERNAL COPY/.test(txt), 'customer PDF has no internal mark');
  const py = execFileSync('python3', ['-c', 'import sys,pypdf; r=pypdf.PdfReader(sys.argv[1]); print(len(r.pages), r.metadata.title)', pdf]).toString().trim();
  check(py.startsWith(String(pages)), `pypdf reads the PDF too (${py})`);

  await page.click('[data-action=save-pdf]');
  await page.click('label:has(> #pdf-pricing)');
  const ipdf = await waitDownload(() => page.click('dialog.modal [data-act=save]'));
  const itxt = execFileSync('pdftotext', [ipdf, '-']).toString();
  check(itxt.includes('INTERNAL COPY') && itxt.includes('INTERNAL PRICING') && itxt.includes('$1,500'), 'internal PDF carries the pricing page and mark');
  check(path.basename(ipdf).startsWith('INTERNAL - ') && fs.existsSync(pdf), 'internal PDF is named apart from the customer PDF');

  console.log('Copy customer text');
  await page.click('[data-action=copy-customer]'); await settle();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check(clip.includes('PROPOSED WORK') && clip.includes('Jane O’Brien'), 'customer text copied to the clipboard');

  console.log('Private WhatsApp copy');
  // The sandbox has no route to WhatsApp, so check the address the app opens rather than the page.
  await context.route(/wa\.me|whatsapp\.com/, r => r.fulfill({ status: 200, body: 'ok' }));
  const [popup] = await Promise.all([context.waitForEvent('page'), page.click('[data-wa]')]);
  await popup.waitForLoadState();
  const waUrl = popup.url();
  await popup.close();
  const waText = decodeURIComponent(new URL(waUrl).searchParams.get('text') || '');
  check(waText.startsWith('PRIVATE COPY') && waText.includes('Internal pricing'), 'WhatsApp message carries the private copy with pricing');
  check(/^https:\/\/(wa\.me|api\.whatsapp\.com)\//.test(waUrl) && /16144963246|phone=16144963246/.test(waUrl), `WhatsApp opens for the fixed number (${waUrl.slice(0, 60)}…)`);
  await settle(800);
  check(/Not confirmed sent/.test(await page.textContent('[data-live=pc-status]')), 'status says opened, not confirmed sent');

  await page.click('[data-action=copy-private]'); await settle();
  const pclip = await page.evaluate(() => navigator.clipboard.readText());
  check(pclip.startsWith('PRIVATE COPY') && pclip.includes('Internal pricing'), 'private text can be copied for pasting');

  console.log('Estimates list: search, duplicate, delete');
  await page.goto(url + '#/estimates'); await settle();
  await page.fill('#est-q', 'Elm'); await settle();
  check((await page.locator('.est-row').count()) === 1, 'search by address finds the estimate');
  await page.fill('#est-q', 'zzzz'); await settle();
  check(await page.isVisible('text=No estimates match'), 'search with no match says so');
  await page.fill('#est-q', ''); await settle();
  await page.click('.est-row [data-action=dup]'); await page.waitForURL(/#\/estimates\/[\w-]+$/); await settle();
  await page.goto(url + '#/estimates'); await settle();
  check((await page.locator('.est-row').count()) === 2, 'duplicate creates a second estimate');
  const photosBefore = await page.evaluate(async () => (await DB.getAll('photos')).length);
  check(photosBefore === 6, `duplicate copies photos (${photosBefore})`);

  console.log('Backup and restore');
  await page.goto(url + '#/settings'); await settle();
  const backup = await waitDownload(() => page.click('[data-act=export]'));
  const bj = JSON.parse(fs.readFileSync(backup, 'utf8'));
  check(bj.app === 'chimney-estimator' && bj.estimates.length === 2 && bj.photos.length === 6, 'backup has both estimates and all photos');

  await page.goto(url + '#/estimates'); await settle();
  page.once('dialog', d => d.accept());
  await page.click('.est-row [data-action=del] >> nth=0');
  await page.click('dialog.modal [data-ok]'); await settle(800);
  check((await page.locator('.est-row').count()) === 1, 'delete removes the estimate');
  check((await page.evaluate(async () => (await DB.getAll('photos')).length)) === 3, 'delete removes its photos');

  await page.goto(url + '#/settings'); await settle();
  await chooseFiles(() => page.click('[data-act=import]'), [path.relative(FX, backup)]);
  await page.click('dialog.modal [data-ok]');
  await page.waitForLoadState('load'); await page.waitForSelector('main .view h1'); await settle(800);
  check((await page.locator('.est-row').count()) === 2, 'restore brings back both estimates');
  check((await page.evaluate(async () => (await DB.getAll('photos')).length)) === 6, 'restore brings back all photos');

  console.log('Restore refuses bad files');
  const bad = [
    ['not-json.json', 'this is not json', /not valid JSON/],
    ['other-app.json', JSON.stringify({ app: 'something-else' }), /not a backup from this app/],
    ['no-photos.json', JSON.stringify({ ...bj, photos: undefined }), /incomplete/],
    ['url-photo.json', JSON.stringify({ ...bj, photos: [{ ...bj.photos[0], blob: 'https://example.com/x.jpg' }] }), /damaged photo/],
  ];
  for (const [name, body, expect] of bad) {
    fs.writeFileSync(path.join(OUT, name), body);
    await page.goto(url + '#/settings'); await settle();
    await chooseFiles(() => page.click('[data-act=import]'), [path.relative(FX, path.join(OUT, name))]);
    await settle(600);
    check(expect.test(await toast()) && !(await page.isVisible('dialog.modal')), `${name} is refused before anything changes`);
  }
  check((await page.evaluate(async () => (await DB.getAll('estimates')).length)) === 2, 'data is unchanged after refused restores');

  const rollback = await page.evaluate(async () => {
    const before = (await DB.getAll('estimates')).length;
    let err = '';
    // The third estimate has no id, so its write fails after the stores were already cleared.
    try { await DB.replaceAll({ estimates: [{ id: 'a' }, { id: 'b' }, { name: 'no id' }], findings: [], repairs: [], photos: [], meta: [] }); } catch (e) { err = e.name || e.message; }
    return { err, before, after: (await DB.getAll('estimates')).length, findings: (await DB.getAll('findings')).length };
  });
  check(rollback.err && rollback.after === rollback.before && rollback.findings > 0, `a restore that fails part-way changes nothing (${rollback.err}; ${rollback.after} estimates kept)`);

  console.log('Mobile layout');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(estUrl); await settle(800);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, `editor has no horizontal scroll at 390px (${overflow})`);
} catch (err) {
  check(false, `unexpected: ${err.stack}`);
  await page.screenshot({ path: path.join(OUT, 'failure.png'), fullPage: true });
  console.log('screenshot:', path.join(OUT, 'failure.png'));
}

check(!errors.length, `no console errors (${errors.join(' / ')})`);
await browser.close();
server.close();
console.log(failed() ? `\n${failed()} check(s) failed` : '\nAll checks passed');
process.exit(failed() ? 1 : 0);
