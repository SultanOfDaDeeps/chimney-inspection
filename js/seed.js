'use strict';

// Component categories and the code prefix used when suggesting new catalog codes.
const CATEGORIES = [
  ['Crown', 'CRN'], ['Chimney cap', 'CAP'], ['Chase cover', 'CHS'], ['Flue liner', 'FLU'],
  ['Flashing', 'FLS'], ['Masonry', 'MAS'], ['Firebox', 'FBX'], ['Damper', 'DMP'],
  ['Smoke chamber', 'SMK'], ['Connector', 'CON'], ['Cleanout', 'CLN'], ['Thimble', 'THM'],
  ['Cricket', 'CRK'], ['Appliance', 'APP'], ['Factory-built chimney', 'FBC'],
  ['Gas appliance', 'GAS'], ['Pilot / ignition', 'PLT'], ['Burner', 'BRN'], ['Glass / door', 'GLS'],
  ['Gas vent', 'VNT'], ['Log set', 'LOG'], ['Controls', 'CTL'], ['Other', 'OTH'],
];

const SYSTEM_TYPES = [['wood', 'Wood'], ['gas', 'Gas']];

const prefixFor = category => {
  const hit = CATEGORIES.find(([c]) => c.toLowerCase() === String(category || '').trim().toLowerCase());
  if (hit) return hit[1];
  const letters = String(category || '').replace(/[^a-z]/gi, '').toUpperCase();
  return (letters.slice(0, 3) || 'GEN').padEnd(3, 'X');
};

