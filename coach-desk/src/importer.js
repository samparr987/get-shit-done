'use strict';
const { parse } = require('csv-parse/sync');
const ExcelJS = require('exceljs');
const calc = require('./calc');

// Source columns that must never be stored (children's data rule). They are shown as "ignored".
const SENSITIVE = /(address|street|town|city|post\s*code|postcode|zip|phone|mobile|tel\b|e-?mail|medical|medic|condition|allerg|doctor|gp\b|parent|guardian|emergency|contact|next of kin|nok|photo|consent|bank|payment|nhs)/i;

// Field definitions per import kind. `aliases` drive the auto-guess on the mapping page.
const KINDS = {
  swimmers: {
    title: 'Swimmers (SportMember / Club Organiser export)',
    fields: [
      { key: 'first_name', label: 'First name', aliases: ['first name', 'firstname', 'forename', 'given name', 'first'] },
      { key: 'last_name', label: 'Last name', aliases: ['last name', 'lastname', 'surname', 'family name', 'last'] },
      { key: 'full_name', label: 'Full name (if no first/last)', aliases: ['name', 'full name', 'member name', 'member'] },
      { key: 'dob', label: 'Date of birth', required: true, aliases: ['dob', 'date of birth', 'birth date', 'birthdate', 'd.o.b'] },
      { key: 'sex', label: 'Sex', required: true, aliases: ['sex', 'gender', 'm/f'] },
      { key: 'se_id', label: 'Swim England ID', aliases: ['se id', 'asa', 'asa number', 'swim england', 'se number', 'membership number', 'reg no', 'registration'] },
      { key: 'group_name', label: 'Group', aliases: ['group', 'squad', 'training group', 'section', 'team'] },
      { key: 'other_club', label: 'Other club', aliases: ['other club', 'second club', 'club 2'] },
      { key: 'bolton_metro', label: 'Bolton Metro (Y/N)', aliases: ['bolton metro', 'metro'] },
    ],
  },
  times: {
    title: 'Times / results',
    fields: [
      { key: 'se_id', label: 'Swim England ID', aliases: ['se id', 'asa', 'asa number', 'swim england', 'id', 'tiref'] },
      { key: 'full_name', label: 'Swimmer name', aliases: ['name', 'swimmer', 'full name', 'athlete'] },
      { key: 'event', label: 'Event', required: true, aliases: ['event', 'stroke', 'race'] },
      { key: 'course', label: 'Course (SC/LC)', required: true, aliases: ['course', 'pool', 'sc/lc'] },
      { key: 'time', label: 'Time', required: true, aliases: ['time', 'result', 'final time', 'swim time'] },
      { key: 'conv_sc', label: 'Converted to SC (LC swims)', aliases: ['converted', 'converted to sc', 'conv sc', 'sc equivalent', 'converted time'] },
      { key: 'date', label: 'Date', required: true, aliases: ['date', 'swum', 'swim date', 'meet date'] },
      { key: 'meet', label: 'Meet', aliases: ['meet', 'gala', 'competition', 'meet name'] },
    ],
  },
  county: {
    title: 'County qualifying times',
    fields: [
      { key: 'event', label: 'Event', required: true, aliases: ['event', 'stroke'] },
      { key: 'sex', label: 'Sex', required: true, aliases: ['sex', 'gender'] },
      { key: 'age', label: 'Age (e.g. 12, 10/11, 17/Ov)', required: true, aliases: ['age', 'age group'] },
      { key: 'course', label: 'Course', required: true, aliases: ['course', 'pool'] },
      { key: 'time', label: 'Time', required: true, aliases: ['time', 'qt', 'qualifying time', 'standard'] },
    ],
  },
  plan: {
    title: 'Annual plan',
    fields: [
      { key: 'week_no', label: 'Week number', required: true, aliases: ['week', 'week no', 'wk', 'week number'] },
      { key: 'mesocycle', label: 'Mesocycle', aliases: ['mesocycle', 'meso', 'phase', 'block'] },
      { key: 'focus', label: 'Focus / theme', aliases: ['focus', 'theme', 'focus/theme'] },
      { key: 'drills', label: 'Drill rotation', aliases: ['drills', 'drill rotation', 'rotation', 'drill'] },
      { key: 'notes', label: 'Notes', aliases: ['notes', 'comments'] },
      { key: 'galas_text', label: 'Galas', aliases: ['galas', 'gala', 'competitions', 'meets'] },
      { key: 'holiday', label: 'Holiday / half-term', aliases: ['holiday', 'half term', 'half-term', 'hol'] },
    ],
  },
  drills: {
    title: 'House drills',
    fields: [
      { key: 'name', label: 'Drill name', required: true, aliases: ['name', 'drill', 'drill name'] },
      { key: 'stroke', label: 'Stroke', required: true, aliases: ['stroke'] },
      { key: 'category', label: 'Category', aliases: ['category', 'type', 'purpose', 'for'] },
      { key: 'description', label: 'Description', aliases: ['description', 'how', 'instructions', 'details'] },
      { key: 'equipment', label: 'Equipment', aliases: ['equipment', 'kit'] },
      { key: 'groups', label: 'Groups', aliases: ['groups', 'group', 'level'] },
      { key: 'rotation', label: 'Rotation', aliases: ['rotation', 'rot', 'letter'] },
      { key: 'video_url', label: 'Video link', aliases: ['video', 'url', 'link'] },
    ],
  },
  technique: {
    title: 'Technique points',
    fields: [
      { key: 'stroke', label: 'Stroke', required: true, aliases: ['stroke'] },
      { key: 'area', label: 'Area', aliases: ['area', 'phase', 'part'] },
      { key: 'point', label: 'Point', required: true, aliases: ['point', 'technique', 'description', 'coaching point'] },
      { key: 'cue_word', label: 'Cue word', aliases: ['cue', 'cue word', 'call'] },
    ],
  },
};

