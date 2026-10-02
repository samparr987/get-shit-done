'use strict';
// First-run seed data. Everything here is editable in the app afterwards.

const GALAS = [
  { name: 'BCM Autumn', start: '2026-10-03', end: '2026-10-04' },
  { name: 'Radcliffe League', start: '2026-10-10', end: '2026-10-10' },
  { name: 'Burnley Monster Splash', start: '2026-10-24', end: '2026-10-25' },
  { name: 'BMSS Winter', start: '2026-12-12', end: '2026-12-12' },
  { name: 'Winter Warmer', start: '2027-01-08', end: '2027-01-10' },
];

// [stroke, area, point, cue word] — standard teaching points, edit to match how you coach.
const TECHNIQUE = [
  ['Free', 'Body position', 'Head neutral, eyes down, hips and heels at the surface', 'Long & flat'],
  ['Free', 'Rotation', 'Rotate from the hips and shoulders together, about 45°', 'Roll'],
  ['Free', 'Catch', 'High elbow early vertical forearm before pulling', 'Elbow up'],
  ['Free', 'Pull', 'Pull under the body and push past the hip', 'Finish at the thigh'],
  ['Free', 'Recovery', 'Relaxed high-elbow recovery, hand enters in line with the shoulder', 'Fingertips in'],
  ['Free', 'Breathing', 'Breathe by rotating, one goggle stays in the water', 'One goggle'],
  ['Free', 'Kick', 'Kick from the hip, long legs, pointed toes, small fast kick', 'Fast feet'],
  ['Back', 'Body position', 'Head still, ears in, hips up, chin neutral', 'Head still'],
  ['Back', 'Rotation', 'Rotate shoulders so each shoulder clears the water', 'Shoulder to chin'],
  ['Back', 'Entry', 'Little finger enters first, arm straight, in line with the shoulder', 'Pinkie first'],
  ['Back', 'Pull', 'Bent-arm pull, push down towards the feet', 'Bend & push'],
  ['Back', 'Kick', 'Kick from the hips, knees stay under the surface', 'Boil the water'],
  ['Breast', 'Body position', 'Glide streamlined between strokes, head in line', 'Kick, glide'],
  ['Breast', 'Pull', 'Outsweep, insweep, hands meet under the chin, shoot forward', 'Out, in, shoot'],
  ['Breast', 'Kick', 'Heels to bottom, turn feet out, whip round and together', 'Feet out'],
  ['Breast', 'Timing', 'Pull, breathe, kick, glide — arms forward before the kick finishes', 'Pull, breathe, kick, glide'],
  ['Breast', 'Breathing', 'Lift the head on the insweep, return it as the hands shoot', 'Chin forward'],
  ['Fly', 'Body position', 'Undulate from the chest, hips stay high', 'Chest press'],
  ['Fly', 'Kick', 'Two kicks per stroke: one on entry, one on the push', 'Kick in, kick out'],
  ['Fly', 'Pull', 'Keyhole pull, finish past the hips', 'Push through'],
  ['Fly', 'Recovery', 'Arms swing low and relaxed over the water, thumbs down', 'Low & loose'],
  ['Fly', 'Breathing', 'Breathe forward low and early, head back down before hands enter', 'Chin on the water'],
  ['IM', 'Transitions', 'Fly→back: touch with two hands, drop back. Back→breast: touch on the back. Breast→free: two-hand touch', 'Legal touches'],
  ['IM', 'Pacing', 'Even effort across strokes, do not over-swim the fly', 'Control the fly'],
  ['Starts', 'Set', 'Weight forward, back foot ready to drive, eyes down', 'Ready to drive'],
  ['Starts', 'Entry', 'Enter through one hole, tight streamline', 'One hole'],
  ['Starts', 'Breakout', 'Underwater kicks then breakout before slowing to race speed', 'Kick, kick, break'],
  ['Turns', 'Approach', 'No breath into the wall, hold speed', 'Attack the wall'],
  ['Turns', 'Rotation', 'Tight tumble, chin to chest, feet plant shoulder-width', 'Small ball'],
  ['Turns', 'Push-off', 'Streamline push off on the back/side, rotate during the kick', 'Streamline'],
  ['Finishes', 'Touch', 'Finish on a full stroke, head down, no glide into the wall', 'Head down to the wall'],
];

