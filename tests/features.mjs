// The rest of the app: catalog create/edit/link/delete, sizes, identification lookup, presenting,
// autosave across a reload, keyboard shortcuts, private client notes, and HTML injection in every
// free-text field.
//
// Run: node tests/features.mjs
import { serve, launch, check, failed } from './harness.mjs';

const { server, url } = await serve();
const { browser, context, page, errors } = await launch(url);
const settle = (ms = 400) => page.waitForTimeout(ms);
const toast = async () => (await page.locator('#toasts .toast').allTextContents()).join(' | ');
let alerts = 0;
page.on('dialog', d => { alerts++; d.dismiss(); });

try {
  console.log('Catalog');
  await page.goto(url + '#/catalog/findings'); await settle();
  const total = await page.locator('.cat-row').count();
  await page.fill('#cat-q', 'crown'); await settle();
  const crown = await page.locator('.cat-row').count();
  check(crown > 0 && crown < total, `search narrows the list (${crown} of ${total})`);
  await page.fill('#cat-q', ''); await page.selectOption('#cat-sys', 'gas'); await settle();
  check((await page.locator('.cat-row').count()) < total, 'system-type filter narrows the list (wood-only entries hidden for gas)');
  await page.selectOption('#cat-sys', '');

  // An install from before the fix: starter wood-only entries untagged, one of them edited by the user.
  const mig = await page.evaluate(async () => {
    const all = await DB.getAll('findings');
    const wood = all.filter(f => SEED_V2.woodOnly.test(f.code));
    wood.forEach(f => { f.appliesTo = []; });
    wood[0].description = 'My own wording';
    await DB.putMany('findings', wood);
    await DB.del('meta', 'catalog-v11');
    await Store.init();
    const after = await DB.getAll('findings');
    const byCode = c => after.find(f => f.code === c);
    return { edited: byCode(wood[0].code).appliesTo, others: wood.slice(1).map(f => byCode(f.code).appliesTo.join()) };
  });
  check(mig.others.every(x => x === 'wood'), `migration tags untouched starter wood-only entries (${mig.others.length})`);
  check(mig.edited.length === 0, 'migration leaves an entry you edited alone');

  await page.goto(url + '#/catalog/findings/new'); await settle();
  await page.click('#cat-form button[type=submit]');
  check(await page.isVisible('#cat-form .form-error'), 'empty catalog entry is rejected');
  await page.fill('#ci-cat', 'Crown'); await page.dispatchEvent('#ci-cat', 'change');
  check(/^CRN-FND-\d\d$/.test(await page.inputValue('#ci-code')), `next free code is suggested (${await page.inputValue('#ci-code')})`);
  await page.fill('#ci-code', 'CRN-FND-01');
  await page.fill('#ci-name', 'Test finding');
  await page.fill('#ci-desc', 'Something observed.');
  await page.click('#cat-form button[type=submit]');
  check((await page.textContent('#cat-form .form-error')).includes('already used'), 'duplicate identifier is rejected');
  await page.fill('#ci-code', 'TST-FND-99');
  await page.fill('#ci-rel-q', 'CRN-FIX-01'); await settle();
  await page.click('#ci-rel label.check >> nth=0');
  await page.click('#cat-form button[type=submit]'); await page.waitForURL(/#\/catalog\/findings$/); await settle();
  check(/Saved TST-FND-99/.test(await toast()), 'new finding saved');
  const linked = await page.evaluate(async () => {
    const f = (await DB.getAll('findings')).find(x => x.code === 'TST-FND-99');
    const r = (await DB.getAll('repairs')).find(x => f.relatedIds.includes(x.id));
    return !!r && r.relatedIds.includes(f.id);
  });
  check(linked, 'finding↔repair link is stored on both sides');
  await page.fill('#cat-q', 'TST-FND-99'); await settle();
  await page.click('.cat-row'); await settle();
  await page.click('[data-act=delete]'); await page.click('dialog.modal [data-ok]'); await page.waitForURL(/#\/catalog\/findings$/); await settle();
  const after = await page.evaluate(async () => {
    const ids = new Set((await DB.getAll('findings')).map(f => f.id));
    return {
      gone: !(await DB.getAll('findings')).some(x => x.code === 'TST-FND-99'),
      dangling: (await DB.getAll('repairs')).some(r => (r.relatedIds || []).some(id => !ids.has(id))),
    };
  });
  check(after.gone && !after.dangling, 'catalog entry deleted and no repair still links to it');

  console.log('Sizes');
  await page.goto(url + '#/catalog/sizes'); await settle();
  const opts = page.locator('.size-group >> nth=0 >> input.opts >> nth=0');
  await opts.fill('8 × 8, 9 × 9, 99 × 99');
  await page.click('#sizes-form button[type=submit]'); await settle();
  check(/Sizes saved/.test(await toast()), 'sizes saved');
  check((await page.evaluate(async () => (await Sizes.all())[0].types[0].options)).includes('99 × 99'), 'edited size list is stored');
  await page.click('[data-act=reset]'); await page.click('dialog.modal [data-ok]'); await settle(800);
  check(!(await page.evaluate(async () => (await Sizes.all())[0].types[0].options)).includes('99 × 99'), 'starter sizes restored');

  console.log('Estimate: identification, presenting, autosave');
  const id = await page.evaluate(async () => {
    const e = await Store.createEstimate({ name: 'Pat Lee', date: '2026-10-24', phone: '614-555-0111', email: '', jobAddress: '3 Pine St' });
    return e.id;
  });
  await page.goto(url + `#/estimates/${id}`); await settle();
  await page.click('label:has(> input[name=sys-type][value=gas])'); await settle();
  check(await page.locator('[data-action=add-problem][aria-disabled=true]').count() === 1, 'gas system asks for manufacturer/model before problems');
  await page.fill('[data-bind="system.manufacturer"]', 'Heat & Glo');
  await page.fill('[data-bind="system.model"]', 'SL-750'); await settle();
  check(await page.locator('[data-action=add-problem][aria-disabled=true]').count() === 0, 'problems unlock once identified');

  await page.click('[data-action=toggle-status]', { force: true }).catch(() => {});
  await page.click('details.more > summary'); await page.click('[data-action=toggle-status]'); await settle();
  check(/at least one finding/.test(await toast()), 'cannot present an estimate with no findings');

  await page.click('[data-action=add-problem]');
  await page.click('dialog.modal .chip >> nth=0');
  await page.click('dialog.modal [data-finding] >> nth=0');
  await page.click('dialog.modal [data-go=finish], dialog.modal [data-go=next]');
  if (await page.locator('dialog.modal [data-go=skip-sizes]').isVisible().catch(() => false)) await page.click('dialog.modal [data-go=skip-sizes]');
  await settle(800);
  await page.click('details.more > summary'); await page.click('[data-action=toggle-status]'); await settle();
  check(/title/.test(await toast()), 'cannot present without a title and description');

  await page.locator('[data-action=identify]').evaluate(b => b.closest('details').open = true);
  await page.click('[data-action=identify]'); await settle();
  await page.fill('#id-url', 'https://www.amazon.com/dp/B000123'); await page.click('[data-act=add-src]');
  check((await page.textContent('dialog.modal')).includes('store, listing, or price'), 'store links are rejected in identification lookup');
  await page.fill('#id-url', 'javascript:alert(1)'); await page.click('[data-act=add-src]');
  check(/Only http|full link/.test(await page.textContent('dialog.modal')), 'non-web links are rejected');
  await page.click('label:has(> input[name=id-status][value=confirmed])').catch(() => page.check('input[name=id-status][value=confirmed]'));
  await page.click('[data-act=save]');
  check((await page.textContent('dialog.modal')).includes('Add at least one source'), 'confirming a match needs a source');
  await page.fill('#id-url', 'https://www.heatnglo.com/manuals/sl-750.pdf'); await page.click('[data-act=add-src]');
  await page.click('[data-act=save]'); await settle(600);
  check(/Identification saved/.test(await toast()), 'identification saved with a source');

  await page.click('[data-action=generate]'); await settle(800);
  await page.fill('[data-bind=clientNote]', 'Daughter Sam schedules');
  await page.fill('[data-bind=jobAddress]', '3 Pine St, Unit B');
  await settle(1600);
  await page.reload(); await page.waitForSelector('#sec-items'); await settle();
  check((await page.inputValue('[data-bind=jobAddress]')) === '3 Pine St, Unit B', 'autosave keeps edits across a reload');
  await page.fill('[data-bind=jobAddress]', '3 Pine St, Unit C');
  await page.keyboard.press('Control+s'); await settle(300);
  check(/Saved/.test(await toast()), 'Ctrl+S saves immediately');
  await page.reload(); await page.waitForSelector('#sec-items');
  check((await page.inputValue('[data-bind=jobAddress]')) === '3 Pine St, Unit C', 'Ctrl+S save persisted');
  await page.click('details.more > summary'); await page.click('[data-action=toggle-status]'); await settle();
  check(/Marked as presented/.test(await toast()), 'complete estimate can be marked presented');
  const pv = await page.evaluate(async i => { const e = Store.normalize(await DB.get('estimates', i)); return Customer.text(Customer.model(e, await Store.settings())); }, id);
  check(!pv.includes('Daughter Sam'), 'private client note stays out of the customer text');

  console.log('Private notes across estimates');
  const id2 = await page.evaluate(async () => (await Store.createEstimate({ name: 'Pat Lee', date: '2026-10-25', phone: '', email: '', jobAddress: '' })).id);
  await page.goto(url + `#/estimates/${id2}`); await settle();
  check((await page.textContent('#sec-client')).includes('Private notes from 1 other estimate'), 'notes from the same client’s other estimates are offered');

  console.log('Keyboard');
  await page.goto(url + '#/estimates'); await settle();
  await page.keyboard.press('/');
  check(await page.evaluate(() => document.activeElement.id === 'est-q'), '/ focuses search');
  await page.click('h1'); await page.keyboard.press('n'); await settle();
  check(await page.isVisible('#new-est'), 'N opens a new estimate');
  await page.keyboard.press('Escape'); await settle();
  check(!(await page.isVisible('#new-est')), 'Esc closes the dialog');

  console.log('HTML injection');
  const X = '<img src=x onerror="window.__xss=(window.__xss||0)+1">';
  const xid = await page.evaluate(async x => {
    const s = await Store.settings(); await Store.saveSettings({ ...s, businessName: `Biz ${x}`, footer: x, notice: x });
    const e = await Store.createEstimate({ name: `N ${x}`, date: '2026-10-24', phone: x, email: '', jobAddress: x });
    e.title = x; e.scopeText = `${x}\n\nHead ${x}\nWhat we found: ${x}`; e.clientNote = x; e.system = { type: 'gas', manufacturer: x, model: x };
    e.components = [{ ...Store.newComponent(), category: x, location: x, findings: [{ ...Store.findingSnapshot(null), name: x, note: x, measurements: [{ label: x, unit: x, value: x }],
      repairs: [{ ...Store.repairSnapshot(null), name: x, description: x, details: [{ label: x, unit: x, value: x }] }] }] }];
    e.pricing.showPrices = true; e.discount = { category: x, amount: '5', unit: '%', show: true };
    await DB.put('estimates', e);
    const f = (await DB.getAll('findings'))[0]; await DB.put('findings', { ...f, name: x, description: x });
    return e.id;
  }, X);
  for (const h of ['#/estimates', `#/estimates/${xid}`, `#/estimates/${xid}/preview`, '#/catalog/findings', '#/settings']) {
    await page.goto(url + h); await settle(600);
  }
  await page.goto(url + `#/estimates/${xid}`); await settle(600);
  await page.click('[data-action=expand-all]').catch(() => {});
  await page.click('#sec-deliver > summary').catch(() => {}); await settle(400);
  check(!(await page.evaluate(() => window.__xss)) && alerts === 0, 'markup typed into any field is shown as text, never run');
} catch (err) {
  check(false, `unexpected: ${err.stack}`);
  await page.screenshot({ path: '/tmp/apex-features-failure.png', fullPage: true });
}

check(!errors.length, `no console errors (${errors.join(' / ')})`);
await browser.close();
server.close();
console.log(failed() ? `\n${failed()} check(s) failed` : '\nAll checks passed');
process.exit(failed() ? 1 : 0);
