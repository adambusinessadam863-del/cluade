// תבניות תמחור. כל המחירים כאן הם **דוגמאות להמחשה** ויש להחליף אותם במחירון האמיתי של העסק.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QuotePresets = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const num = (id, label, min, max, def, unit) => ({ id, label, type: 'number', min, max, default: def, unit });
  const bool = (id, label, def = false) => ({ id, label, type: 'bool', default: def });
  const sel = (id, label, options, def) => ({ id, label, type: 'select', options, default: def });

  // ---------- הובלות ----------
  const MOVERS_BASE = [0, 900, 1200, 1500, 1900, 2300, 2800, 3300, 3800, 4300, 4800];
  const movers = {
    id: 'movers', tab: 'הובלות', prefix: 'HV', title: 'הובלת דירה',
    fields: [
      num('rooms', 'מספר חדרים', 1, 10, 3), num('distance', 'מרחק (ק״מ)', 0, 400, 15),
      num('floorFrom', 'קומה במוצא', 0, 30, 2), bool('elevFrom', 'יש מעלית במוצא'),
      num('floorTo', 'קומה ביעד', 0, 30, 1), bool('elevTo', 'יש מעלית ביעד', true),
      sel('packing', 'אריזה', [{ v: 'none', label: 'ללא' }, { v: 'partial', label: 'חלקית' }, { v: 'full', label: 'מלאה' }], 'none'),
      num('piano', 'פסנתר', 0, 3, 0), num('safe', 'כספת כבדה', 0, 3, 0),
      num('assembly', 'חדרים לפירוק והרכבה', 0, 10, 0), bool('crane', 'מנוף')
    ],
    lines(i) {
      const base = MOVERS_BASE[i.rooms];
      const L = [{ label: `הובלת דירת ${i.rooms} חדרים`, qty: 1, unitPrice: base }];
      const extraKm = Math.max(0, i.distance - 20);
      L.push({ label: 'מרחק מעבר ל-20 ק״מ', qty: extraKm, unit: 'ק״מ', unitPrice: 4 });
      if (!i.elevFrom && i.floorFrom > 0) L.push({ label: 'מדרגות במוצא (ללא מעלית)', note: `קומה ${i.floorFrom}`, qty: i.floorFrom, unit: 'קומות', unitPrice: 80 });
      if (!i.elevTo && i.floorTo > 0) L.push({ label: 'מדרגות ביעד (ללא מעלית)', note: `קומה ${i.floorTo}`, qty: i.floorTo, unit: 'קומות', unitPrice: 80 });
      if (i.packing === 'partial') L.push({ label: 'אריזה חלקית', qty: 1, unitPrice: Math.round(base * 0.15) });
      if (i.packing === 'full') L.push({ label: 'אריזה מלאה', qty: 1, unitPrice: Math.round(base * 0.35) });
      L.push({ label: 'פסנתר', qty: i.piano, unit: 'יח׳', unitPrice: 500 });
      L.push({ label: 'כספת כבדה', qty: i.safe, unit: 'יח׳', unitPrice: 400 });
      L.push({ label: 'פירוק והרכבה', qty: i.assembly, unit: 'חדרים', unitPrice: 150 });
      if (i.crane) L.push({ label: 'מנוף', qty: 1, unitPrice: 650 });
      return L;
    },
    summary: i => `הובלת דירת ${i.rooms} חדרים, ${i.distance} ק״מ`,
    terms: ['המחיר מבוסס על הפרטים שנמסרו ויעודכן אם יתגלו הבדלים בפועל.', 'ביטול עד 48 שעות לפני המועד ללא עלות.', 'תשלום ביום ההובלה: מזומן, העברה או ביט.'],
    // המרה מתשובות תהליך השיחה של ההובלות (whatsapp-followup/flows.js) לשדות ההצעה
    fromLead(a = {}) {
      return { inputs: { elevFrom: a['מעלית'] !== 'אין מעלית' }, note: [a['מוצא'] && a['יעד'] ? `${a['מוצא']} ← ${a['יעד']}` : '', a['מתי'] || ''].filter(Boolean).join(' · ') };
    }
  };

  // ---------- שיפוצים ----------
  const reno = {
    id: 'reno', tab: 'שיפוצים', prefix: 'SH', title: 'הצעת מחיר לשיפוץ',
    fields: [
      num('paint', 'צביעה (מ״ר קירות)', 0, 1000, 100), num('plaster', 'שפכטל וטיח (מ״ר)', 0, 500, 0),
      num('tile', 'הנחת ריצוף (מ״ר)', 0, 500, 0), num('bathroom', 'שיפוץ חדר רחצה מלא', 0, 5, 0),
      num('electric', 'נקודות חשמל', 0, 100, 0), num('plumbing', 'נקודות אינסטלציה', 0, 50, 0),
      num('demolition', 'פירוק ופינוי (מ״ק)', 0, 100, 0),
      sel('contingency', 'עתודה לבלת״מ', [{ v: '0', label: 'ללא' }, { v: '5', label: '5%' }, { v: '10', label: '10%' }], '10')
    ],
    lines(i) {
      const L = [
        { label: 'צביעה', qty: i.paint, unit: 'מ״ר', unitPrice: 38 }, { label: 'שפכטל וטיח', qty: i.plaster, unit: 'מ״ר', unitPrice: 55 },
        { label: 'הנחת ריצוף (ללא אריחים)', qty: i.tile, unit: 'מ״ר', unitPrice: 180 }, { label: 'שיפוץ חדר רחצה מלא', qty: i.bathroom, unit: 'יח׳', unitPrice: 18000 },
        { label: 'נקודות חשמל', qty: i.electric, unit: 'נק׳', unitPrice: 220 }, { label: 'נקודות אינסטלציה', qty: i.plumbing, unit: 'נק׳', unitPrice: 350 },
        { label: 'פירוק ופינוי', qty: i.demolition, unit: 'מ״ק', unitPrice: 450 }
      ];
      const sub = L.reduce((s, l) => s + Math.round(l.qty * l.unitPrice), 0);
      const pct = Number(i.contingency);
      if (pct && sub) L.push({ label: `עתודה לבלת״מ (${pct}%)`, qty: 1, unitPrice: Math.round(sub * pct / 100) });
      return L;
    },
    summary: i => `עבודות שיפוץ בדירה`,
    meta(i) {
      const days = Math.ceil(i.paint / 35 + i.plaster / 25 + i.tile / 8 + i.bathroom * 10 + i.electric / 8 + i.plumbing / 6 + i.demolition / 3);
      return days ? [{ label: 'משך עבודה משוער (הערכה)', value: `${days} ימי עבודה` }] : [];
    },
    terms: ['ההצעה אינה כוללת חומרי גמר ואריחים אלא אם צוין אחרת.', 'שינויים בהיקף העבודה יתומחרו בנפרד ובאישור מראש.', 'תשלום בשלבים: מקדמה, אמצע עבודה וסיום.']
  };

  // ---------- ניקיון ----------
  const cleaning = {
    id: 'cleaning', tab: 'ניקיון', prefix: 'NK', title: 'שירותי ניקיון',
    fields: [
      sel('kind', 'סוג ניקיון', [{ v: 'regular', label: 'רגיל' }, { v: 'deep', label: 'יסודי' }, { v: 'post', label: 'אחרי שיפוץ' }, { v: 'moveout', label: 'לפני כניסה / יציאה' }], 'regular'),
      num('area', 'שטח (מ״ר)', 20, 1000, 90), num('windows', 'חלונות', 0, 60, 0),
      bool('balcony', 'מרפסת'), bool('oven', 'תנור ומקרר')
    ],
    lines(i) {
      const rate = { regular: 6, deep: 11, post: 16, moveout: 12 }[i.kind];
      const name = { regular: 'ניקיון רגיל', deep: 'ניקיון יסודי', post: 'ניקיון אחרי שיפוץ', moveout: 'ניקיון לפני כניסה / יציאה' }[i.kind];
      const L = [{ label: name, qty: i.area, unit: 'מ״ר', unitPrice: rate }];
      const sub = Math.round(i.area * rate);
      if (sub < 350) L.push({ label: 'השלמה למחיר מינימום', qty: 1, unitPrice: 350 - sub });
      L.push({ label: 'חלונות', qty: i.windows, unit: 'יח׳', unitPrice: 15 });
      if (i.balcony) L.push({ label: 'מרפסת', qty: 1, unitPrice: 80 });
      if (i.oven) L.push({ label: 'תנור ומקרר', qty: 1, unitPrice: 120 });
      return L;
    },
    summary: i => `${i.area} מ״ר`,
    terms: ['חומרי הניקוי והציוד כלולים במחיר.', 'מועד העבודה מתואם מראש. ביטול עד 24 שעות לפני ללא עלות.']
  };

  return { movers, reno, cleaning };
});
