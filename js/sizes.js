'use strict';

// Size library: standard measurement choices organized by component and measurement type.
// Stored in meta 'sizes' and editable under Catalog → Sizes. Estimates store the chosen value
// as plain text, so editing the library never changes saved estimates.
const Sizes = (() => {
  const T = (label, unit, options, aliases = []) => ({ label, unit, options, aliases });
  const FLUE_TILE = ['8 × 8', '8 × 12', '8 × 13', '12 × 12', '13 × 13', '13 × 18', '18 × 18'];

  // Starter values — common US sizes. Edit them to match what you install.
  const DEFAULTS = [
    { category: 'Chimney cap', types: [
      T('Flue size', 'in', FLUE_TILE, ['flue tile size']),
      T('Round flue diameter', 'in', ['6', '7', '8', '10', '12'], ['diameter']),
    ] },
    { category: 'Flue liner', types: [
      T('Diameter', 'in', ['3', '4', '5', '6', '7', '8', '10', '12'], ['liner diameter']),
      T('Length', 'ft', ['15', '20', '25', '30', '35', '40'], ['liner length']),
      T('Flue size', 'in', FLUE_TILE, ['flue tile size', 'clay flue size']),
    ] },
    { category: 'Crown', types: [
      T('Crown dimensions', 'in', ['16 × 16', '16 × 24', '20 × 20', '24 × 24', '24 × 32', '32 × 32'], ['chimney size', 'dimensions']),
      T('Overhang', 'in', ['1', '1.5', '2', '2.5', '3']),
      T('Area', 'sq ft', ['4', '6', '8', '10', '12', '16']),
    ] },
    { category: 'Chase cover', types: [
      T('Dimensions', 'in', ['24 × 24', '24 × 36', '30 × 30', '36 × 36', '36 × 48', '48 × 48'], ['chase cover size']),
      T('Flue collar diameter', 'in', ['6', '8', '10', '12']),
    ] },
    { category: 'Damper', types: [T('Flue size', 'in', FLUE_TILE)] },
    { category: 'Connector', types: [
      T('Diameter', 'in', ['5', '6', '7', '8']),
      T('Length', 'ft', ['2', '3', '4', '5', '6']),
    ] },
    { category: 'Gas vent', types: [
      T('Diameter', 'in', ['3', '4', '5', '6', '7', '8'], ['vent diameter']),
      T('Direct-vent pipe', 'in', ['4 × 6⅝', '5 × 8'], ['coaxial size']),
    ] },
    { category: 'Masonry', types: [
      T('Area', 'sq ft', ['5', '10', '20', '30', '50', '100'], ['approx. area']),
      T('Quantity', 'bricks', ['5', '10', '20', '50'], ['approx. number of bricks', 'number of bricks']),
    ] },
    { category: 'Firebox', types: [
      T('Quantity', 'bricks', ['2', '4', '6', '8', '12'], ['number of bricks']),
      T('Firebox opening', 'in', ['30 × 24', '36 × 24', '36 × 29', '42 × 29']),
    ] },
    { category: 'Flashing', types: [T('Chimney width', 'in', ['16', '20', '24', '32', '36', '48'])] },
  ];

  async function all() {
    const rec = await DB.get('meta', 'sizes');
    return rec ? rec.value : U.clone(DEFAULTS);
  }
  const save = list => DB.put('meta', { key: 'sizes', value: list });

  // General chimney measurements added in data version 3 (only where that size name is missing).
  const ADDED_V3 = [
    ['Chimney cap', T('Cap size', 'in', ['9 × 9', '9 × 13', '13 × 13', '13 × 18', '18 × 18'])],
    ['Flue liner', T('Chimney height (approx.)', 'ft', ['10', '15', '20', '25', '30', '35', '40'], ['chimney height'])],
    ['Crown', T('Chimney height (approx.)', 'ft', ['10', '15', '20', '25', '30', '35', '40'], ['chimney height'])],
    ['Masonry', T('Chimney height (approx.)', 'ft', ['10', '15', '20', '25', '30', '35', '40'], ['chimney height'])],
    ['Firebox', T('Firebox depth', 'in', ['16', '18', '20', '22', '24'])],
  ];

  // The full starter library (used for new installs and "Restore starter sizes").
  function starter() {
    const lib = U.clone(DEFAULTS);
    for (const [cat, type] of ADDED_V3) forCategory(lib, cat).push(U.clone(type));
    return lib;
  }

  // Seed once; later versions only add missing size names, never overwrite edits.
  async function init() {
    const rec = await DB.get('meta', 'sizes');
    if (!rec) {
      await save(starter());
      await DB.put('meta', { key: 'sizes-v3', value: true });
      return;
    }
    if (await DB.get('meta', 'sizes-v3')) return;
    const lib = rec.value;
    for (const [cat, type] of ADDED_V3) {
      let group = lib.find(g => norm(g.category) === norm(cat));
      if (!group) { group = { category: cat, types: [] }; lib.push(group); }
      if (!match(group.types, type.label)) group.types.push(U.clone(type));
    }
    await save(lib);
    await DB.put('meta', { key: 'sizes-v3', value: true });
  }

  const norm = s => String(s || '').trim().toLowerCase();
  const forCategory = (lib, category) => (lib.find(g => norm(g.category) === norm(category)) || { types: [] }).types;
  // The size type a measurement/detail row refers to, matched by label or alias.
  const match = (types, label) => types.find(t => [t.label, ...(t.aliases || [])].some(l => norm(l) === norm(label)));

  return { all, save, init, forCategory, match, starter };
})();
