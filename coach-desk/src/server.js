'use strict';
const path = require('path');
const { openDb } = require('./db');
const { createApp } = require('./app');

const PORT = Number(process.env.PORT) || 4400;
const DB_FILE = process.env.COACH_DESK_DB || path.join(__dirname, '..', 'data', 'coach-desk.sqlite');

// Default: this PC only. `npm run start:lan` also listens on your home network so a phone on the same Wi-Fi can open it.
const LAN = process.argv.includes('--lan');
const HOST = LAN ? '0.0.0.0' : '127.0.0.1';

const db = openDb(DB_FILE);
createApp(db).listen(PORT, HOST, () => {
  console.log(`Coach Desk running at http://localhost:${PORT}  (database: ${DB_FILE})`);
  if (LAN) {
    const nets = Object.values(require('os').networkInterfaces()).flat().filter((n) => n && n.family === 'IPv4' && !n.internal);
    for (const n of nets) console.log(`  On your phone (same Wi-Fi): http://${n.address}:${PORT}`);
    console.log('  Note: anyone on this Wi-Fi can open it — there is no login. Use on your home network only.');
  }
});
