'use strict';
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const FLOWS = require('../flows.js');

const OPT_OUT = /^(הסר|הסרה|stop|unsubscribe)$/i;
const CALL_ME = /התקשרו|תתקשרו|שיחה|תחזרו/;
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function loadConfig(env) {
  return {
    port: +env.PORT || 3000,
    verifyToken: env.VERIFY_TOKEN || '',
    appSecret: env.APP_SECRET || '',
    token: env.WA_TOKEN || '',
    phoneId: env.PHONE_NUMBER_ID || '',
    graphBase: env.GRAPH_BASE || 'https://graph.facebook.com',
    graphVersion: env.GRAPH_VERSION || 'v23.0',
    bizName: env.BUSINESS_NAME || 'העסק',
    flow: env.FLOW || 'driving',
    dataFile: env.DATA_FILE || path.join(__dirname, 'data', 'leads.json'),
    telegramToken: env.TELEGRAM_BOT_TOKEN || '',
    telegramChat: env.TELEGRAM_CHAT_ID || '',
    telegramBase: env.TELEGRAM_BASE || 'https://api.telegram.org',
    templates: [null, env.TEMPLATE_FU_2 || '', env.TEMPLATE_FU_3 || ''], // מעקב ראשון (שעה) נשלח בתוך חלון 24 השעות
    ownerReminderMin: +env.OWNER_REMINDER_MIN || 0,
    adminToken: env.ADMIN_TOKEN || '',
    allowUnsigned: env.ALLOW_UNSIGNED === '1'
  };
}

