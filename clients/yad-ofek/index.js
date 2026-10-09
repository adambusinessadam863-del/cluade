'use strict';
const Quote = require('../../automations/quote/core.js');
const Presets = require('../../automations/quote/presets.js');
const config = require('./client.json');
const pricing = require('./pricing.json');
const flow = require('./flow.js');

const ROOMS = { 'עד 2 חדרים': 2, '3 חדרים': 3, '4 חדרים': 4, '5 חדרים ומעלה': 5 };
const preset = Presets.makeMovers(pricing.prices);

// הערכת מחיר פנימית לבעל העסק (לא נשלחת ללקוח). פעילה רק אחרי שהמחירון אושר.
function leadExtra(lead) {
  if (!pricing.confirmed) return '';
  const a = lead.answers || {}, rooms = ROOMS[a['חדרים']];
  if (a['סוג ההובלה'] !== 'דירה' || !rooms) return '';
  const { inputs } = Presets.movers.fromLead(a);
  const q = Quote.buildQuote(preset, { ...inputs, rooms, distance: 0, floorFrom: 0, floorTo: 0 }, { includeVat: false });
  return `💰 הערכה פנימית: כ-${Quote.money(q.total)} לפני מע״מ (דירת ${rooms} חדרים, ללא מרחק ומדרגות. להשלים אחרי שיחה).`;
}

module.exports = { config, flow, leadExtra, preset, pricing };
