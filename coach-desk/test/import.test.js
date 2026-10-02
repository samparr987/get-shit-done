'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const importer = require('../src/importer');
const calc = require('../src/calc');

const HEADERS = ['Forename', 'Surname', 'Date of Birth', 'Gender', 'ASA Number', 'Squad', 'Address 1', 'Parent Email', 'Medical Conditions'];
const row = (a) => Object.fromEntries(HEADERS.map((h, i) => [h, a[i]]));
const exportV1 = [
  row(['Amy', 'Brown', '03/05/2013', 'Female', '1001', 'Group 2', '1 High St', 'mum@example.com', 'Asthma']),
  row(['Ben', 'Cole', '14/09/2012', 'Male', '1002', 'Group 3', '2 Low Rd', 'dad@example.com', '']),
  row(['Cara', 'Dunn', '21/01/2011', 'F', '', 'Squad', '', '', '']),
];

function runImport(db, rows) {
  const map = importer.guessMapping('swimmers', HEADERS);
  return importer.applyImport(db, 'swimmers', rows, map);
}
const byName = (db, first) => db.prepare('SELECT * FROM swimmers WHERE first_name = ?').get(first);

test('mergeSwimmerImport: locked group is kept, unlocked group follows the import', () => {
  const p1 = calc.mergeSwimmerImport({ group_name: 'Squad', group_locked: 1 }, { first_name: 'A', group_name: 'Group 3' });
  assert.equal(p1.group_name, undefined, 'locked: group not in the patch');
  assert.equal(p1.imported_group, 'Group 3', 'export value still recorded');
  const p2 = calc.mergeSwimmerImport({ group_name: 'Squad', group_locked: 0 }, { group_name: 'Group 3' });
  assert.equal(p2.group_name, 'Group 3');
  const p3 = calc.mergeSwimmerImport(null, { group_name: 'Group 1' });
  assert.equal(p3.group_name, 'Group 1', 'new swimmer takes the export group');
});

test('re-import does not overwrite manual group overrides', () => {
  const db = openDb(':memory:');
  const s1 = runImport(db, exportV1);
  assert.deepEqual([s1.added, s1.updated, s1.skipped.length], [3, 0, 0]);
  assert.equal(byName(db, 'Amy').group_name, 'Group 2');

  // Coach moves Amy to Squad by hand (what the edit form does: change => lock).
  db.prepare("UPDATE swimmers SET group_name = 'Squad', group_locked = 1 WHERE first_name = 'Amy'").run();

  // Next export: Amy still Group 2 in the club system, Ben moved up, Cara's DOB corrected.
  const exportV2 = [
    row(['Amy', 'Brown', '03/05/2013', 'Female', '1001', 'Group 2', '', '', '']),
    row(['Ben', 'Cole', '14/09/2012', 'Male', '1002', 'Squad', '', '', '']),
    row(['Cara', 'Dunn', '21/01/2011', 'F', '', 'Group 3', '', '', '']),
    row(['Dev', 'Earl', '2014-02-02', 'M', '1004', 'Group 1', '', '', '']),
  ];
  const s2 = runImport(db, exportV2);
  assert.deepEqual([s2.added, s2.updated], [1, 3], 'matched by SE ID / name+DOB, no duplicates');
  const amy = byName(db, 'Amy');
  assert.equal(amy.group_name, 'Squad', 'manual override kept');
  assert.equal(amy.group_locked, 1);
  assert.equal(amy.imported_group, 'Group 2', 'export group recorded for reference');
  assert.equal(byName(db, 'Ben').group_name, 'Squad', 'unlocked swimmer follows the export');
  assert.equal(byName(db, 'Cara').group_name, 'Group 3', 'matched without SE ID, by name + DOB');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM swimmers').get().n, 4);
});

test('sensitive columns are never mapped or stored', () => {
  const map = importer.guessMapping('swimmers', HEADERS);
  assert.ok(!Object.values(map).some((h) => /address|email|medical/i.test(h)));
  for (const h of ['Address 1', 'Parent Email', 'Medical Conditions', 'Mobile', 'Postcode', 'Emergency Contact']) assert.ok(importer.isSensitive(h), h);
  for (const h of ['Forename', 'Surname', 'Squad', 'ASA Number', 'Date of Birth']) assert.ok(!importer.isSensitive(h), h);
  const db = openDb(':memory:');
  const cols = db.prepare('PRAGMA table_info(swimmers)').all().map((c) => c.name);
  assert.ok(!cols.some((c) => /address|phone|email|medical|parent|contact/.test(c)), 'no such columns exist');
});

test('swimmingresults paste keeps the official Converted-to-SC figure', () => {
  const text = [
    'Long Course',
    'Stroke\tTime\tConverted Time\tWA Points\tDate\tMeet\tVenue\tLicence\tLevel',
    '100 Freestyle\t1:10.50\t1:08.12\t412\t11/07/26\tCOMAST Summer Open\tManchester\tLX261234\t1',
    'Short Course',
    'Stroke\tTime\tWA Points\tDate\tMeet\tVenue\tLicence\tLevel',
    '100 Freestyle\t1:09.00\t430\t02/03/26\tBolton Open\tBolton\tLX262222\t3',
    '50 Backstroke\t36.20\t388\t02/03/26\tBolton Open\tBolton\tLX262222\t3',
  ].join('\n');
  const { rows, problems } = importer.parseSwimmingResults(text);
  assert.deepEqual(problems, []);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { event: '100FR', course: 'LC', time_hs: 7050, conv_sc_hs: 6812, swum_on: '2026-07-11', meet: 'COMAST Summer Open' });
  assert.equal(rows[1].course, 'SC');
  assert.equal(rows[1].conv_sc_hs, null);
});
