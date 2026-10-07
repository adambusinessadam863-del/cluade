'use strict';
// בדיקות מקצה לקצה מול Graph API מדומה (ללא רשת). הרצה: node test.js
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('./server.js');
const { createClassifier } = require('./ai.js');

const sent = [], telegram = [];
let clock = 1_700_000_000_000;
const fakeFetch = async (url, opts) => {
  const body = JSON.parse(opts.body);
  (url.includes('tg.test') ? telegram : sent).push(body);
  return { ok: true, status: 200, text: async () => '' };
};
const cfg = (over = {}) => ({
  port: 0, verifyToken: 'vt', appSecret: 'sec', token: 't', phoneId: '123', graphBase: 'https://g.test', graphVersion: 'v1',
  bizName: 'רעות – בית הספר לנהיגה', flow: 'driving', dataFile: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wa-')), 'l.json'),
  telegramToken: 'tg', telegramChat: '9', telegramBase: 'https://tg.test', templates: [null, 'followup_day', 'followup_last'],
  ownerReminderMin: 0, adminToken: '', allowUnsigned: false, ...over
});
let mid = 0;
const text = (from, body) => ({ entry: [{ changes: [{ value: { contacts: [{ wa_id: from, profile: { name: 'נועה' } }], messages: [{ from, id: 'm' + ++mid, type: 'text', text: { body } }] } }] }] });
const reply = (from, id, title, kind = 'list_reply') => ({ entry: [{ changes: [{ value: { messages: [{ from, id: 'm' + ++mid, type: 'interactive', interactive: { type: kind, [kind]: { id, title } } }] } }] }] });
const last = () => sent[sent.length - 1];
const bodyOf = m => m.text ? m.text.body : m.interactive.body.text;