// ---------- file parsing ----------
async function parseFile(buffer, filename) {
  let grid;
  if (/\.xlsx$/i.test(filename)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.worksheets[0];
    grid = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals = [];
      for (let c = 1; c <= ws.columnCount; c++) vals.push(cellValue(row.getCell(c).value));
      grid.push(vals);
    });
  } else {
    grid = parse(buffer.toString('utf8'), { bom: true, relax_column_count: true, skip_empty_lines: true, delimiter: sniffDelimiter(buffer) });
  }
  grid = grid.filter((r) => r.some((v) => v !== '' && v != null));
  if (!grid.length) return { headers: [], rows: [] };
  const headers = grid[0].map((h, i) => (String(h || '').trim() || `Column ${i + 1}`));
  const rows = grid.slice(1).map((r) => {
    const o = {};
    headers.forEach((h, i) => (o[h] = r[i] == null ? '' : r[i]));
    return o;
  });
  return { headers, rows };
}
function sniffDelimiter(buffer) {
  const first = buffer.toString('utf8').split(/\r?\n/)[0] || '';
  const counts = [',', ';', '\t'].map((d) => [d, first.split(d).length]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][0];
}
function cellValue(v) {
  if (v == null) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (v.result != null) return v.result;
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.text != null) return v.text;
    return '';
  }
  return v;
}

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9/]+/g, ' ').trim();
function isSensitive(header) {
  return SENSITIVE.test(header);
}
function guessMapping(kind, headers) {
  const map = {};
  const usable = headers.filter((h) => !isSensitive(h));
  for (const f of KINDS[kind].fields) {
    const hit =
      usable.find((h) => f.aliases.includes(norm(h))) ||
      usable.find((h) => f.aliases.some((a) => a.length > 3 && norm(h).includes(a)));
    if (hit && !Object.values(map).includes(hit)) map[f.key] = hit;
  }
  return map;
}

// ---------- row transform (raw source row -> normalised value or error) ----------
function splitName(full) {
  const s = String(full || '').trim();
  if (!s) return {};
  if (s.includes(',')) {
    const [last, first] = s.split(',').map((x) => x.trim());
    return { first_name: first, last_name: last };
  }
  const parts = s.split(/\s+/);
  return { first_name: parts.slice(0, -1).join(' ') || parts[0], last_name: parts.length > 1 ? parts[parts.length - 1] : '' };
}

