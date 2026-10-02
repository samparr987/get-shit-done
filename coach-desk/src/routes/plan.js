'use strict';
const calc = require('../calc');
const web = require('../web');

module.exports = (app, { db }) => {
  function weeks(res) {
    const st = res.locals.settings;
    const galas = db.prepare('SELECT * FROM galas ORDER BY start_date').all();
    return db.prepare('SELECT * FROM plan_weeks ORDER BY week_no').all().map((w) => ({
      ...w,
      toCounties: Number(st.counties_week) - w.week_no,
      galas: galas.filter((g) => g.start_date <= calc.addDays(w.start_date, 6) && g.end_date >= w.start_date),
    }));
  }
  app.get('/plan', (req, res) => {
    const rows = weeks(res);
    if (web.wantsCsv(req)) {
      return web.sendCsv(res, 'annual-plan', [
        ['Week', (r) => r.week_no], ['Start', (r) => r.start_date], ['Weeks to Counties', (r) => r.toCounties], ['Mesocycle', (r) => r.mesocycle],
        ['Focus', (r) => r.focus], ['Drills', (r) => r.drills], ['Notes', (r) => r.notes], ['Galas', (r) => [r.galas_text, ...r.galas.map((g) => g.name)].filter(Boolean).join('; ')],
        ['Holiday', (r) => (r.holiday ? 'Y' : '')],
      ], rows);
    }
    res.render('plan', { title: 'Annual plan', rows });
  });
  app.post('/plan', (req, res) => {
    const up = db.prepare('UPDATE plan_weeks SET mesocycle=@mesocycle, focus=@focus, drills=@drills, notes=@notes, galas_text=@galas_text, holiday=@holiday WHERE week_no=@week_no');
    const tx = db.transaction(() => {
      for (const r of web.arr(req.body.rows)) {
        if (!web.int(r.week_no)) continue;
        up.run({ week_no: web.int(r.week_no), mesocycle: web.s(r.mesocycle), focus: web.s(r.focus), drills: web.s(r.drills), notes: web.s(r.notes), galas_text: web.s(r.galas_text), holiday: r.holiday ? 1 : 0 });
      }
    });
    tx();
    res.redirect('/plan?msg=Plan+saved#current');
  });
};
