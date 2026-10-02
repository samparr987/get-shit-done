'use strict';
// Browser entry for the Coach Desk artifact: same routes, views and SQL as the local app,
// with SQLite running in the page and the database kept in this browser's IndexedDB.
const Database = require('better-sqlite3');
const express = require('express');
const { openDb, setSetting } = require('../src/db');
const { createApp } = require('../src/app');
const { generateSession } = require('../src/generate');
const calc = require('../src/calc');
const templates = window.__CD_TEMPLATES; // separate non-strict script, see build.js
const { WASM_B64 } = require('./.build/wasm.js');

const appEl = () => document.getElementById('app');
let db = null;
let app = null;
let current = '/';
const history = [];
let saveTimer = null;
let storageOk = true;

// ---------- IndexedDB persistence ----------
function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('coach-desk', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbGet(key) {
  try {
    const d = await idb();
    return await new Promise((res, rej) => {
      const q = d.transaction('kv').objectStore('kv').get(key);
      q.onsuccess = () => res(q.result || null);
      q.onerror = () => rej(q.error);
    });
  } catch {
    storageOk = false;
    return null;
  }
}
async function idbPut(key, val) {
  const d = await idb();
  await new Promise((res, rej) => {
    const t = d.transaction('kv', 'readwrite');
    t.objectStore('kv').put(val, key);
    t.oncomplete = res;
    t.onerror = () => rej(t.error);
  });
}
function status(text, bad) {
  const el = document.getElementById('save-status');
  if (!el) return;
  el.textContent = text;
  el.dataset.bad = bad ? '1' : '';
}
function scheduleSave() {
  clearTimeout(saveTimer);
  status('Saving…');
  saveTimer = setTimeout(async () => {
    try {
      await idbPut('db', db.exportBytes());
      storageOk = true;
      status('Saved on this device');
    } catch {
      storageOk = false;
      status('Not saved — this browser is blocking storage. Use Backup to keep a copy.', true);
    }
  }, 400);
}

// ---------- query/body parsing (qs-style a[b][c]) ----------
function parsePairs(pairs) {
  const out = {};
  for (const [key, val] of pairs) {
    const parts = key.replace(/\]/g, '').split('[');
    let o = out;
    parts.forEach((p, i) => {
      const last = i === parts.length - 1;
      if (last) {
        if (p === '') return; // a[] handled by repeat below
        if (o[p] === undefined) o[p] = val;
        else if (Array.isArray(o[p])) o[p].push(val);
        else o[p] = [o[p], val];
      } else {
        if (o[p] == null || typeof o[p] !== 'object') o[p] = {};
        o = o[p];
      }
    });
  }
  return out;
}
function splitUrl(url) {
  const u = new URL(url, 'http://x');
  return { path: u.pathname, query: parsePairs([...u.searchParams]), hash: u.hash.slice(1), full: u.pathname + u.search };
}

