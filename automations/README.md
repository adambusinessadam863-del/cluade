# אוטומציות למכירה לעסקים קטנים

שלוש אוטומציות שונות, כל אחת עם קוד, בדיקות והדמיה, ועוד רביעית שהתחלתי.

| תיקייה | מה זה | הדמיה | בדיקות |
|---|---|---|---|
| `quote/` | הצעת מחיר מיידית (הובלות, שיפוצים, ניקיון) | `quote/web/index.html` | `cd quote && node test.js` |
| `reminders/` | תזכורות תורים והחזרת שעות מרשימת המתנה | `reminders/demo.html` | `cd reminders && node test.js` |
| `reviews/` | בקשות ביקורת (ללא סינון) וטיוטות תשובה בעזרת Claude | `reviews/demo.html` | `cd reviews && node test.js` |
| `invoices/` (התחלה) | חילוץ חשבוניות לטבלה, כולל בדיקת מספר הקצאה | אין עדיין | `cd invoices && node test.js` |
| `gateway/` | נתב: webhook אחד לכל האוטומציות של לקוח (`cd gateway && node test.js`) | | `cd gateway && node test.js` |
| `common/` | שליחה ל-WhatsApp Cloud API, התראות טלגרם, אימות חתימה | | |
| `assets/` | עיצוב משותף לטלפונים בהדמיות | | |

## לקוח ראשון
חבילת ההפעלה של יד אופק הובלות נמצאת ב-`../clients/yad-ofek` (הגדרות, פריסה, תבניות, עלויות, הצעה וספר הפעלה).

## מסמכים
- **`PITCH.md`**: איך מוכרים, מחירים, תסריטי שיחה, מיילים והתנגדויות.
- **`CATALOG.md`**: עוד אוטומציות לבדיקה, מדורגות, ומה כבר בנוי.

## מה נבדק ומה לא
כל הבדיקות מדמות את WhatsApp Cloud API ואת Claude. הקוד **לא הורץ מול Meta או Anthropic אמיתיים**. צפו לתיקונים קטנים בבדיקה הראשונה מול מספר הבדיקה של Meta ומול מפתח API אמיתי. פרטים בכל README של מודול.

## דרישות
Node 20.6 ומעלה. הכלי `quote/web` ודפי ההדמיה הם קבצי דפדפן בלבד, בלי התקנה. שכבת Claude (`reviews`, `invoices`) דורשת `npm i @anthropic-ai/sdk` ומפתח `ANTHROPIC_API_KEY`. הדגם הוא `claude-opus-5-5`.

## הרצת כל הבדיקות
```bash
for d in quote reminders reviews invoices gateway; do (cd $d && node test.js) || exit 1; done
(cd ../whatsapp-followup/server && node test.js)
```
