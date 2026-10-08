'use strict';
// עזרים משותפים לכל האוטומציות: שליחה דרך WhatsApp Cloud API, התראה לבעל העסק, שרת Webhook מאובטח.
const http = require('http');
const crypto = require('crypto');

function createWA({ graphBase = 'https://graph.facebook.com', graphVersion = 'v23.0', phoneId, token, fetch: fetchFn = fetch }) {
  async function send(to, payload) {
    const res = await fetchFn(`${graphBase}/${graphVersion}/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, ...payload })
    });
    if (!res.ok) console.error('WhatsApp send failed', res.status, await res.text().catch(() => ''));
    return res.ok;
  }
  const sendText = (to, body) => send(to, { type: 'text', text: { body, preview_url: false } });
  // תבנית מאושרת מראש (חובה להודעה יזומה מחוץ לחלון 24 השעות). params = ערכי {{1}}, {{2}}...
  // quickReplies = מזהים (payload) לכפתורי "תשובה מהירה" שהוגדרו בתבנית, לפי הסדר.
  const sendTemplate = (to, name, params = [], quickReplies = [], lang = 'he') => {
    const components = [];
    if (params.length) components.push({ type: 'body', parameters: params.map(text => ({ type: 'text', text: String(text) })) });
    quickReplies.forEach((payload, index) => components.push({ type: 'button', sub_type: 'quick_reply', index: String(index), parameters: [{ type: 'payload', payload }] }));
    return send(to, { type: 'template', template: { name, language: { code: lang }, components } });
  };
  return { send, sendText, sendTemplate };
}

function createNotifier({ telegramToken, telegramChat, telegramBase = 'https://api.telegram.org', fetch: fetchFn = fetch, log = console.log }) {
  return async function notify(text) {
    log('[owner]', text.replace(/\n/g, ' | '));
    if (!telegramToken || !telegramChat) return false;
    const res = await fetchFn(`${telegramBase}/bot${telegramToken}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: telegramChat, text })
    });
    if (!res.ok) console.error('telegram failed', res.status);
    return res.ok;
  };
}

function verifySignature(raw, header, appSecret) {
  if (!appSecret || !header) return false;
  const exp = Buffer.from('sha256=' + crypto.createHmac('sha256', appSecret).update(raw).digest('hex'));
  const got = Buffer.from(header);
  return exp.length === got.length && crypto.timingSafeEqual(exp, got);
}

// השוואת טוקן ניהול בזמן קבוע (נגד ניחוש לפי זמן תגובה)
function bearerOk(req, token) {
  if (!token) return false;
  const a = Buffer.from(String(req.headers.authorization || '')), b = Buffer.from('Bearer ' + token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// מחלץ הודעה נכנסת לצורה אחידה: { text, id } (id = payload של כפתור/רשימה אם יש)
function extractInbound(msg) {
  switch (msg.type) {
    case 'text': return { text: (msg.text.body || '').trim() };
    case 'button': return { text: (msg.button.text || '').trim(), id: msg.button.payload }; // כפתור תשובה מהירה בתבנית
    case 'interactive': {
      const i = msg.interactive || {}; const r = i.button_reply || i.list_reply;
      return r ? { text: r.title, id: r.id } : { text: '' };
    }
    default: return { text: '' };
  }
}

// כל הודעות ה-webhook בצורה שטוחה: [{ msg, profileName }]
function flattenWebhook(payload) {
  const out = [];
  for (const entry of payload.entry || []) for (const ch of entry.changes || []) {
    const v = ch.value || {};
    const names = Object.fromEntries((v.contacts || []).map(c => [c.wa_id, c.profile && c.profile.name]));
    for (const msg of v.messages || []) out.push({ msg, profileName: names[msg.from] });
  }
  return out;
}

// שרת HTTP: אימות webhook (GET), קבלה חתומה (POST), ונתיבים נוספים (למשל admin)
function createWebhookServer({ verifyToken, appSecret, allowUnsigned = false, onPayload, routes = () => false }) {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && url.pathname === '/webhook') {
      const ok = url.searchParams.get('hub.mode') === 'subscribe' && verifyToken && url.searchParams.get('hub.verify_token') === verifyToken;
      res.writeHead(ok ? 200 : 403); return res.end(ok ? url.searchParams.get('hub.challenge') : 'forbidden');
    }
    if (req.method === 'POST' && url.pathname === '/webhook') {
      const chunks = []; let size = 0;
      req.on('data', c => { size += c.length; if (size > 1e6) req.destroy(); else chunks.push(c); });
      req.on('end', () => {
        const raw = Buffer.concat(chunks);
        if (!allowUnsigned && !verifySignature(raw, req.headers['x-hub-signature-256'], appSecret)) { res.writeHead(401); return res.end(); }
        res.writeHead(200); res.end('ok'); // עונים מיד; העיבוד ממשיך ברקע
        try { onPayload(JSON.parse(raw.toString('utf8'))); } catch (e) { console.error('bad payload', e.message); }
      });
      return;
    }
    if (routes(req, res, url)) return;
    res.writeHead(404); res.end();
  });
}

// ניקוי מספר טלפון ישראלי לפורמט וואטסאפ (972...). מחזיר null אם לא תקין.
function normalizePhone(raw) {
  let d = String(raw || '').replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = '972' + d.slice(1);
  if (!/^972(5\d{8}|[23489]\d{7})$/.test(d)) return null; // נייד (5X) או קווי
  return d;
}

module.exports = { bearerOk, createWA, createNotifier, verifySignature, extractInbound, flattenWebhook, createWebhookServer, normalizePhone };
