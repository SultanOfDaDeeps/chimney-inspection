'use strict';

// Optional photo analysis by Claude. Two routes, both real image analysis:
//  - In the hosted claude.ai page: the page's `sample` capability asks Claude on the viewer's own
//    claude.ai account (the viewer allows it once). No API key is involved or stored.
//  - Anywhere else: the Claude API, called directly from the browser with the user's own API key
//    (stored only in this browser, excluded from backups).
// Results are suggestions only: the UI asks the user to confirm or correct each one before it is used.
const AI = (() => {
  const ENDPOINT = 'https://api.anthropic.com/v1/messages';
  const DEFAULT_MODEL = 'claude-opus-5-5';
  const MODELS = [['claude-opus-5-5', 'Claude Opus 5.5 (most accurate)'], ['claude-sonnet-5-5', 'Claude Sonnet 5.5 (faster)']];

  async function config() {
    return { apiKey: '', model: DEFAULT_MODEL, ...((await DB.get('meta', 'ai')) || {}), key: 'ai' };
  }
  const saveConfig = c => DB.put('meta', { ...c, key: 'ai' });

  // The hosted page's Claude, when this view can send it images; null otherwise.
  let hostedP = null;
  const hosted = () => hostedP || (hostedP = U.capability('sample').then(async sample => {
    if (!sample) return null;
    const lim = await sample.limits().catch(() => null);
    return lim && lim.images ? sample : null;
  }));
  // 'hosted' | 'key' | '' — which route analysis takes here.
  async function mode() {
    if (await hosted()) return 'hosted';
    return (await config()).apiKey ? 'key' : '';
  }
  const configured = async () => !!(await mode());

  const suggestion = desc => ({
    type: 'object', additionalProperties: false, required: ['value', 'confidence', 'explanation'],
    properties: {
      value: { type: 'string', description: `${desc} Empty string if it cannot be determined from the photo.` },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      explanation: { type: 'string', description: 'One short sentence on what in the photo supports this.' },
    },
  });

  const SCHEMA = {
    type: 'object', additionalProperties: false,
    required: ['photo_clear', 'unclear_reason', 'component', 'manufacturer', 'model', 'label_text', 'condition', 'finding_code'],
    properties: {
      photo_clear: { type: 'boolean', description: 'False if the photo is too blurry, dark, distant, or ambiguous to say what it shows.' },
      unclear_reason: { type: 'string', description: 'Why the photo is unclear; empty string if it is clear.' },
      component: suggestion('The chimney or appliance component shown, using one of the listed component names when one fits.'),
      manufacturer: suggestion('Manufacturer, only if readable on a label or unmistakable.'),
      model: suggestion('Model number or product name, only if readable on a label.'),
      label_text: { type: 'string', description: 'Exact text read from any rating plate or label; empty string if none.' },
      condition: suggestion('Visible condition or possible problem, described as an observation (e.g. "visible cracking"), never as a confirmed diagnosis or cause.'),
      finding_code: suggestion('The code of the listed finding that best matches the visible condition.'),
    },
  };

  function prompt({ mode, systemType, categories, findings }) {
    return [
      'You are helping a chimney technician document a job. Look at the photo and suggest what it shows.',
      'Rules: report only what is visible. Do not state a cause or a definitive diagnosis; a photo alone cannot establish one.',
      'Use an empty value and low confidence when you cannot tell. Never mention prices, sellers, or availability.',
      mode === 'label'
        ? 'This photo should show a rating plate or label. Focus on reading the manufacturer and model exactly as printed; copy the label text.'
        : 'Identify the component, any readable manufacturer/model, and any visible condition. Pick a finding code only if one clearly matches.',
      `System type: ${systemType || 'not specified'}.`,
      `Component names: ${categories.join(', ')}.`,
      findings.length ? `Findings (code — name — component):\n${findings.map(f => `${f.code} — ${f.name} — ${f.category}`).join('\n')}` : 'No findings list provided; leave finding_code empty.',
    ].join('\n');
  }

  async function analyzeWithKey(rec, ctx) {
    const cfg = await config();
    if (!cfg.apiKey) throw new Error('Photo analysis is not set up. Add an API key in Settings.');
    const img = await Photos.forAnalysis(rec.blob);
    const data = (await Photos.blobToDataURL(img)).split(',')[1];
    // Server-side fallback re-runs a declined request on Anthropic's recommended model.
    const fallbacks = ['claude-opus-5-5', 'claude-sonnet-5-5'].includes(cfg.model);
    const headers = {
      'content-type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2026-10-21',
      'anthropic-dangerous-direct-browser-access': 'true',
    };
    if (fallbacks) headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
    const body = {
      model: cfg.model,
      max_tokens: 16000,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
        { type: 'text', text: prompt(ctx) },
      ] }],
    };
    if (fallbacks) body.fallbacks = 'default';

    let res;
    try {
      res = await fetch(ENDPOINT, { method: 'POST', headers, body: JSON.stringify(body), signal: ctx.signal });
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      throw new Error('Could not reach the analysis service. Check your connection.');
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = json.error && json.error.message ? json.error.message : `HTTP ${res.status}`;
      if (res.status === 401) throw new Error('The API key was rejected. Check it in Settings.');
      if (res.status === 429) throw new Error('Analysis is rate-limited right now. Try again shortly or continue manually.');
      throw new Error(`Analysis failed: ${msg}`);
    }
    if (json.stop_reason === 'refusal') throw new Error('The analysis service declined this photo. Continue manually.');
    if (json.stop_reason === 'max_tokens') throw new Error('The analysis was cut off. Try again or continue manually.');
    const text = (json.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    let parsed;
    try { parsed = JSON.parse(text); } catch (e) { throw new Error('The analysis result could not be read. Continue manually.'); }
    return { ...normalize(parsed), model: json.model || cfg.model };
  }


  // Hosted route: the same prompt and schema, answered by Claude on the viewer's account.
  const HOSTED_ERRORS = {
    not_granted: 'Photo analysis needs your permission to use Claude on this page. Continue manually, or allow it next time.',
    sampling_disabled: 'Claude isn’t available for this account. Continue manually.',
    rate_limited: 'Analysis is rate-limited right now. Try again shortly or continue manually.',
    session_expired: 'Your Claude session has expired. Sign in again, then retry.',
    image_rejected: 'This photo couldn’t be sent for analysis. Continue manually.',
    refused: 'The analysis service declined this photo. Continue manually.',
    invalid_json: 'The analysis result could not be read. Continue manually.',
    empty_completion: 'The analysis came back empty. Continue manually.',
    images_unavailable: 'This view can’t send photos for analysis. Continue manually.',
  };
  async function analyzeHosted(sample, rec, ctx) {
    const instructions = `${prompt(ctx)}\n\nReply with only a JSON object that matches this JSON Schema, with no other text:\n${JSON.stringify(SCHEMA)}`;
    try {
      const parsed = await sample.json(instructions, { images: [await Photos.forAnalysis(rec.blob)], signal: ctx.signal, modelTier: 'complex', effort: 'medium' });
      return { ...normalize(parsed), model: 'Claude (claude.ai)' };
    } catch (e) {
      if (e && e.code === 'cancelled') throw new DOMException('Analysis cancelled', 'AbortError');
      if (e instanceof Error) throw e;
      throw new Error(HOSTED_ERRORS[e && e.code] || `Analysis failed${e && e.code ? ` (${e.code})` : ''}. Continue manually.`);
    }
  }

  // The answer's shape is checked, not assumed: anything missing becomes an empty, low-confidence value.
  const SUGGESTIONS = ['component', 'manufacturer', 'model', 'condition', 'finding_code'];
  function normalize(r) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw new Error('The analysis result could not be read. Continue manually.');
    const str = v => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
    const out = { photo_clear: r.photo_clear !== false, unclear_reason: str(r.unclear_reason), label_text: str(r.label_text), analyzedAt: new Date().toISOString() };
    for (const k of SUGGESTIONS) {
      const x = r[k] && typeof r[k] === 'object' ? r[k] : {};
      out[k] = { value: str(x.value), confidence: ['high', 'medium', 'low'].includes(x.confidence) ? x.confidence : 'low', explanation: str(x.explanation) };
    }
    return out;
  }

  async function analyzePhoto(photoId, ctx) {
    const rec = await DB.get('photos', photoId);
    if (!rec || !rec.blob) throw new Error('Photo not found.');
    const sample = await hosted();
    return sample ? analyzeHosted(sample, rec, ctx) : analyzeWithKey(rec, ctx);
  }

  return { config, saveConfig, configured, mode, analyzePhoto, normalize, MODELS, DEFAULT_MODEL };
})();
