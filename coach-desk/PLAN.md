# Coach Desk — plan (schema + pages)

Scope change (Sam, mid-planning): **session generation, technique points per stroke and a house-drills folder are now IN scope.**

Status: **awaiting Sam's OK before any code is written.**

Stack: Node.js + Express + better-sqlite3 + EJS templates, one CSS file, no front-end framework.
Runs at `http://localhost:4400` via `npm start`. Database: `data/coach-desk.sqlite` (`data/` is gitignored).
Import: `csv-parse` + `exceljs` (avoiding the npm `xlsx` package, which has unpatched advisories). Tests: `node --test`.

## Conventions

- **Times are stored as integer hundredths of a second** (`6523` = 1:05.23). They're shown as `m:ss.hh` and typed in as `1:05.23`, `65.23` or `65.2`.
- **Dates are stored as ISO text** (`YYYY-MM-DD`).
- **Events are a fixed list** in code, keyed like `100FR`, `50BK`, `200BR`, `100FL` and `200IM`. Display names look like "100 Free". Covers 50/100/200/400/800/1500 Free; 50/100/200 Back, Breast and Fly; and 100 (SC only)/200/400 IM.
- **Course** is `SC` or `LC`. **Sex** is `M` or `F`.
- **Groups** come from a fixed list: Group 1, Group 2, Group 3, Squad, Masters, Club Train and Cold.

## Database schema

