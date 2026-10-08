// מנוע הצעות מחיר: אותו קוד רץ בדפדפן (כלי ווב) וב-Node (בדיקות, שורת פקודה).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QuoteCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => '₪' + Math.round(n).toLocaleString('en-US');
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const ymd = d => d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
  const dmy = d => pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear();

  // מנרמל קלט לפי הגדרות השדות של התבנית (טווחים, ברירות מחדל, אפשרויות)
  function normalizeInputs(preset, raw = {}) {
    const out = {};
    for (const f of preset.fields) {
      let v = raw[f.id];
      if (f.type === 'number') {
        v = Number(v); if (!Number.isFinite(v)) v = f.default ?? 0;
        v = Math.min(f.max ?? Infinity, Math.max(f.min ?? 0, v));
      } else if (f.type === 'bool') {
        v = v === undefined ? !!f.default : (v === true || v === 'true' || v === 1 || v === '1' || v === 'on');
      } else if (f.type === 'select') {
        v = f.options.some(o => o.v === v) ? v : (f.default ?? f.options[0].v);
      } else v = v == null ? '' : String(v).slice(0, 500);
      out[f.id] = v;
    }
    return out;
  }

  function buildQuote(preset, rawInputs, opts = {}) {
    const inputs = normalizeInputs(preset, rawInputs);
    const vatRate = opts.vatRate ?? 0.18; // בדקו את שיעור המע״מ הנוכחי
    const includeVat = opts.includeVat !== false;
    const date = opts.date || new Date();
    const lines = preset.lines(inputs)
      .map(l => ({ ...l, total: Math.round(l.qty * l.unitPrice) }))
      .filter(l => l.qty > 0 && l.total !== 0);
    const subtotal = lines.reduce((s, l) => s + l.total, 0);
    const discountPct = Math.min(100, Math.max(0, opts.discountPct || 0));
    const discount = Math.round(subtotal * discountPct / 100);
    const net = subtotal - discount;
    const vat = includeVat ? Math.round(net * vatRate) : 0;
    const valid = new Date(date.getTime()); valid.setDate(valid.getDate() + (opts.validDays ?? 7));
    return {
      number: `${preset.prefix || 'Q'}-${ymd(date)}-${pad(opts.seq || 1, 3)}`,
      date, validUntil: valid, preset: preset.id, title: preset.title,
      summary: preset.summary ? preset.summary(inputs) : preset.title,
      inputs, lines, subtotal, discountPct, discount, net, vatRate, includeVat, vat, total: net + vat,
      meta: preset.meta ? preset.meta(inputs, lines) : [],
      terms: opts.terms || preset.terms || [],
      customer: opts.customer || {}
    };
  }

  const CSS = `
  .q{--c:#0f766e;font:15px/1.55 system-ui,"Segoe UI",Arial,sans-serif;color:#1c1b19;background:#fff;max-width:760px;margin:0 auto;padding:0;direction:rtl}
  .q *{box-sizing:border-box}
  .q-head{background:var(--c);color:#fff;padding:22px 26px;display:flex;justify-content:space-between;gap:16px;align-items:center;border-radius:12px 12px 0 0}
  .q-brand{display:flex;gap:12px;align-items:center}
  .q-logo{width:46px;height:46px;border-radius:12px;background:rgba(255,255,255,.2);display:grid;place-items:center;font-weight:800;font-size:1.3rem}
  .q-brand b{font-size:1.25rem;display:block}.q-brand small{opacity:.85}
  .q-ref{text-align:left;direction:ltr;font-size:.82rem;opacity:.95;line-height:1.5}
  .q-body{padding:22px 26px;border:1px solid #e3ded5;border-top:0;border-radius:0 0 12px 12px}
  .q h2{margin:0 0 4px;font-size:1.2rem}
  .q-sum{color:#5d5951;margin:0 0 14px}
  .q-cust{background:#f6f4ef;border-radius:10px;padding:10px 14px;margin-bottom:16px;font-size:.92rem}
  .q table{width:100%;border-collapse:collapse;margin:6px 0 10px}
  .q th{background:#f6f4ef;text-align:right;font-size:.82rem;color:#5d5951;padding:8px 10px}
  .q td{padding:9px 10px;border-bottom:1px solid #eee9e0;vertical-align:top}
  .q td.n,.q th.n{text-align:left;white-space:nowrap;direction:ltr}
  .q td small{display:block;color:#7a756b}
  .q-tot{margin-inline-start:auto;width:min(320px,100%)}
  .q-tot div{display:flex;justify-content:space-between;padding:4px 0}
  .q-tot .g{border-top:2px solid var(--c);margin-top:6px;padding-top:8px;font-size:1.25rem;font-weight:800;color:var(--c)}
  .q-meta{margin:14px 0 0;color:#5d5951;font-size:.9rem}
  .q-terms{margin:16px 0 0;padding:12px 16px 12px 0;background:#faf8f4;border-radius:10px;font-size:.85rem;color:#5d5951}
  .q-terms li{margin:3px 0}
  .q-ok{margin-top:18px;border:2px dashed var(--c);border-radius:12px;padding:14px 16px;font-size:.95rem}
  .q-ok b{color:var(--c)}
  @media print{body{background:#fff!important}.q-head{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  `;

  function renderBody(q, biz = {}) {
    const color = /^#[0-9a-fA-F]{6}$/.test(biz.color || '') ? biz.color : '#0f766e';
    const rows = q.lines.map(l => `<tr><td>${esc(l.label)}${l.note ? `<small>${esc(l.note)}</small>` : ''}</td>
      <td class="n">${esc(l.qty)}${l.unit ? ' ' + esc(l.unit) : ''}</td><td class="n">${money(l.unitPrice)}</td><td class="n">${money(l.total)}</td></tr>`).join('');
    const c = q.customer || {};
    return `<div class="q" style="--c:${color}">
    <div class="q-head"><div class="q-brand"><div class="q-logo">${esc((biz.name || 'ע').trim().charAt(0))}</div>
      <div><b>${esc(biz.name || 'שם העסק')}</b><small>${esc([biz.phone, biz.license && 'ע.מ/ח.פ ' + biz.license].filter(Boolean).join(' · '))}</small></div></div>
      <div class="q-ref">הצעת מחיר ${esc(q.number)}<br>${dmy(q.date)}<br>בתוקף עד ${dmy(q.validUntil)}</div></div>
    <div class="q-body">
      <h2>${esc(q.title)}</h2><p class="q-sum">${esc(q.summary)}</p>
      ${c.name || c.phone ? `<div class="q-cust">עבור: <b>${esc(c.name || '')}</b> ${esc(c.phone || '')}</div>` : ''}
      <table><thead><tr><th>פירוט</th><th class="n">כמות</th><th class="n">מחיר יחידה</th><th class="n">סה״כ</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="q-tot"><div><span>סכום ביניים</span><span>${money(q.subtotal)}</span></div>
        ${q.discount ? `<div><span>הנחה (${q.discountPct}%)</span><span>-${money(q.discount)}</span></div>` : ''}
        ${q.includeVat ? `<div><span>מע״מ (${Math.round(q.vatRate * 100)}%)</span><span>${money(q.vat)}</span></div>` : '<div><span>המחירים ללא מע״מ</span><span></span></div>'}
        <div class="g"><span>סה״כ לתשלום</span><span>${money(q.total)}</span></div></div>
      ${q.meta.length ? `<p class="q-meta">${q.meta.map(m => `${esc(m.label)}: <b>${esc(m.value)}</b>`).join(' · ')}</p>` : ''}
      ${q.terms.length ? `<ul class="q-terms">${q.terms.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
      <div class="q-ok"><b>לאישור ההצעה</b> השיבו "מאשר/ת" בוואטסאפ${biz.phone ? ` למספר ${esc(biz.phone)}` : ''}, ונקבע מועד.</div>
    </div></div>`;
  }

  function renderHTML(q, biz) {
    return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>הצעת מחיר ${esc(q.number)}</title><style>body{margin:0;padding:24px 12px;background:#efece5}${CSS}@page{size:A4;margin:12mm}@media print{body{padding:0}}</style></head><body>${renderBody(q, biz)}</body></html>`;
  }

  function renderText(q, biz = {}) {
    const L = [`*הצעת מחיר ${q.number}* – ${biz.name || ''}`.trim(), q.summary, ''];
    q.lines.forEach(l => L.push(`• ${l.label}: ${money(l.total)}`));
    if (q.discount) L.push(`הנחה ${q.discountPct}%: -${money(q.discount)}`);
    L.push('', q.includeVat ? `*סה״כ כולל מע״מ: ${money(q.total)}*` : `*סה״כ (ללא מע״מ): ${money(q.total)}*`);
    L.push(`בתוקף עד ${dmy(q.validUntil)}`, 'לאישור, השיבו "מאשר/ת" ונקבע מועד.');
    return L.join('\n');
  }

  function waLink(phone, text) {
    const d = String(phone || '').replace(/\D/g, '').replace(/^0/, '972');
    return `https://wa.me/${d}?text=${encodeURIComponent(text)}`;
  }

  return { buildQuote, normalizeInputs, renderHTML, renderBody, renderText, waLink, money, esc, CSS };
});
