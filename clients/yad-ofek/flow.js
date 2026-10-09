'use strict';
// תהליך השיחה של יד אופק: התהליך הכללי של הובלות, עם שאלה נוספת על מספר חדרים (המשתנה שהכי משפיע על המחיר).
const base = require('../../whatsapp-followup/flows.js').moving;

const rooms = {
  key: 'חדרים', ask: 'כמה חדרים בדירה? (אם זו לא דירה, בחרו "לא רלוונטי")', type: 'choice',
  options: [
    { label: 'עד 2 חדרים', score: 1 }, { label: '3 חדרים', score: 2 }, { label: '4 חדרים', score: 3 },
    { label: '5 חדרים ומעלה', score: 3 }, { label: 'לא רלוונטי', score: 0 }
  ]
};
const steps = [...base.steps];
steps.splice(steps.findIndex(s => s.key === 'יעד') + 1, 0, rooms);

module.exports = { ...base, steps, hotAt: 7 };
