'use strict';
const calc = require('../calc');
const web = require('../web');

module.exports = (app, { db }) => {
  app.get('/times', (req, res) => {
    const { swimmer, event, course, meet } = req.query;
    let sql = 'SELECT t.*, s.first_name, s.last_name FROM times t JOIN swimmers s ON s.id = t.swimmer_id WHERE 1=1';
    const p = [];
    if (swimmer) { sql += ' AND t.swimmer_id = ?'; p.push(swimmer); }
    if (event) { sql += ' AND t.event = ?'; p.push(event); }
    if (course) { sql += ' AND t.course = ?'; p.push(course); }
    if (meet) { sql += ' AND t.meet LIKE ?'; p.push(`%${meet}%`); }
    sql += ' ORDER BY t.swum_on DESC, s.last_name LIMIT ' + (web.wantsCsv(req) ? 100000 : 500);
    const rows = db.prepare(sql).all(...p);
    if (web.wantsCsv(req)) {
      return web.sendCsv(res, 'times', [
        ['Swimmer', (r) => `${r.first_name} ${r.last_name}`], ['Event', (r) => calc.eventName(r.event)], ['Course', (r) => r.course],
        ['Time', (r) => calc.formatTime(r.time_hs)], ['Converted to SC', (r) => calc.formatTime(r.conv_sc_hs)], ['Date', (r) => r.swum_on], ['Meet', (r) => r.meet], ['Source', (r) => r.source],
      ], rows);
    }
    const swimmers = db.prepare('SELECT id, first_name, last_name FROM swimmers WHERE active = 1 ORDER BY last_name, first_name').all();
    res.render('times', { title: 'Times', rows, swimmers });
  });

  function form(res, t, errors = [], status = 200) {
    const swimmers = db.prepare('SELECT id, first_name, last_name, group_name FROM swimmers WHERE active = 1 ORDER BY last_name, first_name').all();
    const meets = db.prepare('SELECT DISTINCT meet FROM times WHERE meet IS NOT NULL ORDER BY swum_on DESC LIMIT 20').all().map((x) => x.meet);
    res.status(status).render('time-form', { title: t.id ? 'Edit time' : 'Add a time', t, swimmers, meets, errors });
  }
  app.get('/times/new', (req, res) => form(res, { swimmer_id: req.query.swimmer, swum_on: res.locals.todayIso, course: 'SC', meet: req.query.meet }));
  app.get('/times/:id/edit', (req, res) => {
    const t = db.prepare('SELECT * FROM times WHERE id = ?').get(req.params.id);
    if (!t) return web.notFound(res, 'Time');
    form(res, { ...t, time: calc.formatTime(t.time_hs), conv: calc.formatTime(t.conv_sc_hs) });
  });

  function read(body) {
    return {
      swimmer_id: web.int(body.swimmer_id), event: calc.EVENT_KEYS.includes(body.event) ? body.event : null,
      course: calc.normaliseCourse(body.course), time_hs: calc.parseTime(body.time), conv_sc_hs: calc.parseTime(body.conv),
      swum_on: calc.parseDate(body.swum_on), meet: web.s(body.meet), time: body.time, conv: body.conv,
    };
  }
  function check(v) {
    const e = [];
    if (!v.swimmer_id) e.push('Pick a swimmer.');
    if (!v.event) e.push('Pick an event.');
    if (!v.course) e.push('Pick SC or LC.');
    if (v.time_hs == null) e.push('Time not understood — use 1:05.23 or 65.23.');
    if (!v.swum_on) e.push('Date is required.');
    if (v.course !== 'LC') v.conv_sc_hs = null;
    return e;
  }
  app.post('/times', (req, res) => {
    const v = read(req.body);
    const errors = check(v);
    if (errors.length) return form(res, v, errors, 400);
    db.prepare(`INSERT INTO times (swimmer_id, event, course, time_hs, swum_on, meet, conv_sc_hs) VALUES (@swimmer_id, @event, @course, @time_hs, @swum_on, @meet, @conv_sc_hs)
      ON CONFLICT DO NOTHING`).run(v);
    const back = req.body.again ? `/times/new?swimmer=${v.swimmer_id}&meet=${encodeURIComponent(v.meet || '')}` : `/swimmers/${v.swimmer_id}`;
    res.redirect(`${back}${back.includes('?') ? '&' : '?'}msg=${encodeURIComponent(`Saved ${calc.eventName(v.event)} ${v.course} ${calc.formatTime(v.time_hs)}`)}`);
  });
  app.post('/times/:id', (req, res) => {
    const v = read(req.body);
    const errors = check(v);
    if (errors.length) return form(res, { ...v, id: req.params.id }, errors, 400);
    db.prepare('UPDATE times SET swimmer_id=@swimmer_id, event=@event, course=@course, time_hs=@time_hs, swum_on=@swum_on, meet=@meet, conv_sc_hs=@conv_sc_hs WHERE id=@id').run({ ...v, id: req.params.id });
    res.redirect(`/swimmers/${v.swimmer_id}?msg=Time+updated`);
  });
  app.post('/times/:id/delete', (req, res) => {
    const t = db.prepare('SELECT swimmer_id FROM times WHERE id = ?').get(req.params.id);
    db.prepare('DELETE FROM times WHERE id = ?').run(req.params.id);
    res.redirect(t ? `/swimmers/${t.swimmer_id}?msg=Time+deleted` : '/times');
  });
};