// Starter catalog. These are templates written as neutral observations / proposed work;
// edit or delete them to match how you describe things. `rel` lists related codes.
const SEED = (() => {
  const F = (label, unit = '', internal = false) => ({ label, unit, internal });
  const findings = [
    { code: 'CRN-FND-01', category: 'Crown', name: 'Cracking on crown',
      description: 'Visible cracking was observed on the chimney crown.',
      fields: [F('Approx. crack length', 'in')], rel: ['CRN-FIX-01', 'CRN-FIX-02'] },
    { code: 'CRN-FND-02', category: 'Crown', name: 'Crown surface deterioration',
      description: 'The surface of the chimney crown shows visible deterioration, with loose or missing material.',
      fields: [], rel: ['CRN-FIX-02'] },
    { code: 'CAP-FND-01', category: 'Chimney cap', name: 'No chimney cap present',
      description: 'No chimney cap was present on the flue at the time of the visit.',
      fields: [F('Flue size', 'in')], rel: ['CAP-FIX-01'] },
    { code: 'CAP-FND-02', category: 'Chimney cap', name: 'Damaged or loose chimney cap',
      description: 'The existing chimney cap is damaged, loose, or corroded.',
      fields: [], rel: ['CAP-FIX-01'] },
    { code: 'CHS-FND-01', category: 'Chase cover', name: 'Rusted chase cover',
      description: 'Rust was observed on the chase cover.',
      fields: [F('Chase cover size', 'in')], rel: ['CHS-FIX-01'] },
    { code: 'FLU-FND-01', category: 'Flue liner', name: 'Damaged clay flue tiles',
      description: 'Cracked, offset, or missing sections of the clay flue tile liner were observed.',
      fields: [F('Flue size', 'in')], rel: ['FLU-FIX-01', 'FLU-FIX-02'] },
    { code: 'FLU-FND-02', category: 'Flue liner', name: 'Gaps in flue tile joints',
      description: 'Gaps were observed in the mortar joints between flue tiles.',
      fields: [], rel: ['FLU-FIX-01', 'FLU-FIX-02'] },
    { code: 'FLU-FND-03', category: 'Flue liner', name: 'Creosote or soot buildup',
      description: 'Creosote or soot buildup was observed in the flue.',
      fields: [], rel: ['FLU-FIX-03'] },
    { code: 'FLS-FND-01', category: 'Flashing', name: 'Loose or separated flashing',
      description: 'The flashing where the chimney meets the roof is loose, separated, or has visible gaps.',
      fields: [], rel: ['FLS-FIX-01', 'FLS-FIX-02'] },
    { code: 'FLS-FND-02', category: 'Flashing', name: 'Water staining near chimney',
      description: 'Water staining was observed near the chimney-to-roof intersection.',
      fields: [], rel: ['FLS-FIX-01', 'FLS-FIX-02'] },
    { code: 'MAS-FND-01', category: 'Masonry', name: 'Deteriorated mortar joints',
      description: 'Mortar joints on the chimney are eroded, cracked, or missing in places.',
      fields: [F('Approx. area', 'sq ft')], rel: ['MAS-FIX-01'] },
    { code: 'MAS-FND-02', category: 'Masonry', name: 'Spalling brick',
      description: 'Some bricks show spalling, with the face of the brick flaking or breaking away.',
      fields: [F('Approx. number of bricks', 'bricks')], rel: ['MAS-FIX-02', 'MAS-FIX-03'] },
    { code: 'MAS-FND-03', category: 'Masonry', name: 'Efflorescence on masonry',
      description: 'White mineral deposits (efflorescence) were observed on the masonry surface.',
      fields: [], rel: ['MAS-FIX-03'] },
    { code: 'FBX-FND-01', category: 'Firebox', name: 'Firebox mortar joint gaps',
      description: 'Gaps or missing mortar were observed in the firebox mortar joints.',
      fields: [], rel: ['FBX-FIX-01'] },
    { code: 'FBX-FND-02', category: 'Firebox', name: 'Cracked or damaged firebrick',
      description: 'Cracked or broken firebricks were observed in the firebox.',
      fields: [F('Number of bricks', 'bricks')], rel: ['FBX-FIX-02'] },
    { code: 'DMP-FND-01', category: 'Damper', name: 'Damper does not operate fully',
      description: 'The damper does not fully open or close.',
      fields: [], rel: ['DMP-FIX-01', 'DMP-FIX-02'] },
    { code: 'DMP-FND-02', category: 'Damper', name: 'Rusted or damaged damper',
      description: 'The damper plate or frame shows rust or physical damage.',
      fields: [], rel: ['DMP-FIX-01', 'DMP-FIX-02'] },
    { code: 'SMK-FND-01', category: 'Smoke chamber', name: 'Rough or open smoke chamber walls',
      description: 'The smoke chamber walls have rough surfaces or open gaps between masonry units.',
      fields: [], rel: ['SMK-FIX-01'] },
    { code: 'CON-FND-01', category: 'Connector', name: 'Corroded connector pipe',
      description: 'The appliance connector pipe shows corrosion or physical damage.',
      fields: [F('Diameter', 'in')], rel: ['CON-FIX-01'] },
    { code: 'CON-FND-02', category: 'Connector', name: 'Loose connector joints',
      description: 'One or more connector pipe joints are loose or not mechanically fastened.',
      fields: [], rel: ['CON-FIX-02'] },
  ];
  const repairs = [
    { code: 'CRN-FIX-01', category: 'Crown', name: 'Seal crown cracks',
      description: 'Clean and seal the cracked areas of the chimney crown with a crown repair coating.',
      fields: [F('Material'), F('Area', 'sq ft')] },
    { code: 'CRN-FIX-02', category: 'Crown', name: 'Rebuild chimney crown',
      description: 'Remove the existing chimney crown and form and pour a new crown.',
      fields: [F('Crown dimensions', 'in'), F('Overhang', 'in'), F('Material')] },
    { code: 'CAP-FIX-01', category: 'Chimney cap', name: 'Install chimney cap',
      description: 'Install a new chimney cap on the flue.',
      fields: [F('Flue size', 'in'), F('Material'), F('Finish')] },
    { code: 'CHS-FIX-01', category: 'Chase cover', name: 'Replace chase cover',
      description: 'Remove the existing chase cover and install a new custom-fit chase cover.',
      fields: [F('Dimensions', 'in'), F('Material'), F('Finish')] },
    { code: 'FLU-FIX-01', category: 'Flue liner', name: 'Install stainless steel liner',
      description: 'Install a stainless steel chimney liner sized for the connected appliance, including top and bottom terminations.',
      fields: [F('Diameter', 'in'), F('Length', 'ft'), F('Liner type'), F('Insulation')] },
    { code: 'FLU-FIX-02', category: 'Flue liner', name: 'Video scan of flue',
      description: 'Perform a video scan of the flue to evaluate the full length of the liner.',
      fields: [] },
    { code: 'FLU-FIX-03', category: 'Flue liner', name: 'Chimney sweep',
      description: 'Sweep the flue to remove creosote and soot deposits.',
      fields: [] },
    { code: 'FLS-FIX-01', category: 'Flashing', name: 'Reseal flashing',
      description: 'Reseal the existing chimney flashing where it meets the chimney and roof.',
      fields: [F('Sealant')] },
    { code: 'FLS-FIX-02', category: 'Flashing', name: 'Replace flashing',
      description: 'Remove the existing chimney flashing and install new step and counter flashing.',
      fields: [F('Material'), F('Finish')] },
    { code: 'MAS-FIX-01', category: 'Masonry', name: 'Repoint mortar joints',
      description: 'Grind out deteriorated mortar joints and repoint with new mortar.',
      fields: [F('Area', 'sq ft'), F('Mortar color')] },
    { code: 'MAS-FIX-02', category: 'Masonry', name: 'Replace damaged bricks',
      description: 'Remove damaged bricks and install replacement bricks.',
      fields: [F('Quantity', 'bricks'), F('Brick match')] },
    { code: 'MAS-FIX-03', category: 'Masonry', name: 'Apply water repellent',
      description: 'Clean the masonry and apply a vapor-permeable masonry water repellent.',
      fields: [F('Product'), F('Area', 'sq ft')] },
    { code: 'FBX-FIX-01', category: 'Firebox', name: 'Repair firebox mortar joints',
      description: 'Remove loose mortar and repoint firebox joints with refractory mortar.',
      fields: [] },
    { code: 'FBX-FIX-02', category: 'Firebox', name: 'Replace firebricks',
      description: 'Remove damaged firebricks and install new firebricks set in refractory mortar.',
      fields: [F('Quantity', 'bricks')] },
    { code: 'DMP-FIX-01', category: 'Damper', name: 'Install top-sealing damper',
      description: 'Install a top-sealing damper at the top of the flue with a control cable to the firebox.',
      fields: [F('Flue size', 'in'), F('Model')] },
    { code: 'DMP-FIX-02', category: 'Damper', name: 'Repair or adjust damper',
      description: 'Repair or adjust the existing throat damper so it opens and closes.',
      fields: [] },
    { code: 'SMK-FIX-01', category: 'Smoke chamber', name: 'Parge smoke chamber',
      description: 'Apply a refractory parging coat to the smoke chamber walls.',
      fields: [F('Product')] },
    { code: 'CON-FIX-01', category: 'Connector', name: 'Replace connector pipe',
      description: 'Remove the existing connector pipe and install a new connector.',
      fields: [F('Diameter', 'in'), F('Length', 'ft'), F('Material')] },
    { code: 'CON-FIX-02', category: 'Connector', name: 'Secure connector joints',
      description: 'Secure each connector pipe joint with mechanical fasteners.',
      fields: [] },
  ];
  return { findings, repairs };
})();

