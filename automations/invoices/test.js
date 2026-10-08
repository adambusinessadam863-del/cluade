'use strict';
const assert = require('assert');
const { validateInvoice, validateBatch, isValidIsraeliId } = require('./validate.js');
const { buildRequest, extractInvoice } = require('./extract.js');
const { toCsv } = require('./csv.js');
const ok = m => console.log('ok', m);
const today = () => new Date('2026-10-08T12:00:00');

// ת.ז / ח.פ
assert.ok(isValidIsraeliId('123456782')); assert.ok(isValidIsraeliId('000000018')); assert.ok(isValidIsraeliId('51-234-567-0'.replace(/\D/g, '')) === isValidIsraeliId('512345670'));
assert.ok(!isValidIsraeliId('123456789')); assert.ok(!isValidIsraeliId('')); assert.ok(!isValidIsraeliId('12'));
ok('Israeli ID checksum');

const base = { document_type: 'tax_invoice', supplier_name: 'ספק בע״מ', supplier_tax_id: '123456782', invoice_number: 'A-100', allocation_number: '', date: '2026-10-01', currency: 'ILS', net_amount: 1000, vat_amount: 180, total_amount: 1180, summary: 'חומרי גלם', confidence: 0.95, missing_fields: [] };
const v = (over, opts) => validateInvoice({ ...base, ...over }, { today, ...opts });

assert.strictEqual(v({}).status, 'ok');
ok('clean invoice passes');

assert.ok(v({ total_amount: 1200 }).reasons.some(r => r.includes('לא מתאים')));
assert.ok(v({ vat_amount: 100, total_amount: 1100 }).reasons.some(r => r.includes('מע״מ')));
assert.ok(v({ supplier_tax_id: '123456789' }).reasons.some(r => r.includes('עוסק')));
assert.ok(v({ date: '2026-12-01' }).reasons.includes('תאריך עתידי'));
assert.ok(v({ date: '31/12/2026' }).reasons.includes('תאריך לא תקין'));
assert.ok(v({ date: '2024-01-01' }).reasons.includes('תאריך ישן מאוד'));
assert.ok(v({ confidence: 0.4 }).reasons.some(r => r.includes('ודאות')));
assert.ok(v({ missing_fields: ['invoice_number'], invoice_number: '' }).reasons.some(r => r.includes('שדות חסרים')));
ok('math, VAT rate, tax id, date, confidence, missing fields');

// מספר הקצאה: מעל הסף חובה (רק בחשבונית מס), מתחת לסף או בקבלה לא
const big = { net_amount: 6000, vat_amount: 1080, total_amount: 7080 };
assert.ok(v(big).reasons.some(r => r.includes('מספר הקצאה')));
assert.ok(!v({ ...big, allocation_number: '123456789' }).reasons.some(r => r.includes('מספר הקצאה')));
assert.ok(!v({ ...big, document_type: 'receipt' }).reasons.some(r => r.includes('מספר הקצאה')));
assert.ok(!v({ net_amount: 4900, vat_amount: 882, total_amount: 5782 }).reasons.some(r => r.includes('מספר הקצאה')));
assert.ok(!v(big, { allocationThreshold: 20000 }).reasons.some(r => r.includes('מספר הקצאה')));
ok('allocation number rule (configurable threshold)');

// כפילויות בקבוצה
const batch = validateBatch([base, { ...base, summary: 'עותק' }, { ...base, invoice_number: 'A-101' }], { today });
assert.deepStrictEqual(batch.map(b => b.status), ['ok', 'review', 'ok']);
assert.ok(batch[1].reasons.some(r => r.includes('כפילות')));
ok('duplicate detection');

// בקשה למודל: מסמך לפני הטקסט, base64, בלי פרמטרים אסורים
const pdf = Buffer.from('%PDF-1.4 fake');
let req = buildRequest(pdf, '.pdf');
assert.strictEqual(req.messages[0].content[0].type, 'document');
assert.strictEqual(req.messages[0].content[0].source.data, pdf.toString('base64'));
assert.strictEqual(req.messages[0].content[1].type, 'text');
assert.strictEqual(buildRequest(Buffer.from('x'), '.JPG').messages[0].content[0].source.media_type, 'image/jpeg');
assert.throws(() => buildRequest(pdf, '.exe'), /לא נתמך/);
assert.ok(!('temperature' in req) && req.model === 'claude-opus-5-5' && req.system.includes('untrusted data'));
ok('request shape (PDF/image, media types, unsupported file)');

// חילוץ עם לקוח מדומה + סירוב/חיתוך
(async () => {
const stub = r => ({ messages: { create: async () => r } });
assert.deepStrictEqual(await extractInvoice(stub({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(base) }] }), pdf, '.pdf'), base);
await assert.rejects(extractInvoice(stub({ stop_reason: 'refusal', content: [] }), pdf, '.pdf'), /סירב/);
await assert.rejects(extractInvoice(stub({ stop_reason: 'max_tokens', content: [] }), pdf, '.pdf'), /נחתך/);
ok('extract with stub, refusal, truncation');

// CSV: BOM, גרשיים, והגנה מנוסחאות
const csv = toCsv([{ file: 'a.pdf', status: 'review', reasons: ['שגיאה, אחת', 'שנייה'], supplier_name: '=HYPERLINK("http://evil")', total_amount: -5, summary: 'שורה\nשנייה' }]);
assert.ok(csv.startsWith('﻿'));
assert.ok(csv.includes('"\'=HYPERLINK(""http://evil"")"'));
assert.ok(csv.includes('"שגיאה, אחת; שנייה"') && csv.includes(',-5,'));
ok('CSV: BOM, quoting, formula injection guard');

console.log('\nall invoice tests passed');
})().catch(e => { console.error(e); process.exit(1); });
