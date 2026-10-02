'use strict';
const calc = require('../calc');
const web = require('../web');
const { setSetting } = require('../db');

module.exports = (app, { db }) => {
  app.get('/settings', (req, res) => res.render('settings', { title: 'Settings', errors: [] }));
  app.post('/settings', (req, res) => {
    const b = req.body;
    const errors = [];
    const start = calc.parseDate(b.season_start);
    if (!start || calc.dayOfWeek(start) !== 1) errors.push('Season start must be a Monday.');
    const ageAt = calc.parseDate(b.county_age_at);
    if (!ageAt) errors.push('County age-at date is not a date.');
    const cw = web.int(b.counties_week);
    if (!cw || cw < 1) errors.push('Counties week must be a positive number.');
    const amber = Number(b.amber_threshold_s);
    if (!(amber >= 0)) errors.push('Amber threshold must be 0 or more.');
    if (errors.length) return res.status(400).render('settings', { title: 'Settings', errors });
    const old = res.locals.settings.season_start;
    db.transaction(() => {
      setSetting(db, 'season_start', start);
      setSetting(db, 'counties_week', cw);
      setSetting(db, 'county_season', web.s(b.county_season) || '2027');
      setSetting(db, 'county_age_at', ageAt);
      setSetting(db, 'amber_threshold_s', amber);
      if (start !== old) {
        // Move week start dates; week numbers (and the plan text on them) stay put.
        for (const w of db.prepare('SELECT week_no FROM plan_weeks ORDER BY week_no DESC').all()) {
          db.prepare('UPDATE plan_weeks SET start_date = ? WHERE week_no = ?').run(`tmp-${w.week_no}`, w.week_no);
        }
        for (const w of db.prepare('SELECT week_no FROM plan_weeks').all()) {
          db.prepare('UPDATE plan_weeks SET start_date = ? WHERE week_no = ?').run(calc.weekStart(w.week_no, start), w.week_no);
        }
        for (const sess of db.prepare('SELECT id, date FROM sessions').all()) {
          const wn = calc.weekNumber(sess.date, start);
          db.prepare('UPDATE sessions SET week_no = (SELECT week_no FROM plan_weeks WHERE week_no = ?) WHERE id = ?').run(wn, sess.id);
        }
      }
    })();
    res.redirect('/settings?msg=Settings+saved');
  });
};
