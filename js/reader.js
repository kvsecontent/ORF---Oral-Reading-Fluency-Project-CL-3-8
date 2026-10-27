/* Reading engine: shows a passage word by word, runs the 1-minute timer,
   listens with the browser's speech recognition (Chrome / Edge) and lines up
   what it hears with the passage. The teacher or student can then correct any
   word by tapping it before the result is saved. */
(function () {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const DURATION = 60;
  const STOPS = /[.?!।|]["'”’)]*$/;          // sentence-ending marks (auto pause check)
  const ANY_PUNCT = /[.,?!;:।|]["'”’)]*$/;
  const SHORT_OK = 3;                         // a single dropped short word (a, the, है) is not counted

  const NUM_EN = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
  const NUM_HI = ['शून्य', 'एक', 'दो', 'तीन', 'चार', 'पाँच', 'छह', 'सात', 'आठ', 'नौ', 'दस'];

  function norm(w, lang) {
    let s = String(w).toLowerCase().normalize('NFC');
    s = s.replace(/[’‘`]/g, "'").replace(/[^\p{L}\p{M}\p{N}']/gu, '').replace(/'/g, '');
    if (lang === 'hi') {
      s = s.replace(/़/g, '').replace(/ँ/g, 'ं').replace(/[०-९]/g, (d) => String('०१२३४५६७८९'.indexOf(d)));
      if (/^\d+$/.test(s) && +s < NUM_HI.length) s = norm(NUM_HI[+s], 'hi');
    } else if (/^\d+$/.test(s) && +s <= 20) s = NUM_EN[+s];
    return s;
  }
  function lev(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j), cur = new Array(n + 1);
    for (let i = 1; i <= m; i++) {
      cur[0] = i;
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      [prev, cur] = [cur, prev];
    }
    return prev[n];
  }
  function sim(a, b) { if (!a || !b) return 0; return 1 - lev(a, b) / Math.max(a.length, b.length); }
  const good = (a, b) => (b.length <= 3 ? a === b || sim(a, b) >= 0.66 : sim(a, b) >= 0.7);

  /* Lines up the heard words (T) with the passage words (P).
     Returns per-word states and the index reached. segEnds = indexes in T
     where the recogniser closed a phrase (the reader paused). */
  function align(P, T, segEnds) {
    const st = P.map(() => '');
    const pauseAt = new Set();
    let i = 0;
    for (let k = 0; k < T.length && i < P.length; k++) {
      const t = T[k], t2 = k + 1 < T.length ? t + T[k + 1] : null;
      let hit = -1, used2 = false;
      for (let j = i; j < Math.min(P.length, i + 5); j++) {
        if (good(t, P[j])) { hit = j; break; }
        if (t2 && P[j].length > 3 && sim(t2, P[j]) >= 0.8) { hit = j; used2 = true; break; }
      }
      // the recogniser lost a few words: jump ahead only when two heard words in a row match
      if (hit < 0 && k + 1 < T.length) {
        for (let j = i + 5; j < Math.min(P.length - 1, i + 25); j++) {
          if (good(t, P[j]) && good(T[k + 1], P[j + 1])) { hit = j; break; }
        }
      }
      if (hit >= 0) {
        for (let j = i; j < hit; j++) st[j] = 'miss';
        st[hit] = 'ok'; i = hit + 1;
        if (used2) k++;
        if (segEnds.has(k)) pauseAt.add(hit);
      } else if (sim(t, P[i]) >= 0.4) {
        st[i] = 'err'; if (segEnds.has(k)) pauseAt.add(i); i++;
      }
    }
    // a single dropped short word between two read words is usually the recogniser, not the child
    for (let j = 1; j < i - 1; j++) if (st[j] === 'miss' && P[j].length <= SHORT_OK && st[j - 1] === 'ok' && st[j + 1] === 'ok') st[j] = 'ok';
    return { st, reached: i, pauseAt };
  }

  function speak(text, lang) {
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang === 'hi' ? 'hi-IN' : 'en-IN'; u.rate = 0.8;
      const v = speechSynthesis.getVoices().find((x) => x.lang && x.lang.toLowerCase().startsWith(lang === 'hi' ? 'hi' : 'en-in'));
      if (v) u.voice = v;
      speechSynthesis.speak(u);
    } catch (e) { /* no speech */ }
  }

  /* mount(el, {passage, lang, onDone(result)}) */
  function mount(el, opt) {
    const lang = opt.lang;
    const words = tokens(opt.passage.text);
    const P = words.map((w) => norm(w, lang));
    const canAuto = !!SR;
    let mode = canAuto ? 'auto' : 'manual';
    let phase = 'ready';          // ready → reading → review
    let left = DURATION, startAt = 0, elapsed = 0, tick = null;
    let rec = null, sessions = [], live = [], wantRec = false;
    let state = P.map(() => ''), end = -1, pauseAt = new Set(), tapMode = 'mark', punct = null;
    const V = window.Voice, canVoice = !!(V && V.canRecord);
    let voiceOn = canVoice && getPref('orf_voice', '1') === '1', vrec = null, voiceBlob = null, voiceDone = null;

    el.innerHTML = `
      <div class="rd-head">
        <div class="rd-info">${opt.header || ''}</div>
        <div class="timer"><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="17" fill="none" stroke="#e2e8f0" stroke-width="4"/><circle id="arc" cx="20" cy="20" r="17" fill="none" stroke="#2563eb" stroke-width="4" stroke-linecap="round" stroke-dasharray="106.8" stroke-dashoffset="0"/></svg><div class="n" id="tn">60</div></div>
      </div>
      <div class="note" id="tip"></div>
      <div class="passage blur" id="psg" lang="${lang}">${words.map((w, i) => `<span class="w" data-i="${i}">${esc(w)}</span>`).join(' ')}</div>
      <div class="heard" id="heard"></div>
      <div id="voice"></div>
      <div class="ctrl" id="ctrl"></div>
      <div id="review"></div>`;
    const $ = (s) => el.querySelector(s);
    const spans = [...el.querySelectorAll('.w')];

    function paint() {
      spans.forEach((s, i) => {
        s.className = 'w' + (state[i] ? ' ' + state[i] : '') + (phase === 'review' && i > end ? ' after' : '') + (i === end ? ' end' : '');
      });
      if (phase === 'reading' && mode === 'auto') { const c = spans[Math.min(end + 1, spans.length - 1)]; if (c) c.classList.add('cur'); }
    }
    function setTimer() {
      $('#tn').textContent = Math.ceil(left);
      $('#arc').setAttribute('stroke-dashoffset', String(106.8 * (1 - left / DURATION)));
      $('#arc').setAttribute('stroke', left <= 10 ? '#dc2626' : left <= 30 ? '#ea8a0c' : '#2563eb');
    }
    function controls() {
      const c = $('#ctrl');
      if (phase === 'ready') {
        c.innerHTML = `${canAuto ? `<span class="mode-sw"><button data-m="auto" class="${mode === 'auto' ? 'on' : ''}">🎤 Auto (mic)</button><button data-m="manual" class="${mode === 'manual' ? 'on' : ''}">✋ Teacher marks</button></span>` : ''}
          ${canVoice ? `<label class="rec-sw"><input type="checkbox" id="von" ${voiceOn ? 'checked' : ''}> 🎙️ Record voice</label>` : ''}
          <button class="btn big green" id="go">▶ Start reading</button>
          ${opt.onNew ? '<button class="btn ghost" id="newp">🔀 Another passage</button>' : ''}`;
        c.querySelectorAll('.mode-sw button').forEach((b) => (b.onclick = () => { mode = b.dataset.m; controls(); }));
        $('#go').onclick = start;
        if (canVoice) $('#von').onchange = (e) => { voiceOn = e.target.checked; setPref('orf_voice', voiceOn ? '1' : '0'); };
        if (opt.onNew) $('#newp').onclick = opt.onNew;
        $('#tip').className = 'note' + (canAuto ? '' : ' warn');
        $('#tip').innerHTML = mode === 'auto'
          ? '🎤 <b>Auto:</b> Press Start, allow the microphone, and read aloud clearly. The app listens and colours each word. You have <b>1 minute</b>.'
          : (canAuto ? '' : '⚠️ This browser cannot listen. Please use <b>Google Chrome</b> or <b>Edge</b> for Auto mode. ') + '✋ <b>Teacher marks:</b> Press Start. While the child reads, tap any word read wrongly or skipped. When time is up, tap the last word read.';
      } else if (phase === 'reading') {
        c.innerHTML = `<button class="btn big red ${mode === 'auto' ? 'mic-on' : ''}" id="stop">⏹ Stop</button><span class="muted">${mode === 'auto' ? '🎤 Listening… read aloud' : 'Tap the words read wrongly'}</span>`;
        $('#stop').onclick = () => finish();
      } else c.innerHTML = '';
    }

    function start() {
      if (!voiceOn) return begin();
      // get the microphone for recording first, so the minute does not run while the browser asks for permission
      $('#go').disabled = true;
      $('#tip').className = 'note'; $('#tip').innerHTML = '🎙️ Please <b>allow the microphone</b> if the browser asks…';
      vrec = V.recorder();
      let done = false;
      const go = (ok) => {
        if (done) return; done = true;
        if (ok) $('#voice').innerHTML = '<span class="rec-dot">● REC</span>';
        else { stopVoice(); $('#voice').innerHTML = '<span class="muted">🎙️ Voice is not being recorded.</span>'; }
        begin();
      };
      vrec.start().then(go);
      setTimeout(() => go(false), 10000);     // no answer to the permission prompt: read without recording
    }
    function begin() {
      phase = 'reading'; $('#psg').classList.remove('blur'); startAt = performance.now(); left = DURATION; elapsed = 0;
      $('#tip').className = 'note';
      $('#tip').innerHTML = mode === 'auto' ? '📖 Read from the first word. Read clearly and stop at full stops (।/.).' : '📖 Child reads aloud now. Tap a word to mark it wrong.';
      controls(); setTimer(); paint();
      tick = setInterval(() => {
        left = Math.max(0, DURATION - (performance.now() - startAt) / 1000); setTimer();
        if (left <= 0) finish();
      }, 200);
      if (mode === 'auto') startRec();
    }
    // stop the recording (once) and keep the clip
    function stopVoice() {
      if (!vrec) return Promise.resolve(voiceBlob);
      if (!voiceDone) voiceDone = vrec.stop().then((b) => { voiceBlob = b; return b; });
      return voiceDone;
    }
    /* Chrome ends a listening session on its own (a short silence, a network
       hiccup, or about every minute). Each time, keep what was heard so far and
       start a fresh session, so the words after the break are still caught. */
    let fails = 0;
    const tipReading = () => { $('#tip').className = 'note'; $('#tip').innerHTML = '📖 Read from the first word. Read clearly and stop at full stops (।/.).'; };
    function startRec() {
      wantRec = true;
      let r;
      try {
        r = new SR(); r.lang = lang === 'hi' ? 'hi-IN' : 'en-IN'; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
      } catch (e) { mode = 'manual'; controls(); return; }
      rec = r; live = [];
      r.onresult = (e) => {
        if (rec !== r) return;
        if (fails) { fails = 0; tipReading(); }
        live = [];
        for (let k = 0; k < e.results.length; k++) live.push({ text: e.results[k][0].transcript, fin: e.results[k].isFinal });
        update();
      };
      r.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { wantRec = false; mode = 'manual'; $('#tip').className = 'note warn'; $('#tip').innerHTML = '⚠️ Microphone not allowed. Switched to <b>Teacher marks</b>: tap wrong words, then the last word read.'; controls(); }
        else if (e.error === 'audio-capture' && vrec && vrec.active()) {
          // some phones cannot record and listen at the same time: keep listening, stop recording
          stopVoice(); $('#voice').innerHTML = '<span class="muted">🎙️ This device cannot record while listening – recording stopped.</span>';
        } else if (e.error === 'network' || e.error === 'audio-capture') {
          fails++;
          if (fails >= 3) { $('#tip').className = 'note warn'; $('#tip').innerHTML = '⚠️ The microphone keeps stopping (internet is needed). Still trying… If words do not turn green, mark them by tapping.'; }
        }
      };
      r.onend = () => {
        if (rec !== r) return;
        // keep unfinished words too: when a session is cut, Chrome never finalises them
        sessions.push(...dedupe(live).map((x) => ({ text: x.text, fin: true }))); live = [];
        if (wantRec && phase === 'reading') setTimeout(() => { if (wantRec && phase === 'reading') startRec(); }, fails ? 400 : 50);
        else if (phase === 'closing') review();
      };
      try { r.start(); } catch (e) { setTimeout(() => { if (wantRec && phase === 'reading') startRec(); }, 400); }
    }
    // Some phones send each phrase again with the new words added; keep only the longest copy.
    function dedupe(list) {
      const out = [];
      list.forEach((s) => {
        const prev = out[out.length - 1], a = s.text.trim(), b = prev ? prev.text.trim() : '';
        if (prev && b && a.startsWith(b)) out[out.length - 1] = s;
        else if (prev && a && b.startsWith(a)) { /* shorter repeat, skip */ }
        else out.push(s);
      });
      return out;
    }
    function heardList() {
      const segs = [...sessions, ...dedupe(live)], T = [], ends = new Set();
      segs.forEach((s) => {
        s.text.trim().split(/\s+/).forEach((w) => { const n = norm(w, lang); if (n) T.push(n); });
        if (s.fin && T.length) ends.add(T.length - 1);
      });
      return { T, ends, raw: segs.map((s) => s.text).join(' ') };
    }
    function update() {
      const { T, ends, raw } = heardList();
      const a = align(P, T, ends);
      state = a.st; end = a.reached - 1; pauseAt = a.pauseAt;
      $('#heard').innerHTML = raw ? '<span>👂 ' + esc(raw.slice(-160)) + '</span>' : '';
      paint();
      if (a.reached >= P.length) finish();
    }
    function finish() {
      if (phase !== 'reading') return;
      clearInterval(tick); elapsed = Math.min(DURATION, (performance.now() - startAt) / 1000);
      if (mode === 'auto' && rec) {
        phase = 'closing'; wantRec = false; controls();
        $('#tip').innerHTML = '⏳ Checking…';
        try { rec.stop(); } catch (e) { review(); }
        setTimeout(() => { if (phase === 'closing') review(); }, 2500);
      } else review();
    }
    function autoPunct() {
      const marks = [];
      for (let i = 0; i < end; i++) if (STOPS.test(words[i])) marks.push(i);
      if (!marks.length) return 'good';
      const hit = marks.filter((i) => pauseAt.has(i) || pauseAt.has(i + 1) || pauseAt.has(i - 1)).length / marks.length;
      return hit >= 0.6 ? 'good' : hit >= 0.3 ? 'some' : 'poor';
    }
    function review() {
      if (phase === 'review') return;
      if (mode === 'auto' && rec) { const { T, ends } = heardList(); const a = align(P, T, ends); state = a.st; end = a.reached - 1; pauseAt = a.pauseAt; }
      phase = 'review'; controls();
      if (mode === 'auto') punct = autoPunct();
      if (end < 0 && mode === 'manual') tapMode = 'end';
      $('#heard').innerHTML = '';
      if (vrec) stopVoice().then((b) => {
        const box = $('#voice'); box.innerHTML = '';
        if (b) { box.innerHTML = '<b>🔊 Listen to the reading:</b> '; box.appendChild(V.player(b)); }
      });
      $('#tip').className = 'note';
      $('#tip').innerHTML = '✅ Time over. <b>Check the colours.</b> Tap a word to mark it right/wrong. Use <b>📍 Last word</b> to change where the reading stopped.';
      paint(); drawReview();
    }
    function score() {
      const read = end + 1;
      const errors = state.slice(0, read).filter((s) => s === 'err' || s === 'miss').length;
      const correct = Math.max(0, read - errors);
      // only a child who finished the passage early gets a per-minute rate from the shorter time;
      // stopping early otherwise counts as the full minute (words correct in one minute)
      const secs = Math.max(5, elapsed || DURATION);
      const rateSecs = read >= P.length ? secs : DURATION;
      return { read, errors, correct, wcpm: Math.round((correct * 60) / rateSecs), acc: read ? Math.round((correct / read) * 100) : 0, secs: Math.round(secs) };
    }
    function drawReview() {
      const s = score();
      $('#review').innerHTML = `
        <div class="card" style="margin-top:0.9rem">
          <div class="row" style="justify-content:space-between">
            <div class="legend"><span><i style="background:var(--green-soft)"></i>Read right</span><span><i style="background:var(--red-soft)"></i>Wrong word</span><span><i style="background:var(--orange-soft)"></i>Skipped</span><span><i style="background:#e2e8f0"></i>Not reached</span></div>
            <span class="mode-sw"><button data-t="mark" class="${tapMode === 'mark' ? 'on' : ''}">✏️ Mark wrong</button><button data-t="end" class="${tapMode === 'end' ? 'on' : ''}">📍 Last word</button></span>
          </div>
          <p style="margin-top:0.7rem">Words read: <b>${s.read}</b> · Errors: <b>${s.errors}</b> · Correct: <b>${s.correct}</b> · Time: <b>${s.secs} s</b></p>
          <div class="step"><b>Stops at punctuation (। . , ?)</b>
            <div class="punct-pick">${[['good', '✅ Always stopped'], ['some', '⚠️ Sometimes'], ['poor', '❌ Did not stop']].map(([k, t]) => `<button data-p="${k}" class="${punct === k ? 'on' : ''}">${t}</button>`).join('')}</div>
            ${mode === 'auto' ? '<p class="muted" style="font-size:0.85rem;margin:0.3rem 0 0">Auto-checked from the pauses — change it if needed.</p>' : ''}
          </div>
          <div class="row"><button class="btn big green" id="save" ${s.read && punct ? '' : 'disabled'}>💾 Save result</button><button class="btn ghost" id="again">↺ Read again</button></div>
          ${!s.read ? '<p class="err-msg">Tap the last word the child read.</p>' : !punct ? '<p class="err-msg">Choose the punctuation rating.</p>' : ''}
        </div>`;
      el.querySelectorAll('#review .mode-sw button').forEach((b) => (b.onclick = () => { tapMode = b.dataset.t; drawReview(); }));
      el.querySelectorAll('.punct-pick button').forEach((b) => (b.onclick = () => { punct = b.dataset.p; drawReview(); }));
      $('#again').onclick = () => { stopVoice(); mount(el, opt); };
      $('#save').onclick = () => {
        const sc = score();
        const wrong = [];
        state.slice(0, sc.read).forEach((x, i) => { if ((x === 'err' || x === 'miss') && !wrong.includes(clean(words[i]))) wrong.push(clean(words[i])); });
        $('#save').disabled = true;
        stopVoice().then((audio) => opt.onDone({ ...sc, punct, mode, wrong, audio }));
      };
    }
    $('#psg').addEventListener('click', (e) => {
      const w = e.target.closest('.w'); if (!w) return;
      const i = +w.dataset.i;
      if (phase === 'reading' && mode === 'manual') { state[i] = state[i] === 'err' ? '' : 'err'; paint(); return; }
      if (phase !== 'review') { if (phase === 'ready') speak(clean(words[i]), lang); return; }
      if (tapMode === 'end') {
        end = i;
        for (let j = 0; j <= end; j++) if (!state[j]) state[j] = 'ok';
        for (let j = end + 1; j < state.length; j++) if (state[j] === 'ok') state[j] = '';
        if (mode === 'manual' && !punct) punct = null;
        tapMode = 'mark';
      } else {
        if (i > end) { end = i; for (let j = 0; j <= end; j++) if (!state[j]) state[j] = 'ok'; }
        else state[i] = state[i] === 'ok' || !state[i] ? 'err' : 'ok';
      }
      paint(); drawReview();
    });
    // manual mode: make every untouched word up to the end "ok" when the end is set
    controls(); setTimer();
    return { stop: () => { clearInterval(tick); wantRec = false; stopVoice(); try { rec && rec.abort(); } catch (e) { /* */ } } };
  }

  // split on spaces; a lone mark such as — or … sticks to the word before it
  function tokens(text) {
    const out = [];
    text.trim().split(/\s+/).forEach((w) => {
      if (!/[\p{L}\p{N}]/u.test(w) && out.length) out[out.length - 1] += ' ' + w;
      else out.push(w);
    });
    return out;
  }
  const getPref = (k, d) => { try { const x = localStorage.getItem(k); return x == null ? d : x; } catch (e) { return d; } };
  const setPref = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* */ } };
  const clean = (w) => w.replace(/^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu, '');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  window.Reader = { mount, speak, align, norm, tokens, canListen: !!SR, ANY_PUNCT };
})();
