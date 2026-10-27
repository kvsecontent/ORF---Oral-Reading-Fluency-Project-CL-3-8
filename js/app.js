/* ORF app: student mode, teacher mode, records and Excel export.
   Everything is kept in this browser's localStorage. */
(function () {
  const KS = 'orf_student_v1', KT = 'orf_teacher_v1', KU = 'orf_used_v1', KIN = 'orf_teacher_in';
  const DEFAULT_USER = 'TeachORF', DEFAULT_PASS = 'ORF@2026';
  const CLASSES = ['3', '4', '5', '6', '7', '8'];
  const LANGS = { en: 'English', hi: 'हिंदी Hindi' };
  const LANG_PLAIN = { en: 'English', hi: 'Hindi' };
  const LEVELS = { easy: 'Easy · सरल', medium: 'Medium · मध्यम', hard: 'Hard · कठिन' };
  const BOOKS = { '3-en': 'Santoor', '4-en': 'Santoor', '5-en': 'Santoor', '6-en': 'Poorvi', '7-en': 'Poorvi', '8-en': 'Poorvi', '3-hi': 'वीणा', '4-hi': 'वीणा', '5-hi': 'वीणा', '6-hi': 'मल्हार', '7-hi': 'मल्हार', '8-hi': 'मल्हार' };
  // Suggested end-of-year targets (words correct per minute), roughly in line with common ORF benchmarks.
  const TARGET = { 3: 60, 4: 75, 5: 90, 6: 100, 7: 110, 8: 120 };
  const PUNCT = { good: 'Good', some: 'Sometimes', poor: 'Needs practice' };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const app = document.getElementById('app');
  const who = document.getElementById('who');
  let reader = null;

  /* ---------- storage ---------- */
  const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { toast('⚠️ Could not save in this browser'); return false; } };
  const S = () => load(KS, { profile: null, attempts: [] });
  const T = () => {
    const t = load(KT, null) || {};
    return { user: DEFAULT_USER, pass: DEFAULT_PASS, school: '', cur: '', classes: {}, ...t };
  };
  const inT = () => { try { return sessionStorage.getItem(KIN) === '1'; } catch (e) { return false; } };
  const setIn = (v) => { try { v ? sessionStorage.setItem(KIN, '1') : sessionStorage.removeItem(KIN); } catch (e) { /* */ } };

  /* ---------- helpers ---------- */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (s, r = app) => r.querySelector(s);
  const $$ = (s, r = app) => [...r.querySelectorAll(s)];
  const monthKey = (d) => d.slice(0, 7);
  const monthLabel = (k) => MONTHS[+k.slice(5, 7) - 1] + '-' + k.slice(0, 4);
  const today = () => new Date().toISOString();
  const fmtDate = (d) => { const x = new Date(d); return `${String(x.getDate()).padStart(2, '0')}-${MONTHS[x.getMonth()]}-${x.getFullYear()}`; };
  function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2600); }
  // a ▶ button for a reading's voice clip; bindPlay() swaps it for a player
  const playCell = (r) => (r.aid && window.Voice ? `<button class="play" data-aid="${esc(r.aid)}" title="Listen">▶</button>` : '');
  function bindPlay(root) {
    $$('.play', root).forEach((b) => (b.onclick = () => {
      Voice.get(b.dataset.aid).then((blob) => {
        if (!blob) { b.replaceWith(Object.assign(document.createElement('span'), { className: 'muted', textContent: '–' })); toast('This recording is not in this browser'); return; }
        const a = Voice.player(blob); b.replaceWith(a); a.play().catch(() => { /* */ });
      });
    }));
  }
  const better = (a, b) => (!b || a.wcpm > b.wcpm || (a.wcpm === b.wcpm && a.acc > b.acc));
  const bank = (cls, lang) => (window.ORF_BANK && window.ORF_BANK[cls + '-' + lang]) || [];
  function stopReader() { if (reader) { reader.stop(); reader = null; } try { speechSynthesis.cancel(); } catch (e) { /* */ } }

  function pickPassage(cls, lang, level, avoidId) {
    const all = bank(cls, lang).map((p, i) => ({ ...p, id: `${cls}-${lang}-${i}` })).filter((p) => p.level === level);
    if (!all.length) return null;
    const used = load(KU, {}), key = `${cls}-${lang}-${level}`, recent = used[key] || [];
    let pool = all.filter((p) => !recent.includes(p.id) && p.id !== avoidId);
    if (!pool.length) pool = all.filter((p) => p.id !== avoidId);
    if (!pool.length) pool = all;
    const p = pool[Math.floor(Math.random() * pool.length)];
    used[key] = [p.id, ...recent.filter((x) => x !== p.id)].slice(0, Math.max(1, Math.floor(all.length / 2)));
    save(KU, used);
    return p;
  }
  function bandOf(r, cls) {
    const t = TARGET[cls] || 100, x = r.wcpm / t;
    const stars = (x >= 1 ? 3 : x >= 0.75 ? 2 : x >= 0.5 ? 1 : 0) + (r.acc >= 95 ? 2 : r.acc >= 85 ? 1 : 0);
    const label = x >= 1 && r.acc >= 95 ? '🏆 Fluent Reader' : x >= 0.75 && r.acc >= 85 ? '🌟 Good Reader' : x >= 0.5 ? '📗 Developing Reader' : '🌱 Beginner Reader';
    return { stars: Math.max(1, Math.min(5, stars)), label, target: t };
  }

  /* ---------- router ---------- */
  function go(view, arg) {
    stopReader();
    window.scrollTo(0, 0);
    const t = inT();
    who.innerHTML = t ? `👩‍🏫 ${esc(DEFAULT_USER)} <button id="lo">Logout</button>` : (S().profile ? `👦 ${esc(S().profile.name)}` : '');
    const lo = document.getElementById('lo'); if (lo) lo.onclick = () => { setIn(false); go('home'); };
    ({ home, student, studentSetup, progress, login, teacher, read, result }[view] || home)(arg);
  }
  document.getElementById('homeBtn').onclick = () => go('home');

  /* ---------- home ---------- */
  function home() {
    app.innerHTML = `
      <section class="hero">
        <h1>📖 Oral Reading Fluency</h1>
        <p>मौखिक पठन प्रवाह · Classes 3–8 · English &amp; Hindi passages from NCERT textbooks. Read for 1 minute and see your <b>speed</b> and <b>accuracy</b>.</p>
      </section>
      <div class="choose">
        <button id="goS"><span class="ic">👦👧</span><b>Student · विद्यार्थी</b><span>Practise reading and track your own progress</span></button>
        <button id="goT"><span class="ic">👩‍🏫</span><b>Teacher · शिक्षक</b><span>Test your class, save every child's record, download Excel</span></button>
      </div>
      <div class="how">
        <div><b>1️⃣ Choose</b>Class, language and level (Easy / Medium / Hard).</div>
        <div><b>2️⃣ Read aloud</b>A random NCERT passage for 1 minute. The mic listens.</div>
        <div><b>3️⃣ Check</b>Wrong and skipped words are coloured. Tap to correct.</div>
        <div><b>4️⃣ Result</b>Speed (words correct per minute), accuracy and punctuation.</div>
      </div>`;
    $('#goS').onclick = () => go(S().profile ? 'student' : 'studentSetup');
    $('#goT').onclick = () => go(inT() ? 'teacher' : 'login');
  }

  /* ---------- student ---------- */
  function studentSetup() {
    const p = S().profile || {};
    app.innerHTML = `<div class="card" style="max-width:34rem;margin:1rem auto">
      <h2>👋 Hello! Who is reading?</h2>
      <label class="f">Your name · आपका नाम<input class="in" id="nm" value="${esc(p.name || '')}" maxlength="40"></label><br>
      <div class="step"><b>Your class · कक्षा</b><div class="pills" id="cl">${CLASSES.map((c) => `<button class="pill ${p.cls === c ? 'on' : ''}" data-c="${c}">${c}</button>`).join('')}</div></div>
      <p class="err-msg" id="e"></p>
      <button class="btn big green" id="ok">Continue ➜</button></div>`;
    let cls = p.cls || '';
    $$('#cl .pill').forEach((b) => (b.onclick = () => { cls = b.dataset.c; $$('#cl .pill').forEach((x) => x.classList.toggle('on', x === b)); }));
    $('#ok').onclick = () => {
      const name = $('#nm').value.trim();
      if (!name || !cls) { $('#e').textContent = 'Please write your name and choose your class.'; return; }
      const s = S(); s.profile = { name, cls }; save(KS, s); go('student');
    };
  }
  function chooser(cls, onGo, extra) {
    const prefs = load('orf_pref', {});
    let lang = prefs.lang || 'en', level = prefs.level || 'easy';
    return {
      html: `<div class="step"><b>Language · भाषा</b><div class="pills" id="lg">${Object.entries(LANGS).map(([k, v]) => `<button class="pill ${k === lang ? 'on' : ''}" data-l="${k}">${v}</button>`).join('')}</div></div>
        <div class="step"><b>Level · स्तर</b><div class="pills" id="lv">${Object.entries(LEVELS).map(([k, v]) => `<button class="pill lv-${k} ${k === level ? 'on' : ''}" data-v="${k}">${v}</button>`).join('')}</div></div>
        <p class="err-msg" id="ce"></p>
        <button class="btn big green" id="start">📖 Get my passage</button> ${extra || ''}`,
      bind() {
        $$('#lg .pill').forEach((b) => (b.onclick = () => { lang = b.dataset.l; $$('#lg .pill').forEach((x) => x.classList.toggle('on', x === b)); }));
        $$('#lv .pill').forEach((b) => (b.onclick = () => { level = b.dataset.v; $$('#lv .pill').forEach((x) => x.classList.toggle('on', x === b)); }));
        $('#start').onclick = () => {
          const c = typeof cls === 'function' ? cls() : cls;
          if (!c) return;
          if (!bank(c, lang).some((p) => p.level === level)) { $('#ce').textContent = `Passages for Class ${c} ${LANG_PLAIN[lang]} are being added. Please choose another.`; return; }
          save('orf_pref', { lang, level });
          onGo(lang, level);
        };
      },
    };
  }
  function student() {
    const s = S(); if (!s.profile) return go('studentSetup');
    const ch = chooser(s.profile.cls, (lang, level) => go('read', { who: 'student', cls: s.profile.cls, lang, level }));
    const last = s.attempts[s.attempts.length - 1];
    app.innerHTML = `<div class="grid2">
      <div class="card"><h2>Hi ${esc(s.profile.name)} 👋</h2><p class="muted">Class ${esc(s.profile.cls)} · Choose and start reading.</p>${ch.html}</div>
      <div class="card"><h3>📈 My progress</h3>
        ${last ? `<p>Last reading: <b>${last.wcpm}</b> words/min · <b>${last.acc}%</b> accuracy <span class="muted">(${fmtDate(last.d)})</span></p>` : '<p class="muted">No readings yet. Start your first one!</p>'}
        <p>Total readings: <b>${s.attempts.length}</b></p>
        <div class="row"><button class="btn purple" id="pg">See my progress</button><button class="btn ghost small" id="ch">✏️ Change name / class</button></div>
      </div></div>`;
    ch.bind();
    $('#pg').onclick = () => go('progress');
    $('#ch').onclick = () => go('studentSetup');
  }
  function chart(list) {
    if (list.length < 2) return '';
    const W = 640, H = 220, pad = 34, max = Math.max(...list.map((a) => a.wcpm), 20);
    const x = (i) => pad + (i * (W - pad * 2)) / (list.length - 1), y = (v) => H - pad - (v / max) * (H - pad * 2);
    const pts = list.map((a, i) => `${x(i)},${y(a.wcpm)}`).join(' ');
    const apts = list.map((a, i) => `${x(i)},${H - pad - (a.acc / 100) * (H - pad * 2)}`).join(' ');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Progress chart">
      <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="#cbd5e1"/>
      <polyline points="${apts}" fill="none" stroke="#16a34a" stroke-width="2.5" stroke-dasharray="6 5"/>
      <polyline points="${pts}" fill="none" stroke="#2563eb" stroke-width="3.5" stroke-linejoin="round"/>
      ${list.map((a, i) => `<circle cx="${x(i)}" cy="${y(a.wcpm)}" r="4.5" fill="#2563eb"><title>${a.wcpm} wpm</title></circle>`).join('')}
      <text x="${pad}" y="18" font-size="14" fill="#2563eb" font-weight="700">— Speed (words/min)</text>
      <text x="${pad + 200}" y="18" font-size="14" fill="#16a34a" font-weight="700">- - Accuracy %</text>
    </svg>`;
  }
  function progress() {
    const s = S(); if (!s.profile) return go('studentSetup');
    const byLang = {};
    s.attempts.forEach((a) => (byLang[a.lang] = byLang[a.lang] || []).push(a));
    const best = {};
    s.attempts.forEach((a) => { const k = a.lang + '|' + monthKey(a.d); if (better(a, best[k])) best[k] = a; });
    app.innerHTML = `<div class="card"><div class="row" style="justify-content:space-between"><h2>📈 ${esc(s.profile.name)}'s progress</h2><button class="btn ghost" id="bk">⬅ Back</button></div>
      ${!s.attempts.length ? '<p class="muted">No readings yet.</p>' : Object.entries(byLang).map(([l, list]) => `
        <h3 style="margin-top:1rem">${LANGS[l]}</h3>${chart(list.slice(-15))}
        <h3 style="margin-top:1rem">Best of each month</h3>
        <div class="tbl-wrap"><table class="t"><tr><th>Month</th><th>Speed (WCPM)</th><th>Accuracy %</th><th>Level</th></tr>
        ${Object.entries(best).filter(([k]) => k.startsWith(l + '|')).sort().map(([k, a]) => `<tr><td>${monthLabel(k.split('|')[1])}</td><td><b>${a.wcpm}</b></td><td><b>${a.acc}%</b></td><td>${a.level}</td></tr>`).join('')}
        </table></div>
        <h3 style="margin-top:1rem">All readings</h3>
        <div class="tbl-wrap"><table class="t"><tr><th>Date</th><th>Level</th><th class="l">Chapter</th><th>Speed (WCPM)</th><th>Accuracy %</th><th>Punctuation</th><th>🔊 Voice</th></tr>
        ${list.slice().reverse().map((a) => `<tr><td>${fmtDate(a.d)}</td><td>${a.level}</td><td class="l">${esc(a.ch)}</td><td><b>${a.wcpm}</b></td><td>${a.acc}%</td><td>${PUNCT[a.punct] || ''}</td><td>${playCell(a)}</td></tr>`).join('')}
        </table></div>`).join('')}
      </div>`;
    $('#bk').onclick = () => go('student');
    bindPlay(app);
  }

  /* ---------- reading ---------- */
  function read(ctx) {
    const p = pickPassage(ctx.cls, ctx.lang, ctx.level, ctx.prev);
    if (!p) { toast('No passage found'); return go(ctx.who === 'teacher' ? 'teacher' : 'student'); }
    app.innerHTML = `<div class="card" id="rd"></div><div class="row"><button class="btn ghost" id="bk">⬅ Back</button></div>`;
    const header = `${ctx.studentName ? `<b>${esc(ctx.studentName)}</b> · ` : ''}Class ${ctx.cls} <span class="tag lang">${LANG_PLAIN[ctx.lang]}</span><span class="tag ${ctx.level}">${ctx.level}</span><br><span class="muted">${esc(BOOKS[ctx.cls + '-' + ctx.lang] || '')} · ${esc(p.ch)}${p.title ? ' – ' + esc(p.title) : ''}</span>`;
    reader = Reader.mount($('#rd'), {
      passage: p, lang: ctx.lang, header,
      onNew: () => go('read', { ...ctx, prev: p.id }),
      onDone: (r) => {
        const rec = { d: today(), cls: ctx.cls, lang: ctx.lang, level: ctx.level, pid: p.id, ch: `${p.ch}${p.title ? ' – ' + p.title : ''}`, wcpm: r.wcpm, acc: r.acc, punct: r.punct, words: r.read, errors: r.errors, secs: r.secs, mode: r.mode };
        if (r.audio) { rec.aid = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); Voice.put(rec.aid, r.audio); }
        if (ctx.who === 'teacher') {
          const t = T(), c = t.classes[t.cur]; if (!c) return go('teacher');
          c.records.push({ roll: ctx.roll, ...rec }); save(KT, t);
        } else { const s = S(); s.attempts.push(rec); save(KS, s); }
        go('result', { ctx, rec, wrong: r.wrong, audio: r.audio });
      },
    });
    $('#bk').onclick = () => go(ctx.who === 'teacher' ? 'teacher' : 'student');
  }
  function result({ ctx, rec, wrong, audio }) {
    const b = bandOf(rec, ctx.cls);
    app.innerHTML = `<div class="card">
      <h2>${ctx.studentName ? esc(ctx.studentName) + ' – ' : ''}Your result 🎉</h2>
      <div class="stars">${'⭐'.repeat(b.stars)}${'☆'.repeat(5 - b.stars)}</div>
      <div class="badge">${b.label}</div>
      <div class="res-stats">
        <div class="stat sp"><div class="v">${rec.wcpm}</div><div class="k">Speed · गति</div><div class="s">words correct per minute<br>Class ${ctx.cls} target: ${b.target}</div></div>
        <div class="stat ac"><div class="v">${rec.acc}%</div><div class="k">Accuracy · शुद्धता</div><div class="s">${rec.words - rec.errors} of ${rec.words} words right</div></div>
        <div class="stat pu"><div class="v" style="font-size:2rem;padding:0.5rem 0">${PUNCT[rec.punct]}</div><div class="k">Punctuation · विराम</div><div class="s">stopping at । . , ?</div></div>
      </div>
      ${audio ? '<div class="voice-box" id="vb"><b>🎧 Listen to your reading</b></div>' : ''}
      ${wrong.length ? `<h3>🔊 Practise these words (tap to listen)</h3><div class="practice">${wrong.slice(0, 24).map((w) => `<button data-w="${esc(w)}">${esc(w)} 🔊</button>`).join('')}</div>` : '<p class="badge" style="font-size:1.1rem">No mistakes – excellent! 👏</p>'}
      <p class="muted" style="margin-top:1rem">${tips(rec)}</p>
      <div class="row" style="margin-top:1rem">
        <button class="btn green big" id="again">📖 Read another passage</button>
        <button class="btn ghost" id="bk">${ctx.who === 'teacher' ? '👩‍🏫 Next student' : '🏠 Back'}</button>
      </div></div>`;
    if (audio) $('#vb').appendChild(Voice.player(audio));
    $$('.practice button').forEach((x) => (x.onclick = () => Reader.speak(x.dataset.w, ctx.lang)));
    $('#again').onclick = () => go('read', { ...ctx, prev: rec.pid });
    $('#bk').onclick = () => go(ctx.who === 'teacher' ? 'teacher' : 'student');
  }
  function tips(r) {
    const t = [];
    if (r.acc < 90) t.push('Read a little slower and look at each word carefully.');
    if (r.punct !== 'good') t.push('Take a short pause at every comma and full stop (। .).');
    if (r.acc >= 90 && r.wcpm < 60) t.push('Your reading is correct – now practise to read a little faster.');
    if (!t.length) t.push('Great reading! Try a harder level next time.');
    return '💡 ' + t.join(' ');
  }

  /* ---------- teacher ---------- */
  function login() {
    app.innerHTML = `<div class="card" style="max-width:30rem;margin:1.5rem auto">
      <h2>👩‍🏫 Teacher login</h2>
      <label class="f">Login name<input class="in" id="u" autocomplete="username"></label><br>
      <label class="f">Password<input class="in" id="p" type="password" autocomplete="current-password"></label>
      <p class="err-msg" id="e"></p>
      <button class="btn big" id="ok">Login</button>
      <p class="muted" style="font-size:0.85rem;margin-top:1rem">Records are saved only in this browser on this device.</p></div>`;
    const tryIn = () => {
      const t = T();
      if ($('#u').value.trim() === t.user && $('#p').value === t.pass) { setIn(true); go('teacher'); }
      else $('#e').textContent = 'Wrong login name or password.';
    };
    $('#ok').onclick = tryIn;
    $('#p').onkeydown = (e) => { if (e.key === 'Enter') tryIn(); };
    $('#u').focus();
  }
  let tab = 'read';
  function teacher(arg) {
    if (!inT()) return go('login');
    if (arg && arg.tab) tab = arg.tab;
    const t = T();
    const cur = t.classes[t.cur];
    const keys = Object.keys(t.classes).sort();
    app.innerHTML = `
      <div class="card">
        <div class="row" style="align-items:flex-end">
          <label class="f" style="flex:2;min-width:14rem">School name · विद्यालय<input class="in" id="school" value="${esc(t.school)}" placeholder="e.g. PM SHRI Kendriya Vidyalaya ..."></label>
          <label class="f">Class<select class="in" id="cls">${CLASSES.map((c) => `<option ${cur && cur.cls === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
          <label class="f">Section<input class="in" id="sec" style="width:5rem" maxlength="4" value="${esc(cur ? cur.sec : 'A')}"></label>
          <button class="btn" id="open">Open class</button>
        </div>
        ${keys.length ? `<div class="row" style="margin-top:0.7rem"><span class="muted">Saved classes:</span>${keys.map((k) => `<button class="pill ${k === t.cur ? 'on' : ''}" data-k="${esc(k)}" style="font-size:0.95rem;padding:0.25rem 0.8rem">${esc(k)}</button>`).join('')}</div>` : ''}
      </div>
      ${cur ? `<div class="tabs">${[['read', '📖 Take reading'], ['students', '👥 Students'], ['records', '📊 Records & Excel'], ['settings', '⚙️ Settings']].map(([k, v]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${v}</button>`).join('')}</div><div id="pane"></div>`
        : '<div class="card"><p>Choose the <b>class</b> and <b>section</b> and press <b>Open class</b> to start.</p></div>'}`;
    $('#school').onchange = () => { const x = T(); x.school = $('#school').value.trim(); save(KT, x); toast('School name saved'); };
    $('#open').onclick = () => {
      const x = T(); const cls = $('#cls').value, sec = ($('#sec').value.trim() || 'A').toUpperCase(), k = `${cls}-${sec}`;
      x.school = $('#school').value.trim();
      if (!x.classes[k]) x.classes[k] = { cls, sec, students: [], records: [] };
      x.cur = k; save(KT, x);
      if (!x.classes[k].students.length) tab = 'students';
      go('teacher');
    };
    $$('.pill[data-k]').forEach((b) => (b.onclick = () => { const x = T(); x.cur = b.dataset.k; save(KT, x); go('teacher'); }));
    if (!cur) return;
    $$('.tabs button').forEach((b) => (b.onclick = () => { tab = b.dataset.tab; go('teacher'); }));
    ({ read: tRead, students: tStudents, records: tRecords, settings: tSettings }[tab] || tRead)(t, cur);
  }
  function monthBest(records) {
    const best = {};
    records.forEach((r) => { const k = `${r.roll}|${r.lang}|${monthKey(r.d)}`; if (better(r, best[k])) best[k] = r; });
    return best;
  }
  function tRead(t, cur) {
    const pane = $('#pane');
    if (!cur.students.length) { pane.innerHTML = '<div class="card"><p>Add students first in the <b>👥 Students</b> tab.</p></div>'; return; }
    const mk = monthKey(today());
    const doneNow = new Set(cur.records.filter((r) => monthKey(r.d) === mk).map((r) => r.roll));
    let sel = null;
    const ch = chooser(() => cur.cls, (lang, level) => {
      if (!sel) { $('#ce').textContent = 'Tap a student first.'; return; }
      const st = cur.students.find((x) => String(x.roll) === String(sel));
      go('read', { who: 'teacher', cls: cur.cls, lang, level, roll: st.roll, studentName: `${st.roll}. ${st.name}` });
    });
    pane.innerHTML = `<div class="card"><h3>1. Tap the student who will read</h3>
      <p class="muted" style="font-size:0.9rem">✔ = already read this month. If a child reads again, the best score of the month is kept.</p>
      <div class="stu-grid">${cur.students.map((s) => `<button data-r="${esc(s.roll)}"><span class="r">${esc(s.roll)}</span>${esc(s.name)}${doneNow.has(s.roll) ? '<span class="done">✔</span>' : ''}</button>`).join('')}</div></div>
      <div class="card"><h3>2. Language and level</h3>${ch.html}</div>`;
    ch.bind();
    $$('.stu-grid button').forEach((b) => (b.onclick = () => { sel = b.dataset.r; $$('.stu-grid button').forEach((x) => x.classList.toggle('on', x === b)); $('#ce').textContent = ''; }));
  }
  function tStudents(t, cur) {
    const pane = $('#pane');
    pane.innerHTML = `<div class="grid2">
      <div class="card"><h3>👥 Class ${esc(cur.cls)}-${esc(cur.sec)} students (${cur.students.length})</h3>
        <div class="tbl-wrap"><table class="t"><tr><th>Roll No</th><th class="l">Name</th><th>Readings</th><th></th></tr>
        ${cur.students.map((s, i) => `<tr><td>${esc(s.roll)}</td><td class="l">${esc(s.name)}</td><td>${cur.records.filter((r) => String(r.roll) === String(s.roll)).length}</td><td><button class="del" data-i="${i}" title="Remove">🗑</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted">No students yet</td></tr>'}
        </table></div></div>
      <div class="card"><h3>➕ Add a student</h3>
        <div class="row"><input class="in" id="roll" placeholder="Roll No" style="width:6rem" inputmode="numeric"><input class="in" id="name" placeholder="Name" style="flex:1;min-width:10rem"><button class="btn green" id="add">Add</button></div>
        <h3 style="margin-top:1.2rem">📋 Add many at once</h3>
        <p class="muted" style="font-size:0.9rem">One student per line: <b>Roll No, Name</b>. You can copy two columns from Excel and paste here.</p>
        <textarea class="in" id="bulk" rows="7" style="width:100%" placeholder="1, Aarav Sharma&#10;2, Diya Verma"></textarea>
        <button class="btn" id="addAll" style="margin-top:0.5rem">Add all</button>
        <p class="err-msg" id="e"></p></div></div>`;
    const put = (roll, name) => {
      roll = String(roll).trim(); name = String(name).trim();
      if (!roll || !name) return false;
      const x = T(), c = x.classes[x.cur], ex = c.students.find((s) => String(s.roll) === roll);
      if (ex) ex.name = name; else c.students.push({ roll, name });
      c.students.sort((a, b) => (parseInt(a.roll, 10) || 0) - (parseInt(b.roll, 10) || 0) || String(a.roll).localeCompare(String(b.roll)));
      save(KT, x); return true;
    };
    $('#add').onclick = () => { if (put($('#roll').value, $('#name').value)) go('teacher'); else $('#e').textContent = 'Write both Roll No and Name.'; };
    $('#name').onkeydown = (e) => { if (e.key === 'Enter') $('#add').click(); };
    $('#addAll').onclick = () => {
      let n = 0;
      $('#bulk').value.split(/\n/).forEach((line) => { const m = line.trim().match(/^(\S+?)[\s,;.\t)-]+(.+)$/); if (m && put(m[1], m[2])) n++; });
      if (n) { toast(`${n} students added`); go('teacher'); } else $('#e').textContent = 'Nothing added. Use the format: 1, Name';
    };
    $$('.del').forEach((b) => (b.onclick = () => {
      const x = T(), c = x.classes[x.cur], s = c.students[+b.dataset.i];
      if (!confirm(`Remove ${s.roll}. ${s.name}? Their readings will also be removed.`)) return;
      if (window.Voice) Voice.del(c.records.filter((r) => String(r.roll) === String(s.roll)).map((r) => r.aid));
      c.students.splice(+b.dataset.i, 1); c.records = c.records.filter((r) => String(r.roll) !== String(s.roll)); save(KT, x); go('teacher');
    }));
  }
  function tRecords(t, cur) {
    const pane = $('#pane');
    const langs = Object.keys(LANGS).filter((l) => cur.records.some((r) => r.lang === l));
    let lang = langs.includes(load('orf_rec_lang', 'en')) ? load('orf_rec_lang', 'en') : (langs[0] || 'en');
    const draw = () => {
      const recs = cur.records.filter((r) => r.lang === lang);
      const best = monthBest(recs);
      const months = [...new Set(recs.map((r) => monthKey(r.d)))].sort();
      pane.innerHTML = `<div class="card">
        <div class="row" style="justify-content:space-between">
          <div class="pills">${Object.entries(LANGS).map(([k, v]) => `<button class="pill ${k === lang ? 'on' : ''}" data-l="${k}">${v}</button>`).join('')}</div>
          <div class="row"><button class="btn green" id="xl">⬇ Download Excel</button></div>
        </div>
        <p class="muted" style="font-size:0.9rem;margin-top:0.6rem">Each month shows the child's <b>best</b> reading of that month. Speed = words correct per minute (WCPM).</p>
        ${!recs.length ? '<p>No readings in this language yet.</p>' : `<div class="tbl-wrap"><table class="t">
          <tr><th rowspan="2">Roll No</th><th rowspan="2" class="l">Name</th>${months.map((m) => `<th colspan="2">${monthLabel(m)}</th>`).join('')}</tr>
          <tr class="sub">${months.map(() => '<th>Speed (WCPM)</th><th>Accuracy %</th>').join('')}</tr>
          ${cur.students.map((s) => `<tr><td>${esc(s.roll)}</td><td class="l">${esc(s.name)}</td>${months.map((m) => { const b = best[`${s.roll}|${lang}|${m}`]; return b ? `<td><b>${b.wcpm}</b></td><td>${b.acc}%</td>` : '<td class="muted">–</td><td class="muted">–</td>'; }).join('')}</tr>`).join('')}
        </table></div>
        <h3 style="margin-top:1.2rem">All readings (${recs.length})</h3>
        <div class="tbl-wrap" style="max-height:24rem"><table class="t"><tr><th>Date</th><th>Roll</th><th class="l">Name</th><th>Level</th><th class="l">Chapter</th><th>Speed</th><th>Accuracy</th><th>Punctuation</th><th>🔊 Voice</th><th></th></tr>
          ${recs.map((r) => ({ r, i: cur.records.indexOf(r) })).reverse().map(({ r, i }) => `<tr><td>${fmtDate(r.d)}</td><td>${esc(r.roll)}</td><td class="l">${esc((cur.students.find((s) => String(s.roll) === String(r.roll)) || {}).name || '')}</td><td>${r.level}</td><td class="l">${esc(r.ch)}</td><td><b>${r.wcpm}</b></td><td>${r.acc}%</td><td>${PUNCT[r.punct] || ''}</td><td>${playCell(r)}</td><td><button class="del" data-i="${i}" title="Delete">🗑</button></td></tr>`).join('')}
        </table></div>`}
      </div>`;
      $$('.pills .pill[data-l]', pane).forEach((b) => (b.onclick = () => { lang = b.dataset.l; save('orf_rec_lang', lang); draw(); }));
      $('#xl').onclick = () => exportExcel(T(), T().classes[T().cur]);
      $$('.del', pane).forEach((b) => (b.onclick = () => {
        if (!confirm('Delete this reading?')) return;
        const x = T(), gone = x.classes[x.cur].records.splice(+b.dataset.i, 1)[0];
        if (gone && gone.aid && window.Voice) Voice.del(gone.aid);
        save(KT, x); cur = x.classes[x.cur]; draw();
      }));
      bindPlay(pane);
    };
    draw();
  }
  function tSettings(t) {
    const pane = $('#pane');
    pane.innerHTML = `<div class="grid2">
      <div class="card"><h3>🔑 Change password</h3>
        <label class="f">Current password<input class="in" type="password" id="p0"></label><br>
        <label class="f">New password<input class="in" type="password" id="p1"></label><br>
        <button class="btn" id="cp">Change</button><p class="err-msg" id="pe"></p>
        <p class="muted" style="font-size:0.85rem">Login name: <b>${esc(t.user)}</b></p></div>
      <div class="card"><h3>💾 Backup</h3>
        <p class="muted">Data lives only in this browser. Take a backup file regularly, and use it to move records to another computer.</p>
        <div class="row"><button class="btn green" id="bk">⬇ Download backup</button><label class="btn ghost" style="display:inline-block">⬆ Restore backup<input type="file" id="rs" accept=".json,application/json" hidden></label></div>
        <h3 style="margin-top:1.2rem">🗑 Delete this class</h3>
        <button class="btn red small" id="dc">Delete class ${esc(t.cur)} and its records</button></div>
      <div class="card"><h3>🎙️ Voice recordings</h3>
        <p class="muted">Each reading's voice (about 250 KB a minute) is kept only in this browser. The backup file has the scores, not the voices.</p>
        <p id="vu" class="muted">Checking…</p>
        <button class="btn red small" id="vclr">Delete all voice recordings</button></div></div>`;
    if (window.Voice) {
      Promise.all([Voice.keys(), Voice.usage()]).then(([k, u]) => { $('#vu').innerHTML = `Recordings saved: <b>${k.length}</b>${u.usage ? ` · space used: <b>${(u.usage / 1048576).toFixed(1)} MB</b>${u.quota ? ` of about ${Math.round(u.quota / 1073741824)} GB` : ''}` : ''}`; });
      $('#vclr').onclick = () => {
        if (!confirm('Delete ALL voice recordings in this browser (teacher and student)? Scores are kept.')) return;
        Voice.clear().then(() => { toast('Voice recordings deleted'); go('teacher'); });
      };
    } else $('#vclr').disabled = true;
    $('#cp').onclick = () => {
      const x = T();
      if ($('#p0').value !== x.pass) { $('#pe').textContent = 'Current password is wrong.'; return; }
      if ($('#p1').value.length < 4) { $('#pe').textContent = 'New password must have at least 4 characters.'; return; }
      x.pass = $('#p1').value; save(KT, x); toast('Password changed'); go('teacher');
    };
    $('#bk').onclick = () => {
      const blob = new Blob([JSON.stringify({ app: 'orf', v: 1, teacher: T() }, null, 1)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `ORF-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
    $('#rs').onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const d = JSON.parse(rd.result);
          if (d.app !== 'orf' || !d.teacher || !d.teacher.classes) throw new Error('bad');
          if (!confirm('Merge the backup into this browser? Students and readings will be added.')) return;
          const x = T();
          Object.entries(d.teacher.classes).forEach(([k, c]) => {
            const mine = x.classes[k] || (x.classes[k] = { cls: c.cls, sec: c.sec, students: [], records: [] });
            c.students.forEach((s) => { if (!mine.students.some((m) => String(m.roll) === String(s.roll))) mine.students.push(s); });
            const seen = new Set(mine.records.map((r) => r.roll + r.d));
            c.records.forEach((r) => { if (!seen.has(r.roll + r.d)) mine.records.push(r); });
          });
          if (!x.school) x.school = d.teacher.school || '';
          if (!x.cur) x.cur = d.teacher.cur;
          save(KT, x); toast('Backup restored'); go('teacher');
        } catch (err) { toast('⚠️ This is not an ORF backup file'); }
      };
      rd.readAsText(f);
    };
    $('#dc').onclick = () => {
      if (!confirm(`Delete class ${t.cur} with all its students and readings?`)) return;
      const x = T();
      if (window.Voice) Voice.del((x.classes[x.cur].records || []).map((r) => r.aid));
      delete x.classes[x.cur]; x.cur = Object.keys(x.classes)[0] || ''; save(KT, x); tab = 'read'; go('teacher');
    };
  }

  /* ---------- Excel ---------- */
  function exportExcel(t, cur) {
    if (!window.XLSX) { toast('⚠️ Excel library did not load'); return; }
    const wb = XLSX.utils.book_new();
    const name = (roll) => (cur.students.find((s) => String(s.roll) === String(roll)) || {}).name || '';
    let any = false;
    Object.keys(LANGS).forEach((lang) => {
      const recs = cur.records.filter((r) => r.lang === lang);
      if (!recs.length) return;
      any = true;
      const best = monthBest(recs);
      const months = [...new Set(recs.map((r) => monthKey(r.d)))].sort();
      const aoa = [
        ['Oral Reading Fluency (ORF) – Monthly Best Report'],
        ['School Name:', t.school || ''],
        ['Class:', +cur.cls, 'Section:', cur.sec, 'Language:', LANG_PLAIN[lang]],
        ['Downloaded on:', fmtDate(today())],
        [],
        ['Roll No', 'Name', ...months.flatMap((m) => [monthLabel(m), ''])],
        ['', '', ...months.flatMap(() => ['Speed (WCPM)', 'Accuracy (%)'])],
      ];
      cur.students.forEach((s) => {
        const row = [isNaN(+s.roll) ? s.roll : +s.roll, s.name];
        months.forEach((m) => { const b = best[`${s.roll}|${lang}|${m}`]; row.push(b ? b.wcpm : '', b ? b.acc : ''); });
        aoa.push(row);
      });
      aoa.push([], ['Speed (WCPM) = words read correctly in one minute. Accuracy (%) = correct words ÷ words read × 100. If a child read more than once in a month, the best score is shown.']);
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(5, 1 + months.length * 2) } }, { s: { r: 1, c: 1 }, e: { r: 1, c: Math.max(5, 1 + months.length * 2) } }, { s: { r: 5, c: 0 }, e: { r: 6, c: 0 } }, { s: { r: 5, c: 1 }, e: { r: 6, c: 1 } },
        ...months.map((_, i) => ({ s: { r: 5, c: 2 + i * 2 }, e: { r: 5, c: 3 + i * 2 } }))];
      ws['!cols'] = [{ wch: 13 }, { wch: 26 }, ...months.flatMap(() => [{ wch: 14 }, { wch: 13 }])];
      XLSX.utils.book_append_sheet(wb, ws, `${LANG_PLAIN[lang]} Monthly Best`);
    });
    if (!any) { toast('No readings to download yet'); return; }
    const all = [
      ['Oral Reading Fluency (ORF) – All Readings'],
      ['School Name:', t.school || ''],
      ['Class:', +cur.cls, 'Section:', cur.sec],
      [],
      ['Date', 'Month', 'Roll No', 'Name', 'Language', 'Level', 'Chapter', 'Speed (WCPM)', 'Accuracy (%)', 'Punctuation', 'Words read', 'Errors', 'Time (s)'],
      ...cur.records.slice().sort((a, b) => a.d.localeCompare(b.d) || (parseInt(a.roll, 10) || 0) - (parseInt(b.roll, 10) || 0)).map((r) => [fmtDate(r.d), monthLabel(monthKey(r.d)), isNaN(+r.roll) ? r.roll : +r.roll, name(r.roll), LANG_PLAIN[r.lang], r.level, r.ch, r.wcpm, r.acc, PUNCT[r.punct] || '', r.words, r.errors, r.secs]),
    ];
    const ws2 = XLSX.utils.aoa_to_sheet(all);
    ws2['!cols'] = [{ wch: 13 }, { wch: 10 }, { wch: 8 }, { wch: 24 }, { wch: 9 }, { wch: 8 }, { wch: 34 }, { wch: 13 }, { wch: 12 }, { wch: 15 }, { wch: 10 }, { wch: 7 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wb, ws2, 'All Readings');
    const safe = (s) => String(s).replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '');
    XLSX.writeFile(wb, `ORF_${safe(t.school || 'School')}_Class${cur.cls}-${safe(cur.sec)}.xlsx`);
  }

  window.ORFApp = { go, exportExcel, monthBest };
  go('home');
})();
