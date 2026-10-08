'use strict';
// תזכורות תורים + החזרת שעות שבוטלו (רשימת המתנה). נשלחות דרך WhatsApp Cloud API (תבניות מאושרות).
const fs = require('fs');
const path = require('path');
const { createWA, createNotifier, flattenWebhook, extractInbound, createWebhookServer, normalizePhone } = require('../common/wa.js');

// ---------- זמן ----------
function tzOffsetMinutes(utcMs, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(dtf.formatToParts(new Date(utcMs)).map(x => [x.type, x.value]));
  return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(utcMs / 1000) * 1000) / 60000);
}
// "2026-10-26 17:00" או "26/10/2026 17:00" (שעון מקומי באזור הזמן) -> UTC במילי-שניות
function zonedToUtc(str, tz) {
  let m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/.exec(str.trim()), y, mo, d, h, mi;
  if (m) [, y, mo, d, h, mi] = m;
  else if ((m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})[ T](\d{1,2}):(\d{2})$/.exec(str.trim()))) [, d, mo, y, h, mi] = m;
  else return null;
  const guess = Date.UTC(+y, +mo - 1, +d, +h, +mi);
  let utc = guess - tzOffsetMinutes(guess, tz) * 60000;
  utc = guess - tzOffsetMinutes(utc, tz) * 60000; // תיקון סביב מעבר שעון קיץ
  return utc;
}
function localParts(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday), date: `${p.year}-${p.month}-${p.day}` };
}
function fmtWhen(ms, tz) {
  const p = localParts(ms, tz);
  const day = new Intl.DateTimeFormat('he-IL', { timeZone: tz, weekday: 'long' }).format(new Date(ms));
  const date = `${String(p.d).padStart(2, '0')}.${String(p.m).padStart(2, '0')}`, time = `${String(p.h).padStart(2, '0')}:${String(p.min).padStart(2, '0')}`;
  return { day, date, time, long: `${day}, ${date} בשעה ${time}` };
}

// ---------- CSV ----------
function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some(x => x.trim())) rows.push(row); row = []; }
    else cur += c;
  }
  row.push(cur); if (row.some(x => x.trim())) rows.push(row);
  return rows;
}
const COLS = { name: ['name', 'שם'], phone: ['phone', 'טלפון', 'נייד'], start: ['start', 'מועד', 'תאריך', 'מתי'], service: ['service', 'שירות', 'סוג'] };
function csvRecords(text) {
  const [head, ...rest] = parseCsv(text);
  if (!head) return [];
  const idx = {};
  for (const [k, names] of Object.entries(COLS)) idx[k] = head.findIndex(h => names.includes(h.trim().toLowerCase()));
  return rest.map((r, i) => ({ line: i + 2, name: (r[idx.name] || '').trim(), phone: r[idx.phone], start: r[idx.start], service: (r[idx.service] || '').trim() }));
}

// ---------- השירות ----------
const DEFAULTS = {
  timezone: 'Asia/Jerusalem',
  businessName: 'העסק',
  templates: { reminder: 'appointment_reminder_v1', slot: 'slot_available_v1' },
  reminders: [{ beforeMin: 1440, whenQuiet: 'earlier' }, { beforeMin: 180, whenQuiet: 'skip', onlyIfUnconfirmed: true }],
  quiet: { fromHour: 21, toHour: 8, shabbat: true }, // שבת: הערכה גסה, שישי 15:00 עד שבת 20:00
  offerHoldMin: 30, minLeadMin: 60, summaryHour: 20, forwardUnknown: true
};
const CONFIRM = /^(1|אישור|מאשר|מאשרת|מאשר\/ת|מגיע|מגיעה|בסדר)$/;
const CANCEL = /^(2|ביטול|לבטל|מבטל|מבטלת|מבטל\/ת|לא|לא מגיע|לא מגיעה)$/;
const MOVE = /^(3|להזיז|הזזה|לשנות|שינוי|לדחות|דחייה)$/;
const YES = /^(כן|בטח|אשמח|לוקח|לוקחת|אני לוקח|אני לוקחת|1)$/;
const NO = /^(לא|לא תודה|2|דלג)$/;
const OPTOUT = /^(הסר|הסרה|stop|unsubscribe)$/i;

