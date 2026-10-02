'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { generateSession } = require('../src/generate');

function setup() {
  const db = openDb(':memory:');
  db.prepare("UPDATE plan_weeks SET mesocycle = 'Aerobic', focus = 'Backstroke rotation', drills = 'A' WHERE week_no = 5").run();
  const ins = db.prepare('INSERT INTO drills (name, stroke, rotation) VALUES (?, ?, ?)');
  for (const [n, s, r] of [['Single arm back', 'Back', 'A'], ['Spin drill', 'Back', 'A'], ['Double arm back', 'Back', 'A'], ['Head-cup back', 'Back', 'A'], ['6-kick switch', 'Back', 'B'], ['Catch-up', 'Free', 'A']]) ins.run(n, s, r);
  return db;
}
const drillNames = (db, ids) => ids.map((id) => db.prepare('SELECT name, stroke, rotation FROM drills WHERE id = ?').get(id));

test('generator follows the week rotation and focus stroke, near target metres', () => {
  const db = setup();
  for (let seed = 1; seed <= 20; seed++) {
    for (const group of ['Group 1', 'Group 3', 'Squad']) {
      const g = generateSession(db, { date: '2026-10-02', slot: 'Fri', group, seed });
      assert.equal(g.stroke, 'Back');
      const ds = drillNames(db, g.drillIds);
      assert.ok(ds.length >= 2 && ds.length <= 3);
      for (const d of ds) assert.deepEqual([d.stroke, d.rotation], ['Back', 'A'], `${group} seed ${seed}`);
      assert.ok(Math.abs(g.total_m - g.target) <= g.target * 0.1, `${group} seed ${seed}: ${g.total_m} vs ${g.target}`);
      assert.match(g.sets, /Week 5 · Aerobic · Backstroke rotation/);
      assert.match(g.sets, /TECHNIQUE CUES/);
    }
  }
});

test('same seed gives the same session; different seed can differ', () => {
  const db = setup();
  const a = generateSession(db, { date: '2026-10-02', slot: 'Fri', group: 'Group 3', seed: 7 });
  const b = generateSession(db, { date: '2026-10-02', slot: 'Fri', group: 'Group 3', seed: 7 });
  assert.equal(a.sets, b.sets);
  const outs = new Set([1, 2, 3, 4, 5, 6].map((seed) => generateSession(db, { date: '2026-10-02', slot: 'Fri', group: 'Group 3', seed }).sets));
  assert.ok(outs.size > 1);
});

test('avoids drills used for that group in the last 2 weeks when alternatives exist', () => {
  const db = setup();
  const used = db.prepare("SELECT id FROM drills WHERE name IN ('Single arm back', 'Spin drill')").all().map((x) => x.id);
  const sid = db.prepare("INSERT INTO sessions (date, slot, group_name) VALUES ('2026-09-25', 'Fri', 'Group 3')").run().lastInsertRowid;
  for (const d of used) db.prepare('INSERT INTO session_drills (session_id, drill_id) VALUES (?, ?)').run(sid, d);
  for (let seed = 1; seed <= 15; seed++) {
    const g = generateSession(db, { date: '2026-10-02', slot: 'Fri', group: 'Group 3', seed });
    const fresh = g.drillIds.filter((id) => !used.includes(id));
    assert.ok(fresh.length >= Math.min(2, g.drillIds.length), `seed ${seed}`);
    if (g.drillIds.length === 2) assert.ok(g.drillIds.every((id) => !used.includes(id)), `seed ${seed}: 2 fresh available`);
  }
});

test('empty drills folder still produces a session with a note', () => {
  const db = openDb(':memory:');
  const g = generateSession(db, { date: '2026-10-02', slot: 'Mon', group: 'Group 2', seed: 1 });
  assert.deepEqual(g.drillIds, []);
  assert.ok(g.explain.some((e) => /Drills folder is empty/.test(e)));
  assert.ok(g.total_m > 0);
});
