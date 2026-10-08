'use strict';
const assert = require('assert');
const { createReminderService, zonedToUtc, fmtWhen, parseCsv } = require('./index.js');
const ok = m => console.log('ok', m);
const TZ = 'Asia/Jerusalem';
const L = s => zonedToUtc(s, TZ);            // שעון ישראל -> UTC
const H = 3600000, M = 60000;

// ---- זמן ----
assert.strictEqual(new Date(L('2026-10-20 17:00')).toISOString(), '2026-10-20T14:00:00.000Z'); // קיץ (UTC+3)
assert.strictEqual(new Date(L('2026-10-26 17:00')).toISOString(), '2026-10-26T15:00:00.000Z'); // אחרי סוף שעון קיץ ב-25.10 (UTC+2)
assert.strictEqual(L('26/10/2026 17:00'), L('2026-10-26 17:00'));
assert.strictEqual(L('בלה'), null);
assert.strictEqual(fmtWhen(L('2026-10-26 17:00'), TZ).long, 'יום שני, 26.10 בשעה 17:00');
ok('timezone + DST + Hebrew date');

// ---- CSV ----
const rows = parseCsv('שם,טלפון\n"כהן, דנה",050-1\n"יצחק ""הגדול""",2\n');
assert.deepStrictEqual(rows[1], ['כהן, דנה', '050-1']); assert.strictEqual(rows[2][0], 'יצחק "הגדול"');
ok('csv quoting');

// ---- סביבה מדומה ----
const sent = [], owner = [];
let clock = L('2026-10-08 10:00');
const wa = {
  sendText: async (to, body) => { sent.push({ to, type: 'text', body }); return true; },
  sendTemplate: async (to, name, params, qr) => { sent.push({ to, type: 'template', name, params, qr }); return true; }
};
const mk = (over = {}) => createReminderService({ businessName: 'מבחן', ...over }, { wa, notify: async t => { owner.push(t); return true; }, now: () => clock });
const msg = (from, body, id) => ({ entry: [{ changes: [{ value: { messages: [{ from, id: 'm' + Math.random(), type: 'text', text: { body } }] } }] }] });
const btn = (from, payload, text = 'x') => ({ entry: [{ changes: [{ value: { messages: [{ from, id: 'm' + Math.random(), type: 'button', button: { payload, text } }] } }] }] });
const reset = () => { sent.length = 0; owner.length = 0; };

// ---- ייבוא ----
let s = mk();
const csv = `שם,טלפון,מועד,שירות
דנה כהן,050-111-1111,2026-10-09 17:00,שיעור נהיגה
"לוי, יוסי",+972 52 222 2222,10/10/2026 09:00,פילאטיס
בלי טלפון,,2026-10-09 18:00,
טלפון שגוי,123,2026-10-09 18:00,
תור שעבר,050-333-3333,2026-10-01 10:00,
דנה כהן,050-111-1111,2026-10-09 17:00,שיעור נהיגה`;
let r = s.importAppointments(csv);
assert.strictEqual(r.added.length, 2);
assert.deepStrictEqual(r.skipped.map(x => x.reason), ['טלפון לא תקין', 'טלפון לא תקין', 'התור כבר עבר', 'כבר קיים']);
ok('csv import with validation');

