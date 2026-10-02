'use strict';
const multer = require('multer');
const calc = require('../calc');
const web = require('../web');
const county = require('../county');
const seed = require('../seed');
const { setSetting } = require('../db');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

module.exports = (app, { db }) => {
  // Whole-group gap view
  app.get('/county', (req, res) => {
    const { group, event, sex, band, sort = 'closest' } = req.query;
    let rows = county.allGaps(db, { group, event, sex, band });
    if (sort === 'closest') {
      // Not yet qualified, smallest gap first; qualified swimmers after.
      rows.sort((a, b) => (a.band === 'green') - (b.band === 'green') || (a.band === 'green' ? b.gap.gapHs - a.gap.gapHs : a.gap.gapHs - b.gap.gapHs));
    } else if (sort === 'event') {
      rows.sort((a, b) => calc.EVENT_KEYS.indexOf(a.event) - calc.EVENT_KEYS.indexOf(b.event) || a.gap.gapHs - b.gap.gapHs);
    } else {
      rows.sort((a, b) => a.swimmer.last_name.localeCompare(b.swimmer.last_name) || calc.EVENT_KEYS.indexOf(a.event) - calc.EVENT_KEYS.indexOf(b.event));
    }
    if (web.wantsCsv(req)) {
      return web.sendCsv(res, 'county-gaps', [
        ['Swimmer', (r) => web.swimmerName(r.swimmer)], ['Group', (r) => r.swimmer.group_name], ['Sex', (r) => r.swimmer.sex], ['County age', (r) => r.age],
        ['Event', (r) => r.name], ['Best SC-equiv', (r) => calc.formatTime(r.best.time)], ['Source', (r) => r.best.source], ['QT', (r) => calc.formatTime(r.qt)],
        ['Gap (s)', (r) => r.gap.gapSeconds.toFixed(2)], ['Band', (r) => r.band],
      ], rows);
    }
    const counts = { green: 0, amber: 0, red: 0 };
    rows.forEach((r) => counts[r.band]++);
    res.render('county', { title: 'County times — gaps', rows, counts, info: county.seasonInfo(db) });
  });

  // Qualifying-times table editor
  app.get('/county/times', (req, res) => {
    const seasons = db.prepare('SELECT DISTINCT season FROM county_times UNION SELECT season FROM county_seasons ORDER BY 1 DESC').all().map((x) => x.season);
    const season = req.query.season || res.locals.settings.county_season;
    const { sex, event } = req.query;
    let sql = 'SELECT * FROM county_times WHERE season = ?';
    const p = [season];
    if (sex) { sql += ' AND sex = ?'; p.push(sex); }
    if (event) { sql += ' AND event = ?'; p.push(event); }
    const rows = db.prepare(sql).all(...p).sort((a, b) =>
      a.sex.localeCompare(b.sex) || calc.EVENT_KEYS.indexOf(a.event) - calc.EVENT_KEYS.indexOf(b.event) || a.course.localeCompare(b.course) || a.age - b.age);
    if (web.wantsCsv(req)) {
      return web.sendCsv(res, `county-times-${season}`, [
        ['Season', (r) => r.season], ['Event', (r) => calc.eventName(r.event)], ['Sex', (r) => r.sex],
        ['Age', (r) => (r.age_max == null ? r.age : r.age_max >= 99 ? `${r.age}/Ov` : `${r.age}/${r.age_max}`)], ['Course', (r) => r.course], ['Time', (r) => calc.formatTime(r.time_hs)],
      ], rows);
    }
    const meta = db.prepare('SELECT * FROM county_seasons WHERE season = ?').get(season) || {};
    res.render('county-times', { title: `County qualifying times ${season}`, rows, season, seasons, meta });
  });

  app.post('/county/times', (req, res) => {
    const season = web.s(req.body.season) || res.locals.settings.county_season;
    const tx = db.transaction(() => {
      for (const r of web.arr(req.body.rows)) {
        const hs = calc.parseTime(r.time);
        if (r.id && hs != null) db.prepare('UPDATE county_times SET time_hs = ? WHERE id = ?').run(hs, r.id);
      }
      const n = req.body.add || {};
      const band = seed.parseAgeBand(n.age || '');
      const ev = calc.EVENT_KEYS.includes(n.event) ? n.event : null;
      const hs = calc.parseTime(n.time);
      if (ev && band && hs != null && calc.normaliseSex(n.sex) && calc.normaliseCourse(n.course)) {
        db.prepare(`INSERT INTO county_times (season, event, sex, age, age_max, course, time_hs) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (season, event, sex, age, course) DO UPDATE SET time_hs = excluded.time_hs, age_max = excluded.age_max`)
          .run(season, ev, calc.normaliseSex(n.sex), band.age, band.age_max, calc.normaliseCourse(n.course), hs);
      }
      const m = req.body.meta;
      if (m) {
        db.prepare(`INSERT INTO county_seasons (season, authority, course, age_reference_date, qualifying_window, conditions, source, note)
          VALUES (@season, @authority, @course, @age_reference_date, @qualifying_window, @conditions, @source, @note)
          ON CONFLICT (season) DO UPDATE SET authority=excluded.authority, age_reference_date=excluded.age_reference_date,
          qualifying_window=excluded.qualifying_window, conditions=excluded.conditions, source=excluded.source, note=excluded.note`)
          .run({ season, authority: web.s(m.authority), course: 'SC', age_reference_date: calc.parseDate(m.age_reference_date), qualifying_window: web.s(m.qualifying_window), conditions: web.s(m.conditions), source: web.s(m.source), note: web.s(m.note) });
      }
    });
    tx();
    res.redirect(`/county/times${web.qs({ season, sex: req.body.sex, event: req.body.event, msg: 'Saved' })}`);
  });
  app.post('/county/times/:id/delete', (req, res) => {
    db.prepare('DELETE FROM county_times WHERE id = ?').run(req.params.id);
    res.redirect(`/county/times${web.qs({ season: req.body.season, msg: 'Deleted' })}`);
  });
  // Load a standards sheet in the swimmer-county-analysis skill's JSON format
  app.post('/county/standards-json', upload.single('file'), (req, res) => {
    let n;
    try {
      const json = JSON.parse(req.file.buffer.toString('utf8'));
      const season = web.s(req.body.season) || String((json.meta || {}).championship_year || '');
      if (!season) throw new Error('No season given and none in the file meta.');
      n = db.transaction(() => seed.loadStandards(db, json, season))();
      return res.redirect(`/county/times${web.qs({ season, msg: `Loaded ${n} qualifying times` })}`);
    } catch (err) {
      return res.status(400).render('message', { title: 'Could not load standards', message: err.message });
    }
  });

  // ----- LC -> SC conversion tables -----
  app.get('/conversions', (req, res) => {
    const tables = db.prepare('SELECT t.*, (SELECT COUNT(*) FROM conversion_factors f WHERE f.table_id = t.id) n FROM conversion_tables t ORDER BY name').all();
    res.render('conversions', { title: 'LC → SC conversion tables', tables });
  });
  app.post('/conversions', (req, res) => {
    const name = web.s(req.body.name);
    if (!name) return res.redirect('/conversions?msg=Name+required');
    const tx = db.transaction(() => {
      const id = db.prepare('INSERT INTO conversion_tables (name, notes) VALUES (?, ?)').run(name, web.s(req.body.notes)).lastInsertRowid;
      const from = web.int(req.body.copy_from);
      if (from) db.prepare('INSERT INTO conversion_factors (table_id, event, sex, factor, offset_s) SELECT ?, event, sex, factor, offset_s FROM conversion_factors WHERE table_id = ?').run(id, from);
      else for (const e of calc.EVENT_KEYS) db.prepare("INSERT INTO conversion_factors (table_id, event, sex) VALUES (?, ?, 'X')").run(id, e);
      return id;
    });
    try {
      res.redirect(`/conversions/${tx()}?msg=Created`);
    } catch (err) {
      if (/UNIQUE/.test(err.message)) return res.redirect('/conversions?msg=That+name+is+taken');
      throw err;
    }
  });
  app.get('/conversions/:id', (req, res) => {
    const table = db.prepare('SELECT * FROM conversion_tables WHERE id = ?').get(req.params.id);
    if (!table) return web.notFound(res, 'Conversion table');
    const f = db.prepare('SELECT * FROM conversion_factors WHERE table_id = ?').all(table.id);
    const grid = calc.EVENTS.map((e) => ({ ...e, X: f.find((x) => x.event === e.key && x.sex === 'X'), M: f.find((x) => x.event === e.key && x.sex === 'M'), F: f.find((x) => x.event === e.key && x.sex === 'F') }));
    res.render('conversion', { title: table.name, table, grid });
  });
  app.post('/conversions/:id', (req, res) => {
    const id = Number(req.params.id);
    const tx = db.transaction(() => {
      db.prepare('UPDATE conversion_tables SET name = ?, notes = ? WHERE id = ?').run(web.s(req.body.name) || 'Unnamed', web.s(req.body.notes), id);
      db.prepare('DELETE FROM conversion_factors WHERE table_id = ?').run(id);
      const ins = db.prepare('INSERT INTO conversion_factors (table_id, event, sex, factor, offset_s) VALUES (?, ?, ?, ?, ?)');
      for (const [event, bySex] of Object.entries(req.body.f || {})) {
        if (!calc.EVENT_KEYS.includes(event)) continue;
        for (const sex of ['X', 'M', 'F']) {
          const c = bySex[sex] || {};
          const factor = web.s(c.factor);
          if (factor == null) continue; // blank M/F = fall back to X
          ins.run(id, event, sex, Number(factor), Number(web.s(c.offset) || 0));
        }
      }
    });
    tx();
    res.redirect(`/conversions/${id}?msg=Saved`);
  });
  app.post('/conversions/:id/activate', (req, res) => {
    setSetting(db, 'active_conversion_table_id', req.params.id);
    res.redirect('/conversions?msg=Active+table+changed');
  });
  app.post('/conversions/:id/delete', (req, res) => {
    if (String(req.params.id) === res.locals.settings.active_conversion_table_id) return res.redirect('/conversions?msg=Cannot+delete+the+active+table');
    db.prepare('DELETE FROM conversion_tables WHERE id = ?').run(req.params.id);
    res.redirect('/conversions?msg=Deleted');
  });
};
