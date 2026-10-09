'use strict';
// הפעלה: CLIENT=yad-ofek node --env-file=.env automations/gateway/server.js
const path = require('path');
const { createGateway } = require('./index.js');

const id = process.env.CLIENT;
if (!id || !/^[a-z0-9-]+$/.test(id)) { console.error('חובה CLIENT=<שם תיקייה תחת clients/>'); process.exit(1); }
const client = require(path.join(__dirname, '..', '..', 'clients', id, 'index.js'));
const e = process.env;

// מצב "meta": Cloud API ישירות מול Meta. מצב "bsp": ספק כמו 360dialog (כתובת שליחה וכותרת מפתח משלו)
const wa = e.WA_MODE === 'bsp'
  ? { url: e.WA_SEND_URL, headers: { 'D360-API-KEY': e.WA_TOKEN } }
  : { phoneId: e.PHONE_NUMBER_ID, token: e.WA_TOKEN, graphVersion: e.GRAPH_VERSION || 'v23.0' };
if (!(e.WA_MODE === 'bsp' ? e.WA_SEND_URL && e.WA_TOKEN : e.PHONE_NUMBER_ID && e.WA_TOKEN)) { console.error('חסרים פרטי חיבור לוואטסאפ (ראו .env.example)'); process.exit(1); }

const gw = createGateway(client, {
  wa, telegram: { telegramToken: e.TELEGRAM_BOT_TOKEN, telegramChat: e.TELEGRAM_CHAT_ID },
  verifyToken: e.VERIFY_TOKEN, appSecret: e.APP_SECRET, adminToken: e.ADMIN_TOKEN,
  // במצב ספק אין חתימת Meta, ולכן מאבטחים בנתיב סודי (WEBHOOK_PATH=/webhook/<מחרוזת-אקראית-ארוכה>)
  allowUnsigned: e.WA_MODE === 'bsp', webhookPath: e.WEBHOOK_PATH || '/webhook', dataDir: e.DATA_DIR || path.join(__dirname, 'data', id)
}, {
  classify: e.ANTHROPIC_API_KEY ? (() => { const m = require('@anthropic-ai/sdk'); const A = m.default || m; return require('../../whatsapp-followup/server/ai.js').createClassifier(new A({ timeout: 15000, maxRetries: 1 })); })() : null
});
const port = +e.PORT || 3000;
gw.server.listen(port, () => console.log(`gateway פעיל: ${client.config.businessName} · פורט ${port} · נתיב ${e.WEBHOOK_PATH || '/webhook'}`));
setInterval(() => gw.tick().catch(err => console.error('tick', err)), 60000);
