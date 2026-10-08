// יוצר את samples/sample-sheet.html מטיוטות שנכתבו ידנית, להמחשת הפורמט בלבד (בלי קריאה ל-API).
const fs = require('fs'); const path = require('path');
const D = require('../drafts.js');
const reviews = JSON.parse(fs.readFileSync(path.join(__dirname, 'reviews.json'), 'utf8'));
const profile = JSON.parse(fs.readFileSync(path.join(__dirname, 'profile.json'), 'utf8'));
const out = D.validate({
  replies: [
    { id: '1', reply: 'תודה רבה אורי! שמחים שהעדכון בוואטסאפ עזר לך ושהרכב היה מוכן באותו יום. נשמח לראות אותך שוב.', sentiment: 'positive', topics: ['שירות מהיר', 'תקשורת'], needs_owner: false, reason: '' },
    { id: '2', reply: 'תודה מיכל על המשוב ועל המילים הטובות על העבודה. מצטערים על ההמתנה בקבלה, זה לא הסטנדרט שאנחנו רוצים לתת, ואנחנו בודקים איך לקצר אותה.', sentiment: 'neutral', topics: ['המתנה בקבלה'], needs_owner: false, reason: '' },
    { id: '3', reply: 'דוד, אנחנו מצטערים מאוד על החוויה. נשמח לברר מה קרה ולטפל בעניין בצורה הוגנת. אפשר ליצור איתנו קשר ישירות בטלפון 050-0000000.', sentiment: 'negative', topics: ['נזק לרכב', 'אחריות'], needs_owner: true, reason: 'ביקורת של כוכב אחד עם איום משפטי. מומלץ להתקשר ללקוח לפני שמפרסמים תשובה.' },
    { id: '4', reply: 'תודה שרה! חשוב לנו להסביר ללקוחות מה באמת נחוץ ומה אפשר לדחות. שמחים שהרגשת הוגנות.', sentiment: 'positive', topics: ['הגינות'], needs_owner: false, reason: '' },
    { id: '5', reply: 'תודה אבי על המשוב. אנחנו שמחים להסביר כל סעיף בהצעת המחיר, ואפשר לפנות אלינו ישירות בטלפון 050-0000000.', sentiment: 'neutral', topics: ['מחיר'], needs_owner: false, reason: '' }
  ],
  strengths: ['שירות מהיר באותו יום', 'עדכונים בוואטסאפ', 'הגינות והסבר מקצועי'],
  issues: ['המתנה ארוכה בקבלה', 'שריטה ללא לקיחת אחריות (ביקורת אחת)', 'מחיר נתפס כגבוה']
}, reviews, profile);
fs.writeFileSync(path.join(__dirname, 'sample-sheet.html'), D.renderSheet(out, profile, 'דוגמה להמחשה: הביקורות והתשובות נכתבו ידנית כדי להראות את הפורמט. כשמריצים את הכלי, Claude כותב את הטיוטות ואתם מאשרים. הביקורת החמישית כוללת הוראה מוזרקת, והכלי מתעלם ממנה.'));
console.log('נוצר samples/sample-sheet.html');
