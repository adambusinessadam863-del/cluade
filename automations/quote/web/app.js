(function () {
  const $ = id => document.getElementById(id);
  const st = document.createElement('style'); st.textContent = QuoteCore.CSS; document.head.append(st); // עיצוב ההצעה עצמה
  const presets = Object.values(QuotePresets);
  let preset = presets[0], values = {};
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* מצב פרטי: ממשיכים בלי שמירה */ } }
  };
  const settings = store.get('quote.settings', {});
  ['bizName', 'bizPhone', 'bizColor', 'custName', 'custPhone', 'discount', 'valid'].forEach(id => { if (settings[id] != null) $(id).value = settings[id]; });
  if (settings.vat === false) $('vat').checked = false;
  let seq = store.get('quote.seq', 1);

  function buildFields() {
    const box = $('fields'); box.textContent = '';
    values = {};
    preset.fields.forEach(f => {
      const lab = document.createElement('label'); lab.className = 'f' + (f.type === 'bool' ? ' check' : '');
      const t = document.createElement('span'); t.textContent = f.label;
      let el;
      if (f.type === 'select') {
        el = document.createElement('select');
        f.options.forEach(o => { const op = document.createElement('option'); op.value = o.v; op.textContent = o.label; el.append(op); });
        el.value = f.default ?? f.options[0].v;
      } else if (f.type === 'bool') { el = document.createElement('input'); el.type = 'checkbox'; el.checked = !!f.default; }
      else { el = document.createElement('input'); el.type = 'number'; el.inputMode = 'numeric'; el.min = f.min; el.max = f.max; el.value = f.default ?? 0; }
      el.addEventListener('input', render);
      if (f.type === 'bool') lab.append(el, t); else lab.append(t, el);
      lab.dataset.id = f.id; box.append(lab); values[f.id] = el;
    });
  }

  function readInputs() {
    const o = {};
    preset.fields.forEach(f => { const el = values[f.id]; o[f.id] = f.type === 'bool' ? el.checked : el.value; });
    return o;
  }
  const biz = () => ({ name: $('bizName').value, phone: $('bizPhone').value, color: $('bizColor').value });
  const quote = () => QuoteCore.buildQuote(preset, readInputs(), {
    includeVat: $('vat').checked, discountPct: Number($('discount').value) || 0, validDays: Number($('valid').value) || 7, seq,
    customer: { name: $('custName').value, phone: $('custPhone').value }
  });

  function render() {
    const q = quote();
    $('preview').innerHTML = QuoteCore.renderBody(q, biz()); // רינדור מוסלק ב-core (esc על כל ערך שהוזן)
    $('total').textContent = QuoteCore.money(q.total);
    store.set('quote.settings', { bizName: $('bizName').value, bizPhone: $('bizPhone').value, bizColor: $('bizColor').value, custName: $('custName').value, custPhone: $('custPhone').value, discount: $('discount').value, valid: $('valid').value, vat: $('vat').checked });
    return q;
  }
  const bump = () => { seq += 1; store.set('quote.seq', seq); render(); };

  presets.forEach(p => {
    const b = document.createElement('button'); b.textContent = p.tab; b.dataset.id = p.id;
    b.onclick = () => { preset = p; [...$('tabs').children].forEach(x => x.classList.toggle('on', x === b)); buildFields(); render(); };
    $('tabs').append(b);
  });
  $('tabs').firstChild.classList.add('on');
  ['bizName', 'bizPhone', 'bizColor', 'custName', 'custPhone', 'discount', 'valid', 'vat'].forEach(id => $(id).addEventListener('input', render));

  $('wa').onclick = () => { const q = render(); window.open(QuoteCore.waLink($('custPhone').value, QuoteCore.renderText(q, biz())), '_blank', 'noopener'); bump(); };
  $('print').onclick = () => { render(); window.print(); bump(); };
  $('copy').onclick = async () => {
    const text = QuoteCore.renderText(render(), biz());
    try { await navigator.clipboard.writeText(text); $('copy').textContent = 'הועתק ✓'; } catch { prompt('העתיקו את הטקסט:', text); }
    setTimeout(() => ($('copy').textContent = 'העתק טקסט'), 1500); bump();
  };

  buildFields(); render();
})();