// ---------- rendering ----------
const HTML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&#34;', "'": '&#39;' };
const escapeHtml = (v) => (v == null ? '' : String(v).replace(/[&<>"']/g, (c) => HTML_ESC[c]));
function renderView(name, locals) {
  const t = templates[name];
  if (!t) throw new Error(`No view ${name}`);
  const include = (p, d) => renderView(p.replace(/^\.\//, ''), d ? Object.assign({}, locals, d) : locals);
  return t(locals, escapeHtml, include);
}
const host = {
  render(name, locals, hash) {
    appEl().innerHTML = renderView(name, locals);
    if (hash && document.getElementById(hash)) document.getElementById(hash).scrollIntoView();
    else window.scrollTo(0, 0);
  },
  fatal(err) {
    appEl().innerHTML = `<main><h1>Something went wrong</h1><pre class="sets">${String(err && err.stack || err).replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'))}</pre><p><a href="/">Home</a></p></main>`;
  },
};
express.setHost(host);

function dispatch(method, url, body = {}, files = {}, opts = {}) {
  const u = splitUrl(url);
  if (method === 'GET') {
    if (!opts.back && current && current !== u.full) history.push(current);
    current = u.full;
  }
  const req = { method, url: u.full, path: u.path, query: u.query, body, files, params: {} };
  const res = {
    locals: Object.assign({}, app.locals),
    statusCode: 200,
    headers: {},
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    render(view, data) { host.render(view, Object.assign({}, this.locals, data), u.hash); },
    redirect(to) { dispatch('GET', to); },
    send(text) {
      if (/text\/csv/.test(this.headers['content-type'] || '')) {
        const name = ((this.headers['content-disposition'] || '').match(/filename="([^"]+)"/) || [])[1] || 'export.csv';
        showText(name, String(text).replace(/^﻿/, ''), 'Copy this into a spreadsheet, or paste it into a .csv file. Downloads are blocked inside Claude, so copying is the way out.');
      }
    },
  };
  app.handle(req, res);
}

// ---------- modal for CSV / backup text ----------
function showText(title, text, hint) {
  const m = document.getElementById('modal');
  m.querySelector('h2').textContent = title;
  m.querySelector('p').textContent = hint || '';
  m.querySelector('textarea').value = text;
  m.hidden = false;
}
async function copyFrom(textarea, btn) {
  try {
    await navigator.clipboard.writeText(textarea.value);
    btn.textContent = 'Copied';
  } catch {
    textarea.focus();
    textarea.select();
    btn.textContent = 'Selected — press Ctrl+C';
  }
  setTimeout(() => (btn.textContent = 'Copy'), 2500);
}

// ---------- event delegation ----------
document.addEventListener('click', (e) => {
  const copyBtn = e.target.closest('[data-copy]');
  if (copyBtn) {
    e.preventDefault();
    copyFrom(document.getElementById(copyBtn.dataset.copy), copyBtn);
    return;
  }
  if (e.target.closest('[data-close-modal]')) {
    document.getElementById('modal').hidden = true;
    return;
  }
  const a = e.target.closest('a[href]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey) return;
  const href = a.getAttribute('href');
  if (href.startsWith('javascript:')) {
    e.preventDefault();
    dispatch('GET', history.pop() || '/', {}, {}, { back: true });
    return;
  }
  if (href.startsWith('#')) {
    e.preventDefault();
    const el = document.getElementById(href.slice(1));
    if (el) el.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  if (href.startsWith('/')) {
    e.preventDefault();
    dispatch('GET', href);
  }
});

document.addEventListener('submit', async (e) => {
  const form = e.target;
  const sub = e.submitter;
  e.preventDefault();
  // Two-tap confirm instead of confirm() (dialogs are blocked in artifacts)
  const guard = sub && sub.dataset.confirm ? sub : form.dataset.confirm ? form : null;
  if (guard && !guard._armed) {
    guard._armed = true;
    const btn = sub || form.querySelector('button');
    const was = btn.textContent;
    btn.textContent = 'Tap again to confirm';
    btn.classList.add('danger');
    setTimeout(() => { guard._armed = false; btn.textContent = was; }, 4000);
    return;
  }
  if (guard) guard._armed = false;
  const method = ((sub && sub.getAttribute('formmethod')) || form.getAttribute('method') || 'get').toUpperCase();
  let action = (sub && sub.getAttribute('formaction')) || form.getAttribute('action') || current.split('?')[0];
  let fd;
  try { fd = new FormData(form, sub); } catch { fd = new FormData(form); if (sub && sub.name) fd.append(sub.name, sub.value); }
  const pairs = [];
  const files = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v === 'string') pairs.push([k, v]);
    else if (v && v.size) files[k] = { buffer: Buffer.from(await v.arrayBuffer()), originalname: v.name };
  }
  if (method === 'GET') {
    const qs = new URLSearchParams(pairs).toString();
    dispatch('GET', action + (qs ? `?${qs}` : ''));
  } else {
    dispatch('POST', action, parsePairs(pairs), files);
  }
});

// ---------- example data (clearly marked) ----------
function seedExamples(d) {
  const tx = d.transaction(() => {
    const note = 'Example swimmer — go to Backup → Start fresh to remove all examples.';
    const sw = [['Amy', 'Example', '2014-06-01', 'F', 'Group 3'], ['Ben', 'Example', '2012-09-14', 'M', 'Squad'], ['Cara', 'Example', '2011-01-21', 'F', 'Squad'], ['Dev', 'Example', '2015-02-02', 'M', 'Group 2']];
    for (const [f, l, dob, s, g] of sw) d.prepare('INSERT INTO swimmers (first_name, last_name, dob, sex, group_name, notes) VALUES (?, ?, ?, ?, ?, ?)').run(f, l, dob, s, g, note);
    const t = (id, e, c, hs, date, meet, conv = null) => d.prepare('INSERT INTO times (swimmer_id, event, course, time_hs, swum_on, meet, conv_sc_hs, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, e, c, hs, date, meet, conv, 'example');
    t(1, '100FR', 'SC', 7020, '2026-09-20', 'Example meet'); t(1, '50FR', 'SC', 3150, '2026-09-20', 'Example meet'); t(1, '100BK', 'LC', 8300, '2026-07-11', 'Example LC meet', 8105); t(1, '200IM', 'SC', 18000, '2025-06-01', 'Example meet');
    t(2, '100FR', 'SC', 6150, '2026-05-01', 'Example meet'); t(2, '200FR', 'SC', 13600, '2026-05-01', 'Example meet'); t(2, '100BR', 'SC', 7700, '2026-05-01', 'Example meet');
    t(3, '50FL', 'SC', 3300, '2026-03-01', 'Example meet'); t(3, '100FL', 'SC', 7350, '2026-03-01', 'Example meet');
    t(4, '50FR', 'SC', 4100, '2026-09-01', 'Example meet');
    const s = require('../src/db').getSettings(d);
    const today = require('../src/web').today();
    const wn = Math.max(1, calc.weekNumber(today, s.season_start));
    const up = d.prepare('UPDATE plan_weeks SET mesocycle = ?, focus = ?, drills = ?, notes = ? WHERE week_no = ?');
    up.run('Aerobic base', 'Backstroke rotation', 'A', 'Example plan row', wn);
    up.run('Aerobic base', 'Breaststroke timing', 'B', 'Example plan row', wn + 1);
    for (const [n, st, r, c] of [['Example: Spin drill', 'Back', 'A', 'Rotation'], ['Example: Single arm back', 'Back', 'A', 'Catch'], ['Example: Head-cup back', 'Back', 'A', 'Body position'], ['Example: Catch-up', 'Free', 'A', 'Timing'], ['Example: 2 kicks 1 pull', 'Breast', 'B', 'Timing']]) {
      d.prepare('INSERT INTO drills (name, stroke, rotation, category, description) VALUES (?, ?, ?, ?, ?)').run(n, st, r, c, 'Example drill — replace with your house drills.');
    }
    d.prepare('INSERT INTO drill_points (drill_id, point_id) VALUES (1, 9), (2, 10)').run();
    const monday = calc.weekStart(wn, s.season_start);
    let i = 0;
    for (const group of ['Group 3', 'Squad']) {
      for (const slot of calc.SLOTS) {
        const date = calc.addDays(monday, calc.SLOT_DAY[slot] - 1);
        const g = generateSession(d, { date, slot, group, seed: wn * 1000 + ++i });
        const id = d.prepare('INSERT INTO sessions (date, slot, group_name, week_no, sets, total_m, notes, generated, seed) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)')
          .run(date, slot, group, wn, g.sets, g.total_m, 'Example generated session', wn * 1000 + i).lastInsertRowid;
        for (const dr of g.drillIds) d.prepare('INSERT OR IGNORE INTO session_drills (session_id, drill_id) VALUES (?, ?)').run(id, dr);
      }
    }
    setSetting(d, 'example_data', '1');
  });
  tx();
}

// ---------- backup / restore routes (browser only) ----------
const b64 = {
  enc(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); },
  dec(str) { const bin = atob(str.replace(/\s+/g, '')); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; },
};
const isSqlite = (bytes) => bytes && bytes.length > 100 && new TextDecoder().decode(bytes.subarray(0, 15)) === 'SQLite format 3';
function rollbackJournal(bytes) {
  // A file copied from the local app may be in WAL mode; with no -wal file beside it, reading it as a rollback-journal database is correct.
  const b = new Uint8Array(bytes);
  if (b[18] === 2) b[18] = 1;
  if (b[19] === 2) b[19] = 1;
  return b;
}
function extend(a) {
  a.get('/backup', (req, res) => {
    const text = req.query.show ? b64.enc(db.exportBytes()) : null;
    const counts = Object.fromEntries(['swimmers', 'times', 'sessions', 'drills', 'entries'].map((t) => [t, db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n]));
    res.render('backup', { title: 'Backup', text, counts, storageOk });
  });
  a.post('/backup/restore', (req, res) => {
    let bytes = null;
    if (req.files.file) bytes = new Uint8Array(req.files.file.buffer);
    else if (req.body.text) { try { bytes = b64.dec(req.body.text); } catch { bytes = null; } }
    if (!isSqlite(bytes)) return res.status(400).render('message', { title: 'Restore failed', message: 'That is not a Coach Desk backup. Paste the backup text exactly as copied, or choose the coach-desk.sqlite file.' });
    reboot(rollbackJournal(bytes), '/?msg=Backup+restored');
  });
  a.post('/backup/fresh', (req, res) => reboot(null, '/?msg=Started+fresh', { examples: !!req.body.examples }));
}

// ---------- boot ----------
function start(bytes, url, opts = {}) {
  Database.setInitialBytes(bytes);
  db = openDb(':memory:');
  if (!bytes && opts.examples !== false) seedExamples(db);
  Database.setOnWrite(scheduleSave);
  app = createApp(db, { extend });
  app.locals.isArtifact = true;
  scheduleSave();
  history.length = 0;
  current = '';
  dispatch('GET', url || '/');
}
function reboot(bytes, url, opts = {}) {
  Database.setOnWrite(() => {});
  start(bytes, url, { examples: opts.examples === undefined ? false : opts.examples });
}

(async () => {
  try {
    const SQL = await window.initSqlJs({ wasmBinary: b64.dec(WASM_B64).buffer });
    Database.setSQL(SQL);
    const saved = await idbGet('db');
    start(saved ? new Uint8Array(saved) : null, '/');
    status(storageOk ? 'Saved on this device' : 'Not saved — this browser is blocking storage', !storageOk);
  } catch (err) {
    host.fatal(err);
  }
})();
