'use strict';
// Opens every page of a seeded app and runs the main form flows.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { createApp } = require('../src/app');

process.env.COACH_DESK_TODAY = '2026-10-02';

async function start() {
  const db = openDb(':memory:');
  const server = createApp(db).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (p) => fetch(base + p, { redirect: 'manual' });
  const post = (p, data) => fetch(base + p, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(data).toString() });
  return { db, server, base, get, post };
}

test('every page opens, forms work, exports download', async (t) => {
  const app = await start();
  t.after(() => app.server.close());
  const { db, get, post, base } = app;

  // --- create data through the UI ---
  let r = await post('/swimmers', { first_name: 'Amy', last_name: 'Brown', dob: '2014-06-01', sex: 'F', se_id: '1001', group_name: 'Group 3', active: '1' });
  assert.equal(r.status, 302);
  const sid = r.headers.get('location').match(/\/swimmers\/(\d+)/)[1];
  assert.equal(db.prepare('SELECT group_locked FROM swimmers WHERE id = ?').get(sid).group_locked, 1, 'manual group locks');
  r = await post('/times', { swimmer_id: sid, event: '100FR', course: 'SC', time: '1:10.20', swum_on: '2026-09-20', meet: 'Club Champs' });
  assert.equal(r.status, 302);
  r = await post('/times', { swimmer_id: sid, event: '50FR', course: 'LC', time: '33.50', conv: '32.60', swum_on: '2026-07-11', meet: 'COMAST' });
  assert.equal(r.status, 302);
  r = await post(`/swimmers/${sid}/paste`, { text: 'Short Course\n50 Backstroke\t37.50\t380\t02/03/26\tBolton Open\tBolton', confirm: '1' });
  assert.equal(r.status, 302);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM times WHERE event = '50BK'").get().n, 1);

  db.prepare("UPDATE plan_weeks SET mesocycle='Aerobic', focus='Backstroke', drills='A' WHERE week_no = 5").run();
  r = await post('/drills', { name: 'Spin drill', stroke: 'Back', rotation: 'A', active: '1', points: '9' });
  const did = r.headers.get('location').match(/\/drills\/(\d+)/)[1];
  await post('/drills', { name: 'Single arm back', stroke: 'Back', rotation: 'A', active: '1' });
  r = await post('/sessions', { date: '2026-10-02', slot: 'Fri', group_name: 'Group 3', sets: '400 WU', total_m: '400', drill_ids: did });
  const sessId = r.headers.get('location').match(/\/sessions\/(\d+)/)[1];
  assert.equal(db.prepare('SELECT week_no FROM sessions WHERE id = ?').get(sessId).week_no, 5, 'session links to its plan week');
  r = await post('/sessions/generate-week', { date: '2026-09-28', groups: 'Group 3' });
  assert.equal(r.status, 302);
  assert.ok(db.prepare("SELECT COUNT(*) n FROM sessions WHERE generated = 1").get().n >= 3);

  const gala = db.prepare("SELECT id FROM galas WHERE name = 'BCM Autumn'").get().id;
  await post(`/galas/${gala}`, { name: 'BCM Autumn', start_date: '2026-10-03', end_date: '2026-10-04', course: 'SC', closing_date: '2026-10-10' });
  r = await post(`/galas/${gala}/entries`, { swimmer_id: sid, events: '100FR' });
  assert.equal(r.status, 302);
  const entry = db.prepare('SELECT * FROM entries WHERE gala_id = ?').get(gala);
  assert.equal(entry.entry_hs, 7020, 'entry time auto-filled from best time');
  await post(`/entries/${entry.id}`, { status: 'entered', entry_time: '1:09.90' });
  const e2 = db.prepare('SELECT * FROM entries WHERE id = ?').get(entry.id);
  assert.deepEqual([e2.status, e2.entry_hs, e2.entry_auto], ['entered', 6990, 0]);

  // import flow: upload -> mapping preview -> confirm
  const fd = new FormData();
  fd.append('file', new Blob(['Forename,Surname,DOB,Gender,ASA Number,Squad,Address\nBen,Cole,14/09/2012,M,1002,Group 2,1 Street\nAmy,Brown,01/06/2014,F,1001,Group 1,2 Road\n']), 'export.csv');
  r = await fetch(`${base}/import/swimmers`, { method: 'POST', body: fd, redirect: 'manual' });
  assert.equal(r.status, 302);
  const mapUrl = r.headers.get('location');
  r = await get(mapUrl);
  const html = await r.text();
  assert.equal(r.status, 200);
  assert.match(html, /Ignored \(personal data, not stored\):<\/strong> Address/);
  const token = new URL(base + mapUrl).searchParams.get('token');
  r = await post('/import/swimmers/confirm', { token });
  assert.equal(r.status, 200);
  assert.equal(db.prepare("SELECT group_name FROM swimmers WHERE first_name = 'Amy'").get().group_name, 'Group 3', 'manual group survives re-import');
  assert.equal(db.prepare("SELECT group_name FROM swimmers WHERE first_name = 'Ben'").get().group_name, 'Group 2');

  // --- open every page ---
  const tid = db.prepare('SELECT id FROM times LIMIT 1').get().id;
  const pages = [
    '/', '/swimmers', '/swimmers?group=Group+3&sex=F', '/swimmers/new', `/swimmers/${sid}`, `/swimmers/${sid}/edit`,
    `/swimmers/${sid}/county`, `/swimmers/${sid}/county?age=12&since=2026-09-01`, `/swimmers/${sid}/paste`,
    '/times', `/times?swimmer=${sid}`, '/times/new', `/times/${tid}/edit`,
    '/county', '/county?sort=name&band=amber', '/county/times', '/county/times?sex=F&event=100FR', '/conversions', '/conversions/1',
    '/plan', '/sessions', '/sessions?week=6', '/sessions/new', '/sessions/new?date=2026-10-09&slot=Fri&group_name=Group+3&copy=1',
    '/sessions/generate?date=2026-10-02&slot=Fri&group_name=Group+3&seed=2', `/sessions/${sessId}`, `/sessions/${sessId}/edit`, `/sessions/${sessId}/print`,
    '/galas', '/galas/new', `/galas/${gala}`, `/galas/${gala}/edit`,
    '/technique', '/technique?stroke=Back', '/technique?edit=1', '/drills', '/drills?stroke=Back', '/drills/new', `/drills/${did}`, `/drills/${did}/edit`,
    '/library', '/import', '/import/swimmers', '/import/times', '/import/county', '/import/plan', '/import/drills', '/import/technique', '/settings',
  ];
  for (const p of pages) {
    const res = await get(p);
    const body = await res.text();
    assert.equal(res.status, 200, `${p} -> ${res.status}: ${body.slice(0, 300)}`);
    assert.match(body, /<\/html>/, `${p} rendered fully`);
  }
  const csvs = ['/swimmers', '/times', '/county', '/county/times', `/swimmers/${sid}/county`, '/plan', '/sessions', '/galas', `/galas/${gala}`, '/drills', '/technique', '/library'];
  for (const p of csvs) {
    const res = await get(`${p}?format=csv`);
    assert.equal(res.status, 200, p);
    assert.match(res.headers.get('content-type'), /text\/csv/, p);
    const text = await res.text();
    assert.ok(text.split('\n').length >= 2, `${p} csv has a header`);
  }
  for (const p of [`/swimmers/${sid}/county.pdf`, '/county/report.pdf', '/county/report.pdf?group=Group+3']) {
    const res = await get(p);
    assert.equal(res.status, 200, p);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(buf.subarray(0, 5).toString(), '%PDF-', p);
  }
  // home page shows the expected headline facts
  const home = await (await get('/')).text();
  assert.match(home, /Week 5/);
  assert.match(home, /16 weeks to Counties/);
  assert.match(home, /BCM Autumn/);
  assert.match(home, /Amy Brown/, 'amber swimmer listed (100 Free 1:10.20 vs 1:09.99)');
  assert.equal((await get('/nope')).status, 404);
});