function transformRow(kind, raw, mapping) {
  const g = (k) => (mapping[k] ? raw[mapping[k]] : undefined);
  const str = (k) => {
    const v = g(k);
    return v == null || v === '' ? null : String(v).trim();
  };
  const errs = [];
  let v;
  switch (kind) {
    case 'swimmers': {
      let first = str('first_name');
      let last = str('last_name');
      if ((!first || !last) && str('full_name')) ({ first_name: first, last_name: last } = { ...splitName(str('full_name')), ...(first ? { first_name: first } : {}), ...(last ? { last_name: last } : {}) });
      const dob = calc.parseDate(g('dob'));
      const sex = calc.normaliseSex(g('sex'));
      const rawGroup = str('group_name');
      const group = calc.normaliseGroup(rawGroup);
      if (!first || !last) errs.push('name missing');
      if (!dob) errs.push(`bad DOB "${g('dob') ?? ''}"`);
      if (!sex) errs.push(`bad sex "${g('sex') ?? ''}"`);
      if (rawGroup && !group) errs.push(`unknown group "${rawGroup}" (left blank)`);
      v = {
        first_name: first, last_name: last, dob, sex,
        se_id: str('se_id'),
        group_name: group,
        other_club: str('other_club'),
        bolton_metro: mapping.bolton_metro ? calc.truthy(g('bolton_metro')) : null,
      };
      // An unknown group is a warning, not a fatal error.
      return { value: v, errors: errs.filter((e) => !e.startsWith('unknown group')), warnings: errs.filter((e) => e.startsWith('unknown group')) };
    }
    case 'times': {
      const event = calc.parseEvent(g('event'));
      const course = calc.normaliseCourse(g('course'));
      const time_hs = calc.parseTime(g('time'));
      const conv = mapping.conv_sc ? calc.parseTime(g('conv_sc')) : null;
      const swum_on = calc.parseDate(g('date'));
      if (!event) errs.push(`unknown event "${g('event') ?? ''}"`);
      if (!course) errs.push(`bad course "${g('course') ?? ''}"`);
      if (time_hs == null) errs.push(`bad time "${g('time') ?? ''}"`);
      if (!swum_on) errs.push(`bad date "${g('date') ?? ''}"`);
      if (!str('se_id') && !str('full_name')) errs.push('no swimmer ID or name');
      v = { se_id: str('se_id'), full_name: str('full_name'), event, course, time_hs, conv_sc_hs: course === 'LC' ? conv : null, swum_on, meet: str('meet') };
      break;
    }
    case 'county': {
      const event = calc.parseEvent(g('event'));
      const sex = calc.normaliseSex(g('sex'));
      const band = require('./seed').parseAgeBand(g('age'));
      const course = calc.normaliseCourse(g('course'));
      const time_hs = calc.parseTime(g('time'));
      if (!event) errs.push(`unknown event "${g('event') ?? ''}"`);
      if (!sex) errs.push('bad sex');
      if (!band) errs.push(`bad age "${g('age') ?? ''}"`);
      if (!course) errs.push('bad course');
      if (time_hs == null) errs.push(`bad time "${g('time') ?? ''}"`);
      v = { event, sex, age: band && band.age, age_max: band && band.age_max, course, time_hs };
      break;
    }
    case 'plan': {
      const week_no = Number(str('week_no'));
      if (!Number.isInteger(week_no) || week_no < 1) errs.push(`bad week "${g('week_no') ?? ''}"`);
      v = { week_no, mesocycle: str('mesocycle'), focus: str('focus'), drills: str('drills'), notes: str('notes'), galas_text: str('galas_text'), holiday: mapping.holiday ? (calc.truthy(g('holiday')) ? 1 : 0) : null };
      break;
    }
    case 'drills': {
      const stroke = normaliseTechStroke(str('stroke'));
      if (!str('name')) errs.push('name missing');
      if (!stroke) errs.push(`unknown stroke "${g('stroke') ?? ''}"`);
      v = { name: str('name'), stroke, category: str('category'), description: str('description'), equipment: str('equipment'), groups: str('groups'), rotation: str('rotation'), video_url: str('video_url') };
      break;
    }
    case 'technique': {
      const stroke = normaliseTechStroke(str('stroke'));
      if (!stroke) errs.push(`unknown stroke "${g('stroke') ?? ''}"`);
      if (!str('point')) errs.push('point missing');
      v = { stroke, area: str('area'), point: str('point'), cue_word: str('cue_word') };
      break;
    }
  }
  return { value: v, errors: errs, warnings: [] };
}

function normaliseTechStroke(s) {
  if (!s) return null;
  const t = s.toLowerCase();
  const map = { free: 'Free', freestyle: 'Free', fc: 'Free', back: 'Back', backstroke: 'Back', breast: 'Breast', breaststroke: 'Breast', fly: 'Fly', butterfly: 'Fly', im: 'IM', medley: 'IM', start: 'Starts', starts: 'Starts', turn: 'Turns', turns: 'Turns', finish: 'Finishes', finishes: 'Finishes', all: 'IM', general: 'IM' };
  return map[t] || calc.TECH_STROKES.find((x) => x.toLowerCase() === t) || null;
}

