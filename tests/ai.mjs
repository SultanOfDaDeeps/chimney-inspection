// Photo analysis and hosted-page file saving.
//  A. API-key route: the request the app sends (headers, body, image) and the review flow, with the
//     endpoint answered by the test; then every failure the app must explain.
//  B. The real Claude API with an invalid key: the browser request goes through and the 401 is explained.
//  C. Hosted claude.ai route: a stand-in for the page runtime (window.claude.use) that follows the
//     published `sample` and `downloads` contracts, checking what the app passes and how it handles answers.
//
// Run: node tests/ai.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { serve, launch, check, failed, ROOT } from './harness.mjs';

const FX = path.join(ROOT, 'tests', 'fixtures');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-ai-'));
const { server, url } = await serve();
const settle = (page, ms = 400) => page.waitForTimeout(ms);
const toast = async page => (await page.locator('#toasts .toast').allTextContents()).join(' | ');

const GOOD = {
  photo_clear: true, unclear_reason: '',
  component: { value: 'Crown', confidence: 'high', explanation: 'Concrete slab on top of the brick stack.' },
  manufacturer: { value: '', confidence: 'low', explanation: 'No label visible.' },
  model: { value: '', confidence: 'low', explanation: 'No label visible.' },
  label_text: '',
  condition: { value: 'Visible cracking across the crown', confidence: 'medium', explanation: 'Dark line across the crown surface.' },
  finding_code: { value: 'CRN-FND-01', confidence: 'medium', explanation: 'Cracks match the crown cracking finding.' },
};
const apiReply = (obj, extra = {}) => ({ id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn',
  content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }], ...extra });

async function newEstimate(page, name) {
  return page.evaluate(async n => {
    const e = await Store.createEstimate({ name: n, date: '2026-10-24', phone: '', email: '', jobAddress: '1 Oak St' });
    e.system.type = 'wood'; await DB.put('estimates', e); return e.id;
  }, name);
}
async function photoFromFixture(page, estId, file) {
  const b64 = fs.readFileSync(path.join(FX, file)).toString('base64');
  return page.evaluate(async ([b, id, name]) => {
    const blob = await (await fetch(`data:image/jpeg;base64,${b}`)).blob();
    return Photos.importFile(new File([blob], name, { type: 'image/jpeg' }), id);
  }, [b64, estId, file]);
}
const ctxFor = page => page.evaluate(async () => {
  const f = (await Store.catalog('findings')).filter(x => Store.appliesTo(x, 'wood'));
  return { mode: 'component', systemType: 'wood', categories: [...new Set(f.map(x => x.category))], findings: f.map(({ id, code, name, category }) => ({ id, code, name, category })) };
});

