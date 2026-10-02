'use strict';
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const calc = require('./calc');
const seed = require('./seed');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS swimmers (
  id INTEGER PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  dob TEXT NOT NULL,
  sex TEXT NOT NULL CHECK (sex IN ('M','F')),
  se_id TEXT UNIQUE,
  group_name TEXT,
  group_locked INTEGER NOT NULL DEFAULT 0,
  imported_group TEXT,
  other_club TEXT,
  bolton_metro INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS times (
  id INTEGER PRIMARY KEY,
  swimmer_id INTEGER NOT NULL REFERENCES swimmers(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  course TEXT NOT NULL CHECK (course IN ('SC','LC')),
  time_hs INTEGER NOT NULL,
  swum_on TEXT NOT NULL,
  meet TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  conv_sc_hs INTEGER,          -- official 'Converted to SC' figure for an LC swim (e.g. from swimmingresults); overrides the factor table
  UNIQUE (swimmer_id, event, course, time_hs, swum_on)
);
CREATE INDEX IF NOT EXISTS times_swimmer ON times(swimmer_id, event, course);

CREATE TABLE IF NOT EXISTS conversion_tables (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, notes TEXT);
CREATE TABLE IF NOT EXISTS conversion_factors (
  table_id INTEGER NOT NULL REFERENCES conversion_tables(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  sex TEXT NOT NULL CHECK (sex IN ('M','F','X')),
  factor REAL NOT NULL DEFAULT 1.0,
  offset_s REAL NOT NULL DEFAULT 0.0,
  PRIMARY KEY (table_id, event, sex)
);

CREATE TABLE IF NOT EXISTS county_times (
  id INTEGER PRIMARY KEY,
  season TEXT NOT NULL,
  event TEXT NOT NULL,
  sex TEXT NOT NULL CHECK (sex IN ('M','F')),
  age INTEGER NOT NULL,
  age_max INTEGER,
  course TEXT NOT NULL CHECK (course IN ('SC','LC')),
  time_hs INTEGER NOT NULL,
  UNIQUE (season, event, sex, age, course)
);

CREATE TABLE IF NOT EXISTS county_seasons (
  season TEXT PRIMARY KEY,
  authority TEXT, course TEXT, age_reference_date TEXT,
  qualifying_window TEXT, conditions TEXT, source TEXT, note TEXT
);

CREATE TABLE IF NOT EXISTS plan_weeks (
  week_no INTEGER PRIMARY KEY,
  start_date TEXT NOT NULL UNIQUE,
  mesocycle TEXT, focus TEXT, drills TEXT, notes TEXT, galas_text TEXT,
  holiday INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  slot TEXT NOT NULL CHECK (slot IN ('Mon','Fri','Sat AM','Sat PM')),
  group_name TEXT NOT NULL,
  week_no INTEGER REFERENCES plan_weeks(week_no),
  sets TEXT, total_m INTEGER, notes TEXT,
  generated INTEGER NOT NULL DEFAULT 0,
  seed INTEGER,
  UNIQUE (date, slot, group_name)
);

CREATE TABLE IF NOT EXISTS galas (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  venue TEXT,
  course TEXT CHECK (course IN ('SC','LC')),
  closing_date TEXT,
  age_at_date TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY,
  gala_id INTEGER NOT NULL REFERENCES galas(id) ON DELETE CASCADE,
  swimmer_id INTEGER NOT NULL REFERENCES swimmers(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  entry_hs INTEGER,
  entry_auto INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','entered','withdrawn')),
  UNIQUE (gala_id, swimmer_id, event)
);

CREATE TABLE IF NOT EXISTS technique_points (
  id INTEGER PRIMARY KEY,
  stroke TEXT NOT NULL CHECK (stroke IN ('Free','Back','Breast','Fly','IM','Starts','Turns','Finishes')),
  area TEXT,
  point TEXT NOT NULL,
  cue_word TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS drills (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  stroke TEXT NOT NULL,
  category TEXT, description TEXT, equipment TEXT, groups TEXT, rotation TEXT, video_url TEXT,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS drill_points (
  drill_id INTEGER NOT NULL REFERENCES drills(id) ON DELETE CASCADE,
  point_id INTEGER NOT NULL REFERENCES technique_points(id) ON DELETE CASCADE,
  PRIMARY KEY (drill_id, point_id)
);
CREATE TABLE IF NOT EXISTS session_drills (
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  drill_id INTEGER NOT NULL REFERENCES drills(id) ON DELETE CASCADE,
  PRIMARY KEY (session_id, drill_id)
);

CREATE TABLE IF NOT EXISTS set_templates (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  part TEXT NOT NULL CHECK (part IN ('Warm-up','Drill','Pre-main','Main','Kick','Sprint','Swim-down')),
  mesocycles TEXT, focus_tags TEXT, groups TEXT,
  text TEXT NOT NULL,
  metres INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS session_shapes (
  group_name TEXT NOT NULL,
  slot TEXT NOT NULL,
  minutes INTEGER,
  target_m INTEGER NOT NULL,
  parts TEXT NOT NULL,
  PRIMARY KEY (group_name, slot)
);

CREATE TABLE IF NOT EXISTS import_mappings (
  kind TEXT NOT NULL, headers TEXT NOT NULL, mapping TEXT NOT NULL,
  PRIMARY KEY (kind, headers)
);
`;

const DEFAULT_SETTINGS = {
  season_start: calc.DEFAULT_SEASON_START,
  counties_week: '21',
  county_season: '2027',
  county_age_at: '2027-12-31',
  amber_threshold_s: '2.0',
  active_conversion_table_id: '1',
  plan_weeks: '52',
};

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  init(db);
  return db;
}

function init(db) {
  const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) ins.run(k, v);
  const s = getSettings(db);

  // Plan weeks 1..N always exist so sessions can link to them.
  const insWeek = db.prepare('INSERT OR IGNORE INTO plan_weeks (week_no, start_date) VALUES (?, ?)');
  for (let w = 1; w <= Number(s.plan_weeks); w++) insWeek.run(w, calc.weekStart(w, s.season_start));

  // First-run seeds only (never re-seed once a table has had rows).
  const empty = (t) => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n === 0;
  const tx = db.transaction(() => {
    if (empty('conversion_tables')) {
      db.prepare('INSERT INTO conversion_tables (id, name, notes) VALUES (1, ?, ?)').run(
        'Placeholder – edit me',
        'Factor 1.0 = LC time used unchanged as SC. Replace with your trusted equivalent-time factors (SC = LC × factor − offset).'
      );
      const f = db.prepare('INSERT INTO conversion_factors (table_id, event, sex, factor, offset_s) VALUES (1, ?, ?, 1.0, 0)');
      for (const e of calc.EVENT_KEYS) f.run(e, 'X');
    }
    if (empty('county_times')) seed.loadStandards(db, require('../seed-data/county_2027_lancashire.json'), '2027');
    if (empty('galas')) {
      const g = db.prepare('INSERT INTO galas (name, start_date, end_date) VALUES (?, ?, ?)');
      for (const x of seed.GALAS) g.run(x.name, x.start, x.end);
    }
    if (empty('technique_points')) {
      const t = db.prepare('INSERT INTO technique_points (stroke, area, point, cue_word, sort) VALUES (?, ?, ?, ?, ?)');
      seed.TECHNIQUE.forEach((p, i) => t.run(p[0], p[1], p[2], p[3], i));
    }
    if (empty('set_templates')) {
      const t = db.prepare('INSERT INTO set_templates (name, part, mesocycles, focus_tags, groups, text, metres) VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (const x of seed.TEMPLATES) t.run(x.name, x.part, x.mesocycles || '', x.focus || '', x.groups || '', x.text, x.metres);
    }
    if (empty('session_shapes')) {
      const t = db.prepare('INSERT INTO session_shapes (group_name, slot, minutes, target_m, parts) VALUES (?, ?, ?, ?, ?)');
      for (const x of seed.SHAPES) t.run(x.group, x.slot, x.minutes, x.target, x.parts);
    }
  });
  tx();
}

function getSettings(db) {
  const out = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = r.value;
  return out;
}
function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}

module.exports = { openDb, getSettings, setSetting };