```sql
-- Season-wide settings (editable on the Settings page)
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- seeded: season_start='2026-08-31', counties_week='21', county_season='2027',
--         county_age_at='2027-12-31', amber_threshold_s='2.0',
--         active_conversion_table_id='1'

CREATE TABLE swimmers (
  id               INTEGER PRIMARY KEY,
  first_name       TEXT NOT NULL,
  last_name        TEXT NOT NULL,
  dob              TEXT NOT NULL,
  sex              TEXT NOT NULL CHECK (sex IN ('M','F')),
  se_id            TEXT UNIQUE,            -- Swim England ID (nullable for Masters etc.)
  group_name       TEXT,                   -- one of the fixed groups
  group_locked     INTEGER NOT NULL DEFAULT 0,  -- 1 = set by me; import never touches it
  imported_group   TEXT,                   -- what the last import said (shown for reference)
  other_club       TEXT,                   -- free text, e.g. 'Bolton Metro'
  bolton_metro     INTEGER NOT NULL DEFAULT 0,
  active           INTEGER NOT NULL DEFAULT 1,
  notes            TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
-- No address, medical or contact columns exist, and importers drop any such source columns.

CREATE TABLE times (
  id          INTEGER PRIMARY KEY,
  swimmer_id  INTEGER NOT NULL REFERENCES swimmers(id) ON DELETE CASCADE,
  event       TEXT NOT NULL,              -- '100FR'
  course      TEXT NOT NULL CHECK (course IN ('SC','LC')),
  time_hs     INTEGER NOT NULL,           -- hundredths
  swum_on     TEXT NOT NULL,
  meet        TEXT,
  source      TEXT NOT NULL DEFAULT 'manual',   -- 'manual' | 'import'
  UNIQUE (swimmer_id, event, course, time_hs, swum_on)   -- stops duplicate re-imports
);
-- PBs are computed with a query (MIN time per swimmer/event/course), not stored.

CREATE TABLE conversion_tables (
  id    INTEGER PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE,             -- e.g. 'Swim England equivalent 2026'
  notes TEXT
);
CREATE TABLE conversion_factors (
  table_id  INTEGER NOT NULL REFERENCES conversion_tables(id) ON DELETE CASCADE,
  event     TEXT NOT NULL,
  sex       TEXT NOT NULL CHECK (sex IN ('M','F','X')),  -- X = applies to both
  factor    REAL NOT NULL DEFAULT 1.0,    -- SC = LC * factor - offset_s
  offset_s  REAL NOT NULL DEFAULT 0.0,
  PRIMARY KEY (table_id, event, sex)
);

CREATE TABLE county_times (
  id       INTEGER PRIMARY KEY,
  season   TEXT NOT NULL,                 -- '2027'
  event    TEXT NOT NULL,
  sex      TEXT NOT NULL CHECK (sex IN ('M','F')),
  age      INTEGER NOT NULL,              -- an age band's upper value, e.g. 17 for '17+'
  age_max  INTEGER,                       -- NULL = single age; 99 = 'and over'
  course   TEXT NOT NULL CHECK (course IN ('SC','LC')),
  time_hs  INTEGER NOT NULL,
  UNIQUE (season, event, sex, age, course)
);

CREATE TABLE plan_weeks (
  week_no      INTEGER PRIMARY KEY,       -- 1..52
  start_date   TEXT NOT NULL UNIQUE,      -- derived: season_start + 7*(week_no-1)
  mesocycle    TEXT,
  focus        TEXT,
  drills       TEXT,
  notes        TEXT,
  galas_text   TEXT,                      -- free text; the linked galas are also shown automatically
  holiday      INTEGER NOT NULL DEFAULT 0 -- holiday / half-term flag
);
-- 'weeks to Counties' = counties_week - week_no (computed, not stored).

CREATE TABLE sessions (
  id          INTEGER PRIMARY KEY,
  date        TEXT NOT NULL,
  slot        TEXT NOT NULL CHECK (slot IN ('Mon','Fri','Sat AM','Sat PM')),
  group_name  TEXT NOT NULL,
  week_no     INTEGER REFERENCES plan_weeks(week_no),  -- set from the date on save
  sets        TEXT,                        -- free text
  total_m     INTEGER,
  notes       TEXT,
  UNIQUE (date, slot, group_name)
);

CREATE TABLE galas (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  start_date    TEXT NOT NULL,
  end_date      TEXT NOT NULL,
  venue         TEXT,
  course        TEXT CHECK (course IN ('SC','LC')),
  closing_date  TEXT,
  age_at_date   TEXT,
  notes         TEXT
);
-- seeded: BCM Autumn 2026-10-03..04, Radcliffe League 2026-10-10,
--         Burnley Monster Splash 2026-10-24..25, BMSS Winter 2026-12-12,
--         Winter Warmer 2027-01-08..10  (venue/course/closing date left blank to fill in)

CREATE TABLE entries (
  id          INTEGER PRIMARY KEY,
  gala_id     INTEGER NOT NULL REFERENCES galas(id) ON DELETE CASCADE,
  swimmer_id  INTEGER NOT NULL REFERENCES swimmers(id) ON DELETE CASCADE,
  event       TEXT NOT NULL,
  entry_hs    INTEGER,                    -- auto-filled, editable
  entry_auto  INTEGER NOT NULL DEFAULT 1, -- 0 once I've typed my own time
  status      TEXT NOT NULL DEFAULT 'planned'
              CHECK (status IN ('planned','entered','withdrawn')),
  UNIQUE (gala_id, swimmer_id, event)
);

-- ===== Added: technique, drills, session generation =====

CREATE TABLE technique_points (
  id        INTEGER PRIMARY KEY,
  stroke    TEXT NOT NULL CHECK (stroke IN ('Free','Back','Breast','Fly','IM','Starts','Turns','Finishes')),
  area      TEXT,                          -- 'Body position','Legs','Arms','Breathing','Timing', ...
  point     TEXT NOT NULL,                 -- the coaching cue, e.g. 'Hips high, head neutral'
  cue_word  TEXT,                          -- short poolside call, e.g. 'Long & tall'
  sort      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE drills (                      -- the "drills folder": your house drills
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,        -- e.g. 'Catch-up'
  stroke      TEXT NOT NULL,               -- same list as technique_points.stroke
  category    TEXT,                        -- 'Kick','Pull','Timing','Breathing','Turns', ...
  description TEXT,                        -- how to do it
  equipment   TEXT,                        -- 'fins, board'
  groups      TEXT,                        -- which groups it suits, comma list
  rotation    TEXT,                        -- rotation tag used by the annual plan, e.g. 'A','B','C'
  video_url   TEXT,
  active      INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE drill_points (                -- which technique points a drill works on
  drill_id  INTEGER NOT NULL REFERENCES drills(id) ON DELETE CASCADE,
  point_id  INTEGER NOT NULL REFERENCES technique_points(id) ON DELETE CASCADE,
  PRIMARY KEY (drill_id, point_id)
);

-- Building blocks the generator assembles (all editable by you; nothing hard-coded)
CREATE TABLE set_templates (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,               -- 'Aerobic 1 main set', 'Race-pace 50s'
  part        TEXT NOT NULL CHECK (part IN ('Warm-up','Drill','Pre-main','Main','Kick','Sprint','Swim-down')),
  mesocycles  TEXT,                        -- which mesocycles it fits, comma list ('' = any)
  focus_tags  TEXT,                        -- which focus/themes it fits
  groups      TEXT,                        -- which groups it suits
  text        TEXT NOT NULL,               -- the set, may contain {stroke} {drill} placeholders
  metres      INTEGER NOT NULL
);
CREATE TABLE session_shapes (              -- metres budget per group/slot
  group_name  TEXT NOT NULL,
  slot        TEXT NOT NULL,
  minutes     INTEGER,
  target_m    INTEGER NOT NULL,
  parts       TEXT NOT NULL,               -- ordered part list, e.g. 'Warm-up,Drill,Main,Swim-down'
  PRIMARY KEY (group_name, slot)
);
-- sessions gains: generated INTEGER DEFAULT 0, seed INTEGER (so a generated session can be re-rolled reproducibly)

-- Saved column mappings, so the next import of the same export pre-fills
CREATE TABLE import_mappings (
  kind     TEXT NOT NULL,                 -- 'swimmers' | 'times' | 'county' | 'plan'
  headers  TEXT NOT NULL,                 -- the file's header row, joined
  mapping  TEXT NOT NULL,                 -- JSON {targetField: sourceColumn}
  PRIMARY KEY (kind, headers)
);
```

