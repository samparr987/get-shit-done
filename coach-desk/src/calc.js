'use strict';
// Pure calculations. No database access in here so everything is unit-testable.

const STROKES = { FR: 'Free', BK: 'Back', BR: 'Breast', FL: 'Fly', IM: 'IM' };
const DISTANCES = {
  FR: [50, 100, 200, 400, 800, 1500],
  BK: [50, 100, 200],
  BR: [50, 100, 200],
  FL: [50, 100, 200],
  IM: [100, 200, 400],
};
const EVENTS = [];
for (const s of Object.keys(DISTANCES)) {
  for (const d of DISTANCES[s]) EVENTS.push({ key: `${d}${s}`, distance: d, stroke: s, name: `${d} ${STROKES[s]}` });
}
const EVENT_KEYS = EVENTS.map((e) => e.key);
const GROUPS = ['Group 1', 'Group 2', 'Group 3', 'Squad', 'Masters', 'Club Train', 'Cold'];
const SLOTS = ['Mon', 'Fri', 'Sat AM', 'Sat PM'];
const SLOT_DAY = { Mon: 1, Fri: 5, 'Sat AM': 6, 'Sat PM': 6 }; // JS getUTCDay()
const TECH_STROKES = ['Free', 'Back', 'Breast', 'Fly', 'IM', 'Starts', 'Turns', 'Finishes'];

function eventName(key) {
  const e = EVENTS.find((x) => x.key === key);
  return e ? e.name : key;
}

// Accepts '100 Free', '100m Freestyle', '100 Fr', '200 IM', '100FR', '50 Butterfly', ...
function parseEvent(text) {
  if (text == null) return null;
  const t = String(text).trim().toUpperCase().replace(/\s+/g, ' ');
  if (EVENT_KEYS.includes(t.replace(/\s/g, ''))) return t.replace(/\s/g, '');
  const m = t.match(/(\d{2,4})\s*M?\b\s*(.*)$/);
  if (!m) return null;
  const dist = Number(m[1]);
  const rest = m[2];
  let stroke = null;
  if (/^(FREE|FR\b|FS\b|F\/S|FREESTYLE)/.test(rest)) stroke = 'FR';
  else if (/^(BACK|BK\b|BA\b)/.test(rest)) stroke = 'BK';
  else if (/^(BREAST|BR\b|BRS)/.test(rest)) stroke = 'BR';
  else if (/^(FLY|BUTTERFLY|FL\b|BF\b)/.test(rest)) stroke = 'FL';
  else if (/^(IM\b|I\.M|IND|MEDLEY)/.test(rest)) stroke = 'IM';
  if (!stroke) return null;
  const key = `${dist}${stroke}`;
  return EVENT_KEYS.includes(key) ? key : null;
}

// ---- times (stored as integer hundredths) ----
function parseTime(text) {
  if (text == null) return null;
  if (typeof text === 'number') return Number.isFinite(text) && text > 0 ? Math.round(text * 100) : null;
  const t = String(text).trim().replace(',', '.');
  if (!t) return null;
  const m = t.match(/^(?:(\d+)[:.](?=\d{2}[.:]))?(\d{1,3})(?:[.:](\d{1,2}))?$/);
  if (!m) return null;
  const mins = m[1] ? Number(m[1]) : 0;
  const secs = Number(m[2]);
  if (m[1] && secs >= 60) return null;
  let frac = m[3] || '0';
  if (frac.length === 1) frac += '0';
  const hs = (mins * 60 + secs) * 100 + Number(frac);
  return hs > 0 ? hs : null;
}

function formatTime(hs) {
  if (hs == null || hs === '') return '';
  hs = Math.round(Number(hs));
  const neg = hs < 0;
  hs = Math.abs(hs);
  const mins = Math.floor(hs / 6000);
  const secs = Math.floor((hs % 6000) / 100);
  const frac = String(hs % 100).padStart(2, '0');
  const s = mins > 0 ? `${mins}:${String(secs).padStart(2, '0')}.${frac}` : `${secs}.${frac}`;
  return neg ? `-${s}` : s;
}

