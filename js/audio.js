/* Voice recordings: records the child's reading with the microphone and keeps
   the clips in this browser (IndexedDB), so they can be played back later.
   A one-minute clip is about 250 KB. */
(function () {
  const DB = 'orf_audio', STORE = 'clips';
  const canRecord = !!(window.MediaRecorder && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  let dbp = null;

  function db() {
    if (!dbp) dbp = new Promise((ok, no) => {
      try {
        const r = indexedDB.open(DB, 1);
        r.onupgradeneeded = () => r.result.createObjectStore(STORE);
        r.onsuccess = () => ok(r.result);
        r.onerror = () => no(r.error);
      } catch (e) { no(e); }
    });
    return dbp;
  }
  function tx(mode, fn) {
    return db().then((d) => new Promise((ok, no) => {
      const t = d.transaction(STORE, mode), s = t.objectStore(STORE);
      const r = fn(s);
      t.oncomplete = () => ok(r && 'result' in r ? r.result : undefined);
      t.onerror = () => no(t.error);
    }));
  }
  const put = (id, blob) => tx('readwrite', (s) => s.put(blob, id)).catch(() => false);
  const get = (id) => tx('readonly', (s) => s.get(id)).catch(() => null);
  const del = (ids) => tx('readwrite', (s) => { [].concat(ids).filter(Boolean).forEach((id) => s.delete(id)); }).catch(() => false);
  const keys = () => tx('readonly', (s) => s.getAllKeys()).catch(() => []);
  const clear = () => tx('readwrite', (s) => s.clear()).catch(() => false);

  function pickType() {
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    return types.find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
  }

  /* start() asks for the microphone and begins recording.
     stop() resolves with the recorded Blob (or null). */
  function recorder() {
    let mr = null, stream = null, chunks = [], stopped = false;
    const start = () => {
      if (!canRecord) return Promise.resolve(false);
      return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then((s) => {
        stream = s;
        if (stopped) { release(); return false; }
        const type = pickType();
        mr = new MediaRecorder(s, type ? { mimeType: type, audioBitsPerSecond: 32000 } : undefined);
        mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
        mr.start(1000);
        return true;
      }).catch(() => false);
    };
    const release = () => { if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; };
    const stop = () => new Promise((ok) => {
      stopped = true;
      if (!mr || mr.state === 'inactive') { release(); return ok(chunks.length ? new Blob(chunks, { type: chunks[0].type }) : null); }
      mr.onstop = () => { release(); ok(chunks.length ? new Blob(chunks, { type: mr.mimeType || chunks[0].type }) : null); };
      try { mr.stop(); } catch (e) { release(); ok(null); }
    });
    return { start, stop, active: () => !!(mr && mr.state === 'recording') };
  }

  /* An audio player for a stored clip id (or a Blob). */
  function player(src) {
    const a = document.createElement('audio');
    a.controls = true; a.preload = 'metadata'; a.className = 'voice';
    const set = (b) => { if (b) a.src = URL.createObjectURL(b); };
    // Chrome's recordings carry no length; seek to the end once so the player learns it
    a.addEventListener('loadedmetadata', function fix() {
      a.removeEventListener('loadedmetadata', fix);
      if (a.duration !== Infinity) return;
      const back = () => { a.removeEventListener('timeupdate', back); a.currentTime = 0; };
      a.addEventListener('timeupdate', back);
      a.currentTime = 1e7;
    });
    if (src instanceof Blob) set(src); else get(src).then(set);
    return a;
  }

  function usage() {
    return (navigator.storage && navigator.storage.estimate ? navigator.storage.estimate() : Promise.resolve({})).catch(() => ({}));
  }

  window.Voice = { canRecord, recorder, put, get, del, keys, clear, player, usage };
})();