## Calculations (pure functions in `src/calc.js`, all unit-tested)

| Function | Rule |
|---|---|
| `ageOn(dob, date)` | whole years on that date |
| `ageAt31Dec(dob, year)` | `ageOn(dob, year-12-31)` |
| `weekNumber(date)` | `floor((date − 2026-08-31) / 7) + 1`. Dates before the season start give ≤ 0, shown as "pre-season". |
| `weeksToCounties(date)` | `21 − weekNumber(date)` |
| `lcToSc(event, sex, lc_hs, table)` | `round(lc × factor − offset × 100)` |
| `bestScEquivalent(scPb, lcPb, …)` | the lower of the SC PB and `lcToSc(LC PB)`; also returns which one was used |
| `countyGap(bestSc, qt)` | `(best − qt) / 100` seconds: ≤ 0 is **green**, ≤ 2.0 is **amber**, otherwise **red** |
| `mergeSwimmerImport(existing, row)` | updates name/DOB/sex/club fields. `group_name` changes only when `group_locked = 0`; `imported_group` is always updated. |

| `generateSession(week, group, slot, lib, seed)` | see "Session generation" below — deterministic for a given seed |

**County time lookup:** match the season, sex, event and the swimmer's age on `county_age_at`, using `age ≤ x ≤ age_max`. If the county table has an SC time, compare it with the best SC-equivalent. If it only has an LC time, convert that to SC with the same table.

## Session generation (added)

Rule-based and fully local (no AI service). It produces a **draft** that you edit before saving.

1. Find the plan week for the date. It gives the mesocycle, focus/theme, drill rotation and holiday flag.
2. Get the shape for this group and slot from `session_shapes`: the target metres and the part order.
3. For each part, pick a `set_template` whose mesocycle, focus and group tags match. If none match, it relaxes the focus first, then the mesocycle, and the draft says which.
4. The **Drill** part takes 2–3 drills from your drills folder with the week's rotation tag and the focus stroke. It avoids drills used for this group in the last 2 weeks.
5. Under the drills, it lists the technique points those drills work on, as the poolside cues.
6. It scales the main set's reps until the total is within ±10% of the target metres.
7. It fills `sets` and `total_m`, then opens the normal session editor. "Re-roll" picks again with a new seed.

Copy-last-week stays as a separate option.

## Pages

All pages are mobile-first, with a sticky top nav that collapses to a menu on a phone. Every list has an **Export CSV** button (`?format=csv` on the same URL with the same filters).