// ---------------- A. API-key route ----------------
{
  console.log('A. API-key route');
  const { browser, page, errors } = await launch(url, { hash: '#/settings' });
  await page.fill('#ai-key', 'not-a-key'); await page.click('#ai-settings button[type=submit]');
  check(await page.isVisible('#ai-settings .form-error'), 'a malformed key is rejected with a message');
  await page.fill('#ai-key', 'sk-ant-test-0123456789abcdef'); await page.click('#ai-settings button[type=submit]');
  await page.waitForSelector('text=✓ Photo analysis is on.');
  check(true, 'saving a key turns analysis on');
  const backupKeyLeak = await page.evaluate(async () => (await DB.getAll('meta')).some(m => m.key === 'ai'));
  check(backupKeyLeak, 'key is stored locally (and the export filters it out — see e2e)');

  let captured = null;
  await page.route('https://api.anthropic.com/v1/messages', async route => {
    captured = { headers: route.request().headers(), body: JSON.parse(route.request().postData()) };
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(apiReply(GOOD)) });
  });

  const estId = await newEstimate(page, 'Photo Test');
  await page.goto(url + `#/estimates/${estId}`); await page.waitForSelector('#sec-items');
  check((await page.textContent('#sec-items .hint')).includes('Photos get suggestions'), 'editor says photo analysis is on');
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-action=photo-problem]:not([data-capture])')]);
  await fc.setFiles(path.join(FX, 'chimney.jpg'));
  await page.waitForSelector('text=Review photo suggestions', { timeout: 15000 });
  const h = captured.headers, b = captured.body;
  check(h['x-api-key'] === 'sk-ant-test-0123456789abcdef' && h['anthropic-version'] === '2026-10-21' && h['anthropic-dangerous-direct-browser-access'] === 'true', 'request carries the key, API version, and browser-access headers');
  check(h['anthropic-beta'] === 'server-side-fallback-2026-07-01' && b.fallbacks === 'default', 'refusal fallback is requested');
  check(b.model === 'claude-opus-5-5' && b.output_config.format.type === 'json_schema' && b.output_config.effort === 'medium', 'model, effort, and structured-output schema are sent');
  const img = b.messages[0].content.find(c => c.type === 'image');
  const raw = Buffer.from(img.source.data, 'base64');
  fs.writeFileSync(path.join(OUT, 'sent.jpg'), raw);
  const dims = execFileSync('python3', ['-c', 'import sys;from PIL import Image;i=Image.open(sys.argv[1]);print(i.format,i.size[0],i.size[1])', path.join(OUT, 'sent.jpg')]).toString().trim();
  check(img.source.media_type === 'image/jpeg' && /^JPEG \d+ 1568$/.test(dims), `the photo itself is sent as a JPEG, 1568px long edge (${dims}, ${Math.round(raw.length / 1024)} KB)`);
  const text = b.messages[0].content.find(c => c.type === 'text').text;
  check(text.includes('CRN-FND-01') && !text.includes('Photo Test'), 'prompt lists catalog findings and no customer details');

  check((await page.locator('dialog.modal .sugg').count()) === 3, 'review shows the three non-empty suggestions');
  check((await page.textContent('dialog.modal')).includes('Medium confidence'), 'confidence levels are shown');
  await page.click('dialog.modal [data-act=ok]');
  check(await page.isVisible('dialog.modal .form-error'), 'each suggestion must be confirmed or ignored');
  for (const k of ['component', 'condition', 'finding_code']) await page.click(`dialog.modal .sugg[data-k=${k}] label:has(input[value=use])`);
  await page.click('dialog.modal [data-act=ok]');
  await page.waitForSelector('dialog.modal .wiz');
  check((await page.textContent('dialog.modal .chip.selected')).includes('Crown'), 'confirmed component is pre-selected in the wizard');
  await page.click('dialog.modal .chip.selected');
  check((await page.locator('dialog.modal .pick.suggested').count()) === 1, 'confirmed finding is highlighted');
  await page.click('dialog.modal .pick.suggested');
  await page.click('dialog.modal [data-go=finish], dialog.modal [data-go=next]');
  if (await page.locator('dialog.modal [data-go=skip-sizes]').isVisible().catch(() => false)) await page.click('dialog.modal [data-go=skip-sizes]');
  await settle(page, 800);
  const saved = await page.evaluate(async id => {
    const e = Store.normalize(await DB.get('estimates', id));
    const f = e.components[0].findings[0];
    const m = Customer.model(e, await Store.settings());
    return { name: f.name, analysis: f.photos[0].analysis, customer: Customer.text(m) + JSON.stringify(m) };
  }, estId);
  check(saved.analysis && saved.analysis.decisions.component === 'confirmed', `finding added with the analysis kept on the photo (${saved.name})`);
  check(!saved.customer.includes('Visible cracking across the crown') && !saved.customer.includes('analysis'), 'analysis never reaches the customer document');

  console.log('   failures');
  const photoId = await photoFromFixture(page, estId, 'chimney.jpg');
  const ctx = await ctxFor(page);
  const attempt = async () => page.evaluate(async ([id, c]) => { try { await AI.analyzePhoto(id, c); return 'ok'; } catch (e) { return e.message; } }, [photoId, ctx]);
  const cases = [
    ['401', r => r.fulfill({ status: 401, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}' }), /key was rejected/],
    ['429', r => r.fulfill({ status: 429, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"type":"error","error":{"message":"rate"}}' }), /rate-limited/],
    ['529', r => r.fulfill({ status: 529, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}' }), /Analysis failed: Overloaded/],
    ['offline', r => r.abort('internetdisconnected'), /Could not reach/],
    ['refusal', r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(apiReply('', { stop_reason: 'refusal', content: [] })) }), /declined/],
    ['cut off', r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(apiReply('{"photo_clear":', { stop_reason: 'max_tokens' })) }), /cut off/],
    ['not JSON', r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(apiReply('I think this is a chimney.')) }), /could not be read/],
    ['wrong shape', r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(apiReply('[1,2]')) }), /could not be read/],
  ];
  for (const [label, handler, expect] of cases) {
    await page.unroute('https://api.anthropic.com/v1/messages');
    await page.route('https://api.anthropic.com/v1/messages', handler);
    const msg = await attempt();
    check(expect.test(msg), `${label}: "${msg}"`);
  }
  // A partial answer is filled in rather than breaking the review dialog.
  await page.unroute('https://api.anthropic.com/v1/messages');
  await page.route('https://api.anthropic.com/v1/messages', r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(apiReply({ photo_clear: false, unclear_reason: 'Too dark', component: { value: 'Crown' } })) }));
  const partial = await page.evaluate(async ([id, c]) => AI.analyzePhoto(id, c), [photoId, ctx]);
  check(partial.photo_clear === false && partial.component.confidence === 'low' && partial.finding_code.value === '', 'partial answer is filled with empty, low-confidence values');
  // The unclear-photo path in the UI.
  await page.goto(url + `#/estimates/${estId}`); await page.waitForSelector('#sec-items');
  const [fc2] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-action=photo-problem]:not([data-capture])')]);
  await fc2.setFiles(path.join(FX, 'chimney.jpg'));
  await page.waitForSelector('text=The photo is unclear.');
  check((await page.textContent('dialog.modal')).includes('Too dark'), 'unclear photo is flagged with the reason');
  await page.click('dialog.modal [data-close]');
  await page.waitForSelector('dialog.modal .wiz');
  check(true, 'cancelling the review continues to manual choice');
  await page.click('dialog.modal [data-close]'); await settle(page);
  // Cancelling during analysis.
  await page.unroute('https://api.anthropic.com/v1/messages');
  await page.route('https://api.anthropic.com/v1/messages', () => {}); // never answers
  const [fc3] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-action=photo-problem]:not([data-capture])')]);
  await fc3.setFiles(path.join(FX, 'chimney.jpg'));
  await page.waitForSelector('text=Analyzing photo…');
  await page.click('dialog.modal [data-close]');
  await page.waitForSelector('dialog.modal .wiz');
  check(!/error/i.test(await toast(page)), 'cancelling analysis goes straight to manual choice without an error');
  await page.click('dialog.modal [data-close]');
  // The failed loads above are the failures this test causes on purpose; anything else is a bug.
  const unexpected = errors.filter(e => !/Failed to load resource/.test(e));
  check(!unexpected.length, `no unexpected console errors (${unexpected.join(' / ')})`);
  await browser.close();
}

