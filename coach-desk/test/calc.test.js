'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('../src/calc');

test('age at 31 December', () => {
  assert.equal(c.ageAt31Dec('2013-05-10', 2026), 13);
  assert.equal(c.ageAt31Dec('2013-12-31', 2026), 13, 'birthday on 31 Dec counts');
  assert.equal(c.ageAt31Dec('2014-01-01', 2026), 12, 'born 1 Jan is a year younger');
  assert.equal(c.ageAt31Dec('2012-02-29', 2027), 15, 'leap-day DOB');
  assert.equal(c.ageAt31Dec('2014-06-01', 2027), 13, 'county age for 2027 season');
});

test('age now (whole years on a date)', () => {
  assert.equal(c.ageOn('2013-10-02', '2026-10-01'), 12, 'day before birthday');
  assert.equal(c.ageOn('2013-10-02', '2026-10-02'), 13, 'on birthday');
  assert.equal(c.ageOn('2012-02-29', '2026-02-28'), 13, 'leap-day DOB not yet birthday on 28 Feb');
  assert.equal(c.ageOn('2012-02-29', '2026-03-01'), 14);
});

test('week number for any date (Week 1 = Mon 31 Aug 2026)', () => {
  assert.equal(c.weekNumber('2026-08-31'), 1, 'season start');
  assert.equal(c.weekNumber('2026-09-06'), 1, 'Sunday still week 1');
  assert.equal(c.weekNumber('2026-09-07'), 2, 'next Monday week 2');
  assert.equal(c.weekNumber('2026-08-30'), 0, 'day before season = pre-season');
  assert.equal(c.weekNumber('2026-10-02'), 5);
  assert.equal(c.weekNumber('2027-01-18'), 21, 'Counties week starts Mon 18 Jan 2027');
  assert.equal(c.weekNumber('2027-01-24'), 21);
  assert.equal(c.weekNumber('2027-03-29'), 31, 'across the March clock change');
  assert.equal(c.weekStart(21), '2027-01-18');
  assert.equal(c.weeksToCounties('2026-10-02'), 16);
  assert.equal(c.weeksToCounties('2027-01-20'), 0);
});

test('LC to SC conversion', () => {
  assert.equal(c.lcToSc(7000, { factor: 1, offset_s: 0 }), 7000, 'placeholder table = unchanged');
  assert.equal(c.lcToSc(7000, { factor: 0.97, offset_s: 0 }), 6790);
  assert.equal(c.lcToSc(7000, { factor: 1, offset_s: 1.5 }), 6850);
  assert.equal(c.lcToSc(6523, { factor: 0.98, offset_s: 0.25 }), Math.round(6523 * 0.98 - 25));
  assert.equal(c.lcToSc(null, { factor: 1, offset_s: 0 }), null);
  assert.equal(c.lcToSc(7000, null), null, 'no factor row = cannot convert');
  const factors = [
    { event: '100FR', sex: 'X', factor: 0.98, offset_s: 0 },
    { event: '100FR', sex: 'F', factor: 0.97, offset_s: 0 },
  ];
  assert.equal(c.findFactor(factors, '100FR', 'F').factor, 0.97, 'sex-specific row wins');
  assert.equal(c.findFactor(factors, '100FR', 'M').factor, 0.98, 'falls back to both-sexes row');
  assert.equal(c.findFactor(factors, '50FR', 'M'), null);
});

test('best SC-equivalent PB', () => {
  const f = { factor: 0.97, offset_s: 0 };
  assert.deepEqual(c.bestScEquivalent(6800, 7100, f), { time: 6800, source: 'SC' }, 'SC wins (LC→SC = 68.87)');
  assert.deepEqual(c.bestScEquivalent(6950, 7100, f), { time: 6887, source: 'LC', lc: 7100 }, 'converted LC wins');
  assert.deepEqual(c.bestScEquivalent(null, 7100, f), { time: 6887, source: 'LC', lc: 7100 }, 'only LC');
  assert.deepEqual(c.bestScEquivalent(6800, null, f), { time: 6800, source: 'SC' }, 'only SC');
  assert.equal(c.bestScEquivalent(null, null, f), null);
  assert.deepEqual(c.bestScEquivalent(6887, 7100, f), { time: 6887, source: 'SC' }, 'tie goes to the real SC swim');
  assert.deepEqual(c.bestScEquivalent(6950, 7100, f, 6812), { time: 6812, source: 'LC', lc: 7100 }, 'official swimmingresults figure overrides the table');
});

