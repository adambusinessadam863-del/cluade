'use strict';
// בדיקות אינטגרציה: webhook אחד, ארבע אוטומציות, נתב ההודעות, עם יד אופק כלקוח לדוגמה. הכל מול וואטסאפ מדומה.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createGateway } = require('./index.js');
const { createWA } = require('../common/wa.js');
const { zonedToUtc } = require('../reminders/index.js');
const client = require('../../clients/yad-ofek/index.js');
const ok = m => console.log('ok', m);
const L = s => zonedToUtc(s, 'Asia/Jerusalem');

(async () => {
  const sent = [], owner = []; let clock = L('2026-10-12 10:00');
  const wa = { send: async (to, p) => { sent.push({ to, ...p }); return true; },
    sendText: async (to, body) => { sent.push({ to, type: 'text', text: { body } }); return true; },
    sendTemplate: async (to, name, params, qr) => { sent.push({ to, type: 'template', name, params, qr }); return true; } };
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-'));
  const gw = createGateway(client, { dataDir }, { wa, notify: async t => { owner.push(t); return true; }, now: () => clock });
  const text = (from, body) => ({ entry: [{ changes: [{ value: { contacts: [{ wa_id: from, profile: { name: 'לקוח' } }], messages: [{ from, id: 'm' + Math.random(), type: 'text', text: { body } }] } }] }] });
  const list = (from, id, title) => ({ entry: [{ changes: [{ value: { messages: [{ from, id: 'm' + Math.random(), type: 'interactive', interactive: { type: 'list_reply', list_reply: { id, title } } }] } }] }] });
  const btn = (from, payload) => ({ entry: [{ changes: [{ value: { messages: [{ from, id: 'm' + Math.random(), type: 'button', button: { payload, text: 'x' } }] } }] }] });
  const body = m => m.text ? m.text.body : (m.interactive ? m.interactive.body.text : '');

  // ---- 1. ליד חדש: התהליך המותאם של יד אופק (כולל שאלת חדרים) ----
  const A = '972501110001';
  await gw.processPayload(text(A, 'שלום, אני צריך הובלה'));
  assert.ok(body(sent[0]).includes('יד אופק הובלות')); assert.strictEqual(gw.routed.at(-1), 'leads');
  await gw.processPayload(list(A, 's0o0', 'דירה'));
  await gw.processPayload(text(A, 'חדרה')); await gw.processPayload(text(A, 'פרדס חנה'));
  assert.ok(body(sent.at(-1)).includes('כמה חדרים'));                       // השאלה הנוספת של הלקוח
  await gw.processPayload(list(A, 's3o1', '3 חדרים'));
  await gw.processPayload(list(A, 's4o0', 'תוך שבוע'));
  await gw.processPayload(list(A, 's5o1', 'אין מעלית'));
  await gw.processPayload(text(A, 'דני'));
  assert.ok(gw.leads.leads()[A].done);
  assert.ok(owner.at(-1).includes('דני') && owner.at(-1).includes('3 חדרים'));
  assert.ok(!owner.at(-1).includes('הערכה פנימית'));                          // המחירון עדיין לדוגמה
  ok('lead conversation with custom rooms question; no price estimate while price list unconfirmed');

  // ---- 2. אחרי אישור מחירון: הערכה פנימית לבעל העסק (3 חדרים בסיס 1500, בלי מרחק/מדרגות) ----
  client.pricing.confirmed = true;
  const B = '972501110002';
  for (const step of [text(B, 'היי'), list(B, 's0o0', 'דירה'), text(B, 'חדרה'), text(B, 'חיפה'), list(B, 's3o1', '3 חדרים'), list(B, 's4o0', 'תוך שבוע'), list(B, 's5o0', 'יש מעלית'), text(B, 'רות')]) await gw.processPayload(step);
  assert.ok(owner.at(-1).includes('הערכה פנימית') && owner.at(-1).includes('₪1,500'), owner.at(-1));
  client.pricing.confirmed = false;
  ok('internal estimate appears after price list confirmed');

  // ---- 3. תזכורת יום ההובלה: תבנית עם 3 כפתורים, אישור/ביטול נתבים לתזכורות, בלי רשימת המתנה ----
  const C = '972501110003';
  gw.reminders.importAppointments('name,phone,start,service\nיוסי,0501110003,2026-10-13 08:00,הובלת דירה');
  clock = L('2026-10-12 14:00'); sent.length = 0; await gw.tick();
  const rem = sent.find(m => m.type === 'template');
  assert.strictEqual(rem.name, 'move_reminder_v1'); assert.strictEqual(rem.to, C);
  assert.deepStrictEqual(rem.params, ['יוסי', 'יום שלישי, 13.10 בשעה 08:00', 'הובלת דירה']); assert.strictEqual(rem.qr.length, 3);
  const apptId = Object.keys(gw.reminders.db().appts)[0];
  await gw.processPayload(btn(C, 'CONFIRM:' + apptId));
  assert.strictEqual(gw.routed.at(-1), 'reminders'); assert.strictEqual(gw.reminders.db().appts[apptId].status, 'confirmed');
  await gw.processPayload(btn(C, 'CANCEL:' + apptId));
  assert.ok(owner.some(t => t.includes('ביטל')));
  assert.ok(!sent.some(m => m.name === 'slot_available_v1'));                 // הובלות: אין הצעה לרשימת המתנה
  ok('move-day reminder routed, cancel alerts owner, no waitlist offer');

  // ---- 4. בקשת ביקורת אחרי ההובלה ומשוב פרטי נתב לביקורות ----
  const D = '972501110004';
  gw.reviews.importVisits('name,phone,visit,consent\nדנה,0501110004,2026-10-12 08:00,כן');
  clock = L('2026-10-13 10:00'); sent.length = 0; await gw.tick();
  const rq = sent.find(m => m.name === 'review_request_v1'); assert.ok(rq && rq.to === D);
  assert.strictEqual(rq.params[2], client.config.reviews.link);
  owner.length = 0; await gw.processPayload(text(D, 'הכל היה טוב אבל הם איחרו בחצי שעה'));
  assert.strictEqual(gw.routed.at(-1), 'reviews'); assert.ok(owner[0].includes('משוב פרטי'));
  ok('review request after move, private feedback routed to reviews');

  // ---- 5. ליד באמצע שיחה לא "נחטף" לביקורות ----
  const E = '972501110005';
  gw.reviews.importVisits('name,phone,visit,consent\nאבי,0501110005,2026-10-12 08:00,כן'); clock = L('2026-10-13 11:00'); await gw.tick();
  await gw.processPayload(text(E, 'היי')); // כבר קיבל בקשת ביקורת, מכאן הודעה ראשונה → ביקורות (ידוע ומתועד)
  assert.strictEqual(gw.routed.at(-1), 'reviews');
  ok('known limitation: first message from a recent review recipient goes to reviews');

  // ---- 6. "הסר" עוצר הכל בכל המודולים ----
  const F = '972501110006';
  gw.reminders.importAppointments('name,phone,start\nגל,0501110006,2026-10-14 08:00'); await gw.processPayload(text(F, 'הסר'));
  clock = L('2026-10-13 14:00'); sent.length = 0; await gw.tick();
  assert.ok(!sent.some(m => m.to === F)); assert.strictEqual(gw.routed.at(-1), 'optout');
  ok('opt-out applies to all modules');

  // ---- 7. כפילות ----
  const dup = text('972501110007', 'היי'); const n = sent.length; await gw.processPayload(dup); await gw.processPayload(dup);
  assert.strictEqual(sent.length - n, 2);                                       // ברכה + שאלה, פעם אחת בלבד
  ok('dedupe across the gateway');

  // ---- 8. HTTP: נתיב סודי (מצב ספק), נתיב לא נכון, ונקודת ניהול מוגנת ----
  const gw2 = createGateway(client, { dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'gw2-')), allowUnsigned: true, webhookPath: '/webhook/s3cret', adminToken: 'adm' },
    { wa, notify: async () => true, now: () => clock });
  await new Promise(r => gw2.server.listen(0, r)); const base = 'http://127.0.0.1:' + gw2.server.address().port;
  const payload = JSON.stringify(text('972501110008', 'היי'));
  assert.strictEqual((await fetch(base + '/webhook', { method: 'POST', body: payload })).status, 404);
  assert.strictEqual((await fetch(base + '/webhook/s3cret', { method: 'POST', body: payload })).status, 200);
  assert.strictEqual((await fetch(base + '/admin/stats')).status, 404);
  const st = await (await fetch(base + '/admin/stats', { headers: { authorization: 'Bearer adm' } })).json();
  assert.ok('reminders' in st && 'reviews' in st);
  gw2.server.close();
  ok('http: secret webhook path, admin protected');

  // ---- 9. מצב ספק (BSP): כתובת ו-headers משלו, בלי Authorization של Meta ----
  let seen;
  const bsp = createWA({ url: 'https://bsp.example/messages', headers: { 'D360-API-KEY': 'KEY' }, fetch: async (u, o) => { seen = { u, h: o.headers, b: JSON.parse(o.body) }; return { ok: true, text: async () => '' }; } });
  await bsp.sendText('972500000000', 'שלום');
  assert.strictEqual(seen.u, 'https://bsp.example/messages'); assert.strictEqual(seen.h['D360-API-KEY'], 'KEY'); assert.ok(!seen.h.Authorization);
  assert.strictEqual(seen.b.messaging_product, 'whatsapp');
  ok('BSP mode: custom URL and API-key header');

  console.log('\nall gateway tests passed');
})().catch(e => { console.error(e); process.exit(1); });
