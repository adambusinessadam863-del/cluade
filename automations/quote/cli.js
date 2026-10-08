#!/usr/bin/env node
'use strict';
// שימוש: node cli.js --preset movers --input samples/movers-input.json --biz samples/biz.json --out out [--customer "דנה" --phone 0501234567] [--pdf]
const fs = require('fs');
const path = require('path');
const C = require('./core.js');
const P = require('./presets.js');

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) { const k = argv[i].slice(2); o[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; }
  return o;
}

async function main() {
  const a = args(process.argv.slice(2));
  const preset = P[a.preset];
  if (!preset) { console.error('--preset חובה: ' + Object.keys(P).join(' | ')); process.exit(1); }
  const inputs = a.input ? JSON.parse(fs.readFileSync(a.input, 'utf8')) : {};
  const biz = a.biz ? JSON.parse(fs.readFileSync(a.biz, 'utf8')) : { name: 'שם העסק' };
  const q = C.buildQuote(preset, inputs, { customer: { name: a.customer, phone: a.phone }, seq: Number(a.seq) || 1, discountPct: Number(a.discount) || 0 });
  const out = a.out || 'out';
  fs.mkdirSync(out, { recursive: true });
  const base = path.join(out, q.number);
  fs.writeFileSync(base + '.html', C.renderHTML(q, biz));
  fs.writeFileSync(base + '.txt', C.renderText(q, biz));
  console.log('נוצרו:', base + '.html', base + '.txt', '| סה״כ', C.money(q.total));
  if (a.phone) console.log('קישור וואטסאפ:', C.waLink(a.phone, C.renderText(q, biz)));
  if (a.pdf) {
    let chromium;
    try { ({ chromium } = require('playwright')); } catch { console.error('PDF דורש playwright: npm i playwright'); process.exit(2); }
    const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
    const p = await b.newPage();
    await p.goto('file://' + path.resolve(base + '.html'));
    await p.pdf({ path: base + '.pdf', format: 'A4', printBackground: true });
    await b.close();
    console.log('נוצר PDF:', base + '.pdf');
  }
}
main().catch(e => { console.error(e); process.exit(1); });
