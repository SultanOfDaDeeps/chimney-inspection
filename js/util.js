'use strict';

// Small shared helpers. Everything rendered with template strings goes through U.esc().
const U = {};

U.$ = (sel, root = document) => root.querySelector(sel);
U.$$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

U.esc = v => String(v ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

U.uid = () => {
  try { if (crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* insecure context */ }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
};

U.today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

U.fmtDate = iso => {
  if (!iso) return '';
  const d = new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso);
  return isNaN(d) ? iso : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
};

U.fmtDateTime = iso => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

U.getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
U.setPath = (obj, path, val) => {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => o[k], obj);
  target[last] = val;
};

U.clone = o => JSON.parse(JSON.stringify(o));

U.debounce = (fn, ms) => {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
};

// True when every whitespace-separated token of `query` appears somewhere in `fields`.
U.matches = (query, fields) => {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const hay = fields.filter(Boolean).join(' ').toLowerCase();
  return q.split(/\s+/).every(tok => hay.includes(tok));
};

U.toast = (msg, kind = '') => {
  let host = U.$('#toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => el.classList.add('out'), 2600);
  setTimeout(() => el.remove(), 3100);
};

// Modal built on <dialog>: Esc closes natively, focus is trapped by the browser.
U.modal = ({ title, body, wide = false, onMount, onClose }) => {
  const dlg = document.createElement('dialog');
  dlg.className = 'modal' + (wide ? ' wide' : '');
  dlg.innerHTML = `
    <div class="modal-head">
      <h2>${U.esc(title)}</h2>
      <button type="button" class="icon-btn" data-close aria-label="Close">✕</button>
    </div>
    <div class="modal-body">${body}</div>`;
  document.body.appendChild(dlg);
  // Finish directly rather than waiting for the 'close' event, which browsers may defer
  // while the page isn't rendering; callers awaiting a picker must always get an answer.
  let finished = false;
  const finish = () => { if (finished) return; finished = true; dlg.remove(); onClose && onClose(); };
  const close = () => { if (dlg.open) dlg.close(); finish(); };
  dlg.addEventListener('click', e => {
    if (e.target === dlg || e.target.closest('[data-close]')) close();
  });
  dlg.addEventListener('cancel', e => { e.preventDefault(); close(); }); // Esc
  dlg.addEventListener('close', finish);
  dlg.showModal();
  onMount && onMount(dlg, close);
  return { el: dlg, close };
};

// Money as typed by the user ("1,250", "$980.50"); null when blank or not a number.
U.parseMoney = v => {
  const s = String(v ?? '').replace(/[$,\s]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};
U.fmtMoney = n => (n == null ? '' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: n % 1 ? 2 : 0 }));

// In-app confirmation (browser confirm() pop-ups are blocked in some hosted views, e.g. a claude.ai page).
U.confirm = (message, okLabel = 'Confirm') => new Promise(resolve => {
  let answered = false;
  const danger = /^(delete|remove|replace)/i.test(okLabel) || /\b(delete|remove)\b/i.test(message);
  U.modal({
    title: 'Please confirm',
    body: `<p class="confirm-msg">${U.esc(message)}</p>
      <div class="modal-actions"><button type="button" data-close>Cancel</button>
        <button type="button" class="${danger ? 'danger-solid' : 'primary'}" data-ok>${U.esc(danger && okLabel === 'Confirm' ? 'Yes, continue' : okLabel)}</button></div>`,
    onMount: (dlg, close) => {
      const ok = U.$('[data-ok]', dlg);
      ok.focus();
      ok.addEventListener('click', () => { answered = true; close(); resolve(true); });
    },
    onClose: () => { if (!answered) resolve(false); },
  });
});

// True when the app runs inside another page's frame (e.g. a hosted claude.ai page), where printing is unavailable.
U.framed = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();

U.download = (filename, blob) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
};

// Copy text to the clipboard. The Clipboard API needs a secure context (HTTPS/localhost);
// elsewhere — e.g. an iPhone opening the app over the local network — fall back to a selection copy.
U.copyText = async text => {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch (e) { /* fall through */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px';
  document.body.appendChild(ta);
  const range = document.createRange();
  range.selectNodeContents(ta);
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(range);
  ta.setSelectionRange(0, text.length); // iOS needs an explicit range
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  sel.removeAllRanges();
  ta.remove();
  return ok;
};

U.isEditableTarget = el => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