function createReminderService(userCfg, io = {}) {
  const cfg = { ...DEFAULTS, ...userCfg, templates: { ...DEFAULTS.templates, ...(userCfg.templates || {}) } };
  const now = io.now || Date.now;
  const wa = io.wa || createWA({ ...cfg.wa, fetch: io.fetch });
  const notify = io.notify || createNotifier({ ...cfg.telegram, fetch: io.fetch });
  const tz = cfg.timezone;

  let db = { appts: {}, waitlist: [], offers: {}, optedOut: {}, lastSummary: '', seq: 0 };
  if (cfg.dataFile) { try { db = { ...db, ...JSON.parse(fs.readFileSync(cfg.dataFile, 'utf8')) }; } catch { /* חדש */ } }
  const save = () => { if (!cfg.dataFile) return; fs.mkdirSync(path.dirname(cfg.dataFile), { recursive: true }); fs.writeFileSync(cfg.dataFile + '.tmp', JSON.stringify(db, null, 2)); fs.renameSync(cfg.dataFile + '.tmp', cfg.dataFile); };

  // --- חלונות שקט ---
  function isQuiet(ms) {
    const p = localParts(ms, tz), q = cfg.quiet;
    if (p.h >= q.fromHour || p.h < q.toHour) return true;
    if (q.shabbat && ((p.dow === 5 && p.h >= 15) || (p.dow === 6 && p.h < 20))) return true;
    return false;
  }
  function sendTime(dueMs, rule) {
    if (!isQuiet(dueMs)) return dueMs;
    if (rule.whenQuiet === 'skip') return null;
    for (let t = dueMs - 15 * 60000; t > dueMs - 18 * 3600000; t -= 15 * 60000) if (!isQuiet(t)) return t; // מקדימים, לא מאחרים
    return null;
  }

  // --- ייבוא ---
  function importAppointments(csvText) {
    const added = [], skipped = [];
    for (const r of csvRecords(csvText)) {
      const phone = normalizePhone(r.phone), start = r.start ? zonedToUtc(r.start, tz) : null;
      if (!r.name) { skipped.push({ line: r.line, reason: 'חסר שם' }); continue; }
      if (!phone) { skipped.push({ line: r.line, reason: 'טלפון לא תקין' }); continue; }
      if (start == null) { skipped.push({ line: r.line, reason: 'תאריך לא תקין' }); continue; }
      if (start <= now()) { skipped.push({ line: r.line, reason: 'התור כבר עבר' }); continue; }
      const id = `${phone}-${start}`;
      if (db.appts[id]) { skipped.push({ line: r.line, reason: 'כבר קיים' }); continue; }
      db.appts[id] = { id, name: r.name, phone, start, service: r.service, status: 'scheduled', sent: {} };
      added.push(id);
    }
    save(); return { added, skipped };
  }
  function addWaitlist(name, rawPhone, service = '') {
    const phone = normalizePhone(rawPhone); if (!phone) throw new Error('טלפון לא תקין');
    if (!db.waitlist.some(w => w.phone === phone)) db.waitlist.push({ name, phone, service, addedAt: now() });
    save();
  }

  // --- שליחת תזכורות ---
  const active = a => ['scheduled', 'confirmed', 'reschedule'].includes(a.status);
  async function sendReminder(a, i) {
    const w = fmtWhen(a.start, tz);
    const ok = await wa.sendTemplate(a.phone, cfg.templates.reminder, [a.name, w.long, a.service || 'התור'], [`CONFIRM:${a.id}`, `CANCEL:${a.id}`, `RESCHEDULE:${a.id}`]);
    if (ok) a.sent['r' + i] = now();
  }

  // --- רשימת המתנה ---
  async function offerSlot(appt) {
    const t = now();
    if (appt.start - t < cfg.minLeadMin * 60000) { await notify(`⚠️ התור של ${appt.name} (${fmtWhen(appt.start, tz).long}) בוטל קרוב מדי למועד, לא הוצע לרשימת המתנה.`); return; }
    const tried = new Set(Object.values(db.offers).filter(o => o.apptId === appt.id).map(o => o.phone));
    const next = db.waitlist.find(w => w.phone !== appt.phone && !tried.has(w.phone) && !Object.values(db.offers).some(o => o.phone === w.phone && o.status === 'open'));
    if (!next) { await notify(`⚠️ השעה התפנתה (${fmtWhen(appt.start, tz).long}) ואין מי שמחכה ברשימת ההמתנה.`); return; }
    const id = 'o' + (++db.seq);
    db.offers[id] = { id, apptId: appt.id, phone: next.phone, name: next.name, expiresAt: t + cfg.offerHoldMin * 60000, status: 'open' };
    await wa.sendTemplate(next.phone, cfg.templates.slot, [next.name, fmtWhen(appt.start, tz).long, String(cfg.offerHoldMin)], [`TAKE:${id}`, `PASS:${id}`]);
  }
  async function takeOffer(o) {
    const src = db.appts[o.apptId], w = db.waitlist.find(x => x.phone === o.phone);
    o.status = 'taken';
    db.waitlist = db.waitlist.filter(x => x.phone !== o.phone);
    const id = `${o.phone}-${src.start}`;
    db.appts[id] = { id, name: o.name, phone: o.phone, start: src.start, service: (w && w.service) || src.service, status: 'confirmed', sent: {}, fromWaitlist: true };
    src.slotTaken = true;
    await wa.sendText(o.phone, `מעולה ${o.name}! קבענו לך ${fmtWhen(src.start, tz).long} ✅`);
    await notify(`✅ ${o.name} (רשימת המתנה) תפס/ה את השעה של ${src.name}: ${fmtWhen(src.start, tz).long}`);
  }

  // --- הודעה נכנסת ---
  async function handleMessage(msg) {
    const from = msg.from, { text, id } = extractInbound(msg), t = text.trim();
    if (OPTOUT.test(t)) { db.optedOut[from] = true; await wa.sendText(from, 'הוסרת מהתזכורות ✅'); return; }
    if (db.optedOut[from]) return;

    // 1) הצעת שעה מרשימת המתנה
    const offer = Object.values(db.offers).find(o => o.phone === from && o.status === 'open');
    if (offer) {
      const key = id && id.split(':')[1] === offer.id ? id.split(':')[0] : null;
      if (key === 'TAKE' || (!key && YES.test(t))) { if (now() > offer.expiresAt) offer.status = 'expired'; else return takeOffer(offer); }
      if (offer.status === 'open' && (key === 'PASS' || (!key && NO.test(t)))) { offer.status = 'passed'; await wa.sendText(from, 'בסדר, תודה! נשאיר אותך ברשימה 🙂'); return offerSlot(db.appts[offer.apptId]); }
      if (offer.status === 'expired') { await wa.sendText(from, 'מצטערים, ההצעה פגה. נעדכן אותך כשיתפנה משהו.'); return; }
    }

    // 2) תגובה לתזכורת
    let a = null, action = null;
    if (id && /^(CONFIRM|CANCEL|RESCHEDULE):/.test(id)) { const [k, aid] = [id.split(':')[0], id.slice(id.indexOf(':') + 1)]; a = db.appts[aid]; action = k.toLowerCase(); }
    if (!a) {
      const mine = Object.values(db.appts).filter(x => x.phone === from && (active(x) || x.status === 'cancelled') && x.start > now() - 3600000).sort((x, y) => x.start - y.start);
      a = mine.find(active) || mine[0];
      action = CONFIRM.test(t) ? 'confirm' : CANCEL.test(t) ? 'cancel' : MOVE.test(t) ? 'reschedule' : null;
    }
    if (!a) { if (cfg.forwardUnknown && t) await notify(`💬 הודעה ממספר ללא תור (+${from}): ${t}`); return; }
    if (!action) { await notify(`💬 ${a.name} (+${from}) כתב/ה: ${t}`); if (!a.ackSent) { a.ackSent = true; await wa.sendText(from, 'קיבלנו ✅ נעביר לצוות.'); } return; }

    const w = fmtWhen(a.start, tz);
    if (action === 'confirm') {
      if (a.status === 'cancelled') {
        if (a.slotTaken) { await wa.sendText(from, 'מצטערים, השעה כבר נתפסה. נשמח לתאם מועד חדש.'); await notify(`⚠️ ${a.name} ניסה/תה לחזור בו מביטול אבל השעה נתפסה.`); return; }
        Object.values(db.offers).filter(o => o.apptId === a.id && o.status === 'open').forEach(o => { o.status = 'withdrawn'; });
        await notify(`↩️ ${a.name} חזר/ה בו מהביטול: ${w.long}`);
      }
      a.status = 'confirmed'; await wa.sendText(from, `מעולה, נתראה ${w.day} בשעה ${w.time} ✅`);
    } else if (action === 'cancel') {
      if (a.status === 'cancelled') return;
      a.status = 'cancelled'; await wa.sendText(from, 'התור בוטל ✅ אם זו טעות, כתבו "אישור".');
      await notify(`❌ ${a.name} ביטל/ה: ${w.long}`);
      await offerSlot(a);
    } else {
      a.status = 'reschedule'; await wa.sendText(from, 'קיבלנו, נחזור אליך עם מועד חדש 🙂');
      await notify(`🔁 ${a.name} ביקש/ה להזיז: ${w.long}. טלפון: +${from}`);
    }
  }

  // --- תהליך ברקע ---
  async function tick() {
    const t = now();
    for (const a of Object.values(db.appts)) {
      if (!active(a) || a.start <= t) continue;
      for (let i = 0; i < cfg.reminders.length; i++) {
        const rule = cfg.reminders[i];
        if (a.sent['r' + i] || db.optedOut[a.phone]) continue;
        if (rule.onlyIfUnconfirmed && a.status === 'confirmed') continue;
        const due = a.start - rule.beforeMin * 60000, at = sendTime(due, rule);
        if (at == null || t < at || t > a.start - 20 * 60000) continue; // לא שולחים תזכורת פחות מ-20 דקות לפני
        if (isQuiet(t)) continue; // גם אם איחרנו: לא בלילה ולא בשבת
        await sendReminder(a, i);
        break; // תזכורת אחת בכל סבב
      }
    }
    for (const o of Object.values(db.offers)) if (o.status === 'open' && t > o.expiresAt) { o.status = 'expired'; await offerSlot(db.appts[o.apptId]); }
    await maybeSummary(t);
    save();
  }

  async function maybeSummary(t) {
    const p = localParts(t, tz);
    if (p.h < cfg.summaryHour || db.lastSummary === p.date) return;
    db.lastSummary = p.date;
    const tomorrow = localParts(t + 24 * 3600000, tz).date;
    const list = Object.values(db.appts).filter(a => localParts(a.start, tz).date === tomorrow).sort((x, y) => x.start - y.start);
    if (!list.length) return;
    const icon = { confirmed: '✅ מאושר', scheduled: '⏳ ממתין לאישור', cancelled: '❌ בוטל', reschedule: '🔁 ביקש להזיז' };
    await notify(`📅 מחר (${list.length} תורים):\n` + list.map(a => `${fmtWhen(a.start, tz).time} ${a.name} ${a.service ? '· ' + a.service : ''} – ${icon[a.status] || a.status}`).join('\n'));
  }

  function stats() {
    const all = Object.values(db.appts), c = s => all.filter(a => a.status === s).length;
    return { total: all.length, confirmed: c('confirmed'), scheduled: c('scheduled'), cancelled: c('cancelled'), reschedule: c('reschedule'), slotsRecovered: all.filter(a => a.fromWaitlist).length };
  }

  // --- HTTP ---
  const authed = req => cfg.adminToken && req.headers.authorization === 'Bearer ' + cfg.adminToken;
  const server = createWebhookServer({
    verifyToken: cfg.verifyToken, appSecret: cfg.appSecret, allowUnsigned: cfg.allowUnsigned,
    onPayload: p => processPayload(p),
    routes(req, res, url) {
      if (!authed(req)) return false;
      if (req.method === 'GET' && url.pathname === '/stats') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(stats())); return true; }
      if (req.method === 'POST' && url.pathname === '/import') {
        const chunks = []; req.on('data', c => chunks.push(c));
        req.on('end', () => { const r = importAppointments(Buffer.concat(chunks).toString('utf8')); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ added: r.added.length, skipped: r.skipped })); });
        return true;
      }
      return false;
    }
  });

  const seen = new Set(); let chain = Promise.resolve();
  function processPayload(payload) {
    chain = chain.then(async () => {
      for (const { msg } of flattenWebhook(payload)) {
        if (seen.has(msg.id)) continue; seen.add(msg.id); if (seen.size > 1000) seen.delete(seen.values().next().value);
        try { await handleMessage(msg); } catch (e) { console.error('handle failed', e); }
      }
      save();
    }).catch(e => console.error(e));
    return chain;
  }

  return { server, processPayload, tick, importAppointments, addWaitlist, stats, db: () => db };
}

module.exports = { createReminderService, zonedToUtc, fmtWhen, parseCsv, localParts, DEFAULTS };

if (require.main === module) {
  const env = process.env;
  const svc = createReminderService({
    businessName: env.BUSINESS_NAME, dataFile: env.DATA_FILE || path.join(__dirname, 'data', 'reminders.json'),
    verifyToken: env.VERIFY_TOKEN, appSecret: env.APP_SECRET, adminToken: env.ADMIN_TOKEN,
    wa: { phoneId: env.PHONE_NUMBER_ID, token: env.WA_TOKEN, graphVersion: env.GRAPH_VERSION || 'v23.0' },
    telegram: { telegramToken: env.TELEGRAM_BOT_TOKEN, telegramChat: env.TELEGRAM_CHAT_ID }
  });
  if (env.APPOINTMENTS_CSV) console.log('ייבוא:', JSON.stringify(svc.importAppointments(fs.readFileSync(env.APPOINTMENTS_CSV, 'utf8')).skipped));
  const port = +env.PORT || 3001;
  svc.server.listen(port, () => console.log('תזכורות פעיל בפורט', port));
  setInterval(() => svc.tick().catch(e => console.error('tick', e)), 60000);
}