// Starter options added in data version 2 to fill the gas-system gap. Only codes that are
// not already in the catalog are added, so existing (possibly edited) entries are untouched.
const SEED_V2 = (() => {
  const F = (label, unit = '', internal = false) => ({ label, unit, internal });
  const gas = ['gas'];
  const findings = [
    { code: 'PLT-FND-01', category: 'Pilot / ignition', name: 'Pilot does not stay lit',
      description: 'The pilot did not stay lit when tested during the visit.', fields: [], rel: ['PLT-FIX-01', 'PLT-FIX-02', 'CTL-FIX-01'] },
    { code: 'PLT-FND-02', category: 'Pilot / ignition', name: 'Appliance does not ignite',
      description: 'The appliance did not ignite when operated during the visit.', fields: [], rel: ['PLT-FIX-02', 'CTL-FIX-01', 'GAS-FIX-01'] },
    { code: 'BRN-FND-01', category: 'Burner', name: 'Uneven or abnormal flame',
      description: 'The burner flame appeared uneven or abnormal during operation.', fields: [], rel: ['GAS-FIX-01', 'CTL-FIX-01'] },
    { code: 'GLS-FND-01', category: 'Glass / door', name: 'Film or soot on glass',
      description: 'Soot or a white film was observed on the glass.', fields: [], rel: ['GAS-FIX-01'] },
    { code: 'GLS-FND-02', category: 'Glass / door', name: 'Cracked glass or damaged gasket',
      description: 'The glass panel or its gasket is cracked or damaged.', fields: [], rel: ['GLS-FIX-01'] },
    { code: 'VNT-FND-01', category: 'Gas vent', name: 'Damaged or obstructed vent termination',
      description: 'The vent termination cap is damaged or obstructed.', fields: [F('Vent diameter', 'in')], rel: ['VNT-FIX-01', 'VNT-FIX-03'] },
    { code: 'VNT-FND-02', category: 'Gas vent', name: 'Separated vent pipe joint',
      description: 'A section of vent pipe is separated or not secured at a joint.', fields: [], rel: ['VNT-FIX-02'] },
    { code: 'LOG-FND-01', category: 'Log set', name: 'Damaged or misplaced logs',
      description: "Logs or ember material are damaged, deteriorated, or not positioned as shown in the manufacturer's layout.", fields: [], rel: ['LOG-FIX-01', 'LOG-FIX-02'] },
    { code: 'CTL-FND-01', category: 'Controls', name: 'Remote or wall switch not working',
      description: 'The remote control or wall switch did not operate the appliance during the visit.', fields: [], rel: ['CTL-FIX-02', 'CTL-FIX-01'] },
  ];
  const repairs = [
    { code: 'GAS-FIX-01', category: 'Gas appliance', name: 'Clean and service gas appliance',
      description: 'Clean and service the gas appliance, including the burner, pilot assembly, and glass.', fields: [] },
    { code: 'PLT-FIX-01', category: 'Pilot / ignition', name: 'Replace thermocouple or thermopile',
      description: 'Replace the thermocouple or thermopile.', fields: [F('Part number')] },
    { code: 'PLT-FIX-02', category: 'Pilot / ignition', name: 'Replace pilot assembly',
      description: 'Replace the pilot assembly.', fields: [F('Part number')] },
    { code: 'CTL-FIX-01', category: 'Controls', name: 'Diagnose ignition and controls',
      description: 'Perform a diagnostic evaluation of the ignition and control system to identify the cause of the operating problem.', fields: [] },
    { code: 'CTL-FIX-02', category: 'Controls', name: 'Replace remote or receiver',
      description: 'Replace the remote control and/or receiver.', fields: [F('Model')] },
    { code: 'GLS-FIX-01', category: 'Glass / door', name: 'Replace glass panel or gasket',
      description: 'Replace the damaged glass panel or gasket.', fields: [F('Part number')] },
    { code: 'VNT-FIX-01', category: 'Gas vent', name: 'Replace vent termination cap',
      description: 'Replace the vent termination cap.', fields: [F('Model'), F('Diameter', 'in')] },
    { code: 'VNT-FIX-02', category: 'Gas vent', name: 'Reconnect and secure vent pipe',
      description: "Reconnect the separated vent pipe section and secure the joint according to the manufacturer's instructions.", fields: [] },
    { code: 'VNT-FIX-03', category: 'Gas vent', name: 'Clear vent termination',
      description: 'Remove debris or obstructions from the vent termination.', fields: [] },
    { code: 'LOG-FIX-01', category: 'Log set', name: 'Reposition logs',
      description: "Reposition the logs and ember material according to the manufacturer's layout.", fields: [] },
    { code: 'LOG-FIX-02', category: 'Log set', name: 'Replace log set',
      description: 'Replace the log set.', fields: [F('Model')] },
  ];
  findings.forEach(f => { f.appliesTo = gas; });
  repairs.forEach(r => { r.appliesTo = gas; });
  // Original starter codes that only make sense for wood systems.
  const woodOnly = /^(FBX|DMP|SMK|CON)-|^FLU-(FND|FIX)-03$/;
  return { findings, repairs, woodOnly };
})();