// ---------- apply to the database ----------
function findSwimmer(db, { se_id, first_name, last_name, dob, full_name }) {
  if (se_id) {
    const s = db.prepare('SELECT * FROM swimmers WHERE se_id = ?').get(se_id);
    if (s) return s;
  }
  if (first_name && last_name && dob) {
    const s = db.prepare('SELECT * FROM swimmers WHERE lower(first_name) = lower(?) AND lower(last_name) = lower(?) AND dob = ?').get(first_name, last_name, dob);
    if (s) return s;
  }
  if (full_name) {
    const n = splitName(full_name);
    const hits = db.prepare("SELECT * FROM swimmers WHERE lower(first_name || ' ' || last_name) = lower(?) OR (lower(first_name) = lower(?) AND lower(last_name) = lower(?))").all(full_name, n.first_name || '', n.last_name || '');
    if (hits.length === 1) return hits[0];
  }
  return null;
}

function importSwimmerRow(db, row) {
  const existing = findSwimmer(db, row);
  const patch = calc.mergeSwimmerImport(existing, row);
  if (existing) {
    const keys = Object.keys(patch);
    if (keys.length) {
      db.prepare(`UPDATE swimmers SET ${keys.map((k) => `${k} = @${k}`).join(', ')}, updated_at = datetime('now') WHERE id = @id`).run({ ...patch, id: existing.id });
    }
    return 'updated';
  }
  const rec = { first_name: null, last_name: null, dob: null, sex: null, se_id: null, group_name: null, imported_group: null, other_club: null, bolton_metro: 0, ...patch };
  db.prepare(`INSERT INTO swimmers (first_name, last_name, dob, sex, se_id, group_name, imported_group, other_club, bolton_metro)
    VALUES (@first_name, @last_name, @dob, @sex, @se_id, @group_name, @imported_group, @other_club, @bolton_metro)`).run(rec);
  return 'added';
}

function addTime(db, swimmerId, t, source = 'import') {
  const r = db.prepare(`INSERT INTO times (swimmer_id, event, course, time_hs, swum_on, meet, source, conv_sc_hs) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (swimmer_id, event, course, time_hs, swum_on) DO UPDATE SET conv_sc_hs = COALESCE(excluded.conv_sc_hs, conv_sc_hs), meet = COALESCE(excluded.meet, meet)`)
    .run(swimmerId, t.event, t.course, t.time_hs, t.swum_on, t.meet || null, source, t.conv_sc_hs ?? null);
  return r.changes;
}

function applyImport(db, kind, rawRows, mapping, ctx = {}) {
  const summary = { added: 0, updated: 0, skipped: [] };
  const tx = db.transaction(() => {
    rawRows.forEach((raw, i) => {
      const { value: v, errors } = transformRow(kind, raw, mapping);
      if (errors.length) return summary.skipped.push({ row: i + 2, reason: errors.join('; ') });
      switch (kind) {
        case 'swimmers':
          summary[importSwimmerRow(db, v)]++;
          break;
        case 'times': {
          const sw = findSwimmer(db, v);
          if (!sw) return summary.skipped.push({ row: i + 2, reason: `no swimmer matches ${v.se_id || v.full_name}` });
          const existed = db.prepare('SELECT 1 FROM times WHERE swimmer_id=? AND event=? AND course=? AND time_hs=? AND swum_on=?').get(sw.id, v.event, v.course, v.time_hs, v.swum_on);
          addTime(db, sw.id, v);
          summary[existed ? 'updated' : 'added']++;
          break;
        }
        case 'county': {
          const season = ctx.season || '2027';
          const ex = db.prepare('SELECT 1 FROM county_times WHERE season=? AND event=? AND sex=? AND age=? AND course=?').get(season, v.event, v.sex, v.age, v.course);
          db.prepare(`INSERT INTO county_times (season, event, sex, age, age_max, course, time_hs) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (season, event, sex, age, course) DO UPDATE SET time_hs = excluded.time_hs, age_max = excluded.age_max`)
            .run(season, v.event, v.sex, v.age, v.age_max, v.course, v.time_hs);
          summary[ex ? 'updated' : 'added']++;
          break;
        }
        case 'plan': {
          const fields = ['mesocycle', 'focus', 'drills', 'notes', 'galas_text', 'holiday'].filter((k) => v[k] != null);
          const exists = db.prepare('SELECT 1 FROM plan_weeks WHERE week_no = ?').get(v.week_no);
          if (!exists) {
            const s = require('./db').getSettings(db);
            db.prepare('INSERT INTO plan_weeks (week_no, start_date) VALUES (?, ?)').run(v.week_no, calc.weekStart(v.week_no, s.season_start));
          }
          if (fields.length) db.prepare(`UPDATE plan_weeks SET ${fields.map((k) => `${k} = @${k}`).join(', ')} WHERE week_no = @week_no`).run(v);
          summary[exists ? 'updated' : 'added']++;
          break;
        }
        case 'drills': {
          const ex = db.prepare('SELECT id FROM drills WHERE lower(name) = lower(?)').get(v.name);
          if (ex) {
            db.prepare(`UPDATE drills SET stroke=@stroke, category=COALESCE(@category, category), description=COALESCE(@description, description), equipment=COALESCE(@equipment, equipment),
              groups=COALESCE(@groups, groups), rotation=COALESCE(@rotation, rotation), video_url=COALESCE(@video_url, video_url) WHERE id=@id`).run({ ...v, id: ex.id });
            summary.updated++;
          } else {
            db.prepare('INSERT INTO drills (name, stroke, category, description, equipment, groups, rotation, video_url) VALUES (@name, @stroke, @category, @description, @equipment, @groups, @rotation, @video_url)').run(v);
            summary.added++;
          }
          break;
        }
        case 'technique': {
          db.prepare('INSERT INTO technique_points (stroke, area, point, cue_word, sort) VALUES (@stroke, @area, @point, @cue_word, 1000)').run(v);
          summary.added++;
          break;
        }
      }
    });
  });
  tx();
  return summary;
}