(async () => {
  const mk = (over, io) => createApp(cfg(over), { fetch: fakeFetch, now: () => clock, ...io });

  // 1. אימות webhook וחתימה, דרך שרת HTTP אמיתי
  const app = mk();
  await new Promise(r => app.server.listen(0, r));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  assert.strictEqual(await (await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=777`)).text(), '777');
  assert.strictEqual((await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=bad&hub.challenge=1`)).status, 403);
  const raw = JSON.stringify(text('972500000001', 'היי'));
  assert.strictEqual((await fetch(base + '/webhook', { method: 'POST', body: raw })).status, 401);
  const sig = 'sha256=' + crypto.createHmac('sha256', 'sec').update(raw).digest('hex');
  assert.strictEqual((await fetch(base + '/webhook', { method: 'POST', body: raw, headers: { 'x-hub-signature-256': sig } })).status, 200);
  await new Promise(r => setTimeout(r, 100));
  assert.ok(sent.some(m => m.to === '972500000001' && m.type === 'text'), 'greeting sent after signed webhook');
  app.server.close();
  console.log('ok webhook verify + signature');

  // 2. שיחה מלאה בנהיגה
  sent.length = 0; telegram.length = 0;
  const a = mk(); const U = '972500000002';
  await a.processPayload(text(U, 'שלום'));
  assert.strictEqual(sent.length, 2); // ברכה + שאלה ראשונה
  assert.ok(bodyOf(sent[0]).includes('רעות – בית הספר לנהיגה'));
  assert.strictEqual(last().interactive.type, 'list'); // 5 אפשרויות -> רשימה
  assert.ok(last().interactive.action.sections[0].rows.every(r => r.title.length <= 24));
  await a.processPayload(reply(U, 's0o2', 'תרגול לקראת טסט'));
  assert.ok(sent.some(m => m.text && m.text.body.includes('קרובים לטסט'))); // reply של האפשרות
  await a.processPayload(text(U, 'מודיעין'));
  await a.processPayload(reply(U, 's2o0', 'השבוע'));
  assert.strictEqual(last().interactive.type, 'button'); // שאלת תיבת הילוכים: 3 אפשרויות קצרות -> כפתורים
  await a.processPayload(reply(U, 's3o0', 'אוטומט', 'button_reply'));
  await a.processPayload(text(U, 'נועה'));
  const lead = a.leads()[U];
  assert.ok(lead.done && lead.score >= 5 && lead.answers['אזור'] === 'מודיעין');
  assert.ok(bodyOf(last()).includes('• אזור: מודיעין'));
  assert.ok(telegram.length === 1 && telegram[0].text.includes('🔥') && telegram[0].text.includes('+' + U));
  console.log('ok full driving conversation + owner alert');

  // 3. כפילות הודעה (Meta שולחת שוב)
  const dup = text(U, 'תודה'); const before = sent.length;
  await a.processPayload(dup); await a.processPayload(dup);
  assert.strictEqual(sent.length - before, 1);
  console.log('ok dedupe');

  // 4. טקסט חופשי בשאלה סגורה: בלי AI -> שאלה חוזרת, פעמיים -> ממשיכים
  sent.length = 0;
  const b = mk(); const V = '972500000003';
  await b.processPayload(text(V, 'היי'));
  await b.processPayload(text(V, 'בלה בלה'));
  assert.ok(bodyOf(last()).startsWith('לא הצלחתי להבין'));
  await b.processPayload(text(V, 'עוד משהו'));
  assert.strictEqual(b.leads()[V].answers['מה מחפשים'].startsWith('אחר:'), true);
  assert.strictEqual(b.leads()[V].step, 1);
  console.log('ok fallback without AI');

  // 5. עם שכבת Claude (מדומה)
  sent.length = 0;
  const c = mk({}, { classify: async (t, step) => (t.includes('טסט') ? 2 : null) });
  const W = '972500000004';
  await c.processPayload(text(W, 'היי'));
  await c.processPayload(text(W, 'יש לי טסט בשבוע הבא'));
  assert.strictEqual(c.leads()[W].answers['מה מחפשים'], 'תרגול לקראת טסט');
  console.log('ok AI mapping');

  // 6. מעקבים: חלון 24 שעות ותבניות
  sent.length = 0;
  const d = mk(); const X = '972500000005';
  await d.processPayload(text(X, 'היי')); sent.length = 0;
  clock += 30 * 60000; await d.tick(); assert.strictEqual(sent.length, 0);
  clock += 31 * 60000; await d.tick();
  assert.strictEqual(sent.length, 1); assert.strictEqual(sent[0].type, 'text');
  clock += 24 * 3600000; await d.tick();
  assert.strictEqual(sent[1].type, 'template'); assert.strictEqual(sent[1].template.name, 'followup_day');
  clock += 49 * 3600000; await d.tick();
  assert.strictEqual(sent[2].template.name, 'followup_last');
  clock += 100 * 3600000; await d.tick(); assert.strictEqual(sent.length, 3); // אחרי 3 הודעות עוצרים
  console.log('ok follow-up schedule (text inside 24h, templates after, max 3)');

  // 7. הסרה
  sent.length = 0;
  const e = mk(); const Y = '972500000006';
  await e.processPayload(text(Y, 'היי')); await e.processPayload(text(Y, 'הסר'));
  assert.ok(bodyOf(last()).includes('הוסרת')); sent.length = 0;
  clock += 200 * 3600000; await e.tick(); await e.processPayload(text(Y, 'עוד הודעה'));
  assert.strictEqual(sent.length, 0);
  console.log('ok opt-out');

  // 8. כותרת מקוצרת מרשימה, מזהה ישן מתעלמים, ותזכורת לבעל העסק
  telegram.length = 0;
  const f = mk({ ownerReminderMin: 120 }); const Z = '972500000007';
  await f.processPayload(text(Z, 'היי'));
  await f.processPayload(reply(Z, 's0o0', 'רישיון חדש – מתחילים מ…')); // כותרת קצרה כפי ש-WhatsApp מחזירה
  assert.strictEqual(f.leads()[Z].answers['מה מחפשים'], 'רישיון חדש – מתחילים מאפס');
  await f.processPayload(reply(Z, 's0o3', 'תאוריה')); // מזהה של שלב קודם: נחשב טקסט חופשי בשאלת האזור
  assert.strictEqual(f.leads()[Z].step, 2);
  await f.processPayload(reply(Z, 's2o1', 'בשבועיים הקרובים'));
  await f.processPayload(reply(Z, 's3o0', 'אוטומט', 'button_reply'));
  await f.processPayload(text(Z, 'דני'));
  assert.ok(f.leads()[Z].done);
  clock += 121 * 60000; await f.tick();
  assert.ok(telegram.some(m => m.text.includes('⏰')));
  console.log('ok truncated title, stale id, owner reminder');

  // 9. ai.js
  const stub = r => ({ messages: { create: async () => r } });
  const step = { ask: 'מה מחפשים?', options: [{ label: 'א' }, { label: 'ב' }] };
  const ok = JSON.stringify({ choice: 1 });
  assert.strictEqual(await createClassifier(stub({ stop_reason: 'end_turn', content: [{ type: 'text', text: ok }] }))('ב', step), 1);
  assert.strictEqual(await createClassifier(stub({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"choice":-1}' }] }))('?', step), null);
  assert.strictEqual(await createClassifier(stub({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"choice":9}' }] }))('?', step), null);
  assert.strictEqual(await createClassifier(stub({ stop_reason: 'refusal', content: [] }))('?', step), null);
  assert.strictEqual(await createClassifier({ messages: { create: async () => { throw new Error('boom'); } } })('?', step), null);
  console.log('ok ai classifier edge cases');
  console.log('\nall tests passed');
})().catch(e => { console.error(e); process.exit(1); });
