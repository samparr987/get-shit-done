'use strict';
// PDF version of the swimmer-county-analysis skill report (fastest-route method), one page per swimmer.
const PDFDocument = require('pdfkit');
const calc = require('./calc');

const NAVY = '#1a2a4a', GREEN = '#1b7a3d', RED = '#b02a2a', AMBER = '#b5781a', GRID = '#cfd6e2', QBG = '#e3f3e8', ABG = '#fdf3e1';

function margin(r) {
  // Skill convention: + = under the QT (qualified), - = still to drop.
  const d = -r.gap.gapHs / 100;
  return (d >= 0 ? '+' : '-') + Math.abs(d).toFixed(2);
}

function ageLabel(analysis) {
  return `${analysis.swimmer.sex === 'F' ? 'Girls' : 'Boys'} ${analysis.age}`;
}

function renderSwimmerPage(doc, analysis, opts = {}) {
  const { swimmer, info } = analysis;
  const meta = info.meta || {};
  const rows = analysis.rows.filter((r) => r.gap);
  const grp = ageLabel(analysis);
  const name = `${swimmer.first_name} ${swimmer.last_name}`;
  const L = 45, W = doc.page.width - 90;

  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(19).text(`${name} — County Qualifying Analysis`, L, 50, { width: W });
  doc.moveDown(0.2).fillColor('#444').font('Helvetica').fontSize(10.5)
    .text(`${meta.authority || 'County'} ${info.season}  |  ${grp}  |  Fastest route (best of SC or LC-converted)`);
  doc.text(['Horwich LC ASC', swimmer.se_id ? `Swim England ID ${swimmer.se_id}` : null, swimmer.group_name].filter(Boolean).join('  |  '));
  let intro = `Assessed against the ${meta.authority || 'county'} ${info.season} (${grp}) ${meta.course === 'LC' ? 'long' : 'short'} course consideration times, age as at ${calc.formatDate(info.ageAt)}. Each event uses the swimmer's fastest available time — the better of the short course best or the long course best converted to short course.`;
  if (opts.since) intro = `New swims since ${calc.formatDate(opts.since)} are marked NEW. ` + intro;
  doc.moveDown(0.4).fillColor('#555').fontSize(9).text(intro, { width: W });
  doc.moveDown(0.6);

  // table
  const cols = [
    ['Event', 95], ['Fastest', 62], ['Source', 62], [`${grp} QT`, 70], ['Margin', 60], ['Gap band', 58], ['Status', 98],
  ];
  let y = doc.y;
  const rowH = 19;
  const drawRow = (cells, opt = {}) => {
    let x = L;
    if (opt.bg) doc.rect(L, y, W, rowH).fill(opt.bg);
    cells.forEach((c, i) => {
      const [, w] = cols[i];
      doc.fillColor(opt.colors && opt.colors[i] ? opt.colors[i] : opt.header ? 'white' : '#222')
        .font(opt.header || (opt.bold && opt.bold.includes(i)) ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5)
        .text(String(c), x + 4, y + 5, { width: w - 8, align: i === 0 ? 'left' : 'center', lineBreak: false });
      x += w;
    });
    if (!opt.header) doc.lineWidth(0.3).strokeColor(GRID).rect(L, y, W, rowH).stroke();
    y += rowH;
  };
  doc.rect(L, y, W, rowH).fill(NAVY);
  drawRow(cols.map((c) => c[0]), { header: true });
  for (const r of rows) {
    const q = r.band === 'green';
    const src = r.best.source === 'SC' ? 'SC' : r.best.official ? 'LC->SC' : 'LC->SC*';
    drawRow(
      [r.name + (r.updated ? '  NEW' : ''), calc.formatTime(r.best.time), src, calc.formatTime(r.qt), margin(r), r.band, q ? 'QUALIFIED' : '—'],
      {
        bg: q ? QBG : r.band === 'amber' ? ABG : null,
        colors: { 0: r.updated ? AMBER : null, 4: q ? null : RED, 5: q ? GREEN : r.band === 'amber' ? AMBER : RED, 6: q ? GREEN : null },
        bold: q ? [6] : [],
      }
    );
  }
  if (!rows.length) {
    doc.fillColor('#555').font('Helvetica').fontSize(10).text('No comparable events — no times yet for events offered at this age.', L + 4, y + 6);
    y += 24;
  }
  doc.y = y + 14;
  doc.x = L;

  const q = rows.filter((r) => r.band === 'green');
  const near = rows.filter((r) => r.band !== 'green').sort((a, b) => a.gap.gapHs - b.gap.gapHs);
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(13).text('Summary', L, doc.y);
  doc.moveDown(0.3).fillColor('#222').font('Helvetica').fontSize(10);
  if (q.length) doc.font('Helvetica-Bold').text(`Qualified — ${q.length} event${q.length !== 1 ? 's' : ''}: `, { continued: true }).font('Helvetica').text(q.map((r) => r.name).join(', ') + '.');
  else doc.font('Helvetica-Bold').text('No events reach the standard yet. ', { continued: true }).font('Helvetica').text('This is a baseline and target sheet — see the closest gaps below.');
  if (near.length) {
    doc.moveDown(0.3).font('Helvetica-Bold').text('Closest to qualifying: ', { continued: true }).font('Helvetica')
      .text(near.slice(0, 4).map((r) => `${r.name} (${margin(r)})`).join(', ') + '.');
  }
  const stale = rows.filter((r) => r.best && calc.daysBetween(r.best.row.swum_on, opts.today || r.best.row.swum_on) > 365);
  if (stale.length) doc.moveDown(0.3).fillColor(AMBER).text(`Older than 12 months (worth re-swimming): ${stale.map((r) => r.name).join(', ')}.`);
  doc.moveDown(0.8).fillColor(NAVY).font('Helvetica-Bold').fontSize(13).text('Note');
  const unofficial = rows.some((r) => r.best.source === 'LC' && !r.best.official);
  doc.moveDown(0.3).fillColor('#555').font('Helvetica').fontSize(9).text(
    `${meta.conditions || ''} ${meta.note || ''} Qualifying window: ${meta.qualifying_window || 'see the official sheet'}. Verify any sub-0.20s margin against the official sheet, and confirm each entry swim falls inside the window at a licensed meet.` +
      (unofficial ? ' * LC->SC* = converted with Coach Desk\'s conversion table, not an official swimmingresults figure.' : ''),
    { width: W }
  );
}

function countyPdf(analyses, opts = {}) {
  const doc = new PDFDocument({ size: 'A4', margin: 45, autoFirstPage: false, info: { Title: 'County Qualifying Analysis', Author: 'Coach Desk' } });
  for (const a of analyses) {
    doc.addPage();
    renderSwimmerPage(doc, a, opts);
  }
  if (!analyses.length) { doc.addPage(); doc.text('No swimmers.'); }
  doc.end();
  return doc;
}

module.exports = { countyPdf, margin };