// ---------------- B. Real Claude API, invalid key ----------------
{
  console.log('B. Real Claude API (invalid key)');
  // This sandbox intercepts TLS with its own certificate authority, which Chromium doesn't trust.
  const { browser, page } = await launch(url, { context: { ignoreHTTPSErrors: true } });
  const estId = await newEstimate(page, 'Live');
  const photoId = await photoFromFixture(page, estId, 'chimney.jpg');
  const ctx = await ctxFor(page);
  await page.evaluate(() => AI.saveConfig({ apiKey: 'sk-ant-invalid-key-for-testing', model: 'claude-opus-5-5' }));
  const msg = await page.evaluate(async ([id, c]) => { try { await AI.analyzePhoto(id, c); return 'ok'; } catch (e) { return e.message; } }, [photoId, ctx]);
  check(/key was rejected/.test(msg), `live API answered and the app explained it: "${msg}"`);
  await browser.close();
}

// ---------------- C. Hosted claude.ai route ----------------
{
  console.log('C. Hosted route (page runtime stand-in)');
  const { browser, context, page: first } = await launch(url);
  await first.close();
  // Stand-in for the claude.ai viewer runtime: window.claude.use(name) per the published contract.
  await context.addInitScript(() => {
    window.__calls = []; window.__saved = [];
    window.__sampleAnswer = null; window.__sampleError = null;
    const sample = Object.freeze(Object.assign(async () => { throw { code: 'invalid_request', message: 'text not used' }; }, {
      limits: async () => ({ maxPromptBytes: 262144, images: { maxCount: 5, maxInputBytes: 20e6, mediaTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] } }),
      json: async (input, opts) => {
        window.__calls.push({ input, images: opts.images.map(b => ({ type: b.type, size: b.size })), modelTier: opts.modelTier, effort: opts.effort });
        if (opts.signal && opts.signal.aborted) throw { code: 'cancelled', message: '' };
        if (window.__sampleError) throw window.__sampleError;
        return window.__sampleAnswer;
      },
    }));
    const downloads = Object.freeze({
      save: async ({ filename, data }) => {
        if (window.__declineSave) throw { code: 'declined', message: 'no' };
        const buf = data instanceof Blob ? await data.arrayBuffer() : new TextEncoder().encode(data).buffer;
        window.__saved.push({ filename, b64: btoa(String.fromCharCode(...new Uint8Array(buf.slice(0, 600000)))), size: buf.byteLength });
        return { status: 'saved' };
      },
    });
    window.claude = { use: async name => ({ sample, downloads })[name] || null };
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url + '#/settings'); await page.waitForSelector('main .view h1');
  check((await page.textContent('main')).includes('uses Claude on your claude.ai account'), 'Settings explains hosted photo analysis (no key field)');
  check(!(await page.isVisible('#ai-key')), 'no API key field in the hosted page');

  const estId = await newEstimate(page, 'Hosted');
  const photoId = await photoFromFixture(page, estId, 'chimney.jpg');
  const ctx = await ctxFor(page);
  await page.evaluate(g => { window.__sampleAnswer = g; }, GOOD);
  const r = await page.evaluate(async ([id, c]) => AI.analyzePhoto(id, c), [photoId, ctx]);
  const call = (await page.evaluate(() => window.__calls))[0];
  check(r.component.value === 'Crown' && r.finding_code.value === 'CRN-FND-01', 'hosted analysis result is returned');
  check(call.images.length === 1 && call.images[0].type === 'image/jpeg' && call.images[0].size > 10000, `the photo is passed as an image (${call.images[0].size} bytes)`);
  check(call.input.includes('"finding_code"') && call.input.includes('CRN-FND-01') && call.modelTier === 'complex', 'prompt carries the schema and catalog; most capable tier');
  for (const [code, expect] of [['not_granted', /permission/], ['rate_limited', /rate-limited/], ['refused', /declined/], ['invalid_json', /could not be read/], ['upstream_error', /Analysis failed \(upstream_error\)/]]) {
    const msg = await page.evaluate(async ([id, c, code]) => { window.__sampleError = { code, message: 'x' }; try { await AI.analyzePhoto(id, c); return 'ok'; } catch (e) { return e.message; } }, [photoId, ctx, code]);
    check(expect.test(msg), `${code}: "${msg}"`);
  }
  const cancelled = await page.evaluate(async ([id, c]) => { window.__sampleError = { code: 'cancelled', message: '' }; try { await AI.analyzePhoto(id, c); return 'ok'; } catch (e) { return e.name; } }, [photoId, ctx]);
  check(cancelled === 'AbortError', 'cancel maps to a quiet abort');
  await page.evaluate(() => { window.__sampleError = null; });

  console.log('   hosted Save PDF and backup');
  await page.evaluate(async id => {
    const e = Store.normalize(await DB.get('estimates', id));
    e.components = [{ ...Store.newComponent(), category: 'Crown', findings: [{ ...Store.findingSnapshot(null), name: 'Cracked crown', status: 'confirmed', photos: [{ id: (await DB.getAll('photos'))[0].id, caption: 'Crown', include: true }],
      repairs: [{ ...Store.repairSnapshot(null), name: 'Seal crown cracks', description: 'Clean and seal the cracks.' }] }] }];
    e.title = 'Crown Repair'; await DB.put('estimates', e);
  }, estId);
  await page.goto(url + `#/estimates/${estId}`); await page.waitForSelector('#sec-items');
  await page.click('#sec-deliver > summary');
  await page.click('[data-action=save-pdf]');
  await page.click('dialog.modal [data-act=save]');
  await page.waitForFunction(() => window.__saved.length === 1);
  const pdfSave = (await page.evaluate(() => window.__saved))[0];
  const pdfFile = path.join(OUT, 'hosted.pdf');
  fs.writeFileSync(pdfFile, Buffer.from(pdfSave.b64, 'base64'));
  check(pdfSave.filename.endsWith('.pdf') && pdfSave.size === fs.statSync(pdfFile).size, `PDF handed to the viewer's save prompt (${pdfSave.filename})`);
  const t = execFileSync('pdftotext', [pdfFile, '-']).toString();
  check(t.includes('Hosted') && t.includes('Crown Repair') && t.includes('Clean and seal the cracks.'), 'the saved PDF is the real estimate');
  const pageTexts = t.split('\f');
  check(pageTexts.every(pt => !/Photos\s*\n\s*EST-/.test(pt)), 'the Photos heading is never left alone at the foot of a page');
  check(/PDF saved/.test(await toast(page)), 'success message after the save');
  await page.evaluate(() => { window.__declineSave = true; });
  await page.click('[data-action=save-pdf]'); await page.click('dialog.modal [data-act=save]'); await settle(page, 800);
  check(/PDF not saved/.test(await toast(page)), 'a declined save is reported, not treated as an error');
  await page.evaluate(() => { window.__declineSave = false; });
  await page.goto(url + '#/settings'); await page.waitForSelector('main .view h1');
  await page.click('[data-act=export]');
  await page.waitForFunction(() => window.__saved.length === 2, null, { timeout: 15000 });
  const bk = (await page.evaluate(() => window.__saved))[1];
  check(bk.filename.endsWith('.json') && bk.size > 50000, `backup handed to the save prompt (${Math.round(bk.size / 1024)} KB)`);
  check(!errors.length, `no page errors (${errors.join(' / ')})`);
  await browser.close();
}

server.close();
console.log(failed() ? `\n${failed()} check(s) failed` : '\nAll checks passed');
process.exit(failed() ? 1 : 0);
