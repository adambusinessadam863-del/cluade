'use strict';
// gateway: נקודת כניסה אחת (webhook אחד) לכל האוטומציות של לקוח, כי למספר וואטסאפ אחד יש כתובת webhook אחת.
// ההודעה נשלחת למודול שהיא שייכת לו: תשובה לתזכורת → תזכורות, משוב אחרי ביקורת → ביקורות, כל השאר → מענה ומעקב לידים.
const path = require('path');
const { createWA, createNotifier, flattenWebhook, extractInbound, createWebhookServer, bearerOk } = require('../common/wa.js');
const { createReminderService } = require('../reminders/index.js');
const { createReviewService } = require('../reviews/index.js');
const { createApp: createLeadApp } = require('../../whatsapp-followup/server/server.js');

const OPTOUT = /^(הסר|הסרה|stop|unsubscribe)$/i;

// client = { config, flow, leadExtra? }  (ראו clients/<id>/index.js)   secrets = { wa, telegram, ... } מהסביבה בלבד
function createGateway(client, secrets, io = {}) {
  const cfg = client.config, on = cfg.features || {};
  const now = io.now || Date.now;
  const wa = io.wa || createWA({ ...secrets.wa, fetch: io.fetch });
  const notify = io.notify || createNotifier({ ...secrets.telegram, fetch: io.fetch });
  const dir = secrets.dataDir || path.join(__dirname, 'data', cfg.id);
  const shared = { wa, notify, now, fetch: io.fetch };

  const leads = on.leads ? createLeadApp({
    bizName: cfg.businessName, flow: 'custom', dataFile: path.join(dir, 'leads.json'),
    templates: [null, cfg.templates.followupDay || '', cfg.templates.followupLast || ''], ownerReminderMin: cfg.ownerReminderMin || 0
  }, { ...shared, flow: client.flow, classify: io.classify, leadExtra: client.leadExtra }) : null;

  const reminders = on.reminders ? createReminderService({
    businessName: cfg.businessName, timezone: cfg.timezone, dataFile: path.join(dir, 'reminders.json'),
    templates: { reminder: cfg.templates.reminder, slot: cfg.templates.slot }, waitlist: cfg.reminders && cfg.reminders.waitlist,
    ...(cfg.reminders && cfg.reminders.rules ? { reminders: cfg.reminders.rules } : {})
  }, shared) : null;

  const reviews = on.reviews ? createReviewService({
    businessName: cfg.businessName, timezone: cfg.timezone, dataFile: path.join(dir, 'reviews.json'),
    reviewLink: cfg.reviews.link, delayHours: cfg.reviews.delayHours, templates: { request: cfg.templates.review }, requireConsent: cfg.reviews.requireConsent !== false
  }, shared) : null;

  const modules = [leads, reminders, reviews].filter(Boolean);
  const leadInProgress = from => { const l = leads && leads.leads()[from]; return !!(l && !l.done && l.step >= 0 && !l.optedOut); };

  async function route(msg, profileName) {
    const { text } = extractInbound(msg), from = msg.from;
    if (OPTOUT.test(text.trim())) {
      modules.forEach(m => m.optOut(from));
      await wa.sendText(from, 'הוסרת מכל ההודעות האוטומטיות ✅');
      return 'optout';
    }
    if (reminders && reminders.owns(msg)) { await reminders.handleMessage(msg); return 'reminders'; }
    if (reviews && reviews.owns(msg) && !leadInProgress(from)) { await reviews.handleMessage(msg); return 'reviews'; }
    if (leads) { await leads.handleMessage(msg, profileName); return 'leads'; }
    return 'ignored';
  }

  const seen = new Set(); let chain = Promise.resolve();
  const routed = [];
  function processPayload(payload) {
    chain = chain.then(async () => {
      for (const { msg, profileName } of flattenWebhook(payload)) {
        if (seen.has(msg.id)) continue; seen.add(msg.id); if (seen.size > 2000) seen.delete(seen.values().next().value);
        try { routed.push(await route(msg, profileName)); } catch (e) { console.error('route failed', e); }
      }
      modules.forEach(m => m.save());
    }).catch(e => console.error(e));
    return chain;
  }

  async function tick() { for (const m of modules) await m.tick(); }

  const path_ = secrets.webhookPath || '/webhook';
  const server = createWebhookServer({
    verifyToken: secrets.verifyToken, appSecret: secrets.appSecret, allowUnsigned: !!secrets.allowUnsigned, path: path_, onPayload: processPayload,
    routes(req, res, url) {
      if (!bearerOk(req, secrets.adminToken)) return false;
      const json = o => { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(o)); return true; };
      if (req.method === 'GET' && url.pathname === '/admin/stats') return json({ reminders: reminders && reminders.stats(), reviews: reviews && reviews.stats(), leads: leads && Object.values(leads.leads()).filter(l => l.done).length });
      if (req.method === 'POST' && (url.pathname === '/admin/appointments' || url.pathname === '/admin/visits')) {
        const mod = url.pathname.endsWith('appointments') ? reminders : reviews;
        if (!mod) { res.writeHead(404); res.end(); return true; }
        const chunks = []; req.on('data', c => chunks.push(c));
        req.on('end', () => { const csv = Buffer.concat(chunks).toString('utf8'); const r = mod === reminders ? mod.importAppointments(csv) : mod.importVisits(csv); json({ added: r.added.length, skipped: r.skipped }); });
        return true;
      }
      return false;
    }
  });

  return { server, processPayload, tick, route, routed, leads, reminders, reviews };
}

module.exports = { createGateway };
