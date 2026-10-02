# Coach Desk

Local swim-coaching records for Horwich LC ASC: swimmers, times, county gaps, the annual plan, sessions, galas and entries, technique points and the house drills folder. It runs on this PC only. There's no cloud and no login, and all the data is one SQLite file.

## Start

```bat
cd C:\Users\sampa\dev\coach-desk
npm install
npm start
```

Open http://localhost:4400.

- **Phone poolside / at home:** `npm run start:lan` prints an address to open on a phone on the same Wi-Fi. There's no login, so only use this on your home network.
- **Tests:** `npm test` runs the calculation tests, the import tests, the generator tests and a smoke test that opens every page.
- **Data:** `data/coach-desk.sqlite` is gitignored. To back it up, copy that file while the app is stopped.

## What's where

| Page | What it does |
|---|---|
| Home | This week's number, weeks to Counties, today's sessions, galas closing soon, and swimmers within 2.0 s of a county time |
| Swimmers | List and profile: age now, age at 31 Dec, PBs, county gap. A 🔒 group is one you set by hand, and imports never change it. |
| Swimmer → County analysis / PDF | The **swimmer-county-analysis skill** built in: fastest route (better of SC PB and LC PB converted to SC) against the Lancashire 2027 consideration times. There's an age override, "new swims since", and a one-page PDF. **County → PDF report** gives one page per swimmer for a whole group. |
| Swimmer → Paste from swimmingresults | Copy the PB page and paste it in. The site's official "Converted to SC" figure is kept and used ahead of the conversion table. |
| Times | Phone-friendly quick add, plus list, filter and CSV import |
| County | Whole-group gap view, sortable by closest to qualifying, with the qualifying-times editor (CSV/XLSX import or the skill's standards JSON) and the named LC→SC conversion tables |
| Plan | 52 weeks, editable inline, with weeks to Counties. Galas show up in their week automatically. |
| Sessions | Write, copy last week's, generate from the plan (one session or the whole week), and print one page |
| Galas | Seeded galas, entries with auto-filled entry times (editable), and status |
| Drills / Technique / Library | House drills folder, technique points per stroke, and the generator's set templates and session sizes |
| Import | CSV/XLSX with a column-mapping preview. Address, phone, email, medical and parent columns are dropped and never stored. |

Every list has an **Export CSV** button.

## Notes

- **LC→SC:** the seeded table, "Placeholder – edit me", uses factor 1.0, so an LC time counts unchanged until you enter real factors. Times pasted from swimmingresults use the site's own converted figure, which matches the skill.
- **County age:** age at 31 Dec 2027 for the 2027 season. Change it in Settings.
- **Session generator:** works from rules only, no AI service. It picks set templates tagged for the week's mesocycle and focus, takes 2–3 drills from your folder in that week's rotation (avoiding ones that group used in the last 2 weeks), adds the linked technique points as cues, and fits the total to the group's target metres. The result is always a draft you edit before saving.