// Data version 3: tuck-pointing options and a short customer-facing "purpose" for starter repairs.
// Purposes are general explanations of what the work does — never claims about a specific job.
const SEED_V3 = {
  findings: [],
  repairs: [
    { code: 'MAS-FIX-04', category: 'Masonry', name: 'Standard tuck pointing', appliesTo: [],
      description: 'Standard tuck pointing of the affected mortar joints: remove loose and deteriorated mortar from the joints in the repair area and install new mortar compatible with the existing masonry.',
      purpose: 'Restoring deteriorated mortar joints helps keep water out of the masonry and supports the surrounding brickwork.',
      fields: [{ label: 'Area', unit: 'sq ft', internal: false }, { label: 'Mortar color', unit: '', internal: false }] },
    { code: 'MAS-FIX-05', category: 'Masonry', name: 'Major tuck pointing', appliesTo: [],
      description: 'Major tuck pointing of the mortar joints in the repair area: grind out the deteriorated mortar from the joints, then apply new mortar to repoint them.',
      purpose: 'Replacing deteriorated mortar across the repair area helps keep water out of the masonry and supports the surrounding brickwork.',
      fields: [{ label: 'Area', unit: 'sq ft', internal: false }, { label: 'Mortar color', unit: '', internal: false }] },
  ],
  // New tuck-pointing repairs are suggested for these existing findings.
  links: { 'MAS-FIX-04': ['MAS-FND-01'], 'MAS-FIX-05': ['MAS-FND-01'] },
  // Added only to starter repairs whose description is still the original wording.
  purposes: {
    'CRN-FIX-01': 'Sealing the crown helps keep water from entering the chimney through cracks in its surface.',
    'CRN-FIX-02': 'A properly formed crown sheds water away from the flue and the top of the chimney.',
    'CAP-FIX-01': 'A chimney cap helps keep rain, debris, and animals out of the flue.',
    'CHS-FIX-01': 'The chase cover seals the top of the chimney chase against water entry.',
    'FLU-FIX-01': 'A properly sized liner provides a continuous, sealed path for combustion gases to leave the home.',
    'FLU-FIX-02': 'A video scan shows the condition of the full length of the flue, which cannot be judged from its ends alone.',
    'FLU-FIX-03': 'Sweeping removes combustible deposits from the flue walls.',
    'FLS-FIX-01': 'Sealed flashing helps keep water out where the chimney meets the roof.',
    'FLS-FIX-02': 'New step and counter flashing forms a water-shedding seal where the chimney meets the roof.',
    'MAS-FIX-01': 'Sound mortar joints keep water out of the masonry and hold the brickwork together.',
    'MAS-FIX-02': 'Replacing damaged brick restores a sound, weather-resistant face to the chimney.',
    'MAS-FIX-03': 'A vapor-permeable water repellent reduces water absorption while still letting moisture in the masonry escape.',
    'FBX-FIX-01': 'Refractory mortar is made to withstand the heat inside the firebox.',
    'FBX-FIX-02': 'Firebrick set in refractory mortar is made to withstand the heat inside the firebox.',
    'DMP-FIX-01': 'A top-sealing damper closes the top of the flue when the fireplace is not in use.',
    'DMP-FIX-02': 'A working damper lets the flue be opened for a fire and closed when the fireplace is not in use.',
    'SMK-FIX-01': 'Parging gives the smoke chamber walls a smooth, continuous surface.',
    'CON-FIX-01': 'The connector carries combustion gases from the appliance into the chimney.',
    'CON-FIX-02': 'Fastening each joint keeps the connector sections from separating.',
    'GAS-FIX-01': 'Cleaning and servicing address buildup on the burner, pilot assembly, and glass.',
    'PLT-FIX-01': 'The thermocouple or thermopile senses the pilot flame so the gas valve can stay open.',
    'PLT-FIX-02': 'The pilot assembly provides the flame that lights the main burner.',
    'CTL-FIX-01': 'A diagnostic evaluation identifies which part of the ignition or control system needs attention before any parts are replaced.',
    'VNT-FIX-01': 'The termination cap lets combustion gases exit while keeping out weather and debris.',
    'VNT-FIX-02': 'Secure vent joints keep combustion gases inside the vent system.',
    'VNT-FIX-03': 'A clear termination lets the appliance vent as intended.',
    'LOG-FIX-01': "Logs placed according to the manufacturer's layout support the intended flame pattern.",
  },
};

