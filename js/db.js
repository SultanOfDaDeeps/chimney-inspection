'use strict';

// IndexedDB wrapper. Stores:
//   estimates  – one self-contained snapshot per estimate
//   findings   – finding catalog
//   repairs    – repair recommendation catalog
//   photos     – resized image blobs (+ thumbnails), indexed by estimateId
//   meta       – settings, estimate counter, seed flag
const DB = (() => {
  const NAME = 'chimney-estimator';
  const VERSION = 1;
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const name of ['estimates', 'findings', 'repairs']) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('photos')) {
          db.createObjectStore('photos', { keyPath: 'id' }).createIndex('estimateId', 'estimateId');
        }
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Database is open in another tab with an older version.'));
    });
    return dbp;
  }

  async function run(stores, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let result;
      // Any error in fn aborts the transaction, so nothing it queued is committed.
      const fail = err => { try { tx.abort(); } catch (e) { /* already finished */ } reject(err); };
      try { Promise.resolve(fn(tx)).then(r => { result = r; }, fail); } catch (err) { fail(err); }
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    });
  }

  const req2p = req => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

  return {
    open,
    get: (store, key) => run(store, 'readonly', tx => req2p(tx.objectStore(store).get(key))),
    getAll: (store) => run(store, 'readonly', tx => req2p(tx.objectStore(store).getAll())),
    put: (store, value) => run(store, 'readwrite', tx => { tx.objectStore(store).put(value); }),
    putMany: (store, values) => run(store, 'readwrite', tx => { values.forEach(v => tx.objectStore(store).put(v)); }),
    del: (store, key) => run(store, 'readwrite', tx => { tx.objectStore(store).delete(key); }),
    delMany: (store, keys) => run(store, 'readwrite', tx => { keys.forEach(k => tx.objectStore(store).delete(k)); }),
    photosFor: (estimateId) => run('photos', 'readonly', tx =>
      req2p(tx.objectStore('photos').index('estimateId').getAll(estimateId))),
    clearAll: () => run(['estimates', 'findings', 'repairs', 'photos', 'meta'], 'readwrite', tx => {
      for (const s of ['estimates', 'findings', 'repairs', 'photos', 'meta']) tx.objectStore(s).clear();
    }),
    // Replace every store's contents in one transaction (backup restore): all or nothing.
    replaceAll: data => run(['estimates', 'findings', 'repairs', 'photos', 'meta'], 'readwrite', tx => {
      for (const s of ['estimates', 'findings', 'repairs', 'photos', 'meta']) {
        const os = tx.objectStore(s);
        os.clear();
        (data[s] || []).forEach(v => os.put(v));
      }
    }),
  };
})();
