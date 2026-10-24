'use strict';

// Writes the project title and the customer-facing proposed-work description from what is
// already in the estimate: selected catalog wording, measurements, details, and notes the user
// entered, plus plain, general explanations of what each chimney part is. It adds no diagnosis,
// cause, material, measurement, timeline, warranty, or commitment of its own.
const Generate = (() => {
  const SMALL = new Set(['and', 'or', 'of', 'the', 'a', 'an', 'to', 'for', 'on', 'in']);
  const titleCase = s => s.split(/(\s+|\/)/).map((w, i) => (i && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1))).join('');
  const clean = s => String(s || '').trim().replace(/\s+/g, ' ');
  const stripEnd = s => clean(s).replace(/[.!?]+$/, '');
  const sentence = s => { const t = clean(s); return !t ? '' : /[.!?]$/.test(t) ? t : t + '.'; };
  const lowerFirst = s => (s && !/^[A-Z]{2}/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
  const listJoin = items => (items.length <= 2 ? items.join(' and ') : `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`);

  // "Approx. crack length 18 in; flue size 8 × 12 in" — values as a phrase, after a label of its own.
  const phrase = rows => rows.filter(r => !r.internal && clean(r.value))
    .map((r, i) => `${r.label ? (i ? lowerFirst(clean(r.label)) : clean(r.label)) + ' ' : ''}${clean(r.value)}${r.unit ? ' ' + clean(r.unit) : ''}`).join('; ');
  const withFindings = e => e.components.filter(c => c.findings.length);
  const sysName = e => (e.system.type === 'gas' ? 'gas appliance' : e.system.type === 'wood' ? 'wood-burning chimney' : 'chimney');

  // Customer-friendly name for each starter repair; other repairs are named from their own wording.
  const TITLE_BY_CODE = {
    'CRN-FIX-01': 'Chimney Crown Restoration', 'CRN-FIX-02': 'Chimney Crown Rebuild', 'CAP-FIX-01': 'Chimney Cap Installation',
    'CHS-FIX-01': 'Chase Cover Replacement', 'FLU-FIX-01': 'Stainless Steel Flue Liner Installation', 'FLU-FIX-02': 'Flue Camera Inspection',
    'FLU-FIX-03': 'Chimney Sweep', 'FLS-FIX-01': 'Chimney Flashing Repair', 'FLS-FIX-02': 'Chimney Flashing Replacement',
    'MAS-FIX-01': 'Masonry Repointing', 'MAS-FIX-02': 'Brick Replacement', 'MAS-FIX-03': 'Masonry Waterproofing',
    'MAS-FIX-04': 'Masonry Tuck Pointing', 'MAS-FIX-05': 'Major Masonry Tuck Pointing', 'FBX-FIX-01': 'Firebox Repair',
    'FBX-FIX-02': 'Firebox Restoration', 'DMP-FIX-01': 'Top-Sealing Damper Installation', 'DMP-FIX-02': 'Damper Repair',
    'SMK-FIX-01': 'Smoke Chamber Parging', 'CON-FIX-01': 'Connector Pipe Replacement', 'CON-FIX-02': 'Connector Pipe Repair',
    'GAS-FIX-01': 'Gas Appliance Service', 'PLT-FIX-01': 'Thermocouple Replacement', 'PLT-FIX-02': 'Pilot Assembly Replacement',
    'CTL-FIX-01': 'Ignition and Control Diagnostics', 'CTL-FIX-02': 'Remote Control Replacement', 'GLS-FIX-01': 'Glass Panel Replacement',
    'VNT-FIX-01': 'Vent Termination Replacement', 'VNT-FIX-02': 'Vent Pipe Repair', 'VNT-FIX-03': 'Vent Termination Clearing',
    'LOG-FIX-01': 'Gas Log Adjustment', 'LOG-FIX-02': 'Gas Log Set Replacement',
  };
  const VERB_TITLES = {
    install: 'Installation', replace: 'Replacement', repair: 'Repair', seal: 'Sealing', reseal: 'Resealing', rebuild: 'Rebuild',
    repoint: 'Repointing', apply: 'Application', clean: 'Cleaning', clear: 'Clearing', reconnect: 'Repair', reposition: 'Adjustment',
    diagnose: 'Diagnostics', secure: 'Repair', parge: 'Parging',
  };
  // "Install chimney cap" -> "Chimney Cap Installation"; "Major tuck pointing" -> "Major Tuck Pointing".
  function repairTitle(r) {
    if (TITLE_BY_CODE[r.code]) return TITLE_BY_CODE[r.code];
    const n = stripEnd(r.name);
    const m = n.match(/^(\w+)\s+(.*)$/);
    const noun = m && VERB_TITLES[m[1].toLowerCase()];
    return titleCase(noun ? `${m[2].replace(/^(a|an|the)\s+/i, '')} ${noun}` : n);
  }

  // A specific, customer-friendly project title built from the selected repairs.
  function title(e) {
    const comps = withFindings(e);
    const names = [...new Set(comps.flatMap(c => c.findings.flatMap(f => f.repairs.map(repairTitle))).filter(Boolean))];
    const gas = e.system.type === 'gas';
    if (!names.length) {
      const cat = clean((comps[0] || {}).category);
      return titleCase(`${gas ? 'Gas Appliance' : 'Chimney'} ${cat && comps.length === 1 ? cat.replace(/^chimney\s+/i, '') + ' ' : ''}Evaluation`);
    }
    if (names.length === 1) return names[0];
    if (names.length === 2 && `${names[0]} & ${names[1]}`.length <= 64) return `${names[0]} & ${names[1]}`;
    // Several repairs: name the components ("Chimney Crown, Cap & Masonry Restoration").
    const cats = [...new Set(comps.map(c => clean(c.category).replace(/^chimney\s+/i, '')).filter(Boolean))].map(titleCase);
    const list = cats.length <= 1 ? cats.join('') : `${cats.slice(0, -1).join(', ')} & ${cats[cats.length - 1]}`;
    const t = gas ? `Gas Appliance ${list} Service` : `Chimney ${list} Restoration`;
    return t.length <= 64 ? t : gas ? 'Gas Appliance Service & Repairs' : 'Chimney Restoration & Repairs';
  }

  const NUMBERS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  // "Install chimney cap" -> "installation of the chimney cap"; names that are already nouns stay as they are.
  const VERB_NOUNS = {
    install: 'installation of', replace: 'replacement of', repair: 'repair of', seal: 'sealing of', reseal: 'resealing of',
    rebuild: 'rebuilding of', repoint: 'repointing of', apply: 'application of', clean: 'cleaning of', clear: 'clearing of',
    reconnect: 'reconnection of', reposition: 'repositioning of', diagnose: 'diagnosis of', secure: 'securing of', parge: 'parging of',
  };
  function asNoun(name) {
    const n = stripEnd(name);
    const m = n.match(/^(\w+)\s+(.*)$/);
    const verb = m && VERB_NOUNS[m[1].toLowerCase()];
    if (!verb) return lowerFirst(n);
    const rest = m[2].replace(/^(a|an|the)\s+/i, '');
    return `${verb} the ${lowerFirst(rest)}`;
  }

  const repairsOf = e => withFindings(e).flatMap(c => c.findings.flatMap(f => f.repairs));
  const isPackage = e => !!(e.pricing && e.pricing.mode === 'package') && repairsOf(e).length > 1;

  // Opening paragraph: what the estimate covers (from the selected repair names), how it is
  // laid out, and its limits. Nothing beyond the selected work.
  function intro(e, biz) {
    const id = e.system.type === 'gas' ? [e.system.manufacturer, e.system.model].map(clean).filter(Boolean).join(' ') : '';
    const where = clean(e.jobAddress.replace(/\s*\n\s*/g, ', '));
    const on = `the ${sysName(e)}${id ? ` (${id})` : ''}${where ? ` at ${where}` : ''}`;
    const work = [...new Set(repairsOf(e).map(r => asNoun(r.name)).filter(Boolean))];
    const count = NUMBERS[work.length] || String(work.length);
    const thanks = `Thank you for considering ${biz || 'us'}.`;
    const limit = 'This estimate covers only these items; it isn’t a full inspection of the chimney.';
    if (!work.length) return `${thanks} Below is what we documented on ${on}, with an explanation of each condition. ${limit}`;
    const what = isPackage(e)
      ? `This estimate describes the ${count} repairs included in the package for ${on}: ${listJoin(work)}.`
      : `This estimate describes ${count === 'one' ? 'the repair' : `${count} repairs`} we recommend for ${on}: ${listJoin(work)}.`;
    return `${thanks} ${what} For each one, we explain what we found, why it matters, exactly what the work includes, `
      + `and what it will accomplish, so you have the full picture before deciding. ${limit}`;
  }

  // Closing paragraph: what completing the selected work does, without promises or guarantees.
  function closing(e) {
    if (!repairsOf(e).length) return '';
    return isPackage(e)
      ? 'Taken together, this package takes care of every condition described above in one coordinated project. Completing it helps protect your home and gives you peace of mind about these parts of your chimney.'
      : `Taken together, ${repairsOf(e).length > 1 ? 'these repairs address every condition' : 'this repair addresses the condition'} described above. Completing the work helps protect your home and gives you peace of mind about these parts of your chimney.`;
  }

  // What each part is, in plain words, given the first time a part comes up.
  const ABOUT = {
    'crown': ['the chimney crown', 'The crown is the concrete or mortar slab on top of the chimney. It surrounds the flue and sheds rain and snow away from the brickwork below.'],
    'chimney cap': ['the chimney cap', 'A chimney cap is the cover that sits over the top of the flue opening. Its screened sides and top keep out rain, debris, and animals while letting smoke and gases escape.'],
    'chase cover': ['the chase cover', 'The chase cover is the metal top on a framed chimney (one finished with siding). It closes off the top of the chase around the flue pipe and sheds water away from it.'],
    'flue liner': ['the flue liner', 'The flue liner is the lining inside the chimney that contains heat, smoke, and gases and carries them out of the house.'],
    'flashing': ['the flashing', 'Flashing is the metal that seals the joint where the chimney meets the roof, so water runs off instead of getting in around the chimney.'],
    'masonry': ['the masonry', 'The masonry is the chimney’s brick or stone and the mortar joints that hold it together. The mortar seals the joints and helps keep water out of the chimney’s walls.'],
    'firebox': ['the firebox', 'The firebox is the part of the fireplace where the fire burns. Its walls are built to stand up to direct heat.'],
    'damper': ['the damper', 'The damper is the plate that opens and closes the flue. Closed, it keeps outside air from coming down the chimney when the fireplace isn’t in use.'],
    'smoke chamber': ['the smoke chamber', 'The smoke chamber is the area above the damper where the fireplace narrows into the flue, guiding smoke up into the chimney.'],
    'connector': ['the connector pipe', 'The connector pipe joins a stove or other appliance to the chimney and carries smoke and gases from the appliance into the flue.'],
    'cleanout': ['the cleanout', 'The cleanout is the small access door, usually near the base of the chimney, used to remove ash and debris from the flue.'],
    'thimble': ['the thimble', 'The thimble is the lined opening in the chimney wall where a connector pipe enters the flue.'],
    'cricket': ['the cricket', 'A cricket is a small peaked structure on the roof behind a chimney that directs water around it.'],
    'factory-built chimney': ['the factory-built chimney', 'A factory-built chimney is a manufactured metal chimney system made of parts designed to work together.'],
    'gas appliance': ['the gas appliance', 'A gas fireplace, insert, or stove depends on its burner, pilot, controls, and venting working together.'],
    'pilot / ignition': ['the pilot and ignition', 'The pilot and ignition system light the main burner. Safety parts in this system shut off the gas if the pilot isn’t lit.'],
    'burner': ['the burner', 'The burner is the part of a gas appliance where gas mixes with air and burns.'],
    'glass / door': ['the glass front', 'The glass front closes off the firebox of a gas appliance and lets you see the flame.'],
    'gas vent': ['the gas vent', 'The gas vent carries combustion gases from the appliance to the outside. The vent termination is the cap where the vent exits the house.'],
    'log set': ['the log set', 'The log set is the set of decorative logs placed over the burner. Their position affects how the flame burns.'],
    'controls': ['the controls', 'The controls (valve, switches, or remote) turn the gas appliance on and off and adjust the flame.'],
  };

  const FOUND = { '': 'What we found', confirmed: 'What we found', suspected: 'What we found (to be confirmed)', further: 'What we found (needs a closer look)' };
  // Each block is headed by the repair it proposes ("Chimney Crown Restoration"); a finding
  // with no repair is headed by its own name.
  const blockTitle = f => {
    const names = [...new Set(f.repairs.map(repairTitle))];
    return names.length ? names.join(' & ') : titleCase(stripEnd(f.name));
  };

  // The full description: every selected item with all of its customer-facing information.
  // There is no length limit; nothing is shortened or dropped to save space.
  function build(e, biz) {
    const out = [intro(e, biz)];
    const explained = new Set();
    for (const c of withFindings(e)) {
      const ids = c.showIds ? [c.manufacturer, c.model].map(clean).filter(Boolean).join(' ') : '';
      const cat = clean(c.category).toLowerCase();
      for (const f of c.findings) {
        out.push('', blockTitle(f));
        if (ABOUT[cat] && !explained.has(cat)) { explained.add(cat); out.push(`About ${ABOUT[cat][0]}: ${ABOUT[cat][1]}`); }
        out.push(`${FOUND[f.status] || FOUND['']}: ${sentence(f.description || f.name)}${clean(f.note) ? ' ' + sentence(f.note) : ''}`);
        const measured = phrase(f.measurements);
        if (measured) out.push(`Measurements: ${sentence(measured)}`);
        if (ids) out.push(`Equipment: ${sentence(ids)}`);
        // A risk is explained only for findings the user marked Confirmed.
        if (f.status === 'confirmed' && clean(f.risk)) {
          out.push(`Why it matters: ${sentence(f.risk)}`);
        }
        for (const r of f.repairs) {
          const desc = clean(r.description) && clean(r.description) !== clean(r.name) ? sentence(r.description) : sentence(r.name);
          out.push(`${f.repairs.length > 1 ? `What we’ll do — ${stripEnd(r.name)}` : 'What we’ll do'}: ${desc}`);
          const details = phrase(r.details);
          if (details) out.push(`Work details: ${sentence(details)}`);
          if (clean(r.purpose)) out.push(`How this helps: ${sentence(r.purpose)}`);
          if (clean(r.note)) out.push(`Note: ${sentence(r.note)}`);
        }
      }
    }
    if (closing(e)) out.push('', closing(e));
    return out.join('\n');
  }

  // Plain-language meanings for trade terms, listed on the estimate only when the term appears.
  const TERMS = [
    [/\bcrown\b/i, 'Chimney crown', 'The concrete or mortar slab that covers the top of the chimney around the flue.'],
    [/\bflashing\b/i, 'Flashing', 'The metal that seals the joint where the chimney meets the roof.'],
    [/tuck[- ]?pointing|repoint/i, 'Tuck pointing', 'Removing worn mortar from between the bricks and filling the joints with new mortar.'],
    [/\bflue\b/i, 'Flue', 'The passage inside the chimney that carries smoke and gases out of the house.'],
    [/\bliner\b/i, 'Flue liner', 'The protective lining of the flue.'],
    [/chimney cap|\bcap\b/i, 'Chimney cap', 'A cover with screened sides that sits over the top of the flue.'],
    [/chase cover/i, 'Chase cover', 'The metal cover on top of a framed chimney (one covered in siding).'],
    [/\bdamper\b/i, 'Damper', 'The plate that opens and closes the flue.'],
    [/\bfirebox\b/i, 'Firebox', 'The part of the fireplace where the fire burns.'],
    [/smoke chamber/i, 'Smoke chamber', 'The area above the damper where the fireplace narrows into the flue.'],
    [/\bparg/i, 'Parging', 'A smooth coat of mortar applied over masonry.'],
    [/refractory/i, 'Refractory mortar', 'Heat-resistant mortar made for fireplaces.'],
    [/thermocouple/i, 'Thermocouple', 'A small safety sensor that tells a gas appliance the pilot is lit.'],
    [/connector pipe/i, 'Connector pipe', 'The pipe that connects a stove or appliance to the chimney.'],
    [/spall/i, 'Spalling', 'Brick or stone whose surface is flaking or breaking off.'],
    [/efflorescence/i, 'Efflorescence', 'White, powdery mineral deposits left on masonry by moisture.'],
    [/vent termination/i, 'Vent termination', 'The cap where a gas appliance’s vent exits the house.'],
    [/creosote/i, 'Creosote', 'A flammable residue that burning wood leaves inside the flue.'],
  ];
  const terms = text => TERMS.filter(([re]) => re.test(text || '')).map(([, term, meaning]) => [term, meaning]);

  // The full proposed-work description. opts.businessName is used in the opening line.
  const scope = (e, opts = {}) => build(e, clean(opts.businessName));

  return { title, scope, repairTitle, terms };
})();