// Data version 5: fuller customer-facing wording for starter repairs. Applied only to entries whose
// description is still the original starter text, so wording you have edited is never replaced.
const SEED_V5_DESCRIPTIONS = {
  'CRN-FIX-01': 'Clean the crown surface to remove loose material and debris, then seal the cracked areas with a crown repair coating made for exposed masonry.',
  'CRN-FIX-02': 'Remove the existing chimney crown down to the brickwork, then form and pour a new crown shaped to slope away from the flue.',
  'CAP-FIX-01': 'Install a new chimney cap sized to the flue and secure it in place on the top of the chimney.',
  'CHS-FIX-01': 'Remove the existing chase cover and install a new custom-fabricated chase cover sized to the top of the chimney chase.',
  'FLU-FIX-01': 'Install a stainless steel chimney liner sized for the connected appliance, running the full height of the flue, with a top termination and cap at the chimney top and the connection at the appliance end.',
  'FLU-FIX-02': 'Perform a camera inspection of the flue, passing a video camera through the flue to record the condition of the liner along its full length.',
  'FLU-FIX-03': 'Sweep the flue with chimney brushes to remove creosote and soot from the flue walls.',
  'FLS-FIX-01': 'Clean the flashing seams where the chimney meets the roof and reseal them with a sealant suited to roofing and masonry.',
  'FLS-FIX-02': 'Remove the existing chimney flashing and install new step flashing woven into the roof courses, with counter flashing set into the chimney\'s mortar joints.',
  'MAS-FIX-01': 'Grind out deteriorated mortar joints to a consistent depth and repoint them with new mortar, tooled to a finished joint profile.',
  'MAS-FIX-02': 'Carefully cut out the damaged bricks and install replacement bricks set in fresh mortar.',
  'MAS-FIX-03': 'Clean the masonry surface and apply a vapor-permeable water repellent to the exposed brickwork.',
  'FBX-FIX-01': 'Rake out loose and deteriorated mortar from the firebox joints and repoint them with refractory mortar.',
  'FBX-FIX-02': 'Remove the damaged firebricks and install new firebricks set in refractory mortar.',
  'DMP-FIX-01': 'Install a top-sealing damper at the top of the flue, operated by a control cable that runs down the flue to the firebox.',
  'SMK-FIX-01': 'Apply a refractory parging coat to the smoke chamber walls, filling gaps between masonry units and leaving a smooth, continuous surface.',
  'CON-FIX-01': 'Remove the existing connector pipe and install a new connector between the appliance and the chimney, with each joint fastened.',
  'MAS-FIX-04': 'Remove loose and deteriorated mortar from the affected joints and install new mortar compatible with the existing masonry.',
  'MAS-FIX-05': 'Grind out the deteriorated mortar from the joints throughout the repair area, then apply new mortar to fully repoint those joints.',
};