test('county gap and colour band', () => {
  assert.deepEqual(c.countyGap(3299, 3299), { gapHs: 0, gapSeconds: 0, band: 'green' }, 'exactly on the QT qualifies');
  assert.equal(c.countyGap(3150, 3299).band, 'green');
  assert.equal(c.countyGap(3150, 3299).gapSeconds, -1.49);
  assert.equal(c.countyGap(3300, 3299).band, 'amber', '0.01 over');
  assert.equal(c.countyGap(3499, 3299).band, 'amber', 'exactly 2.00 s is amber');
  assert.equal(c.countyGap(3500, 3299).band, 'red', '2.01 s is red');
  assert.equal(c.countyGap(3500, 3299).gapSeconds, 2.01);
  assert.equal(c.countyGap(3399, 3299, 1.0).band, 'amber', 'threshold is configurable');
  assert.equal(c.countyGap(3400, 3299, 1.0).band, 'red');
  assert.equal(c.countyGap(null, 3299), null);
});

test('qualifying time lookup handles age bands (10/11, 17/Ov)', () => {
  const rows = [
    { event: '50FR', sex: 'F', age: 10, age_max: 11, course: 'SC', time_hs: 3659 },
    { event: '50FR', sex: 'F', age: 12, age_max: null, course: 'SC', time_hs: 3299 },
    { event: '50FR', sex: 'F', age: 17, age_max: 99, course: 'SC', time_hs: 2899 },
  ];
  assert.equal(c.findQualifyingTime(rows, '50FR', 'F', 10, 'SC').time_hs, 3659);
  assert.equal(c.findQualifyingTime(rows, '50FR', 'F', 11, 'SC').time_hs, 3659);
  assert.equal(c.findQualifyingTime(rows, '50FR', 'F', 12, 'SC').time_hs, 3299);
  assert.equal(c.findQualifyingTime(rows, '50FR', 'F', 23, 'SC').time_hs, 2899);
  assert.equal(c.findQualifyingTime(rows, '50FR', 'F', 9, 'SC'), null);
  assert.equal(c.findQualifyingTime(rows, '50FR', 'M', 12, 'SC'), null);
});

test('time and event parsing', () => {
  assert.equal(c.parseTime('1:05.23'), 6523);
  assert.equal(c.parseTime('65.23'), 6523);
  assert.equal(c.parseTime('65.2'), 6520);
  assert.equal(c.parseTime('10:01.09'), 60109);
  assert.equal(c.parseTime('1:75.00'), null);
  assert.equal(c.parseTime('abc'), null);
  assert.equal(c.formatTime(6523), '1:05.23');
  assert.equal(c.formatTime(2987), '29.87');
  assert.equal(c.formatTime(60109), '10:01.09');
  assert.equal(c.parseEvent('100 Free'), '100FR');
  assert.equal(c.parseEvent('200m Individual Medley'), '200IM');
  assert.equal(c.parseEvent('50 Butterfly'), '50FL');
  assert.equal(c.parseEvent('100 Breaststroke'), '100BR');
  assert.equal(c.parseEvent('400 IM'), '400IM');
  assert.equal(c.parseEvent('75 Free'), null);
  assert.equal(c.parseDate('03/05/2012'), '2012-05-03', 'UK day-first');
  assert.equal(c.parseDate('11/07/26'), '2026-07-11');
  assert.equal(c.parseDate('3 May 2012'), '2012-05-03');
  assert.equal(c.parseDate('31/02/2012'), null);
});
