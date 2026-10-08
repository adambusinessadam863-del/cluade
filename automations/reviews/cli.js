#!/usr/bin/env node
'use strict';
// node cli.js --reviews samples/reviews.json --profile samples/profile.json --out out
// דורש ANTHROPIC_API_KEY (או התחברות עם ant auth login) ואת החבילה @anthropic-ai/sdk.
const fs = require('fs');
const path = require('path');
const { draftReplies, renderSheet } = require('./drafts.js');

const arg = k => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : undefined; };
(async () => {
  const reviews = JSON.parse(fs.readFileSync(arg('reviews') || 'samples/reviews.json', 'utf8'));
  const profile = JSON.parse(fs.readFileSync(arg('profile') || 'samples/profile.json', 'utf8'));
  let Anthropic; try { const m = require('@anthropic-ai/sdk'); Anthropic = m.default || m; } catch { console.error('חסרה החבילה: npm i @anthropic-ai/sdk'); process.exit(2); }
  const out = await draftReplies(new Anthropic({ timeout: 120000 }), reviews, profile);
  const dir = arg('out') || 'out'; fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'drafts.html'), renderSheet(out, profile));
  fs.writeFileSync(path.join(dir, 'drafts.json'), JSON.stringify(out, null, 2));
  console.log(`נוצרו ${out.items.length} טיוטות, ${out.items.filter(i => i.needs_owner).length} דורשות בדיקה: ${path.join(dir, 'drafts.html')}`);
})().catch(e => { console.error(e.message); process.exit(1); });
