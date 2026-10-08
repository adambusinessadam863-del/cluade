'use strict';
// בדיקות על נתוני חשבונית אחרי החילוץ: חשבון, תאריך, כפילויות, מספר הקצאה, ודאות.
const DEFAULTS = {
  vatRate: 0.18,                // בדקו את השיעור הנוכחי
  allocationThreshold: 5000,    // סף (לפני מע״מ) לחובת מספר הקצאה. נקבע ע״י רשות המסים ויורד בשלבים. בדקו מול האתר שלהם
  minConfidence: 0.7,
  maxAgeDays: 400,
  today: () => new Date()
};

// ת.ז / ח.פ / עוסק מורשה: 9 ספרות, סכום ספרות הכפל לסירוגין 1,2 מתחלק ב-10
function isValidIsraeliId(raw) {
  const s = String(raw || '').replace(/\D/g, '');
  if (s.length < 5 || s.length > 9) return false;
  const id = s.padStart(9, '0');
  let sum = 0;
  for (let i = 0; i < 9; i++) { let n = Number(id[i]) * (i % 2 === 0 ? 1 : 2); if (n > 9) n -= 9; sum += n; }
  return sum % 10 === 0;
}

function validateInvoice(inv, opts = {}, seen = new Set()) {
  const o = { ...DEFAULTS, ...opts };
  const reasons = [];
  const near = (a, b, tol) => Math.abs(a - b) <= tol;

  if (!inv.supplier_name) reasons.push('חסר שם ספק');
  if (!isValidIsraeliId(inv.supplier_tax_id)) reasons.push('מספר עוסק/ח.פ לא תקין או חסר');
  if (!inv.invoice_number) reasons.push('חסר מספר חשבונית');

  const d = /^\d{4}-\d{2}-\d{2}$/.test(inv.date || '') ? new Date(inv.date + 'T00:00:00') : null;
  if (!d || Number.isNaN(d.getTime())) reasons.push('תאריך לא תקין');
  else {
    const today = o.today();
    if (d > today) reasons.push('תאריך עתידי');
    else if ((today - d) / 86400000 > o.maxAgeDays) reasons.push('תאריך ישן מאוד');
  }

  const { net_amount: net, vat_amount: vat, total_amount: total } = inv;
  if (![net, vat, total].every(Number.isFinite) || total <= 0) reasons.push('סכומים חסרים או לא תקינים');
  else {
    if (!near(net + vat, total, 1)) reasons.push(`הסכום לא מתאים: ${net} + ${vat} ≠ ${total}`);
    if (vat > 0 && !near(vat, net * o.vatRate, Math.max(2, net * 0.01))) reasons.push(`המע״מ לא ${Math.round(o.vatRate * 100)}% מהסכום לפני מע״מ`);
  }

  if (['tax_invoice', 'tax_invoice_receipt'].includes(inv.document_type) && net > o.allocationThreshold && !String(inv.allocation_number || '').trim()) {
    reasons.push(`חשבונית מעל ₪${o.allocationThreshold.toLocaleString('en-US')} ללא מספר הקצאה (ייתכן שלא ניתן לנכות מע״מ תשומות)`);
  }
  if (typeof inv.confidence === 'number' && inv.confidence < o.minConfidence) reasons.push('ודאות החילוץ נמוכה, נא לבדוק מול המסמך');
  if ((inv.missing_fields || []).length) reasons.push('שדות חסרים: ' + inv.missing_fields.join(', '));

  const key = `${String(inv.supplier_tax_id || '').replace(/\D/g, '')}|${inv.invoice_number}`;
  if (inv.invoice_number && seen.has(key)) reasons.push('כפילות: אותה חשבונית כבר קיימת');
  else if (inv.invoice_number) seen.add(key);

  return { ...inv, status: reasons.length ? 'review' : 'ok', reasons };
}

function validateBatch(list, opts) {
  const seen = new Set();
  return list.map(inv => validateInvoice(inv, opts, seen));
}

module.exports = { validateInvoice, validateBatch, isValidIsraeliId, DEFAULTS };