function createApp(cfg, io = {}) {
  const fetchFn = io.fetch || fetch;
  const now = io.now || Date.now;
  const classify = io.classify || null;
  const flow = io.flow || FLOWS[cfg.flow]; // io.flow: תהליך מותאם ללקוח (ראו clients/)
  if (!flow) throw new Error('FLOW לא מוכר: ' + cfg.flow);

  const fill = (s, extra = {}) => s.replace(/\{(\w+)\}/g, (_, k) => (k === 'biz' ? cfg.bizName : extra[k] ?? ''));

  // ---------- אחסון ----------
  let leads = {};
  try { leads = JSON.parse(fs.readFileSync(cfg.dataFile, 'utf8')); } catch { /* קובץ חדש */ }
  const save = () => {
    fs.mkdirSync(path.dirname(cfg.dataFile), { recursive: true });
    const tmp = cfg.dataFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(leads, null, 2));
    fs.renameSync(tmp, cfg.dataFile);
  };

  // ---------- שליחה ----------
  async function sendWA(to, payload) {
    if (io.wa) return io.wa.send(to, payload); // שליחה משותפת מה-gateway (תומכת גם בספקי WhatsApp)
    const url = `${cfg.graphBase}/${cfg.graphVersion}/${cfg.phoneId}/messages`;
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + cfg.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, ...payload })
    });
    if (!res.ok) console.error('WhatsApp send failed', res.status, await res.text().catch(() => ''));
    return res.ok;
  }
  const sendText = (to, body) => sendWA(to, { type: 'text', text: { body, preview_url: false } });

  async function notifyOwner(text) {
    if (io.notify) return io.notify(text);
    console.log('[owner]', text.replace(/\n/g, ' | '));
    if (!cfg.telegramToken || !cfg.telegramChat) return;
    const res = await fetchFn(`${cfg.telegramBase}/bot${cfg.telegramToken}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: cfg.telegramChat, text })
    });
    if (!res.ok) console.error('telegram failed', res.status);
  }

  // ---------- שאלות ----------
  function askPayload(step, idx, text) {
    if (step.type !== 'choice') return { type: 'text', text: { body: text, preview_url: false } };
    const o = step.options;
    if (o.length <= 3 && o.every(x => x.label.length <= 20)) {
      return { type: 'interactive', interactive: { type: 'button', body: { text },
        action: { buttons: o.map((x, i) => ({ type: 'reply', reply: { id: `s${idx}o${i}`, title: x.label } })) } } };
    }
    return { type: 'interactive', interactive: { type: 'list', body: { text },
      action: { button: 'בחירה', sections: [{ title: 'אפשרויות', rows: o.slice(0, 10).map((x, i) => {
        const row = { id: `s${idx}o${i}`, title: trunc(x.label, 24) };
        if (x.label.length > 24) row.description = trunc(x.label, 72);
        return row;
      }) }] } } };
  }
  const ask = (lead, prefix = '') =>
    sendWA(lead.id, askPayload(flow.steps[lead.step], lead.step, prefix + flow.steps[lead.step].ask));

  const summary = lead => Object.entries(lead.answers).filter(([k]) => k !== 'שם').map(([k, v]) => `• ${k}: ${v}`).join('\n');
  const isHot = lead => lead.score >= flow.hotAt;

  async function finish(lead) {
    lead.done = true; lead.doneAt = now();
    await sendText(lead.id, fill(flow.handoff, { name: lead.name, summary: summary(lead) }));
    const extra = io.leadExtra ? await io.leadExtra(lead) : ''; // למשל הערכת מחיר פנימית לבעל העסק
    await notifyOwner(`${isHot(lead) ? '🔥 ליד חם' : '🟡 ליד'} מוואטסאפ\n${lead.name || lead.profileName || 'ללא שם'}\n${summary(lead)}\nטלפון: +${lead.id}${extra ? '\n' + extra : ''}`);
  }

  async function advance(lead, text, option) {
    const step = flow.steps[lead.step];
    lead.answers[step.key] = text;
    if (step.isName) lead.name = text;
    if (option) lead.score += option.score || 0;
    lead.fuIdx = 0; lead.misses = 0;
    if (option && option.reply) await sendText(lead.id, option.reply);
    lead.step++;
    if (lead.step >= flow.steps.length) return finish(lead);
    return ask(lead);
  }

  // ---------- הודעה נכנסת ----------
  function extract(msg) {
    if (msg.type === 'text') return { text: (msg.text.body || '').trim() };
    if (msg.type === 'interactive') {
      const i = msg.interactive || {};
      const r = i.button_reply || i.list_reply;
      return r ? { text: r.title, id: r.id } : { text: '' };
    }
    if (['image', 'video', 'document', 'audio'].includes(msg.type)) return { text: '📷 נשלח קובץ', media: true };
    return { text: '' };
  }

  async function handleMessage(msg, profileName) {
    const from = msg.from;
    const { text, id, media } = extract(msg);
    let lead = leads[from];
    if (lead && lead.optedOut) return;
    if (OPT_OUT.test(text)) {
      if (!lead) lead = leads[from] = { id: from, step: -1, answers: {}, score: 0, optedOut: true };
      lead.optedOut = true;
      await sendText(from, 'הוסרת מהרשימה ✅ לא נשלח לך עוד הודעות. תודה!');
      return;
    }
    if (!lead) {
      lead = leads[from] = { id: from, profileName: profileName || '', name: '', step: -1, answers: {}, score: 0,
        done: false, optedOut: false, fuIdx: 0, misses: 0, createdAt: now() };
    }
    lead.lastInboundAt = now();

    if (lead.step === -1) {
      await sendText(from, fill(flow.greeting));
      lead.step = 0;
      return ask(lead);
    }
    if (lead.done) {
      if (CALL_ME.test(text)) {
        await notifyOwner(`📞 ${lead.name || from} מבקש/ת שיחה. טלפון: +${from}`);
        return sendText(from, 'מעולה, נתקשר אליך בהקדם 📞');
      }
      await notifyOwner(`💬 הודעה חדשה מ${lead.name || from}: ${text}\nטלפון: +${from}`);
      if (!lead.ackSent) { lead.ackSent = true; return sendText(from, 'קיבלנו ✅ נעביר לצוות.'); }
      return;
    }

    const step = flow.steps[lead.step];
    if (step.type === 'text') return advance(lead, text || '—');
    if (media) return ask(lead, 'כדי להמשיך, בבקשה בחרו אחת מהאפשרויות 🙏\n');

    let idx = -1;
    const m = id && /^s(\d+)o(\d+)$/.exec(id);
    if (m && +m[1] === lead.step) idx = +m[2];
    if (idx < 0) idx = step.options.findIndex(o => o.label === text);
    if (idx < 0 && text.endsWith('…')) idx = step.options.findIndex(o => o.label.startsWith(text.slice(0, -1)));
    if (idx < 0 && classify && text) { const n = await classify(text, step); if (n !== null) idx = n; }
    if (idx >= 0 && step.options[idx]) return advance(lead, step.options[idx].label, step.options[idx]);

    lead.misses++;
    if (lead.misses >= 2) return advance(lead, 'אחר: ' + text.slice(0, 200)); // לא לתקוע את הלקוח
    return ask(lead, 'לא הצלחתי להבין 🙏 אפשר לבחור מהאפשרויות:\n');
  }

  // ---------- עיבוד Webhook ----------
  const seen = new Set();
  let chain = Promise.resolve();
  function processPayload(payload) {
    chain = chain.then(async () => {
      for (const entry of payload.entry || []) for (const ch of entry.changes || []) {
        const v = ch.value || {};
        const names = Object.fromEntries((v.contacts || []).map(c => [c.wa_id, c.profile && c.profile.name]));
        for (const msg of v.messages || []) {
          if (seen.has(msg.id)) continue; // Meta שולחת שוב אם לא ענינו בזמן
          seen.add(msg.id); if (seen.size > 1000) seen.delete(seen.values().next().value);
          try { await handleMessage(msg, names[msg.from]); } catch (e) { console.error('handle failed', e); }
        }
      }
      save();
    }).catch(e => console.error('chain', e));
    return chain;
  }

  // ---------- מעקבים ----------
  async function tick() {
    const t = now();
    for (const lead of Object.values(leads)) {
      if (lead.optedOut) continue;
      if (!lead.done && lead.step >= 0 && lead.fuIdx < flow.followups.length) {
        const fu = flow.followups[lead.fuIdx];
        if (t - lead.lastInboundAt >= fu.after * 60000) {
          const idx = lead.fuIdx++;
          if (t - lead.lastInboundAt < 23 * 3600000) await sendText(lead.id, fu.text);
          else if (cfg.templates[idx]) await sendWA(lead.id, { type: 'template', template: { name: cfg.templates[idx], language: { code: 'he' } } });
          else console.warn(`אין תבנית מעקב #${idx + 1} מוגדרת, מדלגים על ${lead.id}`);
        }
      }
      if (cfg.ownerReminderMin && lead.done && !lead.contacted && !lead.reminded && t - lead.doneAt >= cfg.ownerReminderMin * 60000) {
        lead.reminded = true;
        await notifyOwner(`⏰ תזכורת: הליד של ${lead.name || lead.id} עדיין ממתין לחזרה. טלפון: +${lead.id}`);
      }
    }
    save();
  }

  // ---------- HTTP ----------
  function verifySig(raw, header) {
    if (cfg.allowUnsigned) return true;
    if (!cfg.appSecret || !header) return false;
    const exp = Buffer.from('sha256=' + crypto.createHmac('sha256', cfg.appSecret).update(raw).digest('hex'));
    const got = Buffer.from(header);
    return exp.length === got.length && crypto.timingSafeEqual(exp, got);
  }
  const authed = req => {
    if (!cfg.adminToken) return false;
    const a = Buffer.from(String(req.headers.authorization || '')), b = Buffer.from('Bearer ' + cfg.adminToken);
    return a.length === b.length && crypto.timingSafeEqual(a, b); // זמן קבוע
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && url.pathname === '/webhook') {
      const ok = url.searchParams.get('hub.mode') === 'subscribe' && cfg.verifyToken && url.searchParams.get('hub.verify_token') === cfg.verifyToken;
      res.writeHead(ok ? 200 : 403); return res.end(ok ? url.searchParams.get('hub.challenge') : 'forbidden');
    }
    if (req.method === 'POST' && url.pathname === '/webhook') {
      const chunks = []; let size = 0;
      req.on('data', c => { size += c.length; if (size > 1e6) req.destroy(); else chunks.push(c); });
      req.on('end', () => {
        const raw = Buffer.concat(chunks);
        if (!verifySig(raw, req.headers['x-hub-signature-256'])) { res.writeHead(401); return res.end(); }
        res.writeHead(200); res.end('ok'); // עונים מיד; העיבוד ממשיך ברקע
        try { processPayload(JSON.parse(raw.toString('utf8'))); } catch (e) { console.error('bad payload', e.message); }
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/leads' && authed(req)) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(Object.values(leads).map(l => ({ id: l.id, name: l.name, done: l.done, hot: isHot(l), answers: l.answers, contacted: !!l.contacted }))));
    }
    const ack = req.method === 'POST' && /^\/ack\/(\d+)$/.exec(url.pathname);
    if (ack && authed(req)) {
      if (leads[ack[1]]) { leads[ack[1]].contacted = true; save(); res.writeHead(200); return res.end('ok'); }
    }
    res.writeHead(404); res.end();
  });

  const optOut = phone => {
    if (!leads[phone]) leads[phone] = { id: phone, step: -1, answers: {}, score: 0 };
    leads[phone].optedOut = true; save();
  };
  return { server, processPayload, tick, handleMessage, optOut, save, leads: () => leads };
}

module.exports = { createApp, loadConfig };

if (require.main === module) {
  const cfg = loadConfig(process.env);
  let classify = null;
  if (process.env.ANTHROPIC_API_KEY) {
    const mod = require('@anthropic-ai/sdk');
    const Anthropic = mod.default || mod;
    classify = require('./ai.js').createClassifier(new Anthropic({ timeout: 15000, maxRetries: 1 }));
  }
  const app = createApp(cfg, { classify });
  app.server.listen(cfg.port, () => console.log(`האזנה על פורט ${cfg.port} · תהליך: ${cfg.flow} · AI: ${classify ? 'פעיל' : 'כבוי'}`));
  setInterval(() => app.tick().catch(e => console.error('tick', e)), 60000);
}
