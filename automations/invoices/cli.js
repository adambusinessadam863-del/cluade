#!/usr/bin/env node
'use strict';
// node cli.js --dir ./חשבוניות --out invoices.csv
// דורש ANTHROPIC_API_KEY (או ant auth login) ואת החבילה @anthropic-ai/sdk.
const fs = require('fs');
const path = require('path');
const { extractInvoice } = require('./extract.js');
const { validateBatch } = require('./validate.js');
const { toCsv } = require('./csv.js');
const arg = k => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : undefined; };

(async () => {
  const dir = arg('dir'); if (!dir) { console.error('--dir חובה'); process.exit(1); }
  let Anthropic; try { const m = require('@anthropic-ai/sdk'); Anthropic = m.default || m; } catch { console.error('חסרה החבילה: npm i @anthropic-ai/sdk'); process.exit(2); }
  const client = new Anthropic({ timeout: 120000 });
  const files = fs.readdirSync(dir).filter(f => /\.(pdf|jpe?g|png|webp|gif)$/i.test(f));
  const extracted = [], failed = [];
  for (const f of files) {
    try { extracted.push({ file: f, ...(await extractInvoice(client, fs.readFileSync(path.join(dir, f)), path.extname(f))) }); console.log('✓', f); }
    catch (e) { failed.push({ file: f, status: 'review', reasons: [e.message], document_type: 'other' }); console.error('✗', f, e.message); }
  }
  const rows = [...validateBatch(extracted), ...failed];
  const out = arg('out') || 'invoices.csv';
  fs.writeFileSync(out, toCsv(rows));
  console.log(`נכתב ${out}: ${rows.filter(r => r.status === 'ok').length} תקינות, ${rows.filter(r => r.status === 'review').length} לבדיקה`);
})().catch(e => { console.error(e.message); process.exit(1); });
