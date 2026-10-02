'use strict';
// Rule-based session generator. Builds a DRAFT from the annual plan week + your library
// (set templates, session shapes, drills folder, technique points). Deterministic for a given seed.
const calc = require('./calc');
const { getSettings } = require('./db');

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
function shuffle(r, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const tags = (s) => String(s || '').split(/[,;]/).map((x) => x.trim().toLowerCase()).filter(Boolean);
// '' tag list = matches anything; otherwise any tag must appear in the text.
function tagMatch(list, text) {
  const t = tags(list);
  if (!t.length) return true;
  const hay = String(text || '').toLowerCase();
  return t.some((x) => hay.includes(x));
}

const STROKE_WORDS = [
  ['Fly', /\b(fly|butterfly)\b/i],
  ['Breast', /\b(breast|breaststroke)\b/i],
  ['Back', /\b(back|backstroke)\b/i],
  ['IM', /\b(im|medley)\b/i],
  ['Free', /\b(free|freestyle|front crawl)\b/i],
];
function focusStroke(week) {
  const text = `${week.focus || ''} ${week.drills || ''}`;
  for (const [s, re] of STROKE_WORDS) if (re.test(text)) return s;
  return ['Free', 'Back', 'Breast', 'Fly'][(week.week_no - 1 + 4) % 4];
}
function rotationTags(week) {
  // 'A', 'Rotation B', 'B/C', 'Drills: A' -> ['a'], ['b'], ['b','c'] ...
  const raw = String(week.drills || '').replace(/rotation|drills?:?/gi, ' ');
  return raw.split(/[\s,\/;+&]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
}

/**
 * generateSession(db, { date, slot, group, seed }) -> { sets, total_m, notes, drillIds, week, explain[] }
 */
function generateSession(db, { date, slot, group, seed = 1 }) {
  const s = getSettings(db);
  const r = rng(Number(seed) || 1);
  const wn = calc.weekNumber(date, s.season_start);
  const week = db.prepare('SELECT * FROM plan_weeks WHERE week_no = ?').get(wn) || { week_no: wn };
  const explain = [];
  const shape =
    db.prepare('SELECT * FROM session_shapes WHERE group_name = ? AND slot = ?').get(group, slot) ||
    db.prepare('SELECT * FROM session_shapes WHERE group_name = ? LIMIT 1').get(group) ||
    { target_m: 2000, parts: 'Warm-up,Drill,Main,Swim-down', minutes: 60 };
  const target = shape.target_m;
  const stroke = focusStroke(week);
  const strokeWord = { Free: 'free', Back: 'back', Breast: 'breast', Fly: 'fly', IM: 'IM' }[stroke];
  if (week.holiday) explain.push('Holiday / half-term week — check the pool is on.');
  if (!week.mesocycle && !week.focus) explain.push(`Week ${wn} has no mesocycle or focus in the annual plan, so any template was allowed.`);

  const templates = db.prepare('SELECT * FROM set_templates').all();
  const blocks = [];
  let drillIds = [];
  let cues = [];

  for (const part of shape.parts.split(',').map((p) => p.trim()).filter(Boolean)) {
    if (part === 'Drill') {
      const d = pickDrills(db, r, { week, group, stroke, date, explain });
      drillIds = d.map((x) => x.id);
      if (!d.length) continue;
      const big = ['Squad', 'Masters', 'Group 3'].includes(group);
      const reps = big ? '4 x 50' : '4 x 25';
      const each = big ? 200 : 100;
      blocks.push({
        part: `Drill${rotationTags(week).length ? ` — rotation ${rotationTags(week).join('/').toUpperCase()}` : ''}`,
        lines: d.map((x) => `${reps} ${x.name}${x.equipment ? ` (${x.equipment})` : ''}`),
        metres: each * d.length,
      });
      cues = techniqueCues(db, drillIds, stroke);
      continue;
    }
    const levels = [
      (t) => tagMatch(t.mesocycles, week.mesocycle) && tagMatch(t.focus_tags, week.focus) && tagMatch(t.groups, group),
      (t) => tagMatch(t.mesocycles, week.mesocycle) && tagMatch(t.groups, group),
      (t) => tagMatch(t.groups, group),
      () => true,
    ];
    let cands = [];
    let lvl = 0;
    for (; lvl < levels.length; lvl++) {
      cands = templates.filter((t) => t.part === part && levels[lvl](t));
      if (cands.length) break;
    }
    if (!cands.length) { explain.push(`No ${part} template in the library — part skipped.`); continue; }
    if (lvl === 1) explain.push(`${part}: no template tagged for focus "${week.focus}", used one for the mesocycle.`);
    if (lvl === 2) explain.push(`${part}: no template tagged for mesocycle "${week.mesocycle || '—'}", used a general one.`);
    if (lvl === 3) explain.push(`${part}: no template tagged for ${group}, used any.`);
    const t = pick(r, cands);
    blocks.push({ part, lines: t.text.replace(/\{stroke\}/g, strokeWord).split(/\r?\n/), metres: t.metres, main: part === 'Main', template: t.name });
  }

  // Fit to the target: repeat the main set, then top up or trim optional parts.
  const sum = () => blocks.reduce((a, b) => a + b.metres * (b.rounds || 1), 0);
  const main = blocks.find((b) => b.main);
  if (main) {
    const others = sum() - main.metres;
    main.rounds = Math.max(1, Math.round((target - others) / main.metres));
  }
  for (const opt of ['Kick', 'Sprint', 'Pre-main']) {
    if (sum() <= target * 1.1) break;
    const i = blocks.findIndex((b) => b.part === opt);
    if (i >= 0) { explain.push(`Dropped ${opt} to stay near ${target}m.`); blocks.splice(i, 1); }
  }
  const short = target - sum();
  if (short > target * 0.05) {
    const n = Math.round(short / 50);
    if (n > 0) blocks.splice(Math.max(0, blocks.length - 1), 0, { part: 'Aerobic top-up', lines: [`${n} x 50 ${strokeWord}/free alternate, steady, 10s rest`], metres: n * 50 });
  }
  const total = sum();
  if (Math.abs(total - target) > target * 0.1) explain.push(`Total ${total}m is more than 10% off the ${target}m target — adjust templates on the Library page.`);

  const head = [
    `Week ${wn}${week.mesocycle ? ` · ${week.mesocycle}` : ''}${week.focus ? ` · ${week.focus}` : ''}`,
    `Focus stroke: ${stroke}`,
    '',
  ];
  const body = blocks.map((b) => {
    const m = b.metres * (b.rounds || 1);
    const lines = b.rounds > 1 ? [`${b.rounds} rounds of:`, ...b.lines.map((l) => `  ${l}`)] : b.lines;
    return `${b.part.toUpperCase()} (${m}m)\n${lines.join('\n')}`;
  });
  const cueText = cues.length ? `\n\nTECHNIQUE CUES\n${cues.map((c) => `• ${c.point}${c.cue_word ? ` — "${c.cue_word}"` : ''}`).join('\n')}` : '';
  return {
    sets: head.join('\n') + '\n' + body.join('\n\n') + cueText,
    total_m: total,
    notes: explain.join(' '),
    drillIds,
    week,
    stroke,
    target,
    explain,
  };
}

function pickDrills(db, r, { week, group, stroke, date, explain }) {
  const all = db.prepare('SELECT * FROM drills WHERE active = 1').all();
  if (!all.length) { explain.push('Drills folder is empty — add your house drills on the Drills page.'); return []; }
  const rot = rotationTags(week);
  const inRot = (d) => !rot.length || !d.rotation || tags(d.rotation).some((t) => rot.includes(t));
  const forGroup = (d) => tagMatch(d.groups, group);
  const recent = new Set(
    db.prepare(`SELECT sd.drill_id FROM session_drills sd JOIN sessions s ON s.id = sd.session_id
      WHERE s.group_name = ? AND s.date >= ? AND s.date < ?`).all(group, calc.addDays(date, -14), date).map((x) => x.drill_id)
  );
  let pool = all.filter((d) => inRot(d) && forGroup(d) && (d.stroke === stroke || (stroke === 'IM' && d.stroke !== 'Starts')));
  if (!pool.length) {
    pool = all.filter((d) => inRot(d) && forGroup(d));
    if (pool.length) explain.push(`No ${stroke} drills in rotation ${rot.join('/').toUpperCase() || '(any)'} — used other strokes from the rotation.`);
  }
  if (!pool.length) {
    pool = all.filter(forGroup);
    if (pool.length) explain.push(`No drills tagged for rotation ${rot.join('/').toUpperCase()} — picked from the whole folder.`);
  }
  if (!pool.length) pool = all;
  const fresh = shuffle(r, pool.filter((d) => !recent.has(d.id)));
  const used = shuffle(r, pool.filter((d) => recent.has(d.id)));
  const want = Math.min(pool.length, 2 + Math.floor(r() * 2)); // 2 or 3
  const chosen = fresh.slice(0, want);
  if (chosen.length < want) {
    explain.push('Repeated a drill from the last 2 weeks (not enough alternatives).');
    chosen.push(...used.slice(0, want - chosen.length));
  }
  return chosen;
}

function techniqueCues(db, drillIds, stroke) {
  let cues = [];
  if (drillIds.length) {
    cues = db.prepare(`SELECT DISTINCT tp.* FROM technique_points tp JOIN drill_points dp ON dp.point_id = tp.id
      WHERE dp.drill_id IN (${drillIds.map(() => '?').join(',')}) ORDER BY tp.sort`).all(...drillIds);
  }
  if (!cues.length) cues = db.prepare('SELECT * FROM technique_points WHERE stroke = ? ORDER BY sort LIMIT 3').all(stroke);
  return cues.slice(0, 4);
}

module.exports = { generateSession, focusStroke, rotationTags, rng };