| # | URL | What it shows / does |
|---|---|---|
| 1 | `/` **Home** | This week's number, weeks to Counties and the week's focus/drills. Today's sessions. Galas closing in the next 21 days. Swimmers within 2.0 s (amber) of a county time. |
| 2 | `/swimmers` | List with filters for group, sex and active. Columns: name, age now, age at 31 Dec, group (🔒 if locked), SE ID, club. |
| 3 | `/swimmers/new`, `/swimmers/:id/edit` | Form. Changing the group sets the lock, with an "unlock" tickbox. |
| 4 | `/swimmers/:id` | Profile. **PB table** (event × SC/LC). **County gap table:** per event, best SC-equivalent, its source (SC or LC→SC), the QT, the gap and the colour. Recent times. Quick "add time" form. |
| 5 | `/times` | All times, filtered by swimmer, event, course and meet. Delete/edit a time. |
| 6 | `/times/new` | Phone-friendly quick add: swimmer, event, course, time, date (defaults to today), meet. |
| 7 | `/county` | **Whole-group gap view.** Filters: group, event, sex and colour. Sorts by "closest to qualifying" (smallest gap first) or by name. |
| 8 | `/county/times` | The qualifying-times table for the season, editable inline, with add/delete rows. |
| 9 | `/conversions` | Named LC→SC tables: create, rename, edit factors and pick the active one. |
| 10 | `/plan` | Annual plan: one editable row per week (week, start, weeks to Counties, mesocycle, focus, drills, notes, galas, holiday). The current week is highlighted and galas falling in a week are listed automatically. |
| 11 | `/sessions` | Session list by week/date and group. |
| 12 | `/sessions/new`, `/sessions/:id/edit` | Form, with a **"Copy last week's"** button: same slot and group, date − 7. |
| 13 | `/sessions/:id` + `/sessions/:id/print` | View, linked to its plan week. Print view is a clean A4 page: header (date, slot, group, week, focus), the sets in large type, total metres and notes. |
| 14 | `/galas` | List with closing dates (overdue ones in red). |
| 15 | `/galas/new`, `/galas/:id/edit` | Form. |
| 16 | `/galas/:id` | Gala detail plus entries table. "Add entries" picks a swimmer and ticks events; the entry time auto-fills from the PB in the gala's course (SC gala uses the best SC-equivalent). Status dropdown. |
| 17a | `/sessions/generate` | Pick a date, slot and group to get a generated draft (sets, metres, drills, cue words), with Re-roll and Save. Also offered as "Generate the whole week" for every slot and group. |
| 17b | `/technique` | Technique points by stroke as tabs (Free / Back / Breast / Fly / IM / Starts / Turns / Finishes), editable, with a phone-friendly read view. |
| 17c | `/drills` | **Drills folder:** filter by stroke, category, rotation and group. Each drill page shows its description, equipment, video link, linked technique points and the sessions that used it. Import from CSV. |
| 17d | `/library` | Set templates and session shapes (the generator's building blocks), editable. |
| 17 | `/import/:kind` | Upload a CSV/XLSX for swimmers, times, county times or the plan. |
| 18 | `/import/:kind/map` | **Column-mapping preview:** a dropdown per field, auto-guessed from the headers, and the first 10 rows shown as they'll be imported, with row errors flagged. Confirm, then a summary page (added / updated / skipped, with reasons). |
| 19 | `/settings` | Season start, Counties week, county season, county age-at date and amber threshold. |

**Swimmer import:** matched on SE ID first, then on first name + last name + DOB. Only whitelisted columns are mapped (name, DOB, sex, SE ID, group, club). The column list for address, phone, email, medical and parent fields is shown as "ignored" and never stored.

## Tests (`npm test`)

- `calc.test.js`: age at 31 Dec, including birthdays on 31 Dec and 1 Jan and leap-day DOBs. Week number at the season start, the day before, Sunday/Monday boundaries and Week 21. LC→SC with factor and offset. Best SC-equivalent when SC wins, when LC wins and when one is missing. County gap and its band at exactly 0, exactly 2.00 s, 2.01 s and negative.
- `import.test.js`: run against a temporary in-memory DB. Import swimmers, then lock one swimmer's group, then re-import with a different group. The locked group is kept, `imported_group` is updated and the other swimmers are updated.
- `generate.test.js`: the generator respects the week's rotation and focus, and lands within ±10% of the target metres. It doesn't repeat the previous 2 weeks' drills when alternatives exist, and the same seed gives the same session.
- A smoke test starts the app on a random port and checks that every page returns 200.

## Questions before I build

1. **LC→SC factors.** Do you have the conversion table you trust (e.g. the Swim England equivalent-times factors)? Otherwise I'll seed a table called "Placeholder – edit me" with factor 1.0 for every event, so nothing is invented.
2. **County age.** Which date does Lancashire use for age? I've assumed 31 Dec 2027 for the 2027 season (`county_age_at`, editable).
3. **Groups.** Is "Cold" a group name (e.g. cold-water), and is "Club Train" a separate group from Squad?
4. **House drills.** Please send your drills list (a doc, spreadsheet or photo is fine): name, stroke, what it's for, and the rotation letter if you use one. I'll make it the import format for the drills folder. I won't invent drills to fill it.
5. **Technique points.** Should I seed standard Swim England-style points per stroke for you to edit, or start empty and import yours?
6. **Session shapes.** Please give typical minutes and metres per group and slot (e.g. Group 1 Mon = 60 min / 2,400 m), plus a few of your usual main sets to seed the templates.
7. **Export file.** Can you share the SportMember / Club Organiser column headers, with no data rows? Then the auto-mapping guesses right first time.
