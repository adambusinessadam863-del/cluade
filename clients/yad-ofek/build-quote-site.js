'use strict';
// בונה אתר סטטי של כלי הצעות המחיר עם המחירון והמיתוג של יד אופק. הפלט: dist/quote (מעלים לאחסון סטטי).
// node build-quote-site.js
const fs = require('fs');
const path = require('path');
const { config, pricing } = require('./index.js');

const src = path.join(__dirname, '..', '..', 'automations', 'quote');
const out = path.join(__dirname, 'dist', 'quote');
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
for (const f of ['core.js', 'presets.js']) fs.copyFileSync(path.join(src, f), path.join(out, f));
for (const f of ['app.js', 'style.css']) fs.copyFileSync(path.join(src, 'web', f), path.join(out, f));

const defaults = { only: ['movers'], settings: { bizName: config.businessName, bizPhone: config.quote.phone, bizColor: config.quote.brandColor, vat: true, valid: 7 } };
fs.writeFileSync(path.join(out, 'client.js'),
  `QuotePresets.movers = QuotePresets.makeMovers(${JSON.stringify(pricing.prices)});\nwindow.QUOTE_DEFAULTS = ${JSON.stringify(defaults)};\nwindow.QUOTE_PRICES_CONFIRMED = ${pricing.confirmed};\n`);

let html = fs.readFileSync(path.join(src, 'web', 'index.html'), 'utf8')
  .replace(/\s*<a class="home"[^>]*>.*?<\/a>/s, '')
  .replace('<script src="../core.js"></script>', '<script src="core.js"></script>')
  .replace('<script src="../presets.js"></script>', '<script src="presets.js"></script>\n<script src="client.js"></script>')
  .replace('<title>מחולל הצעות מחיר</title>', `<title>הצעות מחיר: ${config.businessName}</title>`);
if (!pricing.confirmed) html = html.replace('<main class="grid">', '<p style="margin:0 16px;padding:10px 14px;background:#fff3cd;color:#5c4a00;border-radius:8px">המחירון בכלי הוא מחירון לדוגמה. לא לשלוח ללקוחות עד שהמחירון האמיתי יוזן.</p>\n<main class="grid">');
fs.writeFileSync(path.join(out, 'index.html'), html);
console.log('נבנה:', out, pricing.confirmed ? '(מחירון מאושר)' : '(מחירון לדוגמה, יש להחליף)');
