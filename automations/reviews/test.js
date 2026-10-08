'use strict';
const assert = require('assert');
const fs = require('fs');
const { createReviewService } = require('./index.js');
const { zonedToUtc } = require('../reminders/index.js');
const D = require('./drafts.js');
const ok = m => console.log('ok', m);
const H = 3600000;
const L = s => zonedToUtc(s, 'Asia/Jerusalem');

(async () => {
  // ---------- שירות בקשות ----------
  const sent = [], owner = []; let clock = L('2026-10-08 12:00');
  const wa = { sendText: async (to, body) => { sent.push({ to, type: 'text', body }); return true; }, sendTemplate: async (to, name, params) => { sent.push({ to, type: 'template', name, params }); return true; } };
  const LINK = 'https://g.page/r/EXAMPLE/review';
  const mk = (over = {}) => createReviewService({ businessName: 'מוסך לדוגמה', reviewLink: LINK, ...over }, { wa, notify: async t => { owner.push(t); return true; }, now: () => clock });
  const msg = (from, body) => ({ entry: [{ changes: [{ value: { messages: [{ from, id: 'm' + Math.random(), type: 'text', text: { body } }] } }] }] });

  assert.throws(() => createReviewService({ reviewLink: 'javascript:alert(1)' }), /reviewLink/);
  ok('reviewLink must be https');

  let s = mk();
  const r = s.importVisits(`שם,טלפון,ביקור,שירות,הסכמה
אורי,050-111-1111,2026-10-08 10:00,טיפול,כן
מיכל,052-222-2222,2026-10-08 11:30,בלמים,כן
דוד,054-333-3333,2026-10-08 09:00,טיפול,לא
,050-444-4444,2026-10-08 09:00,טיפול,כן`);
  assert.strictEqual(r.added.length, 2);
  assert.deepStrictEqual(r.skipped.map(x => x.reason), ['אין הסכמה לקבלת הודעות', 'חסר שם']);
  ok('import requires consent');

  // אורי: ביקור 10:00, עברו 3 שעות ב-13:00. מיכל: 11:30 → 14:30
  clock = L('2026-10-08 12:00'); await s.tick(); assert.strictEqual(sent.length, 0);
  clock = L('2026-10-08 13:00'); await s.tick();
  assert.strictEqual(sent.length, 1); assert.strictEqual(sent[0].name, 'review_request_v1');
  assert.deepStrictEqual(sent[0].params, ['אורי', 'מוסך לדוגמה', LINK]);
  clock = L('2026-10-08 14:30'); await s.tick(); assert.strictEqual(sent.length, 2);
  clock = L('2026-10-08 15:30'); await s.tick(); assert.strictEqual(sent.length, 2);
  assert.ok(sent.every(m => m.params.includes(LINK))); // כולם מקבלים אותו קישור
  ok('request after delay, same link for everyone');

  // שקט בלילה ובשבת, ופג תוקף
  sent.length = 0; s = mk(); clock = L('2026-10-08 17:00');
  s.importVisits('name,phone,visit\nרות,0503333333,2026-10-08 18:30');                   // 21:30 שקט, ועד 09:00 בבוקר גם
  clock = L('2026-10-08 21:30'); await s.tick(); assert.strictEqual(sent.length, 0);
  clock = L('2026-10-09 08:00'); await s.tick(); assert.strictEqual(sent.length, 0);       // עדיין שקט עד 09:00
  clock = L('2026-10-09 09:05'); await s.tick(); assert.strictEqual(sent.length, 1);       // שישי בבוקר מותר
  sent.length = 0; s = mk(); clock = L('2026-10-08 09:00');
  s.importVisits('name,phone,visit\nגל,0504444444,2026-10-08 10:00');
  clock = L('2026-10-10 12:00'); await s.tick(); assert.strictEqual(sent.length, 0);       // שבת בצהריים: שקט
  assert.strictEqual(Object.values(s.db().visits)[0].status, 'pending');
  clock = L('2026-10-11 11:00'); await s.tick(); assert.strictEqual(sent.length, 0);       // עברו יותר מ-72 שעות
  assert.strictEqual(Object.values(s.db().visits)[0].status, 'expired');
  ok('quiet hours, Shabbat, expiry');

  // תקופת צינון והסרה
  sent.length = 0; s = mk(); clock = L('2026-10-08 09:00');
  s.importVisits('name,phone,visit\nנועה,0505555555,2026-10-08 09:00'); clock = L('2026-10-08 13:00'); await s.tick();
  s.importVisits('name,phone,visit\nנועה,0505555555,2026-10-20 09:00'); clock = L('2026-10-20 13:00'); await s.tick();
  assert.strictEqual(sent.length, 1);                                                      // לא יותר מפעם ב-90 יום
  s.importVisits('name,phone,visit\nדן,0506666666,2026-10-20 09:00'); await s.processPayload(msg('972506666666', 'הסר'));
  clock = L('2026-10-20 14:00'); await s.tick(); assert.strictEqual(sent.filter(x => x.type === 'template').length, 1);
  ok('cooldown + opt-out');

  // משוב פרטי מועבר לבעלים, ומאשרים פעם אחת
  sent.length = 0; owner.length = 0; s = mk(); clock = L('2026-10-08 09:00');
  s.importVisits('name,phone,visit\nמיכל,0502222222,2026-10-08 09:00'); clock = L('2026-10-08 13:00'); await s.tick(); sent.length = 0;
  await s.processPayload(msg('972502222222', 'חיכיתי שעה בקבלה ולא ידעו להגיד כמה זמן'));
  await s.processPayload(msg('972502222222', 'והמחיר היה יותר מההצעה'));
  assert.strictEqual(owner.length, 2); assert.ok(owner[0].includes('מיכל') && owner[0].includes('חיכיתי שעה'));
  assert.strictEqual(sent.filter(x => x.type === 'text').length, 1);
  assert.strictEqual(s.stats().feedback, 2);
  ok('private feedback → owner, single ack');

  // ---------- טיוטות תשובה ----------
  const reviews = JSON.parse(fs.readFileSync(__dirname + '/samples/reviews.json', 'utf8'));
  const profile = JSON.parse(fs.readFileSync(__dirname + '/samples/profile.json', 'utf8'));
  const req = D.buildRequest(reviews, profile);
  assert.strictEqual(req.model, 'claude-opus-5-5');
  assert.strictEqual(req.output_config.format.type, 'json_schema');
  assert.ok(!('temperature' in req) && !('thinking' in req));                              // פרמטרים שהמודל דוחה
  assert.ok(req.system.includes('untrusted data'));
  ok('request shape');

  const good = {
    replies: [
      { id: '1', reply: 'תודה רבה אורי! שמחים שהעדכון בוואטסאפ עזר.', sentiment: 'positive', topics: ['שירות', 'תקשורת'], needs_owner: false, reason: '' },
      { id: '2', reply: 'תודה מיכל, מצטערים על ההמתנה בקבלה. נשפר.', sentiment: 'neutral', topics: ['המתנה'], needs_owner: false, reason: '' },
      { id: '3', reply: 'דוד, מצטערים מאוד. נשמח לברר את העניין, התקשר 054-999-9999 .', sentiment: 'negative', topics: ['נזק'], needs_owner: false, reason: '' },
      { id: '4', reply: 'תודה שרה על המילים החמות!', sentiment: 'positive', topics: ['הגינות'], needs_owner: false, reason: '' },
      { id: '5', reply: 'תודה אבי על המשוב. נשמח לשמוע עוד.', sentiment: 'neutral', topics: ['מחיר'], needs_owner: false, reason: '' }
    ], strengths: ['שירות מהיר', 'הגינות'], issues: ['המתנה בקבלה']
  };
  const stub = out => ({ messages: { create: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(out) }] }) } });
  const res = await D.draftReplies(stub(good), reviews, profile);
  const byId = Object.fromEntries(res.items.map(i => [i.id, i]));
  assert.strictEqual(byId['1'].needs_owner, false);
  assert.ok(byId['3'].needs_owner);                       // דירוג 1 + איום משפטי + מספר טלפון זר בטיוטה
  assert.ok(byId['3'].reason.length > 0);
  assert.ok(byId['5'].reply.indexOf('50%') < 0);          // ההוראה שהוזרקה בתוך הביקורת לא הפכה לתשובה (המודל המדומה התעלם ממנה)
  ok('validation: low rating, legal threat, foreign phone flagged');

  // דליפת פרט קשר גם בביקורת חיובית: מסומן לבדיקה
  const leaky = { ...good, replies: [{ ...good.replies[0], reply: 'תודה אורי! אפשר להתקשר ל-052-123-4567.' }, ...good.replies.slice(1)] };
  const lres = await D.draftReplies(stub(leaky), reviews, profile);
  assert.ok(lres.items[0].needs_owner && lres.items[0].reason.includes('פרט קשר'));
  // פרט הקשר המאושר מהפרופיל מותר
  const fine = { ...good, replies: [{ ...good.replies[0], reply: 'תודה אורי! נשמח לשמוע: 050-0000000' }, ...good.replies.slice(1)] };
  assert.strictEqual((await D.draftReplies(stub(fine), reviews, profile)).items[0].needs_owner, false);
  ok('contact-detail leak guard');

  // מזהה חסר → טיוטה ריקה לבעלים
  const partial = await D.draftReplies(stub({ replies: [good.replies[0]], strengths: [], issues: [] }), reviews, profile);
  assert.ok(partial.items.filter(i => i.reply === '' && i.needs_owner).length === 4);
  ok('missing draft → owner');

  // סירוב וחיתוך
  await assert.rejects(D.draftReplies({ messages: { create: async () => ({ stop_reason: 'refusal', content: [] }) } }, reviews, profile), /סירב/);
  await assert.rejects(D.draftReplies({ messages: { create: async () => ({ stop_reason: 'max_tokens', content: [] }) } }, reviews, profile), /נחתך/);
  ok('refusal and truncation surfaced');

  // דף אישור: הדרה של HTML
  const evil = { ...good, replies: [{ ...good.replies[0], reply: '<script>alert(1)</script>' }, ...good.replies.slice(1)] };
  const html = D.renderSheet(await D.draftReplies(stub(evil), [{ ...reviews[0], author: '<b>x</b>' }, ...reviews.slice(1)], profile), profile);
  assert.ok(!html.includes('<script>alert') && !html.includes('<b>x</b>') && html.includes('dir="rtl"'));
  ok('sheet escapes HTML');

  console.log('\nall review tests passed');
})().catch(e => { console.error(e); process.exit(1); });