// ---- תזכורת 24 שעות: לא מוקדם מדי, פעם אחת, תבנית עם כפתורים ----
reset(); s = mk(); s.importAppointments('name,phone,start,service\nדנה כהן,0501111111,2026-10-09 17:00,שיעור נהיגה');
(async () => {
  clock = L('2026-10-08 10:00'); await s.tick(); assert.strictEqual(sent.length, 0);        // עוד 31 שעות
  clock = L('2026-10-08 17:30'); await s.tick();                                              // פחות מ-24 שעות, 17:30 מותר
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].name, 'appointment_reminder_v1');
  assert.deepStrictEqual(sent[0].params, ['דנה כהן', 'יום שישי, 09.10 בשעה 17:00', 'שיעור נהיגה']);
  assert.strictEqual(sent[0].qr.length, 3);
  await s.tick(); assert.strictEqual(sent.length, 1);                                         // בלי כפילות
  ok('24h reminder with quick-reply buttons, no duplicate');

  // ---- אישור כפתור: לא נשלחת תזכורת שנייה ----
  const id = Object.keys(s.db().appts)[0];
  await s.processPayload(btn('972501111111', 'CONFIRM:' + id));
  assert.strictEqual(s.db().appts[id].status, 'confirmed');
  assert.ok(sent.at(-1).body.includes('נתראה'));
  clock = L('2026-10-09 14:05'); await s.tick();
  assert.strictEqual(sent.filter(x => x.type === 'template').length, 1);
  ok('confirm via button, 3h reminder skipped when confirmed');

  // ---- לא מאשרת: תזכורת שנייה (3 שעות) ----
  reset(); s = mk(); s.importAppointments('name,phone,start\nדנה,0501111111,2026-10-09 17:00');
  clock = L('2026-10-08 17:30'); await s.tick(); clock = L('2026-10-09 14:05'); await s.tick();
  assert.strictEqual(sent.filter(x => x.type === 'template').length, 2);
  ok('3h second reminder when unconfirmed');

  // ---- חלונות שקט: ראשון 08:30, התזכורת חלה בשבת ומוקדמת לשישי לפני 15:00; תזכורת 3 שעות (05:30) מדולגת ----
  reset(); s = mk(); clock = L('2026-10-08 10:00'); s.importAppointments('name,phone,start\nרות,0502222222,2026-10-11 08:30');
  clock = L('2026-10-09 13:00'); await s.tick(); assert.strictEqual(sent.length, 0);   // עדיין מוקדם מדי
  clock = L('2026-10-09 14:59'); await s.tick(); assert.strictEqual(sent.length, 1);   // שישי לפני כניסת שבת
  clock = L('2026-10-11 05:30'); await s.tick(); assert.strictEqual(sent.length, 1);   // 5:30 בבוקר: שקט
  ok('Shabbat/quiet hours: earlier send, skip at night');

  // ---- תור שנוצר בלילה ליום המחרת: מחכים לבוקר ----
  reset(); s = mk(); clock = L('2026-10-08 23:00'); s.importAppointments('name,phone,start\nאבי,0503333333,2026-10-09 10:00');
  await s.tick(); assert.strictEqual(sent.length, 0);
  clock = L('2026-10-09 08:00'); await s.tick(); assert.strictEqual(sent.length, 1);
  ok('late-created appointment waits for morning');

  // ---- ביטול + רשימת המתנה ----
  reset(); s = mk({ offerHoldMin: 30 }); clock = L('2026-10-08 10:00');
  s.importAppointments('name,phone,start,service\nדנה כהן,0501111111,2026-10-09 17:00,שיעור');
  s.addWaitlist('גל', '0504444444'); s.addWaitlist('נועה', '0505555555'); s.addWaitlist('דנה כהן', '0501111111');
  const aid = Object.keys(s.db().appts)[0];
  await s.processPayload(btn('972501111111', 'CANCEL:' + aid));
  assert.strictEqual(s.db().appts[aid].status, 'cancelled');
  const offer = sent.find(x => x.name === 'slot_available_v1');
  assert.strictEqual(offer.to, '972504444444');                                    // הראשון ברשימה (לא המבטלת עצמה)
  assert.ok(owner.some(t => t.includes('ביטל')));
  ok('cancel → offer to first waitlister');

  await s.processPayload(msg('972504444444', 'כן'));
  const taken = Object.values(s.db().appts).find(a => a.fromWaitlist);
  assert.ok(taken && taken.name === 'גל' && taken.status === 'confirmed' && taken.start === s.db().appts[aid].start);
  assert.ok(!sent.some(x => x.to === '972505555555'));                              // השני לא קיבל הצעה
  assert.ok(owner.some(t => t.includes('תפס')));
  assert.strictEqual(s.stats().slotsRecovered, 1);
  ok('waitlister accepts → slot recovered');

  // חזרה מביטול כשהשעה נתפסה
  reset(); await s.processPayload(msg('972501111111', 'אישור'));
  assert.ok(sent[0].body.includes('נתפסה')); assert.strictEqual(s.db().appts[aid].status, 'cancelled');
  ok('cannot un-cancel after slot taken');

  // ---- הצעה פגה → הבא בתור; אחרון → התראה לבעלים ----
  reset(); s = mk({ offerHoldMin: 30 }); clock = L('2026-10-08 10:00');
  s.importAppointments('name,phone,start\nדנה,0501111111,2026-10-09 17:00'); s.addWaitlist('גל', '0504444444'); s.addWaitlist('נועה', '0505555555');
  const a2 = Object.keys(s.db().appts)[0];
  await s.processPayload(msg('972501111111', 'ביטול'));
  clock += 31 * M; await s.tick();
  assert.ok(sent.some(x => x.name === 'slot_available_v1' && x.to === '972505555555'));
  clock += 31 * M; await s.tick();
  assert.ok(owner.some(t => t.includes('אין מי שמחכה')));
  ok('offer expiry cascades, owner told when nobody left');

  // ---- חזרה מביטול כשהשעה לא נתפסה ----
  reset(); s = mk(); clock = L('2026-10-08 10:00');
  s.importAppointments('name,phone,start\nדנה,0501111111,2026-10-09 17:00'); s.addWaitlist('גל', '0504444444');
  await s.processPayload(msg('972501111111', '2')); await s.processPayload(msg('972501111111', 'אישור'));
  assert.strictEqual(Object.values(s.db().appts)[0].status, 'confirmed');
  assert.ok(Object.values(s.db().offers).every(o => o.status === 'withdrawn'));
  ok('un-cancel withdraws open offer');

  // ---- ביטול קרוב מדי: לא מציעים ----
  reset(); s = mk({ minLeadMin: 60 }); clock = L('2026-10-09 16:30');
  s.importAppointments('name,phone,start\nדנה,0501111111,2026-10-09 17:00'); s.addWaitlist('גל', '0504444444');
  await s.processPayload(msg('972501111111', 'ביטול'));
  assert.ok(!sent.some(x => x.name === 'slot_available_v1')); assert.ok(owner.some(t => t.includes('קרוב מדי')));
  ok('last-minute cancel not offered');

  // ---- הזזה, הודעה חופשית, הסרה ----
  reset(); s = mk(); clock = L('2026-10-08 10:00'); s.importAppointments('name,phone,start\nדנה,0501111111,2026-10-09 17:00');
  await s.processPayload(msg('972501111111', 'להזיז'));
  assert.strictEqual(Object.values(s.db().appts)[0].status, 'reschedule'); assert.ok(owner.some(t => t.includes('להזיז')));
  await s.processPayload(msg('972501111111', 'אפשר לבוא עם חבר?'));
  assert.ok(owner.some(t => t.includes('אפשר לבוא עם חבר'))); assert.ok(sent.some(x => x.body && x.body.includes('קיבלנו')));
  await s.processPayload(msg('972501111111', 'הסר'));
  clock = L('2026-10-08 17:30'); sent.length = 0; await s.tick(); assert.strictEqual(sent.length, 0);
  ok('reschedule, free text forwarded, opt-out stops reminders');

  // ---- סיכום יומי לבעלים: פעם אחת ----
  reset(); s = mk(); clock = L('2026-10-08 10:00');
  s.importAppointments('name,phone,start,service\nדנה,0501111111,2026-10-09 17:00,נהיגה\nיוסי,0502222222,2026-10-09 09:00,נהיגה');
  const first = Object.keys(s.db().appts)[0]; await s.processPayload(btn('972501111111', 'CONFIRM:' + first));
  clock = L('2026-10-08 20:05'); await s.tick(); await s.tick();
  const sums = owner.filter(t => t.startsWith('📅'));
  assert.strictEqual(sums.length, 1);
  assert.ok(sums[0].indexOf('09:00') < sums[0].indexOf('17:00') && sums[0].includes('✅ מאושר') && sums[0].includes('⏳'));
  ok('daily owner summary (once, sorted, with status)');

  // ---- כפילות הודעה ----
  reset(); s = mk(); s.importAppointments('name,phone,start\nדנה,0501111111,2026-10-09 17:00');
  const dup = msg('972501111111', 'להזיז'); await s.processPayload(dup); await s.processPayload(dup);
  assert.strictEqual(owner.filter(t => t.includes('להזיז')).length, 1);
  ok('dedupe');

  console.log('\nall reminder tests passed');
})().catch(e => { console.error(e); process.exit(1); });
