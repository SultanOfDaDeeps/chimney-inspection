'use strict';

// Photo handling: large camera images are downscaled to a sensible size before storing,
// and a small thumbnail is kept for the editor.
const Photos = (() => {
  const MAX_EDGE = 2000;
  const THUMB_EDGE = 480;
  const MAX_INPUT_BYTES = 60 * 1024 * 1024;
  const urlCache = new Map(); // `${id}:${kind}` -> object URL

  async function decode(file) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { /* fall back */ }
    }
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This image format could not be read by the browser.')); };
      img.src = url;
    });
  }

  function scaleTo(source, maxEdge, quality) {
    const w = source.width, h = source.height;
    const s = Math.min(1, maxEdge / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * s);
    canvas.height = Math.round(h * s);
    canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve, reject) =>
      canvas.toBlob(b => (b ? resolve({ blob: b, width: canvas.width, height: canvas.height }) : reject(new Error('Could not encode image'))),
        'image/jpeg', quality));
  }

  const MAX_VIDEO_BYTES = 250 * 1024 * 1024;
  const isVideo = file => file.type.startsWith('video/') || /\.(mov|mp4|m4v|webm|3gp)$/i.test(file.name);

  // Grab a poster frame. Resolves null when this browser can't decode the video
  // (e.g. HEVC .mov outside Safari) — the file is still stored as-is.
  function videoPoster(file) {
    return new Promise(resolve => {
      const v = document.createElement('video');
      const url = URL.createObjectURL(file);
      let done = false;
      let meta = false; // the browser understood the file, even if no frame could be drawn
      const info = thumb => ({ thumb, duration: isFinite(v.duration) ? v.duration : 0, width: v.videoWidth, height: v.videoHeight });
      const finish = val => { if (done) return; done = true; URL.revokeObjectURL(url); resolve(val); };
      v.muted = true; v.playsInline = true; v.preload = 'auto';
      v.onloadedmetadata = () => { meta = v.videoWidth > 0 || v.duration > 0; };
      v.onloadeddata = async () => {
        try { finish(info((await scaleTo(v, THUMB_EDGE, 0.75)).blob)); } catch (e) { finish(meta ? info(null) : null); }
      };
      v.onerror = () => finish(null);
      setTimeout(() => finish(meta ? info(null) : null), 6000);
      v.src = url;
    });
  }

  async function importVideo(file, estimateId) {
    if (file.size > MAX_VIDEO_BYTES) throw new Error(`${file.name} is larger than 250 MB. Trim it or record a shorter clip.`);
    const poster = await videoPoster(file);
    const id = U.uid();
    await DB.put('photos', {
      id, estimateId, kind: 'video', blob: file, thumb: poster ? poster.thumb : null, type: file.type || 'video/quicktime',
      width: poster ? poster.width : 0, height: poster ? poster.height : 0, duration: poster ? poster.duration : 0,
      playable: !!poster, size: file.size, name: file.name, createdAt: new Date().toISOString(),
    });
    return { id, kind: 'video', playable: !!poster, name: file.name, size: file.size };
  }

  // Stores a photo or video and returns { id, kind, playable, name, size }.
  async function importMedia(file, estimateId) {
    if (isVideo(file)) return importVideo(file, estimateId);
    return { id: await importFile(file, estimateId), kind: 'photo', playable: true, name: file.name, size: file.size };
  }

  // Returns the stored photo id.
  async function importFile(file, estimateId) {
    if (!file.type.startsWith('image/') && !/\.(heic|heif)$/i.test(file.name)) throw new Error(`${file.name} is not a photo or video this app can store.`);
    if (file.size > MAX_INPUT_BYTES) throw new Error(`${file.name} is larger than 60 MB.`);
    const src = await decode(file);
    const full = await scaleTo(src, MAX_EDGE, 0.85);
    const thumb = await scaleTo(src, THUMB_EDGE, 0.75);
    if (src.close) src.close();
    const id = U.uid();
    await DB.put('photos', {
      id, estimateId, blob: full.blob, thumb: thumb.blob, width: full.width, height: full.height,
      name: file.name, createdAt: new Date().toISOString(),
    });
    return id;
  }

  async function url(id, kind = 'thumb') {
    const key = `${id}:${kind}`;
    if (urlCache.has(key)) return urlCache.get(key);
    const rec = await DB.get('photos', id);
    const blob = rec && (kind === 'thumb' ? rec.thumb : rec.blob);
    if (!blob) return null;
    const u = URL.createObjectURL(blob);
    urlCache.set(key, u);
    return u;
  }

  function forget(id) {
    for (const kind of ['thumb', 'full']) {
      const key = `${id}:${kind}`;
      if (urlCache.has(key)) { URL.revokeObjectURL(urlCache.get(key)); urlCache.delete(key); }
    }
  }

  async function remove(ids) {
    if (!ids.length) return;
    ids.forEach(forget);
    await DB.delMany('photos', ids);
  }

  // Fill every <img data-photo-id> and <video data-video-id> under root.
  async function hydrate(root, kind = 'thumb') {
    const imgs = U.$$('img[data-photo-id]', root);
    const vids = U.$$('video[data-video-id]', root);
    await Promise.all([
      ...imgs.map(async img => {
        const u = await url(img.dataset.photoId, kind);
        if (u) img.src = u; else img.closest('figure')?.classList.add('missing');
      }),
      ...vids.map(async v => {
        const [src, poster] = await Promise.all([url(v.dataset.videoId, 'full'), url(v.dataset.videoId, 'thumb')]);
        if (poster) v.poster = poster;
        if (src) v.src = src; else v.closest('figure')?.classList.add('missing');
      }),
    ]);
  }

  // Copy photo blobs to new ids (used when duplicating an estimate).
  async function copy(id, estimateId) {
    const rec = await DB.get('photos', id);
    if (!rec) return null;
    const newId = U.uid();
    await DB.put('photos', { ...rec, id: newId, estimateId, createdAt: new Date().toISOString() });
    return newId;
  }

  const blobToDataURL = blob => new Promise((res, rej) => {
    const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob);
  });
  const dataURLToBlob = async d => (await fetch(d)).blob();

  const fmtSize = n => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

  return { importFile, importMedia, url, hydrate, remove, copy, forget, blobToDataURL, dataURLToBlob, fmtSize };
})();
