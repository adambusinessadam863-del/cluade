'use strict';
// CSV שנפתח נכון באקסל (UTF-8 עם BOM), עם הגנה מפני הזרקת נוסחאות.
const COLS = [
  ['file', 'קובץ'], ['status', 'סטטוס'], ['reasons', 'סיבות לבדיקה'], ['document_type', 'סוג מסמך'], ['supplier_name', 'ספק'], ['supplier_tax_id', 'ח.פ / עוסק'],
  ['invoice_number', 'מספר חשבונית'], ['allocation_number', 'מספר הקצאה'], ['date', 'תאריך'], ['net_amount', 'לפני מע״מ'], ['vat_amount', 'מע״מ'], ['total_amount', 'סה״כ'], ['summary', 'תיאור']
];
function cell(v) {
  let s = Array.isArray(v) ? v.join('; ') : v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s; // בלי להפוך תוכן לנוסחה
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv(rows) {
  return '﻿' + [COLS.map(c => c[1]).join(','), ...rows.map(r => COLS.map(([k]) => cell(r[k])).join(','))].join('\r\n') + '\r\n';
}
module.exports = { toCsv, COLS };
