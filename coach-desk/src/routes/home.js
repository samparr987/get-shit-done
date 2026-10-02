'use strict';
const calc = require('../calc');
const county = require('../county');

module.exports = (app, { db }) => {
  app.get('/', (req, res) => {
    const { settings: st, todayIso } = res.locals;
    const wn = calc.weekNumber(todayIso, st.season_start);
    const week = db.prepare('SELECT * FROM plan_weeks WHERE week_no = ?').get(wn);
    const sessions = db.prepare('SELECT * FROM sessions WHERE date = ? ORDER BY slot, group_name').all(todayIso);
    const closing = db.prepare(`SELECT * FROM galas WHERE (closing_date >= ? AND closing_date <= ?)
      OR (closing_date IS NULL AND start_date >= ? AND start_date <= ?) ORDER BY COALESCE(closing_date, start_date)`)
      .all(todayIso, calc.addDays(todayIso, 21), todayIso, calc.addDays(todayIso, 42));
    const amber = county.allGaps(db, { band: 'amber' }).sort((a, b) => a.gap.gapHs - b.gap.gapHs);
    const nextGalas = db.prepare('SELECT * FROM galas WHERE end_date >= ? ORDER BY start_date LIMIT 3').all(todayIso);
    res.render('home', {
      title: 'Coach Desk', wn, week, toCounties: Number(st.counties_week) - wn,
      sessions, closing, amber, nextGalas,
    });
  });
};