// ---- dates (ISO YYYY-MM-DD strings, calendar maths in UTC to avoid DST drift) ----
function parseISO(d) {
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) throw new Error(`Bad date: ${d}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}
function toUTC(d) {
  const p = parseISO(d);
  return Date.UTC(p.y, p.m - 1, p.d);
}
function fromUTC(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}
function addDays(d, n) {
  return fromUTC(toUTC(d) + n * 86400000);
}
function daysBetween(a, b) {
  return Math.round((toUTC(b) - toUTC(a)) / 86400000);
}
function dayOfWeek(d) {
  return new Date(toUTC(d)).getUTCDay();
}
function mondayOf(d) {
  const dow = dayOfWeek(d);
  return addDays(d, dow === 0 ? -6 : 1 - dow);
}

// Accepts ISO, UK dd/mm/yyyy (or dd-mm-yyyy, dd.mm.yy), '3 May 2012', JS Date, Excel serial.
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function parseDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return isNaN(v) ? null : v.toISOString().slice(0, 10);
  if (typeof v === 'number') return fromUTC(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += y > 50 ? 1900 : 2000;
    return valid(y, +m[2], +m[1]);
  }
  m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{4})$/);
  if (m) {
    const mi = MONTHS.indexOf(m[2].toLowerCase());
    if (mi >= 0) return valid(+m[3], mi + 1, +m[1]);
  }
  return null;
  function valid(y, mo, d) {
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return dt.toISOString().slice(0, 10);
  }
}

function formatDate(d) {
  if (!d) return '';
  const p = parseISO(d);
  return `${p.d} ${MONTHS[p.m - 1][0].toUpperCase()}${MONTHS[p.m - 1].slice(1)} ${p.y}`;
}

// ---- ages ----
function ageOn(dob, date) {
  const b = parseISO(dob);
  const o = parseISO(date);
  let age = o.y - b.y;
  if (o.m < b.m || (o.m === b.m && o.d < b.d)) age -= 1;
  return age;
}
function ageAt31Dec(dob, year) {
  return ageOn(dob, `${year}-12-31`);
}

// ---- season weeks ----
const DEFAULT_SEASON_START = '2026-08-31';
function weekNumber(date, seasonStart = DEFAULT_SEASON_START) {
  return Math.floor(daysBetween(seasonStart, date) / 7) + 1;
}
function weekStart(weekNo, seasonStart = DEFAULT_SEASON_START) {
  return addDays(seasonStart, (weekNo - 1) * 7);
}
function weeksToCounties(date, countiesWeek = 21, seasonStart = DEFAULT_SEASON_START) {
  return countiesWeek - weekNumber(date, seasonStart);
}

// ---- LC -> SC conversion ----
// factors: [{event, sex: 'M'|'F'|'X', factor, offset_s}]. Sex-specific row wins over 'X'.
function findFactor(factors, event, sex) {
  return (
    factors.find((f) => f.event === event && f.sex === sex) ||
    factors.find((f) => f.event === event && f.sex === 'X') ||
    null
  );
}
function lcToSc(lcHs, factorRow) {
  if (lcHs == null || !factorRow) return null;
  return Math.round(lcHs * Number(factorRow.factor) - Number(factorRow.offset_s) * 100);
}

// Better of SC PB and converted LC PB. Ties go to the real SC swim.
// officialConv: an official 'Converted to SC' figure for the LC swim (swimmingresults), which wins over the factor table.
function bestScEquivalent(scPb, lcPb, factorRow, officialConv = null) {
  const conv = officialConv != null ? officialConv : lcToSc(lcPb, factorRow);
  if (scPb == null && conv == null) return null;
  if (conv == null || (scPb != null && scPb <= conv)) return { time: scPb, source: 'SC' };
  return { time: conv, source: 'LC', lc: lcPb };
}

// ---- county gap ----
// Gap in hundredths; positive = slower than the QT. Bands: green qualified, amber within threshold, red.
function countyGap(bestHs, qtHs, amberSeconds = 2.0) {
  if (bestHs == null || qtHs == null) return null;
  const gap = bestHs - qtHs;
  let band;
  if (gap <= 0) band = 'green';
  else if (gap <= Math.round(amberSeconds * 100)) band = 'amber';
  else band = 'red';
  return { gapHs: gap, gapSeconds: gap / 100, band };
}

// county rows: [{event, sex, age, age_max, course, time_hs}] for one season.
function findQualifyingTime(rows, event, sex, age, course) {
  return (
    rows.find(
      (r) =>
        r.event === event &&
        r.sex === sex &&
        r.course === course &&
        (r.age_max == null ? age === r.age : age >= r.age && age <= r.age_max)
    ) || null
  );
}

// ---- import merge rule ----
// existing: current swimmer row (or null). row: normalised import row.
// Returns the columns to write. The group only changes when the coach hasn't locked it.
function mergeSwimmerImport(existing, row) {
  const patch = {};
  for (const k of ['first_name', 'last_name', 'dob', 'sex', 'other_club']) {
    if (row[k] != null && row[k] !== '') patch[k] = row[k];
  }
  if (row.se_id) patch.se_id = row.se_id;
  if (row.bolton_metro != null) patch.bolton_metro = row.bolton_metro ? 1 : 0;
  if (row.group_name) {
    patch.imported_group = row.group_name;
    if (!existing || !existing.group_locked) patch.group_name = row.group_name;
  }
  return patch;
}

function normaliseGroup(v) {
  if (!v) return null;
  const s = String(v).trim().toLowerCase().replace(/\s+/g, ' ');
  const hit = GROUPS.find((g) => g.toLowerCase() === s || g.toLowerCase().replace(' ', '') === s.replace(' ', ''));
  return hit || null;
}
function normaliseSex(v) {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  if (['m', 'male', 'boy', 'man', 'open'].includes(s)) return 'M';
  if (['f', 'female', 'girl', 'woman', 'w'].includes(s)) return 'F';
  return null;
}
function normaliseCourse(v) {
  if (!v) return null;
  const s = String(v).trim().toUpperCase();
  if (['SC', 'S', '25', '25M', 'SCM', 'SHORT', 'SHORT COURSE'].includes(s)) return 'SC';
  if (['LC', 'L', '50', '50M', 'LCM', 'LONG', 'LONG COURSE'].includes(s)) return 'LC';
  return null;
}
function truthy(v) {
  if (v == null) return false;
  return ['1', 'y', 'yes', 'true', 'x', '✓'].includes(String(v).trim().toLowerCase());
}

module.exports = {
  STROKES, EVENTS, EVENT_KEYS, GROUPS, SLOTS, SLOT_DAY, TECH_STROKES,
  eventName, parseEvent, parseTime, formatTime,
  parseDate, formatDate, addDays, daysBetween, dayOfWeek, mondayOf,
  ageOn, ageAt31Dec, weekNumber, weekStart, weeksToCounties, DEFAULT_SEASON_START,
  findFactor, lcToSc, bestScEquivalent, countyGap, findQualifyingTime,
  mergeSwimmerImport, normaliseGroup, normaliseSex, normaliseCourse, truthy,
};