// ---------- swimmingresults.org paste ----------
// Accepts the text copied from a swimmingresults personal-best page (tab-separated table rows, or plain lines).
// Section headings containing "Long Course" / "Short Course" set the course. In the LC table a second
// time straight after the swim time is the site's official "Converted to SC" figure.
const TIME_RE = /^(?:\d{1,2}:)?\d{1,2}\.\d{2}$/;
const DATE_RE = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/;
function parseSwimmingResults(text) {
  const out = [];
  const problems = [];
  let course = null;
  for (const line of String(text).split(/\r?\n/)) {
    if (/long\s*course/i.test(line) && !/\d\.\d\d/.test(line)) { course = 'LC'; continue; }
    if (/short\s*course/i.test(line) && !/\d\.\d\d/.test(line)) { course = 'SC'; continue; }
    const cells = line.includes('\t') ? line.split('\t').map((c) => c.trim()).filter((c) => c !== '') : line.trim().split(/\s{2,}|\s(?=\d)/).map((c) => c.trim()).filter(Boolean);
    if (!cells.length) continue;
    const evMatch = line.match(/^\s*(\d{2,4})\s*m?\s*(Freestyle|Backstroke|Breaststroke|Butterfly|Individual Medley|Free|Back|Breast|Fly|IM)\b/i);
    if (!evMatch) continue;
    const event = calc.parseEvent(`${evMatch[1]} ${evMatch[2]}`);
    if (!event) { problems.push(`unknown event: ${line.trim()}`); continue; }
    if (!course) { problems.push(`no Long/Short Course heading before: ${line.trim()}`); continue; }
    const tokens = line.trim().split(/\t|\s+/);
    const times = [];
    let dateIdx = -1;
    tokens.forEach((t, i) => {
      if (TIME_RE.test(t) && dateIdx < 0) times.push({ t, i });
      if (DATE_RE.test(t) && dateIdx < 0) dateIdx = i;
    });
    if (!times.length) { problems.push(`no time on: ${line.trim()}`); continue; }
    const time_hs = calc.parseTime(times[0].t);
    let conv = null;
    if (course === 'LC' && times[1] && times[1].i === times[0].i + 1) conv = calc.parseTime(times[1].t);
    const swum_on = dateIdx >= 0 ? calc.parseDate(tokens[dateIdx]) : null;
    if (!swum_on) { problems.push(`no date on: ${line.trim()}`); continue; }
    let meet = null;
    if (line.includes('\t')) {
      const ci = cells.findIndex((c) => DATE_RE.test(c));
      meet = ci >= 0 && cells[ci + 1] ? cells[ci + 1] : null;
    } else {
      meet = tokens.slice(dateIdx + 1).join(' ').replace(/\s+\b(L[1-4]|Level ?[1-4]|[A-Z]{2,3}\d{6,})\b.*$/, '').trim() || null;
    }
    out.push({ event, course, time_hs, conv_sc_hs: conv, swum_on, meet });
  }
  return { rows: out, problems };
}

function swimmingResultsUrl(swimmer) {
  if (!swimmer.se_id) return null;
  return `https://www.swimmingresults.org/individualbest/personal_best.php?back=individualbestname&mode=A&name=${encodeURIComponent(swimmer.last_name)}&tiref=${encodeURIComponent(swimmer.se_id)}`;
}

module.exports = { KINDS, SENSITIVE, isSensitive, parseFile, guessMapping, transformRow, applyImport, importSwimmerRow, findSwimmer, addTime, parseSwimmingResults, swimmingResultsUrl, splitName };
