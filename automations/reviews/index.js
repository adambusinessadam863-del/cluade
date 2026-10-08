'use strict';
// בקשת ביקורת אחרי ביקור, שנשלחת לכולם באותו נוסח (בלי סינון לפי שביעות רצון, כי גוגל אוסרת זאת),
// והודעות פרטיות שחוזרות מהלקוחות מועברות לבעל העסק.
const fs = require('fs');
const path = require('path');
const { createWA, createNotifier, flattenWebhook, extractInbound, createWebhookServer, normalizePhone } = require('../common/wa.js');
const { zonedToUtc, localParts, parseCsv } = require('../reminders/index.js');

const DEFAULTS = {
  timezone: 'Asia/Jerusalem', businessName: 'העסק', reviewLink: '',
  templates: { request: 'review_request_v1' },
  delayHours: 3, maxAgeHours: 72, cooldownDays: 90, requireConsent: true,
  quiet: { fromHour: 21, toHour: 9, shabbat: true }
};
const OPTOUT = /^(הסר|הסרה|stop|unsubscribe)$/i;
const YES = /^(yes|true|1|כן|v|✓)$/i;

function createReviewService(userCfg, io = {}) {
  const cfg = { ...DEFAULTS, ...userCfg, templates: { ...DEFAULTS.templates, ...(userCfg.templates || {}) } };
  if (!/^https:\/\//.test(cfg.reviewLink)) throw new Error('reviewLink חובה (קישור https לביקורת בגוגל)');
  const now = io.now || Date.now, tz = cfg.timezone;
  const wa = io.wa || createWA({ ...cfg.wa, fetch: io.fetch });
  const notify = io.notify || createNotifier({ ...cfg.telegram, fetch: io.fetch });

  let db = { visits: {}, requested: {}, feedback: [], optedOut: {} };
  if (cfg.dataFile) { try { db = { ...db, ...JSON.parse(fs.readFileSync(cfg.dataFile, 'utf8')) }; } catch { /* חדש */ } }
  const save = () => { if (!cfg.dataFile) return; fs.mkdirSync(path.dirname(cfg.dataFile), { recursive: true }); fs.writeFileSync(cfg.dataFile + '.tmp', JSON.stringify(db, null, 2)); fs.renameSync(cfg.dataFile + '.tmp', cfg.dataFile); };

  function isQuiet(ms) {
    const p = localParts(ms, tz), q = cfg.quiet;
    return p.h >= q.fromHour || p.h < q.toHour || (q.shabbat && ((p.dow === 5 && p.h >= 15) || (p.dow === 6 && p.h < 20)));
  }

  function importVisits(csvText) {
    const [head, ...rest] = parseCsv(csvText); const added = [], skipped = [];
    if (!head) return { added, skipped };
    const col = names => head.findIndex(h => names.includes(h.trim().toLowerCase()));
    const ix = { name: col(['name', 'שם']), phone: col(['phone', 'טלפון', 'נייד']), visit: col(['visit', 'ביקור', 'מועד', 'תאריך']), service: col(['service', 'שירות']), consent: col(['consent', 'הסכמה']) };
    rest.forEach((r, i) => {
      const line = i + 2, name = (r[ix.name] || '').trim(), phone = normalizePhone(r[ix.phone]), visit = zonedToUtc((r[ix.visit] || '').trim(), tz);
      const consent = ix.consent < 0 ? true : YES.test((r[ix.consent] || '').trim());
      if (!name || !phone) return skipped.push({ line, reason: !name ? 'חסר שם' : 'טלפון לא תקין' });
      if (visit == null) return skipped.push({ line, reason: 'תאריך לא תקין' });
      if (cfg.requireConsent && !consent) return skipped.push({ line, reason: 'אין הסכמה לקבלת הודעות' });
      const id = `${phone}-${visit}`;
      if (db.visits[id]) return skipped.push({ line, reason: 'כבר קיים' });
      db.visits[id] = { id, name, phone, visit, service: (r[ix.service] || '').trim(), status: 'pending' };
      added.push(id);
    });
    save(); return { added, skipped };
  }

  async function tick() {
    const t = now();
    for (const v of Object.values(db.visits).sort((a, b) => a.visit - b.visit)) {
      if (v.status !== 'pending') continue;
      if (t - v.visit > cfg.maxAgeHours * 3600000) { v.status = 'expired'; continue; }
      if (t < v.visit + cfg.delayHours * 3600000 || isQuiet(t)) continue;
      if (db.optedOut[v.phone]) { v.status = 'optout'; continue; }
      const last = db.requested[v.phone];
      if (last && t - last < cfg.cooldownDays * 86400000) { v.status = 'cooldown'; continue; }
      // אותו נוסח ואותו קישור לכל לקוח. בכוונה אין שאלת דירוג שמכוונת למי שמקבל קישור.
      const ok = await wa.sendTemplate(v.phone, cfg.templates.request, [v.name, cfg.businessName, cfg.reviewLink]);
      if (ok) { v.status = 'sent'; v.sentAt = t; db.requested[v.phone] = t; }
    }
    save();
  }

  async function handleMessage(msg) {
    const { text } = extractInbound(msg), t = text.trim(), from = msg.from;
    if (OPTOUT.test(t)) { db.optedOut[from] = true; await wa.sendText(from, 'הוסרת מהרשימה ✅'); return; }
    if (!t) return;
    const visit = Object.values(db.visits).filter(v => v.phone === from && v.status === 'sent').sort((a, b) => b.sentAt - a.sentAt)[0];
    db.feedback.push({ phone: from, name: visit ? visit.name : '', text: t, at: now() });
    await notify(`💬 משוב פרטי מ${visit ? visit.name : 'לקוח'} (+${from}):\n${t}`);
    if (visit && !visit.ack) { visit.ack = true; await wa.sendText(from, 'תודה ששיתפת! העברנו לבעלים ונחזור אליך אישית 🙏'); }
  }

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

  const stats = () => { const v = Object.values(db.visits); return { visits: v.length, requested: v.filter(x => x.status === 'sent').length, feedback: db.feedback.length, optedOut: Object.keys(db.optedOut).length }; };
  const authed = req => cfg.adminToken && req.headers.authorization === 'Bearer ' + cfg.adminToken;
  const server = createWebhookServer({
    verifyToken: cfg.verifyToken, appSecret: cfg.appSecret, allowUnsigned: cfg.allowUnsigned, onPayload: processPayload,
    routes(req, res, url) {
      if (authed(req) && req.method === 'GET' && url.pathname === '/stats') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(stats())); return true; }
      return false;
    }
  });
  return { server, processPayload, tick, importVisits, stats, db: () => db };
}

module.exports = { createReviewService, DEFAULTS };

if (require.main === module) {
  const env = process.env;
  const svc = createReviewService({
    businessName: env.BUSINESS_NAME, reviewLink: env.REVIEW_LINK, dataFile: env.DATA_FILE || path.join(__dirname, 'data', 'reviews.json'),
    verifyToken: env.VERIFY_TOKEN, appSecret: env.APP_SECRET, adminToken: env.ADMIN_TOKEN,
    wa: { phoneId: env.PHONE_NUMBER_ID, token: env.WA_TOKEN, graphVersion: env.GRAPH_VERSION || 'v23.0' },
    telegram: { telegramToken: env.TELEGRAM_BOT_TOKEN, telegramChat: env.TELEGRAM_CHAT_ID }
  });
  if (env.VISITS_CSV) console.log('ייבוא:', JSON.stringify(svc.importVisits(fs.readFileSync(env.VISITS_CSV, 'utf8')).skipped));
  const port = +env.PORT || 3002;
  svc.server.listen(port, () => console.log('בקשות ביקורת פעיל בפורט', port));
  setInterval(() => svc.tick().catch(e => console.error('tick', e)), 60000);
}
