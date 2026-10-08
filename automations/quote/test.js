'use strict';
const assert = require('assert');
const C = require('./core.js');
const P = require('./presets.js');
const d = new Date('2026-10-08T10:00:00');
const ok = m => console.log('ok', m);

// הובלות: ברירות מחדל (חישוב ידני: 1500 + 2 קומות × 80 = 1660; מע״מ 18% = 299; סה״כ 1959)
let q = C.buildQuote(P.movers, {}, { date: d, seq: 7 });
assert.strictEqual(q.subtotal, 1660); assert.strictEqual(q.vat, 299); assert.strictEqual(q.total, 1959);
assert.strictEqual(q.number, 'HV-20261008-007');
assert.strictEqual(C.renderText(q).includes('1,959'), true);
ok('movers defaults');

// הובלות עם כל התוספות: 4 חדרים 1900 + מרחק (38-20)×4=72 + מדרגות מוצא 3×80=240 (ביעד יש מעלית) + אריזה חלקית 15%×1900=285 + פסנתר 500 + פירוק 3×150=450
q = C.buildQuote(P.movers, JSON.parse(require('fs').readFileSync(__dirname + '/samples/movers-input.json')), { date: d });
assert.strictEqual(q.subtotal, 1900 + 72 + 240 + 285 + 500 + 450);
assert.strictEqual(q.total, q.subtotal + Math.round(q.subtotal * 0.18));
ok('movers with extras');

// הנחה ובלי מע״מ
q = C.buildQuote(P.movers, {}, { date: d, discountPct: 10, includeVat: false });
assert.strictEqual(q.discount, 166); assert.strictEqual(q.total, 1660 - 166);
ok('discount, no VAT');

// תוקף
q = C.buildQuote(P.movers, {}, { date: d, validDays: 10 });
assert.strictEqual(q.validUntil.getDate(), 18);
ok('validity date');

// נרמול: ערכים מחוץ לטווח, טקסט במקום מספר, בחירה לא חוקית
q = C.buildQuote(P.movers, { rooms: 99, distance: 'abc', packing: 'weird', piano: -4 }, { date: d });
assert.strictEqual(q.inputs.rooms, 10); assert.strictEqual(q.inputs.distance, 15); assert.strictEqual(q.inputs.packing, 'none'); assert.strictEqual(q.inputs.piano, 0);
ok('input normalization');

// שיפוצים: 100 מ״ר צבע = 3800, ריצוף 20 מ״ר = 3600, 2 נק׳ חשמל = 440; סכום 7840 + בלת״מ 10% = 784 → 8624
q = C.buildQuote(P.reno, { paint: 100, tile: 20, electric: 2 }, { date: d });
assert.strictEqual(q.lines.find(l => l.label.startsWith('עתודה')).total, 784);
assert.strictEqual(q.subtotal, 8624);
assert.ok(q.meta[0].value.includes('ימי עבודה'));
ok('renovation + contingency');

// ניקיון: 40 מ״ר ניקיון רגיל = 240, מושלם למינימום 350 (השלמה 110), 4 חלונות = 60
q = C.buildQuote(P.cleaning, { kind: 'regular', area: 40, windows: 4 }, { date: d });
assert.strictEqual(q.subtotal, 350 + 60);
ok('cleaning minimum charge');

// אבטחה: קלט משתמש לא נכנס כ-HTML
q = C.buildQuote(P.movers, {}, { date: d, customer: { name: '<img src=x onerror=alert(1)>', phone: '"><script>' } });
const html = C.renderHTML(q, { name: '<b>עסק</b>', color: 'red;background:url(x)' });
assert.ok(!html.includes('<img src=x') && !html.includes('<script>') && !html.includes('<b>עסק</b>'));
assert.ok(!html.includes('red;background'));
assert.ok(html.includes('dir="rtl"') && html.includes('1,959'));
ok('HTML escaping + rtl');

// קישור וואטסאפ
assert.ok(C.waLink('050-123-4567', 'שלום').startsWith('https://wa.me/972501234567?text='));
ok('wa link');

// חיבור מתהליך השיחה של ההובלות
const lead = P.movers.fromLead({ 'מעלית': 'אין מעלית', 'מוצא': 'חדרה', 'יעד': 'פרדס חנה', 'מתי': 'תוך שבוע' });
assert.strictEqual(lead.inputs.elevFrom, false); assert.ok(lead.note.includes('חדרה'));
ok('lead → quote inputs');

console.log('\nall quote tests passed');
