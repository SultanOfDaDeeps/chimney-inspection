'use strict';

// Data-model helpers on top of DB: settings, estimate creation/duplication/deletion,
// catalog relationships, and the snapshot copy from catalog -> estimate.
const Store = (() => {
  const SCHEMA_VERSION = 2;
  const DEFAULT_SETTINGS = {
    key: 'settings',
    businessName: 'Apex Chimney', contactName: '', phone: '', email: '', website: '', address: '', license: '',
    numberPrefix: 'EST',
    notice: 'This estimate covers only the items listed below. It isn’t a full chimney inspection, and it doesn’t describe the condition of anything not listed.',
    footer: '',
    // Editable list shown in each estimate's discount picker. No amounts are stored here.
    discountCategories: ['Senior', 'Veteran', 'Review customer'],
  };

  async function init() {
    await DB.open();
    const seeded = await DB.get('meta', 'seeded');
    if (!seeded) {
      const { findings, repairs } = buildSeedCatalog();
      await DB.putMany('findings', findings);
      await DB.putMany('repairs', repairs);
      await DB.put('meta', { key: 'seeded', value: new Date().toISOString() });
    }
    await migrateCatalogV2();
    await migrateCatalogV3();
    await migrateCatalogV5();
    await migrateCatalogV8();
    await Sizes.init();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  }

  // Data version 2: tag starter wood-only entries with a system type and add gas starter
  // options whose codes are missing. Runs once; never rewrites wording or removes entries.
  async function migrateCatalogV2() {
    if (await DB.get('meta', 'catalog-v2')) return;
    const findings = await DB.getAll('findings');
    const repairs = await DB.getAll('repairs');
    const tagged = list => list.filter(i => i.appliesTo === undefined && SEED_V2.woodOnly.test(i.code))
      .map(i => ({ ...i, appliesTo: ['wood'] }));
    const added = buildSeedRecords(SEED_V2, { findings, repairs });
    const taggedR = tagged(repairs);
    // A repair can be both tagged and linked to a new finding; merge so neither write is lost.
    const repairWrites = new Map([...taggedR, ...added.touchedRepairs].map(r => [r.id, r]));
    for (const r of added.touchedRepairs) {
      const t = taggedR.find(x => x.id === r.id);
      if (t) repairWrites.set(r.id, { ...t, relatedIds: r.relatedIds });
    }
    await DB.putMany('findings', [...tagged(findings), ...added.findings]);
    await DB.putMany('repairs', [...repairWrites.values(), ...added.repairs]);
    await DB.put('meta', { key: 'catalog-v2', value: new Date().toISOString() });
  }

  // Data version 3: add the tuck-pointing repairs (if their codes are free) and a purpose line on
  // starter repairs whose wording is untouched. Existing wording is never changed.
  async function migrateCatalogV3() {
    if (await DB.get('meta', 'catalog-v3')) return;
    const findings = await DB.getAll('findings');
    const repairs = await DB.getAll('repairs');
    const original = Object.fromEntries([...SEED.repairs, ...SEED_V2.repairs].map(r => [r.code, r.description]));
    const writes = new Map();
    for (const r of repairs) {
      const p = SEED_V3.purposes[r.code];
      if (p && r.purpose === undefined && r.description === original[r.code]) writes.set(r.id, { ...r, purpose: p });
    }
    const have = new Set(repairs.map(r => r.code.toUpperCase()));
    const now = new Date().toISOString();
    const added = SEED_V3.repairs.filter(r => !have.has(r.code)).map(r => ({
      systemType: '', assumptions: '', exclusions: '', privateNotes: '', createdAt: now, updatedAt: now, ...U.clone(r), id: U.uid(), relatedIds: [],
    }));
    const findingWrites = [];
    for (const r of added) {
      for (const code of SEED_V3.links[r.code] || []) {
        const f = findings.find(x => x.code === code);
        if (!f) continue;
        r.relatedIds.push(f.id);
        f.relatedIds = [...(f.relatedIds || []), r.id];
        findingWrites.push(f);
      }
    }
    await DB.putMany('repairs', [...writes.values(), ...added]);
    await DB.putMany('findings', findingWrites);
    await DB.put('meta', { key: 'catalog-v3', value: now });
  }

  // Data version 5: fuller wording for starter repairs whose description is still the original text.
  async function migrateCatalogV5() {
    if (await DB.get('meta', 'catalog-v5')) return;
    const original = Object.fromEntries([...SEED.repairs, ...SEED_V2.repairs, ...SEED_V3.repairs].map(r => [r.code, r.description]));
    const writes = (await DB.getAll('repairs')).filter(r => SEED_V5_DESCRIPTIONS[r.code] && r.description === original[r.code])
      .map(r => ({ ...r, description: SEED_V5_DESCRIPTIONS[r.code], updatedAt: new Date().toISOString() }));
    await DB.putMany('repairs', writes);
    await DB.put('meta', { key: 'catalog-v5', value: new Date().toISOString() });
  }

  // Data version 8: a "why it matters" line on starter findings whose description is still the original text.
  async function migrateCatalogV8() {
    if (await DB.get('meta', 'catalog-v8')) return;
    const original = Object.fromEntries([...SEED.findings, ...SEED_V2.findings].map(f => [f.code, f.description]));
    const writes = (await DB.getAll('findings')).filter(f => SEED_V8_RISKS[f.code] && f.risk === undefined && f.description === original[f.code])
      .map(f => ({ ...f, risk: SEED_V8_RISKS[f.code], updatedAt: new Date().toISOString() }));
    await DB.putMany('findings', writes);
    await DB.put('meta', { key: 'catalog-v8', value: new Date().toISOString() });
  }

  // Catalog reads always go through here so older records get the newer optional fields.
  const normalizeItem = i => ({ systemType: '', assumptions: '', exclusions: '', privateNotes: '', purpose: '', risk: '', fields: [], relatedIds: [], ...i,
    appliesTo: Array.isArray(i.appliesTo) ? i.appliesTo : [] });
  const catalog = async store => (await DB.getAll(store)).map(normalizeItem);
  // An entry with no system types applies to every system.
  const appliesTo = (item, type) => !type || !item.appliesTo.length || item.appliesTo.includes(type);

  const OLD_NOTICE = 'This estimate addresses only the specific items described below. It is not a complete chimney inspection and does not describe the condition of any component or area that is not listed.';
  async function settings() {
    const saved = (await DB.get('meta', 'settings')) || {};
    const s = { ...DEFAULT_SETTINGS, ...saved };
    if (!String(s.businessName || '').trim()) s.businessName = DEFAULT_SETTINGS.businessName; // the app's name until you set yours
    if (s.notice === OLD_NOTICE) s.notice = DEFAULT_SETTINGS.notice; // the earlier default, reworded in plain language
    if (!Array.isArray(s.discountCategories)) s.discountCategories = [...DEFAULT_SETTINGS.discountCategories];
    return s;
  }
  const saveSettings = s => DB.put('meta', { ...s, key: 'settings' });

  async function nextNumber() {
    const s = await settings();
    const c = (await DB.get('meta', 'counter')) || { key: 'counter', value: 0 };
    c.value += 1;
    await DB.put('meta', c);
    const prefix = (s.numberPrefix || 'EST').trim();
    return `${prefix}-${new Date().getFullYear()}-${String(c.value).padStart(4, '0')}`;
  }

  const newComponent = () => ({
    id: U.uid(), category: '', location: '', appliance: '',
    manufacturer: '', systemType: '', model: '', serial: '', partId: '', showIds: true,
    ident: { status: '', terms: '', sources: [], manufacturer: '', productFamily: '', componentType: '', notes: '', confirmedAt: '' },
    findings: [],
  });

  async function createEstimate(fields) {
    const now = new Date().toISOString();
    const est = normalize({
      id: U.uid(), number: await nextNumber(), status: 'draft', createdAt: now, updatedAt: now,
      customer: { name: fields.name, phone: fields.phone, email: fields.email },
      jobAddress: fields.jobAddress, date: fields.date, title: fields.title || '',
      schemaVersion: SCHEMA_VERSION, showItemized: false,
      components: [],
    });
    await DB.put('estimates', est);
    return est;
  }

  // Fill in any missing keys so older/imported records render safely. This is the estimate
  // migration: it only adds fields (never removes or rewrites saved wording), and the result
  // is written back the next time the estimate is saved.
  function normalize(e) {
    const legacy = !e.schemaVersion || e.schemaVersion < SCHEMA_VERSION;
    e.customer = { name: '', phone: '', email: '', ...(e.customer || {}) };
    for (const k of ['jobAddress', 'date', 'title', 'accessNotes', 'scopeText', 'internalNotes', 'number']) e[k] = e[k] ?? '';
    e.status = e.status || 'draft';
    e.photos = e.photos || [];
    e.system = { type: '', manufacturer: '', model: '', ...(e.system || {}) };
    e.generated = { title: '', scope: '', ...(e.generated || {}) };
    // Optional pricing and discount — private unless the matching "show" switch is on.
    e.pricing = { mode: 'items', packageName: '', packagePrice: '', itemPrices: {}, notes: '', showPrices: false, ...(e.pricing || {}) };
    e.pricing.itemPrices = e.pricing.itemPrices || {};
    e.discount = { category: '', amount: '', unit: '$', show: false, ...(e.discount || {}) };
    // Private note about the client (family names, preferences). Never customer-facing.
    e.clientNote = e.clientNote ?? '';
    // Version 1 estimates showed findings and repairs item by item; keep that look for them.
    if (e.showItemized === undefined) e.showItemized = legacy;
    e.schemaVersion = SCHEMA_VERSION;
    e.components = (e.components || []).map(c => {
      const base = newComponent();
      const out = { ...base, ...c, ident: { ...base.ident, ...(c.ident || {}) } };
      out.findings = (c.findings || []).map(f => ({
        status: '', measurements: [], note: '', privateNote: '', assumptions: '', exclusions: '', risk: '', photos: [], repairs: [], ...f,
        repairs: (f.repairs || []).map(r => ({ details: [], note: '', privateNote: '', assumptions: '', exclusions: '', purpose: '', photos: [], ...r })),
      }));
      return out;
    });
    return e;
  }

  const photoIdsIn = e => [
    ...e.photos.map(p => p.id),
    ...e.components.flatMap(c => c.findings.flatMap(f => [...f.photos, ...f.repairs.flatMap(r => r.photos)].map(p => p.id))),
  ];

  async function duplicateEstimate(id) {
    const src = await DB.get('estimates', id);
    if (!src) throw new Error('Estimate not found');
    const e = normalize(U.clone(src));
    const now = new Date().toISOString();
    e.id = U.uid();
    e.number = await nextNumber();
    e.status = 'draft';
    delete e.presentedAt;
    e.createdAt = e.updatedAt = now;
    e.date = U.today();
    e.title = e.title ? `${e.title} (copy)` : 'Copy';
    const dupPhotos = async list => {
      const out = [];
      for (const p of list) { const nid = await Photos.copy(p.id, e.id); if (nid) out.push({ ...p, id: nid }); }
      return out;
    };
    e.photos = await dupPhotos(e.photos);
    for (const c of e.components) {
      c.id = U.uid();
      for (const f of c.findings) {
        f.id = U.uid();
        f.photos = await dupPhotos(f.photos);
        for (const r of f.repairs) { r.id = U.uid(); r.photos = await dupPhotos(r.photos); }
      }
    }
    await DB.put('estimates', e);
    return e;
  }

  async function deleteEstimate(id) {
    const photos = await DB.photosFor(id);
    await Photos.remove(photos.map(p => p.id));
    await DB.del('estimates', id);
  }

  // ---- catalog -> estimate snapshots (copied, never referenced) ----
  const findingSnapshot = item => ({
    id: U.uid(), sourceId: item ? item.id : null, code: item ? item.code : '',
    name: item ? item.name : '', description: item ? item.description : '',
    status: '',
    measurements: item ? item.fields.map(f => ({ label: f.label, unit: f.unit, value: '' })) : [],
    note: '', privateNote: item ? item.privateNotes : '',
    assumptions: item ? item.assumptions : '', exclusions: item ? item.exclusions : '',
    risk: item ? item.risk || '' : '',
    photos: [], repairs: [],
  });

  const repairSnapshot = item => ({
    id: U.uid(), sourceId: item ? item.id : null, code: item ? item.code : '',
    name: item ? item.name : '', description: item ? item.description : '',
    details: item ? item.fields.map(f => ({ label: f.label, unit: f.unit, internal: !!f.internal, value: '' })) : [],
    note: '', privateNote: item ? item.privateNotes : '',
    assumptions: item ? item.assumptions : '', exclusions: item ? item.exclusions : '',
    purpose: item ? item.purpose || '' : '', photos: [],
  });

  // ---- catalog writes keep findings<->repairs links symmetric ----
  const other = store => (store === 'findings' ? 'repairs' : 'findings');

  async function saveCatalogItem(store, item, prevRelated = []) {
    item.updatedAt = new Date().toISOString();
    await DB.put(store, item);
    const now = new Set(item.relatedIds);
    const touched = new Set([...prevRelated, ...item.relatedIds]);
    const counterparts = await DB.getAll(other(store));
    const changed = [];
    for (const c of counterparts) {
      if (!touched.has(c.id)) continue;
      const has = c.relatedIds.includes(item.id);
      if (now.has(c.id) && !has) { c.relatedIds.push(item.id); changed.push(c); }
      if (!now.has(c.id) && has) { c.relatedIds = c.relatedIds.filter(x => x !== item.id); changed.push(c); }
    }
    if (changed.length) await DB.putMany(other(store), changed);
  }

  async function deleteCatalogItem(store, item) {
    await DB.del(store, item.id);
    const counterparts = (await DB.getAll(other(store))).filter(c => c.relatedIds.includes(item.id));
    counterparts.forEach(c => { c.relatedIds = c.relatedIds.filter(x => x !== item.id); });
    if (counterparts.length) await DB.putMany(other(store), counterparts);
  }

  const componentLabel = c => [c.category || 'Component', c.location].filter(Boolean).join(' — ');

  // Arithmetic on the amounts the user typed — nothing is estimated or filled in.
  // Returns nulls wherever an amount wasn't entered.
  function priceSummary(e) {
    const repairs = e.components.flatMap(c => c.findings.flatMap(f => f.repairs.map(r => ({ id: r.id, name: r.name, component: componentLabel(c) }))));
    const items = repairs.map(r => ({ ...r, price: U.parseMoney(e.pricing.itemPrices[r.id]) }));
    const priced = items.filter(i => i.price != null);
    const itemTotal = priced.length ? priced.reduce((s, i) => s + i.price, 0) : null;
    const packagePrice = U.parseMoney(e.pricing.packagePrice);
    const subtotal = e.pricing.mode === 'package' ? packagePrice : itemTotal;
    const amt = U.parseMoney(e.discount.amount);
    const hasDiscount = !!e.discount.category && amt != null && amt > 0;
    const discountAmt = !hasDiscount ? null : e.discount.unit === '%' ? (subtotal == null ? null : Math.round(subtotal * amt) / 100) : amt;
    const total = subtotal != null && discountAmt != null ? Math.max(0, Math.round((subtotal - discountAmt) * 100) / 100) : subtotal;
    return { items, priced, itemTotal, packagePrice, subtotal, discountAmt, total };
  }

  // "Gas — Heat & Glo SL-750", "Wood-burning", or '' when not chosen.
  const systemLabel = sys => {
    if (!sys.type) return '';
    const id = [sys.manufacturer, sys.model].map(s => String(s || '').trim()).filter(Boolean).join(' ');
    const name = sys.type === 'wood' ? 'Wood-burning' : (SYSTEM_TYPES.find(([v]) => v === sys.type) || [, sys.type])[1];
    return `${name}${id ? ` — ${id}` : ''}`;
  };

  const statusLabel = s => ({ confirmed: 'Confirmed', suspected: 'Suspected', further: 'Needs further evaluation' }[s] || '');

  return {
    init, settings, saveSettings, createEstimate, duplicateEstimate, deleteEstimate, normalize,
    newComponent, photoIdsIn, findingSnapshot, repairSnapshot, saveCatalogItem, deleteCatalogItem,
    componentLabel, statusLabel, DEFAULT_SETTINGS, SCHEMA_VERSION,
    catalog, normalizeItem, appliesTo, systemLabel, priceSummary,
  };
})();