// Generator building blocks. '' tags = suits anything. {stroke} is filled from the week's focus.
const TEMPLATES = [
  { name: 'Starter WU A', part: 'Warm-up', text: '200 choice easy\n4 x 50 {stroke} drill/swim by 25', metres: 400 },
  { name: 'Starter WU B', part: 'Warm-up', text: '100 free, 100 back, 100 {stroke}, 100 kick', metres: 400 },
  { name: 'Starter WU short', part: 'Warm-up', groups: 'Group 1,Cold', text: '4 x 25 choice easy\n4 x 25 kick', metres: 200 },
  { name: 'Starter pre-main', part: 'Pre-main', text: '4 x 50 {stroke} build, 15s rest', metres: 200 },
  { name: 'Starter aerobic main', part: 'Main', mesocycles: 'Aerobic,Base,General Prep', text: '4 x 100 {stroke} steady, 20s rest\n2 x 50 free easy', metres: 500 },
  { name: 'Starter threshold main', part: 'Main', mesocycles: 'Threshold,Specific Prep', text: '6 x 100 {stroke} on threshold pace, 15s rest', metres: 600 },
  { name: 'Starter race-pace main', part: 'Main', mesocycles: 'Race Pace,Taper,Competition', text: '8 x 50 {stroke} race pace, 30s rest\n100 easy', metres: 500 },
  { name: 'Starter general main', part: 'Main', text: '3 x 100 {stroke} (25 drill / 75 swim)\n4 x 50 free descend 1-4', metres: 500 },
  { name: 'Starter kick', part: 'Kick', text: '4 x 50 {stroke} kick with board', metres: 200 },
  { name: 'Starter sprint', part: 'Sprint', text: '4 x 25 {stroke} sprint from a push, full rest', metres: 100 },
  { name: 'Starter swim-down', part: 'Swim-down', text: '100 easy choice', metres: 100 },
];

// target metres per group/slot — starter guesses, edit on the Library page.
const BASE = { 'Group 1': 1200, 'Group 2': 1800, 'Group 3': 2400, Squad: 3200, Masters: 2400, 'Club Train': 2000, Cold: 800 };
const SHAPES = [];
for (const [group, target] of Object.entries(BASE)) {
  for (const slot of ['Mon', 'Fri', 'Sat AM', 'Sat PM']) {
    SHAPES.push({
      group,
      slot,
      minutes: 60,
      target,
      parts: target >= 2000 ? 'Warm-up,Drill,Pre-main,Main,Kick,Swim-down' : 'Warm-up,Drill,Main,Swim-down',
    });
  }
}

// Load a standards sheet in the swimmer-county-analysis skill's JSON schema:
// { meta:{...}, female:{'50 Free':{'10/11':'36.59','12':...,'17/Ov':...}}, male:{...} }
function parseAgeBand(label) {
  const s = String(label).trim();
  let m = s.match(/^(\d+)\s*\/\s*(?:ov|over|o)\w*$/i) || s.match(/^(\d+)\s*(?:\+|&\s*over|and over)$/i);
  if (m) return { age: Number(m[1]), age_max: 99 };
  m = s.match(/^(\d+)\s*[\/-]\s*(\d+)$/);
  if (m) return { age: Number(m[1]), age_max: Number(m[2]) };
  m = s.match(/^(\d+)$/);
  if (m) return { age: Number(m[1]), age_max: null };
  return null;
}
function loadStandards(db, json, season) {
  const calc = require('./calc');
  const meta = json.meta || {};
  const course = /long/i.test(meta.course || '') ? 'LC' : 'SC';
  season = String(season || meta.championship_year);
  const refDate = calc.parseDate(meta.age_reference_date) || null;
  db.prepare(`INSERT OR REPLACE INTO county_seasons (season, authority, course, age_reference_date, qualifying_window, conditions, source, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(season, meta.authority, course, refDate, meta.qualifying_window, meta.conditions, meta.source, meta.note);
  const ins = db.prepare(`INSERT OR REPLACE INTO county_times (season, event, sex, age, age_max, course, time_hs) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  let n = 0;
  for (const [sexKey, sex] of [['female', 'F'], ['male', 'M']]) {
    for (const [evName, byAge] of Object.entries(json[sexKey] || {})) {
      const event = calc.parseEvent(evName);
      if (!event) throw new Error(`Unknown event in standards: ${evName}`);
      for (const [band, t] of Object.entries(byAge)) {
        const a = parseAgeBand(band);
        const hs = calc.parseTime(t);
        if (!a || hs == null) throw new Error(`Bad standard ${evName} ${band}=${t}`);
        ins.run(season, event, sex, a.age, a.age_max, course, hs);
        n++;
      }
    }
  }
  return n;
}

module.exports = { GALAS, TECHNIQUE, TEMPLATES, SHAPES, parseAgeBand, loadStandards };
