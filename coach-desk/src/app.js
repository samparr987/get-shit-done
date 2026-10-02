'use strict';
const path = require('path');
const express = require('express');
const calc = require('./calc');
const web = require('./web');
const { getSettings } = require('./db');

function createApp(db) {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('query parser', 'extended');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use(express.urlencoded({ extended: true, parameterLimit: 20000, limit: '5mb' }));
  app.use('/static', express.static(path.join(__dirname, '..', 'public')));

  app.use((req, res, next) => {
    const settings = getSettings(db);
    const t = web.today();
    Object.assign(res.locals, {
      calc, web, settings, todayIso: t, path: req.path, query: req.query,
      fmtTime: calc.formatTime, fmtDate: calc.formatDate, eventName: calc.eventName, name: web.swimmerName,
      currentWeek: calc.weekNumber(t, settings.season_start),
      msg: req.query.msg || null,
      gapText: (g) => (!g ? '' : g.gapHs <= 0 ? `✓ ${(-g.gapHs / 100).toFixed(2)} under` : `+${g.gapSeconds.toFixed(2)}`),
    });
    next();
  });

  const ctx = { db };
  for (const m of ['home', 'swimmers', 'times', 'county', 'plan', 'sessions', 'galas', 'library', 'imports', 'settings']) {
    require(`./routes/${m}`)(app, ctx);
  }

  app.use((req, res) => web.notFound(res));
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    console.error(err);
    res.status(500).render('message', { title: 'Something went wrong', message: err.message });
  });
  return app;
}

module.exports = { createApp };
