'use strict';
const crypto = require('crypto');
const multer = require('multer');
const web = require('../web');
const importer = require('../importer');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
// Uploaded files wait here (in memory only) between the upload and the confirm step.
const pending = new Map();

module.exports = (app, { db }) => {
  const kindOr404 = (req, res) => {
    const k = importer.KINDS[req.params.kind];
    if (!k) web.notFound(res, 'Import type');
    return k;
  };
  app.get('/import', (req, res) => res.render('import-index', { title: 'Import', kinds: importer.KINDS }));
  app.get('/import/:kind', (req, res) => {
    const kind = kindOr404(req, res);
    if (!kind) return;
    res.render('import-upload', { title: `Import — ${kind.title}`, kind, key: req.params.kind, error: null });
  });
  app.post('/import/:kind', upload.single('file'), async (req, res) => {
    const kind = kindOr404(req, res);
    if (!kind) return;
    const fail = (error) => res.status(400).render('import-upload', { title: `Import — ${kind.title}`, kind, key: req.params.kind, error });
    if (!req.file) return fail('Choose a CSV or XLSX file.');
    if (!/\.(csv|xlsx|txt)$/i.test(req.file.originalname)) return fail('Only .csv and .xlsx files are supported (save .xls as .xlsx first).');
    let parsed;
    try {
      parsed = await importer.parseFile(req.file.buffer, req.file.originalname);
    } catch (err) {
      return fail(`Could not read the file: ${err.message}`);
    }
    if (!parsed.rows.length) return fail('The file has no data rows.');
    const token = crypto.randomBytes(8).toString('hex');
    for (const [t, v] of pending) if (Date.now() - v.at > 3600e3) pending.delete(t);
    // Sensitive columns are dropped here, before anything is kept even in memory.
    const keep = parsed.headers.filter((h) => !importer.isSensitive(h));
    const ignored = parsed.headers.filter((h) => importer.isSensitive(h));
    const rows = parsed.rows.map((r) => Object.fromEntries(keep.map((h) => [h, r[h]])));
    pending.set(token, { kind: req.params.kind, headers: keep, ignored, rows, filename: req.file.originalname, season: web.s(req.body.season), at: Date.now() });
    res.redirect(`/import/${req.params.kind}/map?token=${token}`);
  });

  function mappingFrom(req, p) {
    const saved = db.prepare('SELECT mapping FROM import_mappings WHERE kind = ? AND headers = ?').get(p.kind, p.headers.join('|'));
    let map = saved ? JSON.parse(saved.mapping) : importer.guessMapping(p.kind, p.headers);
    if (req.query.m || req.body?.m) {
      map = {};
      for (const [k, v] of Object.entries(req.query.m || req.body.m)) if (v && p.headers.includes(v)) map[k] = v;
    }
    return { map, saved: !!saved };
  }
  app.get('/import/:kind/map', (req, res) => {
    const kind = kindOr404(req, res);
    if (!kind) return;
    const p = pending.get(req.query.token);
    if (!p || p.kind !== req.params.kind) return res.redirect(`/import/${req.params.kind}?msg=Upload+expired,+please+upload+again`);
    const { map, saved } = mappingFrom(req, p);
    const preview = p.rows.slice(0, 10).map((r) => importer.transformRow(p.kind, r, map));
    const allErrors = p.rows.map((r) => importer.transformRow(p.kind, r, map).errors.length).filter(Boolean).length;
    const missing = kind.fields.filter((f) => f.required && !map[f.key]).map((f) => f.label);
    res.render('import-map', { title: `Import — ${kind.title}`, kind, key: req.params.kind, p, map, saved, preview, allErrors, missing, token: req.query.token });
  });
  app.post('/import/:kind/confirm', (req, res) => {
    const kind = kindOr404(req, res);
    if (!kind) return;
    const p = pending.get(req.body.token);
    if (!p || p.kind !== req.params.kind) return res.redirect(`/import/${req.params.kind}?msg=Upload+expired,+please+upload+again`);
    const { map } = mappingFrom(req, p);
    db.prepare('INSERT INTO import_mappings (kind, headers, mapping) VALUES (?, ?, ?) ON CONFLICT (kind, headers) DO UPDATE SET mapping = excluded.mapping')
      .run(p.kind, p.headers.join('|'), JSON.stringify(map));
    const summary = importer.applyImport(db, p.kind, p.rows, map, { season: p.season || res.locals.settings.county_season });
    pending.delete(req.body.token);
    res.render('import-done', { title: 'Import finished', kind, key: req.params.kind, summary, p });
  });
};
