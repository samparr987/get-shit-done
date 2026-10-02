'use strict';
// County analysis against the database: PBs, fastest-route best SC-equivalent, gaps.
const calc = require('./calc');
const { getSettings } = require('./db');

function conversionFactors(db, tableId) {
  if (tableId == null) tableId = Number(getSettings(db).active_conversion_table_id);
  return db.prepare('SELECT event, sex, factor, offset_s FROM conversion_factors WHERE table_id = ?').all(tableId);
}

// PBs for one swimmer: { [event]: { SC: timeRow, LC: timeRow, LCconv: {time, row, official} } }
function personalBests(db, swimmer, factors = conversionFactors(db)) {
  const rows = db.prepare('SELECT * FROM times WHERE swimmer_id = ? ORDER BY swum_on').all(swimmer.id);
  const out = {};
  for (const r of rows) {
    const e = (out[r.event] = out[r.event] || {});
    if (!e[r.course] || r.time_hs < e[r.course].time_hs) e[r.course] = r;
    if (r.course === 'LC') {
      const official = r.conv_sc_hs != null;
      const conv = official ? r.conv_sc_hs : calc.lcToSc(r.time_hs, calc.findFactor(factors, r.event, swimmer.sex));
      if (conv != null && (!e.LCconv || conv < e.LCconv.time)) e.LCconv = { time: conv, row: r, official };
    }
  }
  return out;
}

// The fastest-route best for one event, with the swim it came from.
function bestFor(pb) {
  if (!pb) return null;
  const sc = pb.SC ? pb.SC.time_hs : null;
  const best = calc.bestScEquivalent(sc, pb.LC ? pb.LC.time_hs : null, null, pb.LCconv ? pb.LCconv.time : null);
  if (!best) return null;
  const row = best.source === 'SC' ? pb.SC : pb.LCconv.row;
  return { ...best, row, official: best.source === 'LC' ? pb.LCconv.official : null };
}

function seasonInfo(db, season) {
  const s = getSettings(db);
  season = season || s.county_season;
  const meta = db.prepare('SELECT * FROM county_seasons WHERE season = ?').get(season) || { season };
  return { season, meta, ageAt: s.county_age_at || meta.age_reference_date, amber: Number(s.amber_threshold_s) };
}

// Full per-event analysis for one swimmer.
// opts: { season, age (override), since (ISO date: swims on/after are flagged as new) }
function analyseSwimmer(db, swimmer, opts = {}) {
  const info = seasonInfo(db, opts.season);
  const age = opts.age != null && opts.age !== '' ? Number(opts.age) : calc.ageOn(swimmer.dob, info.ageAt);
  const qts = db.prepare('SELECT * FROM county_times WHERE season = ? AND sex = ?').all(info.season, swimmer.sex);
  const factors = conversionFactors(db);
  const pbs = personalBests(db, swimmer, factors);
  const rows = [];
  for (const ev of calc.EVENTS) {
    let qtRow = calc.findQualifyingTime(qts, ev.key, swimmer.sex, age, 'SC');
    let qt = qtRow ? qtRow.time_hs : null;
    if (!qtRow) {
      qtRow = calc.findQualifyingTime(qts, ev.key, swimmer.sex, age, 'LC');
      if (qtRow) qt = calc.lcToSc(qtRow.time_hs, calc.findFactor(factors, ev.key, swimmer.sex));
    }
    const pb = pbs[ev.key];
    if (!qtRow && !pb) continue;
    const best = bestFor(pb);
    const gap = best && qt != null ? calc.countyGap(best.time, qt, info.amber) : null;
    rows.push({
      event: ev.key,
      name: ev.name,
      sc: pb && pb.SC ? pb.SC : null,
      lc: pb && pb.LC ? pb.LC : null,
      lcConv: pb && pb.LCconv ? pb.LCconv : null,
      best,
      qt,
      qtCourse: qtRow ? qtRow.course : null,
      gap,
      band: gap ? gap.band : best ? 'none' : 'notime',
      updated: !!(opts.since && best && best.row.swum_on >= opts.since),
    });
  }
  return { swimmer, age, info, rows };
}

// Every swimmer's gaps (rows that have both a best time and a QT), for the group view and home page.
function allGaps(db, filters = {}) {
  let sql = 'SELECT * FROM swimmers WHERE active = 1';
  const p = [];
  if (filters.group) { sql += ' AND group_name = ?'; p.push(filters.group); }
  if (filters.sex) { sql += ' AND sex = ?'; p.push(filters.sex); }
  const out = [];
  for (const sw of db.prepare(sql).all(...p)) {
    const a = analyseSwimmer(db, sw, { season: filters.season });
    for (const r of a.rows) {
      if (!r.gap) continue;
      if (filters.event && r.event !== filters.event) continue;
      if (filters.band && r.band !== filters.band) continue;
      out.push({ swimmer: sw, age: a.age, ...r });
    }
  }
  return out;
}

// Entry time for a gala: SC (or unknown course) uses the fastest-route SC best; LC uses the LC PB.
function entryTimeFor(db, swimmer, event, course) {
  const pb = personalBests(db, swimmer)[event];
  if (!pb) return null;
  if (course === 'LC') return pb.LC ? pb.LC.time_hs : null;
  const b = bestFor(pb);
  return b ? b.time : null;
}

module.exports = { conversionFactors, personalBests, bestFor, analyseSwimmer, allGaps, entryTimeFor, seasonInfo };
