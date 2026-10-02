'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const county = require('../src/county');

function setup() {
  const db = openDb(':memory:'); // seeds the Lancashire 2027 standards + placeholder conversion table
  const id = db.prepare("INSERT INTO swimmers (first_name, last_name, dob, sex) VALUES ('Amy', 'Brown', '2014-06-01', 'F')").run().lastInsertRowid;
  const sw = db.prepare('SELECT * FROM swimmers WHERE id = ?').get(id);
  const add = (event, course, t, date, conv = null) =>
    db.prepare('INSERT INTO times (swimmer_id, event, course, time_hs, swum_on, conv_sc_hs) VALUES (?, ?, ?, ?, ?, ?)').run(id, event, course, t, date, conv);
  return { db, sw, add };
}

test('seeded Lancashire 2027 table matches the skill sheet', () => {
  const { db } = setup();
  const n = db.prepare("SELECT COUNT(*) n FROM county_times WHERE season = '2027'").get().n;
  assert.equal(n, 232);
  const g13 = db.prepare("SELECT time_hs FROM county_times WHERE season='2027' AND event='100FR' AND sex='F' AND age=13").get();
  assert.equal(g13.time_hs, 6999, 'Girls 13 100 Free = 1:09.99');
});

test('fastest-route best SC-equivalent and gap, end to end', () => {
  const { db, sw, add } = setup();
  // Amy is 13 at 31 Dec 2027. Girls 13: 100 Free QT 1:09.99, 50 Free 31.59, 50 Back 36.99
  add('100FR', 'SC', 7120, '2026-03-01');
  add('100FR', 'SC', 7300, '2025-11-01');           // slower, not the PB
  add('100FR', 'LC', 7200, '2026-07-11', 7010);     // official converted 1:10.10 beats the SC PB
  add('50FR', 'SC', 3159, '2026-05-01');            // exactly on the QT
  add('50BK', 'LC', 4000, '2026-07-11');            // no official figure -> placeholder factor 1.0
  const a = county.analyseSwimmer(db, sw);
  assert.equal(a.age, 13);
  const r = Object.fromEntries(a.rows.map((x) => [x.event, x]));
  assert.equal(r['100FR'].best.time, 7010);
  assert.equal(r['100FR'].best.source, 'LC');
  assert.equal(r['100FR'].best.official, true);
  assert.equal(r['100FR'].qt, 6999);
  assert.equal(r['100FR'].gap.gapHs, 11);
  assert.equal(r['100FR'].band, 'amber');
  assert.equal(r['50FR'].band, 'green');
  assert.equal(r['50BK'].best.time, 4000);
  assert.equal(r['50BK'].best.official, false);
  assert.equal(r['50BK'].band, 'red');
  // age override, as in the skill's --age
  const a12 = county.analyseSwimmer(db, sw, { age: 12 });
  assert.equal(Object.fromEntries(a12.rows.map((x) => [x.event, x]))['100FR'].qt, 7459);
});

test('gala entry time: SC gala uses best SC-equivalent, LC gala uses LC PB', () => {
  const { db, sw, add } = setup();
  add('100FR', 'SC', 7120, '2026-03-01');
  add('100FR', 'LC', 7200, '2026-07-11', 7010);
  assert.equal(county.entryTimeFor(db, sw, '100FR', 'SC'), 7010);
  assert.equal(county.entryTimeFor(db, sw, '100FR', 'LC'), 7200);
  assert.equal(county.entryTimeFor(db, sw, '200FR', 'SC'), null);
});
