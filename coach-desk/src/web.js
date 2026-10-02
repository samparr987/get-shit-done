'use strict';
// Small helpers shared by the route modules.
const calc = require('./calc');

function today() {
  if (process.env.COACH_DESK_TODAY) return process.env.COACH_DESK_TODAY;
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const s = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());
const int = (v) => (s(v) == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));
const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : typeof v === 'object' ? Object.values(v) : [v]);

function csvCell(v) {
  if (v == null) return '';
  const t = String(v);
  return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}
// columns: [[label, row => value], ...]
function sendCsv(res, filename, columns, rows) {
  const lines = [columns.map((c) => csvCell(c[0])).join(',')];
  for (const r of rows) lines.push(columns.map((c) => csvCell(c[1](r))).join(','));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
  res.send('﻿' + lines.join('\r\n') + '\r\n');
}
const wantsCsv = (req) => req.query.format === 'csv';

// Build "?a=1&b=2" from the current query, overriding some keys.
function qs(query, over = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...query, ...over })) if (v != null && v !== '') p.set(k, v);
  const t = p.toString();
  return t ? `?${t}` : '';
}

function notFound(res, what = 'Page') {
  res.status(404).render('message', { title: 'Not found', message: `${what} not found.` });
}

const swimmerName = (sw) => (sw ? `${sw.first_name} ${sw.last_name}` : '');

module.exports = { today, s, int, arr, sendCsv, wantsCsv, qs, notFound, swimmerName, calc };
