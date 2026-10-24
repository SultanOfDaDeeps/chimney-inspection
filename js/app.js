'use strict';

// Hash router + global keyboard shortcuts.
(() => {
  const main = U.$('#main');
  let leaveCurrent = null;

  const routes = [
    [/^#\/estimates\/?$/, m => EstimatesView.show(m), 'estimates'],
    [/^#\/estimates\/([\w-]+)\/preview$/, (m, id) => { leaveCurrent = PreviewView.leave; return PreviewView.show(id, m); }, 'estimates'],
    [/^#\/estimates\/([\w-]+)$/, (m, id) => { leaveCurrent = EditorView.leave; return EditorView.show(id, m); }, 'estimates'],
    [/^#\/catalog\/sizes$/, m => CatalogView.showSizes(m), 'catalog'],
    [/^#\/catalog\/(findings|repairs)\/?$/, (m, store) => CatalogView.showList(store, m), 'catalog'],
    [/^#\/catalog\/(findings|repairs)\/([\w-]+)$/, (m, store, id) => CatalogView.showItem(store, id, m), 'catalog'],
    [/^#\/settings$/, m => SettingsView.show(m), 'settings'],
  ];

  async function route() {
    if (leaveCurrent) { const fn = leaveCurrent; leaveCurrent = null; await fn(); }
    U.$$('dialog.modal').forEach(d => d.close());
    const hash = location.hash || '#/estimates';
    const hit = routes.find(([re]) => re.test(hash));
    if (!hit) { location.replace('#/estimates'); return; }
    const [re, fn, nav] = hit;
    U.$$('.app-nav a').forEach(a => a.toggleAttribute('aria-current', a.dataset.nav === nav));
    // Fresh mount element each route so view listeners never pile up.
    const mount = document.createElement('div');
    mount.className = 'view';
    main.replaceChildren(mount);
    window.scrollTo(0, 0);
    try {
      await fn(mount, ...hash.match(re).slice(1));
    } catch (err) {
      console.error(err);
      mount.innerHTML = `<div class="empty-state"><h2>Something went wrong</h2><p>${U.esc(err.message)}</p><a class="btn" href="#/estimates">Back to estimates</a></div>`;
    }
    const h1 = U.$('h1', mount);
    if (h1 && !mount.contains(document.activeElement)) { h1.tabIndex = -1; h1.focus({ preventScroll: true }); }
  }

  document.addEventListener('keydown', e => {
    if (U.$('dialog[open]')) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      EditorView.flush().then(() => U.toast('Saved'));
      return;
    }
    if (mod || e.altKey || U.isEditableTarget(e.target)) return;
    if (e.key === '/') {
      const s = U.$('#main input[type=search]');
      if (s) { e.preventDefault(); s.focus(); s.select(); }
    }
    if (e.key.toLowerCase() === 'n' && /^#\/estimates\/?$|^$/.test(location.hash)) { e.preventDefault(); EstimatesView.openNew(); }
  });

  window.addEventListener('hashchange', route);
  window.addEventListener('pagehide', () => EditorView.flush());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') EditorView.flush(); });

  // On a hosted HTTPS copy, cache the app's files so it opens without a signal.
  if ('serviceWorker' in navigator && location.protocol === 'https:' && !U.framed) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  Store.init().then(route).catch(err => {
    main.innerHTML = `<div class="empty-state"><h2>Storage unavailable</h2>
      <p>This browser blocked local storage (${U.esc(err.message)}). Private windows and some file:// setups do this.
      Run the app from a local web server instead — see README.md.</p></div>`;
  });
})();
