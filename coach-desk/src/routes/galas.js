'use strict';
const calc = require('../calc');
const web = require('../web');
const county = require('../county');

module.exports = (app, { db }) => {
  app.get('/galas', (req, res) => {
    const rows = db.prepare(`SELECT g.*, (SELECT COUNT(*) FROM entries e WHERE e.gala_id = g.id AND e.status != 'withdrawn') n FROM galas g ORDER BY start_date`).all();
    if (web.wantsCsv(req)) {
      return web.sendCsv(res, 'galas', [
        ['Name', (r) => r.name], ['Start', (r) => r.start_date], ['End', (r) => r.end_date], ['Venue', (r) => r.venue], ['Course', (r) => r.course],
        ['Entries close', (r) => r.closing_date], ['Age at', (r) => r.age_at_date], ['Entries', (r) => r.n], ['Notes', (r) => r.notes],
      ], rows);
    }
    res.render('galas', { title: 'Galas', rows });
  });

  function read(b) {
    const start = calc.parseDate(b.start_date);
    return {
      name: web.s(b.name), start_date: start, end_date: calc.parseDate(b.end_date) || start, venue: web.s(b.venue),
      course: calc.normaliseCourse(b.course), closing_date: calc.parseDate(b.closing_date), age_at_date: calc.parseDate(b.age_at_date), notes: web.s(b.notes),
    };
  }
  const check = (v) => [!v.name && 'Name is required.', !v.start_date && 'Start date is required.', v.end_date < v.start_date && 'End date is before the start.'].filter(Boolean);

  app.get('/galas/new', (req, res) => res.render('gala-form', { title: 'Add gala', g: {}, errors: [] }));
  app.post('/galas', (req, res) => {
    const v = read(req.body);
    const errors = check(v);
    if (errors.length) return res.status(400).render('gala-form', { title: 'Add gala', g: v, errors });
    const id = db.prepare('INSERT INTO galas (name, start_date, end_date, venue, course, closing_date, age_at_date, notes) VALUES (@name, @start_date, @end_date, @venue, @course, @closing_date, @age_at_date, @notes)').run(v).lastInsertRowid;
    res.redirect(`/galas/${id}?msg=Gala+added`);
  });
  const getGala = (id) => db.prepare('SELECT * FROM galas WHERE id = ?').get(id);
  app.get('/galas/:id/edit', (req, res) => {
    const g = getGala(req.params.id);
    if (!g) return web.notFound(res, 'Gala');
    res.render('gala-form', { title: `Edit ${g.name}`, g, errors: [] });
  });
  app.post('/galas/:id', (req, res) => {
    const v = read(req.body);
    const errors = check(v);
    if (errors.length) return res.status(400).render('gala-form', { title: 'Edit gala', g: { ...v, id: req.params.id }, errors });
    db.prepare('UPDATE galas SET name=@name, start_date=@start_date, end_date=@end_date, venue=@venue, course=@course, closing_date=@closing_date, age_at_date=@age_at_date, notes=@notes WHERE id=@id').run({ ...v, id: req.params.id });
    res.redirect(`/galas/${req.params.id}?msg=Saved`);
  });
  app.post('/galas/:id/delete', (req, res) => {
    db.prepare('DELETE FROM galas WHERE id = ?').run(req.params.id);
    res.redirect('/galas?msg=Gala+deleted');
  });

  app.get('/galas/:id', (req, res) => {
    const g = getGala(req.params.id);
    if (!g) return web.notFound(res, 'Gala');
    const entries = db.prepare(`SELECT e.*, s.first_name, s.last_name, s.dob, s.sex, s.group_name FROM entries e JOIN swimmers s ON s.id = e.swimmer_id
      WHERE e.gala_id = ? ORDER BY s.last_name, s.first_name`).all(g.id)
      .sort((a, b) => a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name) || calc.EVENT_KEYS.indexOf(a.event) - calc.EVENT_KEYS.indexOf(b.event));
    const ageAt = g.age_at_date || g.start_date;
    if (web.wantsCsv(req)) {
      return web.sendCsv(res, `entries-${g.name.replace(/\W+/g, '-')}`, [
        ['Swimmer', (r) => `${r.first_name} ${r.last_name}`], ['Sex', (r) => r.sex], [`Age at ${ageAt}`, (r) => calc.ageOn(r.dob, ageAt)], ['Group', (r) => r.group_name],
        ['Event', (r) => calc.eventName(r.event)], ['Entry time', (r) => calc.formatTime(r.entry_hs)], ['Status', (r) => r.status],
      ], entries);
    }
    const swimmers = db.prepare('SELECT id, first_name, last_name, group_name FROM swimmers WHERE active = 1 ORDER BY last_name, first_name').all();
    res.render('gala', { title: g.name, g, entries, swimmers, ageAt });
  });

  app.post('/galas/:id/entries', (req, res) => {
    const g = getGala(req.params.id);
    if (!g) return web.notFound(res, 'Gala');
    const sw = db.prepare('SELECT * FROM swimmers WHERE id = ?').get(req.body.swimmer_id);
    const events = web.arr(req.body.events).filter((e) => calc.EVENT_KEYS.includes(e));
    if (!sw || !events.length) return res.redirect(`/galas/${g.id}?msg=Pick+a+swimmer+and+at+least+one+event`);
    let n = 0;
    for (const ev of events) {
      const t = county.entryTimeFor(db, sw, ev, g.course);
      n += db.prepare("INSERT OR IGNORE INTO entries (gala_id, swimmer_id, event, entry_hs, entry_auto, status) VALUES (?, ?, ?, ?, 1, 'planned')").run(g.id, sw.id, ev, t).changes;
    }
    res.redirect(`/galas/${g.id}?msg=${encodeURIComponent(`Added ${n} entr${n === 1 ? 'y' : 'ies'} for ${web.swimmerName(sw)}`)}`);
  });
  app.post('/galas/:id/refresh-times', (req, res) => {
    const g = getGala(req.params.id);
    if (!g) return web.notFound(res, 'Gala');
    let n = 0;
    for (const e of db.prepare('SELECT * FROM entries WHERE gala_id = ? AND entry_auto = 1').all(g.id)) {
      const sw = db.prepare('SELECT * FROM swimmers WHERE id = ?').get(e.swimmer_id);
      const t = county.entryTimeFor(db, sw, e.event, g.course);
      if (t !== e.entry_hs) { db.prepare('UPDATE entries SET entry_hs = ? WHERE id = ?').run(t, e.id); n++; }
    }
    res.redirect(`/galas/${g.id}?msg=${encodeURIComponent(`${n} auto entry time(s) updated`)}`);
  });
  app.post('/entries/:id', (req, res) => {
    const e = db.prepare('SELECT * FROM entries WHERE id = ?').get(req.params.id);
    if (!e) return web.notFound(res, 'Entry');
    const status = ['planned', 'entered', 'withdrawn'].includes(req.body.status) ? req.body.status : e.status;
    let { entry_hs: hs, entry_auto: auto } = e;
    if (req.body.entry_time !== undefined) {
      const typed = calc.parseTime(req.body.entry_time);
      if (web.s(req.body.entry_time) == null) { hs = null; auto = 0; }
      else if (typed != null && typed !== e.entry_hs) { hs = typed; auto = 0; }
    }
    if (req.body.auto) {
      const g = getGala(e.gala_id);
      const sw = db.prepare('SELECT * FROM swimmers WHERE id = ?').get(e.swimmer_id);
      hs = county.entryTimeFor(db, sw, e.event, g.course);
      auto = 1;
    }
    db.prepare('UPDATE entries SET status = ?, entry_hs = ?, entry_auto = ? WHERE id = ?').run(status, hs, auto, e.id);
    res.redirect(`/galas/${e.gala_id}?msg=Entry+updated#e${e.id}`);
  });
  app.post('/entries/:id/delete', (req, res) => {
    const e = db.prepare('SELECT gala_id FROM entries WHERE id = ?').get(req.params.id);
    db.prepare('DELETE FROM entries WHERE id = ?').run(req.params.id);
    res.redirect(e ? `/galas/${e.gala_id}?msg=Entry+removed` : '/galas');
  });
};
