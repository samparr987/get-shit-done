'use strict';
const calc = require('../calc');
const web = require('../web');
const county = require('../county');
const importer = require('../importer');
const { countyPdf } = require('../county-pdf');

module.exports = (app, { db }) => {
  const get = (id) => db.prepare('SELECT * FROM swimmers WHERE id = ?').get(id);

  app.get('/swimmers', (req, res) => {
    const { group, sex, active = '1', q } = req.query;
    let sql = 'SELECT * FROM swimmers WHERE 1=1';
    const p = [];
    if (group) { sql += ' AND group_name IS ?'; p.push(group === '(none)' ? null : group); }
    if (sex) { sql += ' AND sex = ?'; p.push(sex); }
    if (active !== 'all') { sql += ' AND active = ?'; p.push(Number(active)); }
    if (q) { sql += " AND (first_name || ' ' || last_name) LIKE ?"; p.push(`%${q}%`); }
    sql += ' ORDER BY last_name, first_name';
    const rows = db.prepare(sql).all(...p);
    const t = res.locals.todayIso;
    const year = Number(t.slice(0, 4));
    if (web.wantsCsv(req)) {
      return web.sendCsv(res, 'swimmers', [
        ['First name', (r) => r.first_name], ['Last name', (r) => r.last_name], ['DOB', (r) => r.dob], ['Sex', (r) => r.sex],
        ['Age now', (r) => calc.ageOn(r.dob, t)], [`Age at 31 Dec ${year}`, (r) => calc.ageAt31Dec(r.dob, year)],
        ['Swim England ID', (r) => r.se_id], ['Group', (r) => r.group_name], ['Group locked', (r) => (r.group_locked ? 'Y' : '')],
        ['Other club', (r) => r.other_club], ['Bolton Metro', (r) => (r.bolton_metro ? 'Y' : '')], ['Active', (r) => (r.active ? 'Y' : 'N')], ['Notes', (r) => r.notes],
      ], rows);
    }
    res.render('swimmers', { title: 'Swimmers', rows, year });
  });

  app.get('/swimmers/new', (req, res) => res.render('swimmer-form', { title: 'Add swimmer', sw: { active: 1 }, errors: [] }));

  function readForm(body) {
    return {
      first_name: web.s(body.first_name), last_name: web.s(body.last_name), dob: calc.parseDate(body.dob),
      sex: calc.normaliseSex(body.sex), se_id: web.s(body.se_id), group_name: calc.normaliseGroup(body.group_name),
      other_club: web.s(body.other_club), bolton_metro: body.bolton_metro ? 1 : 0, active: body.active ? 1 : 0, notes: web.s(body.notes),
    };
  }
  function validate(v) {
    const e = [];
    if (!v.first_name || !v.last_name) e.push('First and last name are required.');
    if (!v.dob) e.push('Date of birth is required.');
    if (!v.sex) e.push('Sex is required.');
    return e;
  }

  app.post('/swimmers', (req, res) => {
    const v = readForm(req.body);
    const errors = validate(v);
    if (errors.length) return res.status(400).render('swimmer-form', { title: 'Add swimmer', sw: v, errors });
    try {
      // A group typed in by hand counts as a manual choice, so it is locked against imports.
      const r = db.prepare(`INSERT INTO swimmers (first_name, last_name, dob, sex, se_id, group_name, group_locked, other_club, bolton_metro, active, notes)
        VALUES (@first_name, @last_name, @dob, @sex, @se_id, @group_name, @locked, @other_club, @bolton_metro, @active, @notes)`).run({ ...v, locked: v.group_name ? 1 : 0 });
      res.redirect(`/swimmers/${r.lastInsertRowid}?msg=Swimmer+added`);
    } catch (err) {
      if (/UNIQUE/.test(err.message)) return res.status(400).render('swimmer-form', { title: 'Add swimmer', sw: v, errors: ['That Swim England ID is already used.'] });
      throw err;
    }
  });

  app.get('/swimmers/:id', (req, res) => {
    const sw = get(req.params.id);
    if (!sw) return web.notFound(res, 'Swimmer');
    const analysis = county.analyseSwimmer(db, sw);
    const pbs = county.personalBests(db, sw);
    const times = db.prepare('SELECT * FROM times WHERE swimmer_id = ? ORDER BY swum_on DESC, id DESC LIMIT 30').all(sw.id);
    const entries = db.prepare(`SELECT e.*, g.name gala_name, g.start_date FROM entries e JOIN galas g ON g.id = e.gala_id
      WHERE e.swimmer_id = ? AND g.end_date >= ? ORDER BY g.start_date`).all(sw.id, res.locals.todayIso);
    res.render('swimmer', { title: web.swimmerName(sw), sw, analysis, pbs, times, entries, srUrl: importer.swimmingResultsUrl(sw) });
  });

  app.get('/swimmers/:id/edit', (req, res) => {
    const sw = get(req.params.id);
    if (!sw) return web.notFound(res, 'Swimmer');
    res.render('swimmer-form', { title: `Edit ${web.swimmerName(sw)}`, sw, errors: [] });
  });

  app.post('/swimmers/:id', (req, res) => {
    const old = get(req.params.id);
    if (!old) return web.notFound(res, 'Swimmer');
    const v = readForm(req.body);
    const errors = validate(v);
    if (errors.length) return res.status(400).render('swimmer-form', { title: 'Edit swimmer', sw: { ...old, ...v }, errors });
    let locked = old.group_locked;
    if ((v.group_name || null) !== (old.group_name || null)) locked = 1; // manual change -> lock
    if (req.body.unlock) locked = 0;
    try {
      db.prepare(`UPDATE swimmers SET first_name=@first_name, last_name=@last_name, dob=@dob, sex=@sex, se_id=@se_id, group_name=@group_name,
        group_locked=@locked, other_club=@other_club, bolton_metro=@bolton_metro, active=@active, notes=@notes, updated_at=datetime('now') WHERE id=@id`)
        .run({ ...v, locked, id: old.id });
    } catch (err) {
      if (/UNIQUE/.test(err.message)) return res.status(400).render('swimmer-form', { title: 'Edit swimmer', sw: { ...old, ...v }, errors: ['That Swim England ID is already used.'] });
      throw err;
    }
    res.redirect(`/swimmers/${old.id}?msg=Saved`);
  });

  app.post('/swimmers/:id/delete', (req, res) => {
    db.prepare('DELETE FROM swimmers WHERE id = ?').run(req.params.id);
    res.redirect('/swimmers?msg=Swimmer+deleted');
  });

  // ----- county analysis (the swimmer-county-analysis skill, built in) -----
  function analysisOpts(req) {
    return { season: req.query.season || undefined, age: req.query.age || undefined, since: calc.parseDate(req.query.since) || undefined };
  }
  app.get('/swimmers/:id/county', (req, res) => {
    const sw = get(req.params.id);
    if (!sw) return web.notFound(res, 'Swimmer');
    const a = county.analyseSwimmer(db, sw, analysisOpts(req));
    const seasons = db.prepare('SELECT DISTINCT season FROM county_times ORDER BY season DESC').all().map((x) => x.season);
    if (web.wantsCsv(req)) {
      return web.sendCsv(res, `${sw.last_name}_county_${a.info.season}`, [
        ['Event', (r) => r.name], ['SC PB', (r) => calc.formatTime(r.sc && r.sc.time_hs)], ['LC PB', (r) => calc.formatTime(r.lc && r.lc.time_hs)],
        ['LC converted to SC', (r) => calc.formatTime(r.lcConv && r.lcConv.time)], ['Fastest', (r) => calc.formatTime(r.best && r.best.time)],
        ['Source', (r) => (r.best ? r.best.source : '')], ['QT', (r) => calc.formatTime(r.qt)], ['Gap (s)', (r) => (r.gap ? r.gap.gapSeconds.toFixed(2) : '')], ['Band', (r) => r.band],
      ], a.rows);
    }
    res.render('swimmer-county', { title: `${web.swimmerName(sw)} — county analysis`, sw, a, seasons, opts: analysisOpts(req) });
  });
  app.get('/swimmers/:id/county.pdf', (req, res) => {
    const sw = get(req.params.id);
    if (!sw) return web.notFound(res, 'Swimmer');
    const a = county.analyseSwimmer(db, sw, analysisOpts(req));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${sw.first_name}_${sw.last_name}_${a.info.season}_${sw.sex === 'F' ? 'G' : 'B'}${a.age}.pdf"`);
    countyPdf([a], { ...analysisOpts(req), today: res.locals.todayIso }).pipe(res);
  });
  app.get('/county/report.pdf', (req, res) => {
    let sql = 'SELECT * FROM swimmers WHERE active = 1';
    const p = [];
    if (req.query.group) { sql += ' AND group_name = ?'; p.push(req.query.group); }
    const list = db.prepare(sql + ' ORDER BY last_name, first_name').all(...p);
    const opts = analysisOpts(req);
    delete opts.age;
    const analyses = list.map((sw) => county.analyseSwimmer(db, sw, opts)).filter((a) => a.rows.some((r) => r.gap));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="County_${(req.query.group || 'all').replace(/\s/g, '')}.pdf"`);
    countyPdf(analyses, { ...opts, today: res.locals.todayIso }).pipe(res);
  });

  // ----- paste from swimmingresults.org -----
  app.get('/swimmers/:id/paste', (req, res) => {
    const sw = get(req.params.id);
    if (!sw) return web.notFound(res, 'Swimmer');
    res.render('swimmer-paste', { title: `Paste PBs — ${web.swimmerName(sw)}`, sw, text: '', parsed: null, srUrl: importer.swimmingResultsUrl(sw) });
  });
  app.post('/swimmers/:id/paste', (req, res) => {
    const sw = get(req.params.id);
    if (!sw) return web.notFound(res, 'Swimmer');
    const text = req.body.text || '';
    const parsed = importer.parseSwimmingResults(text);
    const pbs = county.personalBests(db, sw);
    for (const r of parsed.rows) {
      const cur = pbs[r.event] && pbs[r.event][r.course];
      r.isNew = !db.prepare('SELECT 1 FROM times WHERE swimmer_id=? AND event=? AND course=? AND time_hs=? AND swum_on=?').get(sw.id, r.event, r.course, r.time_hs, r.swum_on);
      r.isPb = !cur || r.time_hs < cur.time_hs;
    }
    if (req.body.confirm) {
      const tx = db.transaction(() => parsed.rows.forEach((r) => importer.addTime(db, sw.id, r, 'swimmingresults')));
      tx();
      const added = parsed.rows.filter((r) => r.isNew).length;
      return res.redirect(`/swimmers/${sw.id}/county?msg=${encodeURIComponent(`${added} new time(s) saved from swimmingresults`)}`);
    }
    res.render('swimmer-paste', { title: `Paste PBs — ${web.swimmerName(sw)}`, sw, text, parsed, srUrl: importer.swimmingResultsUrl(sw) });
  });
};