// Data version 8: why each starter finding matters, shown to the customer only when the finding is
// marked Confirmed. General statements about what a condition can lead to — never a diagnosis,
// cause, or code requirement for a particular home. Added only where the finding's wording is unchanged.
const SEED_V8_RISKS = {
  'CRN-FND-01': 'Cracks in the crown can let water into the chimney, where freeze-thaw cycles can widen them and damage the masonry below.',
  'CRN-FND-02': 'A deteriorating crown sheds water less effectively, which can allow moisture into the chimney and the masonry below.',
  'CAP-FND-01': 'Without a cap, rain, debris, and animals can enter the flue.',
  'CAP-FND-02': 'A damaged or loose cap may no longer keep rain, debris, and animals out of the flue.',
  'CHS-FND-01': 'A rusting chase cover can let water into the chimney chase and the framing around it.',
  'FLU-FND-01': 'Cracked, offset, or missing flue tiles leave gaps in the liner that is meant to contain heat and combustion gases.',
  'FLU-FND-02': 'Gaps between flue tiles can let heat and combustion gases reach the surrounding masonry.',
  'FLU-FND-03': 'Creosote is combustible, and buildup in the flue increases the risk of a chimney fire.',
  'FLS-FND-01': 'Gaps in the flashing can let water into the roof and the surrounding structure.',
  'FLS-FND-02': 'Water staining shows that water has reached this area; continued water entry can damage framing and finishes.',
  'MAS-FND-01': 'Deteriorated mortar joints let water into the masonry and can loosen the surrounding brick over time.',
  'MAS-FND-02': 'Spalling brick has lost its protective face, which lets more water in and allows the damage to spread.',
  'MAS-FND-03': 'Efflorescence shows that water is moving through the masonry.',
  'FBX-FND-01': 'Gaps in the firebox joints can expose the structure behind the firebox to the fire’s heat.',
  'FBX-FND-02': 'Cracked or broken firebrick is less able to shield the structure behind it from the fire’s heat.',
  'DMP-FND-01': 'A damper that does not close fully lets heated air escape when the fireplace is not in use; one that does not open fully can restrict the flow of smoke.',
  'DMP-FND-02': 'A damaged damper may not seal or operate as intended.',
  'SMK-FND-01': 'Rough or open smoke chamber walls can collect creosote and leave gaps between masonry units.',
  'CON-FND-01': 'A corroded connector may not contain combustion gases as it should.',
  'CON-FND-02': 'Loose connector joints can separate and let combustion gases escape into the room.',
  'PLT-FND-01': 'A pilot that does not stay lit keeps the appliance from operating as designed.',
  'PLT-FND-02': 'The appliance cannot be used until the ignition problem is identified and corrected.',
  'BRN-FND-01': 'An abnormal flame can mean the burner is not operating as designed and should be corrected before regular use.',
  'GLS-FND-02': 'Cracked glass or a damaged gasket can compromise the sealed front of the appliance.',
  'VNT-FND-01': 'A damaged or obstructed termination can interfere with how the appliance vents combustion gases outdoors.',
  'VNT-FND-02': 'A separated vent joint can let combustion gases escape before they leave the home.',
  'LOG-FND-01': 'Logs that are damaged or out of position can change the flame pattern from what the manufacturer intended.',
};

