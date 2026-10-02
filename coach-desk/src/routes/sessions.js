'use strict';
const calc = require('../calc');
const web = require('../web');
const { generateSession } = require('../generate');

module.exports = (app, { db }) => {
  const st = (res) => res.locals.settings;

  app.get('/sessions', (req, res) => {
    const s = st(res);
    const week = web.int(req.query.week) ?? res.locals.currentWeek;
    const start = calc.weekStart(week, s.season_start);
    let sql = 'SELECT * FROM sessions WHERE date >= ? AND date <= ?';
    const p = [start, calc.addDays(start, 6)];
    if (req.query.all) { sql = 'SELECT * FROM sessions WHERE 1=1'; p.length = 0; }
    if (req.query.group) { sql += ' AND group_name = ?'; p.push(req.query.group); }
    const rows = db.prepare(sql + ' ORDER BY date, slot, group_name').all(...p);
    if (web.wantsCsv(req)) {
      return web.sendCsv(res, req.query.all ? 'sessions' : `sessions-week-${week}`, [
        ['Date', (r) => r.date], ['Week', (r) => r.week_no], ['Session', (r) => r.slot], ['Group', (r) => r.group_name], ['Total m', (r) => r.total_m], ['Sets', (r) => r.sets], ['Notes', (r) => r.notes],
      ], rows);
    }
    const plan = db.prepare('SELECT * FROM plan_weeks WHERE week_no = ?').get(week);
    res.render('sessions', { title: `Sessions — week ${week}`, rows, week, start, plan, shapes: db.prepare('SELECT DISTINCT group_name FROM session_shapes').all().map((x) => x.group_name) });
  });

  function form(res, sess, extra = {}) {
    const wn = sess.date ? calc.weekNumber(sess.date, st(res).season_start) : null;
    const plan = wn ? db.prepare('SELECT * FROM plan_weeks WHERE week_no = ?').get(wn) : null;
    res.status(extra.status || 200).render('session-form', { title: sess.id ? 'Edit session' : 'New session', sess, plan, errors: [], explain: [], ...extra });
  }

  app.get('/sessions/new', (req, res) => {
    const q = req.query;
    const sess = { date: calc.parseDate(q.date) || res.locals.todayIso, slot: q.slot || 'Mon', group_name: q.group_name || q.group || 'Group 1', sets: q.sets || '', total_m: q.total_m || '', notes: q.notes || '' };
    if (q.copy) {
      const prev = db.prepare('SELECT * FROM sessions WHERE date = ? AND slot = ? AND group_name = ?').get(calc.addDays(sess.date, -7), sess.slot, sess.group_name);
      if (!prev) return form(res, sess, { errors: [`No ${sess.slot} ${sess.group_name} session on ${calc.formatDate(calc.addDays(sess.date, -7))} to copy.`] });
      Object.assign(sess, { sets: prev.sets, total_m: prev.total_m, notes: prev.notes });
      return form(res, sess, { info: `Copied from ${calc.formatDate(prev.date)} — edit and save.` });
    }
    form(res, sess);
  });

  app.get('/sessions/generate', (req, res) => {
    const q = req.query;
    const date = calc.parseDate(q.date) || res.locals.todayIso;
    const slot = calc.SLOTS.includes(q.slot) ? q.slot : 'Mon';
    const group = q.group_name || q.group || 'Group 1';
    const seed = web.int(q.seed) || 1;
    const g = generateSession(db, { date, slot, group, seed });
    form(res, { date, slot, group_name: group, sets: g.sets, total_m: g.total_m, notes: '', generated: 1, seed, drill_ids: g.drillIds.join(',') }, {
      explain: g.explain, gen: { seed, target: g.target, stroke: g.stroke }, title: 'Generated session (draft)',
    });
  });

  app.post('/sessions/generate-week', (req, res) => {
    const s = st(res);
    const monday = calc.mondayOf(calc.parseDate(req.body.date) || res.locals.todayIso);
    const wn = calc.weekNumber(monday, s.season_start);
    const groups = web.arr(req.body.groups);
    const shapes = db.prepare('SELECT * FROM session_shapes').all().filter((x) => groups.includes(x.group_name));
    let made = 0, skipped = 0;
    const tx = db.transaction(() => {
      shapes.forEach((sh, i) => {
        const date = calc.addDays(monday, calc.SLOT_DAY[sh.slot] - 1);
        if (db.prepare('SELECT 1 FROM sessions WHERE date = ? AND slot = ? AND group_name = ?').get(date, sh.slot, sh.group_name)) { skipped++; return; }
        const seed = wn * 1000 + i + 1;
        const g = generateSession(db, { date, slot: sh.slot, group: sh.group_name, seed });
        const id = db.prepare('INSERT INTO sessions (date, slot, group_name, week_no, sets, total_m, notes, generated, seed) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)')
          .run(date, sh.slot, sh.group_name, wn, g.sets, g.total_m, g.explain.join(' ') || null, seed).lastInsertRowid;
        for (const d of g.drillIds) db.prepare('INSERT OR IGNORE INTO session_drills (session_id, drill_id) VALUES (?, ?)').run(id, d);
        made++;
      });
    });
    tx();
    res.redirect(`/sessions?week=${wn}&msg=${encodeURIComponent(`Generated ${made} draft session(s)${skipped ? `, ${skipped} already existed` : ''}`)}`);
  });

  function read(body, res) {
    const date = calc.parseDate(body.date);
    return {
      date, slot: calc.SLOTS.includes(body.slot) ? body.slot : null, group_name: calc.normaliseGroup(body.group_name),
      week_no: date ? calc.weekNumber(date, st(res).season_start) : null,
      sets: web.s(body.sets), total_m: web.int(body.total_m), notes: web.s(body.notes),
      generated: body.generated ? 1 : 0, seed: web.int(body.seed), drill_ids: body.drill_ids || '',
    };
  }
  function check(v) {
    const e = [];
    if (!v.date) e.push('Date is required.');
    if (!v.slot) e.push('Pick a session.');
    if (!v.group_name) e.push('Pick a group.');
    return e;
  }
  function saveDrills(id, ids) {
    db.prepare('DELETE FROM session_drills WHERE session_id = ?').run(id);
    for (const d of String(ids || '').split(',').map(Number).filter(Boolean)) db.prepare('INSERT OR IGNORE INTO session_drills (session_id, drill_id) VALUES (?, ?)').run(id, d);
  }
  // week_no only references plan rows that exist
  const weekRef = (wn) => (db.prepare('SELECT 1 FROM plan_weeks WHERE week_no = ?').get(wn) ? wn : null);

  app.post('/sessions', (req, res) => {
    const v = read(req.body, res);
    const errors = check(v);
    if (errors.length) return form(res, v, { errors, status: 400 });
    try {
      const id = db.prepare('INSERT INTO sessions (date, slot, group_name, week_no, sets, total_m, notes, generated, seed) VALUES (@date, @slot, @group_name, @wk, @sets, @total_m, @notes, @generated, @seed)')
        .run({ ...v, wk: weekRef(v.week_no) }).lastInsertRowid;
      saveDrills(id, v.drill_ids);
      res.redirect(`/sessions/${id}?msg=Saved`);
    } catch (err) {
      if (/UNIQUE/.test(err.message)) return form(res, v, { errors: [`There is already a ${v.slot} ${v.group_name} session on ${calc.formatDate(v.date)}.`], status: 400 });
      throw err;
    }
  });

  const getSess = (id) => db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  function detail(res, sess) {
    const plan = sess.week_no ? db.prepare('SELECT * FROM plan_weeks WHERE week_no = ?').get(sess.week_no) : null;
    const drills = db.prepare('SELECT d.* FROM drills d JOIN session_drills sd ON sd.drill_id = d.id WHERE sd.session_id = ?').all(sess.id);
    return { sess, plan, drills };
  }
  app.get('/sessions/:id', (req, res) => {
    const sess = getSess(req.params.id);
    if (!sess) return web.notFound(res, 'Session');
    res.render('session', { title: `${sess.slot} ${sess.group_name} — ${calc.formatDate(sess.date)}`, ...detail(res, sess) });
  });
  app.get('/sessions/:id/print', (req, res) => {
    const sess = getSess(req.params.id);
    if (!sess) return web.notFound(res, 'Session');
    res.render('session-print', { title: `${sess.slot} ${sess.group_name} — ${calc.formatDate(sess.date)}`, ...detail(res, sess) });
  });
  app.get('/sessions/:id/edit', (req, res) => {
    const sess = getSess(req.params.id);
    if (!sess) return web.notFound(res, 'Session');
    const ids = db.prepare('SELECT drill_id FROM session_drills WHERE session_id = ?').all(sess.id).map((x) => x.drill_id).join(',');
    form(res, { ...sess, drill_ids: ids });
  });
  app.post('/sessions/:id', (req, res) => {
    const v = read(req.body, res);
    const errors = check(v);
    if (errors.length) return form(res, { ...v, id: req.params.id }, { errors, status: 400 });
    try {
      db.prepare('UPDATE sessions SET date=@date, slot=@slot, group_name=@group_name, week_no=@wk, sets=@sets, total_m=@total_m, notes=@notes WHERE id=@id')
        .run({ ...v, wk: weekRef(v.week_no), id: req.params.id });
      saveDrills(req.params.id, v.drill_ids);
    } catch (err) {
      if (/UNIQUE/.test(err.message)) return form(res, { ...v, id: req.params.id }, { errors: ['Another session already uses that date, session and group.'], status: 400 });
      throw err;
    }
    res.redirect(`/sessions/${req.params.id}?msg=Saved`);
  });
  app.post('/sessions/:id/delete', (req, res) => {
    const sess = getSess(req.params.id);
    db.prepare('DELETE FROM sessions WHERE id = ?').run(req.params.id);
    res.redirect(`/sessions${sess ? `?week=${sess.week_no || ''}` : ''}${sess ? '&' : '?'}msg=Deleted`);
  });
};
