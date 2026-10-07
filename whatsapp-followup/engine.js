(function () {
  const $ = id => document.getElementById(id);
  const START = 21 * 60 + 7; // השיחה מתחילה ב-21:07, מחוץ לשעות העבודה

  const P = (typeof PROSPECTS !== 'undefined' ? PROSPECTS : {})[new URLSearchParams(location.search).get('b')];
  let flowKey = P ? P.flow : 'driving', st;

  const fmt = m => {
    const t = ((m % 1440) + 1440) % 1440;
    return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
  };
  const biz = () => $('biz').value.trim() || FLOWS[flowKey].defaultBiz;
  const fill = (s, extra) => s.replace(/\{(\w+)\}/g, (_, k) =>
    k === 'biz' ? biz() : (extra && k in extra ? extra[k] : ''));

  function reset() {
    st = { step: -1, clock: START, answers: {}, score: 0, name: '', done: false, optedOut: false,
           fuIdx: 0, msgs: [], ownerMsgs: [], waiting: false };
    $('chat').textContent = '';
    $('owner').textContent = '';
    bot(fill(FLOWS[flowKey].greeting), 1);
    st.ownerMsgs.push({ t: st.clock, text: '🔔 פנייה חדשה בוואטסאפ. העוזר כבר ענה ללקוח.' });
    const cur = st;
    renderOwner();
    typing(true);
    setTimeout(() => { if (cur !== st) return; typing(false); nextStep(); }, 900);
  }

  function typing(on) {
    let t = $('typing');
    if (!on) { if (t) t.remove(); return; }
    if (t) return;
    t = document.createElement('div'); t.id = 'typing'; t.className = 'msg bot typing';
    for (let i = 0; i < 3; i++) t.append(document.createElement('i'));
    $('chat').append(t); $('chat').scrollTop = $('chat').scrollHeight;
  }

  function addBubble(from, text, t) {
    const d = document.createElement('div');
    d.className = 'msg ' + from;
    const p = document.createElement('div'); p.textContent = text;
    const time = document.createElement('span'); time.className = 'time'; time.textContent = fmt(t);
    d.append(p, time);
    $('chat').append(d);
    $('chat').scrollTop = $('chat').scrollHeight;
  }
  function system(text) {
    const d = document.createElement('div'); d.className = 'sys'; d.textContent = text;
    $('chat').append(d); $('chat').scrollTop = $('chat').scrollHeight;
  }
  function bot(text, delayMin) {
    st.clock += delayMin || 0;
    addBubble('bot', text, st.clock);
  }
  function user(text) { st.clock += 1; addBubble('user', text, st.clock); }

  function summary() {
    return Object.entries(st.answers).filter(([k]) => k !== 'שם').map(([k, v]) => '• ' + k + ': ' + v).join('\n');
  }

  function nextStep() {
    const f = FLOWS[flowKey];
    st.step++;
    if (st.step >= f.steps.length) return finish();
    const s = f.steps[st.step];
    bot(s.ask, 0);
    renderInput();
  }

  function renderInput() {
    const box = $('input'); box.textContent = '';
    const f = FLOWS[flowKey];
    if (st.done || st.optedOut) { renderTime(); return; }
    const s = f.steps[st.step];
    if (!s) { renderTime(); return; }
    if (s.type === 'choice') {
      s.options.forEach(o => {
        const b = document.createElement('button'); b.className = 'opt'; b.textContent = o.label;
        b.onclick = () => answer(o.label, o);
        box.append(b);
      });
    } else {
      const inp = document.createElement('input'); inp.placeholder = s.placeholder || '';
      const go = document.createElement('button'); go.textContent = 'שלח';
      const send = () => { if (inp.value.trim()) answer(inp.value.trim()); };
      go.onclick = send; inp.onkeydown = e => { if (e.key === 'Enter') send(); };
      box.append(inp, go); inp.focus();
    }
    renderTime();
  }

  function answer(text, opt) {
    if (/^הסר$/.test(text.trim())) return optOut(text);
    const f = FLOWS[flowKey], s = f.steps[st.step];
    user(text);
    st.answers[s.key] = text;
    if (s.isName) st.name = text;
    if (opt) st.score += opt.score || 0;
    st.fuIdx = 0; // הלקוח ענה: מאפסים את רצף המעקב
    const cur = st;
    $('input').textContent = ''; $('timebar').textContent = '';
    renderOwner();
    typing(true);
    setTimeout(() => {
      if (cur !== st) return;
      typing(false);
      if (opt && opt.reply) bot(opt.reply, 0);
      nextStep();
    }, 750);
  }

  function optOut(text) {
    user(text);
    st.optedOut = true;
    bot('הוסרת מהרשימה ✅ לא נשלח לך עוד הודעות. תודה!', 0);
    system('ההסרה נרשמה. המערכת מפסיקה לשלוח הודעות לאיש הקשר הזה.');
    renderOwner(); renderInput();
  }

  function finish() {
    st.done = true;
    const f = FLOWS[flowKey];
    bot(fill(f.handoff, { name: st.name || '', summary: summary() }), 1);
    system('✅ הליד הועבר לבעל העסק, עם סיכום מלא');
    st.ownerMsgs.push({ t: st.clock, text: '🔔 ליד חדש מהוואטסאפ. הכרטיס למעלה. אם לא עונים תוך שעתיים תישלח תזכורת.' });
    renderOwner(); renderInput();
  }

  function renderOwner() {
    const o = $('owner'); o.textContent = '';
    const f = FLOWS[flowKey];
    const card = document.createElement('div'); card.className = 'card';
    const h = document.createElement('h3');
    const hot = st.score >= f.hotAt;
    h.textContent = st.done ? (hot ? '🔥 ליד חם' : '🟡 ליד בינוני') : (st.optedOut ? '⛔ הוסר' : '⏳ בשיחה...');
    card.append(h);
    const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = st.name || 'לא ידוע עדיין';
    card.append(nm);
    Object.entries(st.answers).forEach(([k, v]) => {
      if (k === 'שם') return;
      const r = document.createElement('div'); r.className = 'kv';
      const a = document.createElement('b'); a.textContent = k + ': ';
      const b = document.createElement('span'); b.textContent = v;
      r.append(a, b); card.append(r);
    });
    if (st.done) {
      const acts = document.createElement('div'); acts.className = 'acts';
      ['📞 חיוג ללקוח', '💬 פתח שיחה'].forEach(x => { const a = document.createElement('span'); a.textContent = x; acts.append(a); });
      card.append(acts);
    }
    o.append(card);
    st.ownerMsgs.forEach(m => {
      const d = document.createElement('div'); d.className = 'ownermsg';
      d.textContent = fmt(m.t) + ' · ' + m.text; o.append(d);
    });
  }

  function renderTime() {
    const t = $('timebar'); t.textContent = '';
    if (st.optedOut) return;
    const f = FLOWS[flowKey];
    if (!st.done && st.fuIdx < f.followups.length) {
      const fu = f.followups[st.fuIdx];
      const b = document.createElement('button'); b.className = 'skip';
      b.textContent = '⏩ הלקוח נעלם – דלג ' + fu.label;
      b.onclick = () => {
        st.clock += fu.after - (st.fuIdx ? f.followups[st.fuIdx - 1].after : 0);
        system('עברו ' + fu.label + ' בלי תגובה');
        bot(fu.text, 0); st.fuIdx++;
        if (st.fuIdx >= f.followups.length) system('זו ההודעה האחרונה. אחרי 3 ניסיונות המערכת מפסיקה ולא מציקה.');
        renderOwner(); renderTime();
      };
      t.append(b);
    }
    if (st.done && !st.reminded) {
      const b = document.createElement('button'); b.className = 'skip';
      b.textContent = '⏩ בעל העסק לא ענה – דלג שעתיים';
      b.onclick = () => {
        st.reminded = true; st.clock += 120;
        st.ownerMsgs.push({ t: st.clock, text: '⏰ תזכורת: הליד של ' + (st.name || 'הלקוח') + ' עדיין ממתין לחזרה.' });
        renderOwner(); renderTime();
      };
      t.append(b);
    }
  }

  function buildTabs() {
    const tabs = $('tabs');
    Object.entries(FLOWS).forEach(([k, f]) => {
      const b = document.createElement('button'); b.textContent = f.tab; b.dataset.k = k;
      b.onclick = () => { flowKey = k; $('biz').value = ''; $('biz').placeholder = f.defaultBiz; mark(); reset(); };
      tabs.append(b);
    });
    mark();
  }
  function mark() { [...$('tabs').children].forEach(b => b.classList.toggle('on', b.dataset.k === flowKey)); }

  if (!P) buildTabs(); else $('biz').value = P.name;
  $('biz').placeholder = FLOWS[flowKey].defaultBiz;
  $('restart').onclick = reset;
  let bizTimer;
  $('biz').oninput = () => {
    clearTimeout(bizTimer);
    // מחליפים את שם העסק מחדש רק אם הלקוח עוד לא ענה; אחרת השם החדש יופיע בהודעות הבאות
    bizTimer = setTimeout(() => { if (!Object.keys(st.answers).length) reset(); }, 600);
  };
  reset();
})();