// Turn seed definitions into catalog records with ids and symmetric relationships.
// `existing` lets new items link to repairs already in the catalog (matched by code).
function buildSeedRecords(seed, existing = { findings: [], repairs: [] }) {
  const now = new Date().toISOString();
  const blank = { systemType: '', appliesTo: [], assumptions: '', exclusions: '', privateNotes: '', createdAt: now, updatedAt: now };
  const haveF = new Set(existing.findings.map(i => i.code.toUpperCase()));
  const haveR = new Set(existing.repairs.map(i => i.code.toUpperCase()));
  const findings = seed.findings.filter(f => !haveF.has(f.code))
    .map(({ rel, ...f }) => ({ ...blank, ...f, id: U.uid(), relatedIds: [], _rel: rel || [] }));
  const repairs = seed.repairs.filter(r => !haveR.has(r.code)).map(r => ({ ...blank, ...r, id: U.uid(), relatedIds: [] }));
  const byCode = Object.fromEntries([...existing.repairs, ...repairs].map(r => [r.code.toUpperCase(), r]));
  const touched = new Set();
  for (const f of findings) {
    for (const code of f._rel) {
      const r = byCode[code];
      if (!r) continue;
      f.relatedIds.push(r.id);
      r.relatedIds = [...(r.relatedIds || []), f.id];
      if (!repairs.includes(r)) touched.add(r);
    }
    delete f._rel;
  }
  return { findings, repairs, touchedRepairs: [...touched] };
}

function buildSeedCatalog() {
  const out = buildSeedRecords(SEED);
  // Starter entries that only make sense for wood systems (see SEED_V2.woodOnly).
  [...out.findings, ...out.repairs].forEach(i => { if (SEED_V2.woodOnly.test(i.code)) i.appliesTo = ['wood']; });
  return out;
}
