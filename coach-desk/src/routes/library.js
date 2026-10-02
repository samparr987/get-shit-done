'use strict';
const calc = require('../calc');
const web = require('../web');

const PARTS = ['Warm-up', 'Drill', 'Pre-main', 'Main', 'Kick', 'Sprint', 'Swim-down'];

module.exports = (app, { db }) => {
  // ----- technique points -----
  app.get('/technique', (req, res) => {
    const stroke = calc.TECH_STROKES.includes(req.query.stroke) ? req.query.stroke : null;
    const rows = stroke
      ? db.prepare('SELECT * FROM technique_points WHERE stroke = ? ORDER BY sort, id').all(stroke)
      : db.prepare('SELECT * FROM technique_points ORDER BY sort, id').all();
    if (web.wantsCsv(req)) {
      return web.sendCsv(res, 'technique-points', [['Stroke', (r) => r.stroke], ['Area', (r) => r.area], ['Point', (r) => r.point], ['Cue word', (r) => r.cue_word]], rows);
    }
    res.render('technique', { title: 'Technique points', rows, stroke, edit: req.query.edit === '1' });
  });
  app.post('/technique', (req, res) => {
    const b = req.body;
    if (calc.TECH_STROKES.includes(b.stroke) && web.s(b.point)) {
      db.prepare('INSERT INTO technique_points (stroke, area, point, cue_word, sort) VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM technique_points))').run(b.stroke, web.s(b.area), web.s(b.point), web.s(b.cue_word));
    }
    res.redirect(`/technique${web.qs({ stroke: b.stroke, edit: 1, msg: 'Added' })}`);
  });
  app.post('/technique/:id', (req, res) => {
    const b = req.body;
    db.prepare('UPDATE technique_points SET area = ?, point = ?, cue_word = ? WHERE id = ?').run(web.s(b.area), web.s(b.point) || '(blank)', web.s(b.cue_word), req.params.id);
    res.redirect(`/technique${web.qs({ stroke: b.stroke, edit: 1, msg: 'Saved' })}`);
  });
  app.post('/technique/:id/delete', (req, res) => {
    db.prepare('DELETE FROM technique_points WHERE id = ?').run(req.params.id);
    res.redirect(`/technique${web.qs({ stroke: req.body.stroke, edit: 1, msg: 'Deleted' })}`);
  });

  // ----- drills folder -----
  app.get('/drills', (req, res) => {
    const { stroke, category, rotation, group, q } = req.query;
    let rows = db.prepare('SELECT d.*, (SELECT COUNT(*) FROM session_drills sd WHERE sd.drill_id = d.id) used FROM drills d ORDER BY stroke, name').all();
    if (stroke) rows = rows.filter((d) => d.stroke === stroke);
    if (category) rows = rows.filter((d) => (d.category || '') === category);
    if (rotation) rows = rows.filter((d) => String(d.rotation || '').toLowerCase().split(/[,\s/]+/).includes(rotation.toLowerCase()));
    if (group) rows = rows.filter((d) => !d.groups || d.groups.toLowerCase().includes(group.toLowerCase()));
    if (q) rows = rows.filter((d) => `${d.name} ${d.description || ''}`.toLowerCase().includes(q.toLowerCase()));
    if (web.wantsCsv(req)) {
      return web.sendCsv(res, 'drills', [
        ['Name', (r) => r.name], ['Stroke', (r) => r.stroke], ['Category', (r) => r.category], ['Description', (r) => r.description], ['Equipment', (r) => r.equipment],
        ['Groups', (r) => r.groups], ['Rotation', (r) => r.rotation], ['Video', (r) => r.video_url], ['Active', (r) => (r.active ? 'Y' : 'N')],
      ], rows);
    }
    const cats = db.prepare('SELECT DISTINCT category FROM drills WHERE category IS NOT NULL ORDER BY 1').all().map((x) => x.category);
    const rots = [...new Set(db.prepare('SELECT rotation FROM drills WHERE rotation IS NOT NULL').all().flatMap((x) => x.rotation.split(/[,\s/]+/).filter(Boolean)))].sort();
    res.render('drills', { title: 'Drills folder', rows, cats, rots });
  });
  function readDrill(b) {
    return {
      name: web.s(b.name), stroke: calc.TECH_STROKES.includes(b.stroke) ? b.stroke : null, category: web.s(b.category), description: web.s(b.description),
      equipment: web.s(b.equipment), groups: web.arr(b.groups).join(', ') || null, rotation: web.s(b.rotation), video_url: web.s(b.video_url), active: b.active ? 1 : 0,
    };
  }
  function drillForm(res, d, errors = [], status = 200) {
    const points = db.prepare('SELECT * FROM technique_points ORDER BY sort').all();
    const linked = d.id ? db.prepare('SELECT point_id FROM drill_points WHERE drill_id = ?').all(d.id).map((x) => x.point_id) : [];
    res.status(status).render('drill-form', { title: d.id ? `Edit ${d.name}` : 'Add drill', d, points, linked, errors });
  }
  function linkPoints(id, ids) {
    db.prepare('DELETE FROM drill_points WHERE drill_id = ?').run(id);
    for (const p of web.arr(ids).map(Number).filter(Boolean)) db.prepare('INSERT OR IGNORE INTO drill_points (drill_id, point_id) VALUES (?, ?)').run(id, p);
  }
  app.get('/drills/new', (req, res) => drillForm(res, { active: 1, stroke: req.query.stroke }));
  app.post('/drills', (req, res) => {
    const v = readDrill(req.body);
    if (!v.name || !v.stroke) return drillForm(res, v, ['Name and stroke are required.'], 400);
    try {
      const id = db.prepare('INSERT INTO drills (name, stroke, category, description, equipment, groups, rotation, video_url, active) VALUES (@name, @stroke, @category, @description, @equipment, @groups, @rotation, @video_url, @active)').run(v).lastInsertRowid;
      linkPoints(id, req.body.points);
      res.redirect(`/drills/${id}?msg=Drill+added`);
    } catch (err) {
      if (/UNIQUE/.test(err.message)) return drillForm(res, v, ['A drill with that name already exists.'], 400);
      throw err;
    }
  });
  app.get('/drills/:id', (req, res) => {
    const d = db.prepare('SELECT * FROM drills WHERE id = ?').get(req.params.id);
    if (!d) return web.notFound(res, 'Drill');
    const points = db.prepare('SELECT tp.* FROM technique_points tp JOIN drill_points dp ON dp.point_id = tp.id WHERE dp.drill_id = ? ORDER BY tp.sort').all(d.id);
    const sessions = db.prepare('SELECT s.* FROM sessions s JOIN session_drills sd ON sd.session_id = s.id WHERE sd.drill_id = ? ORDER BY s.date DESC LIMIT 20').all(d.id);
    res.render('drill', { title: d.name, d, points, sessions });
  });
  app.get('/drills/:id/edit', (req, res) => {
    const d = db.prepare('SELECT * FROM drills WHERE id = ?').get(req.params.id);
    if (!d) return web.notFound(res, 'Drill');
    drillForm(res, d);
  });
  app.post('/drills/:id', (req, res) => {
    const v = readDrill(req.body);
    if (!v.name || !v.stroke) return drillForm(res, { ...v, id: req.params.id }, ['Name and stroke are required.'], 400);
    try {
      db.prepare('UPDATE drills SET name=@name, stroke=@stroke, category=@category, description=@description, equipment=@equipment, groups=@groups, rotation=@rotation, video_url=@video_url, active=@active WHERE id=@id').run({ ...v, id: req.params.id });
    } catch (err) {
      if (/UNIQUE/.test(err.message)) return drillForm(res, { ...v, id: req.params.id }, ['A drill with that name already exists.'], 400);
      throw err;
    }
    linkPoints(req.params.id, req.body.points);
    res.redirect(`/drills/${req.params.id}?msg=Saved`);
  });
  app.post('/drills/:id/delete', (req, res) => {
    db.prepare('DELETE FROM drills WHERE id = ?').run(req.params.id);
    res.redirect('/drills?msg=Drill+deleted');
  });

  // ----- generator library: set templates + session shapes -----
  app.get('/library', (req, res) => {
    const templates = db.prepare('SELECT * FROM set_templates').all().sort((a, b) => PARTS.indexOf(a.part) - PARTS.indexOf(b.part) || a.name.localeCompare(b.name));
    const shapes = db.prepare('SELECT * FROM session_shapes').all().sort((a, b) => calc.GROUPS.indexOf(a.group_name) - calc.GROUPS.indexOf(b.group_name) || calc.SLOTS.indexOf(a.slot) - calc.SLOTS.indexOf(b.slot));
    if (web.wantsCsv(req)) {
      return web.sendCsv(res, 'set-templates', [
        ['Name', (r) => r.name], ['Part', (r) => r.part], ['Mesocycles', (r) => r.mesocycles], ['Focus tags', (r) => r.focus_tags], ['Groups', (r) => r.groups], ['Metres', (r) => r.metres], ['Text', (r) => r.text],
      ], templates);
    }
    res.render('library', { title: 'Session library', templates, shapes, PARTS });
  });
  function readTpl(b) {
    return { name: web.s(b.name) || 'Untitled', part: PARTS.includes(b.part) ? b.part : 'Main', mesocycles: web.s(b.mesocycles) || '', focus_tags: web.s(b.focus_tags) || '', groups: web.s(b.groups) || '', text: web.s(b.text) || '', metres: web.int(b.metres) || 0 };
  }
  app.post('/library/templates', (req, res) => {
    const v = readTpl(req.body);
    if (v.text && v.metres) db.prepare('INSERT INTO set_templates (name, part, mesocycles, focus_tags, groups, text, metres) VALUES (@name, @part, @mesocycles, @focus_tags, @groups, @text, @metres)').run(v);
    res.redirect(`/library?msg=${v.text && v.metres ? 'Template+added' : 'Text+and+metres+are+required'}#templates`);
  });
  app.post('/library/templates/:id', (req, res) => {
    db.prepare('UPDATE set_templates SET name=@name, part=@part, mesocycles=@mesocycles, focus_tags=@focus_tags, groups=@groups, text=@text, metres=@metres WHERE id=@id').run({ ...readTpl(req.body), id: req.params.id });
    res.redirect(`/library?msg=Saved#t${req.params.id}`);
  });
  app.post('/library/templates/:id/delete', (req, res) => {
    db.prepare('DELETE FROM set_templates WHERE id = ?').run(req.params.id);
    res.redirect('/library?msg=Deleted#templates');
  });
  app.post('/library/shapes', (req, res) => {
    const tx = db.transaction(() => {
      for (const r of web.arr(req.body.rows)) {
        if (r.remove) { db.prepare('DELETE FROM session_shapes WHERE group_name = ? AND slot = ?').run(r.group_name, r.slot); continue; }
        if (!calc.GROUPS.includes(r.group_name) || !calc.SLOTS.includes(r.slot) || !web.int(r.target_m)) continue;
        const parts = String(r.parts || '').split(',').map((p) => p.trim()).filter((p) => PARTS.includes(p)).join(',') || 'Warm-up,Main,Swim-down';
        db.prepare(`INSERT INTO session_shapes (group_name, slot, minutes, target_m, parts) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (group_name, slot) DO UPDATE SET minutes = excluded.minutes, target_m = excluded.target_m, parts = excluded.parts`)
          .run(r.group_name, r.slot, web.int(r.minutes), web.int(r.target_m), parts);
      }
    });
    tx();
    res.redirect('/library?msg=Session+sizes+saved#shapes');
  });
};
