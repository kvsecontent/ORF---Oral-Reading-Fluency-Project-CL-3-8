# ORF – Oral Reading Fluency (Class 3–8)

A browser app for practising and assessing oral reading fluency in **English** and **Hindi**.
Every passage is taken from the NCERT textbooks (English: Santoor / Poorvi, Hindi: वीणा / मल्हार).

## What it does
- **Levels:** Easy, Medium and Hard. Each gives a random passage from a random chapter of the chosen class.
- **1-minute reading:** the microphone listens (Chrome / Edge, internet needed) and colours every word:
  - green: read right
  - red: wrong word
  - orange: skipped
- **Scores:**
  - **Speed** = words correct per minute (WCPM)
  - **Accuracy** = correct words ÷ words read
  - **Punctuation:** stops at । . , ? (auto-checked from pauses; can be changed)
- **Voice recording:** the reading is recorded (🎙️ Record voice, on by default) and can be played straight after reading, on the result page, in the student's progress and in the teacher's records. Clips (about 250 KB a minute) are kept in this browser (IndexedDB); the backup file holds the scores, not the voices. Teachers can delete all clips in ⚙️ Settings.
- **Teacher marks mode:** works in any browser. The teacher taps the wrong words and then the last word read.
- **Student mode:** each child's readings are saved in their own browser, with a progress chart.
- **Teacher mode:**
  - Login name `TeachORF`, default password `ORF@2026` (change it in ⚙️ Settings).
  - Add students by Roll No + Name, take readings, and see the monthly table. If a child reads more than once in a month, the best score is kept.
  - **Excel download:** includes the school name, class and section, with Speed and Accuracy in separate columns for each month, plus an "All Readings" sheet.
  - **Backup / Restore:** move the data to another computer.

All data stays in the browser (localStorage, and IndexedDB for voice clips). Nothing is sent to a server.

## Files
- `index.html`, `css/style.css`, `js/app.js` (screens, storage, Excel), `js/reader.js` (timer, speech matching, scoring), `js/audio.js` (voice recording and storage)
- `data/classN.js` – passages, `ORF_BANK['N-en']` and `ORF_BANK['N-hi']`, each `{ level, ch, title, text }`
- `lib/xlsx.full.min.js` – SheetJS for the Excel file
