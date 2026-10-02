'use strict';
// better-sqlite3-compatible API over sql.js (SQLite compiled to WebAssembly), for the browser build.
let SQL = null;
let initialBytes = null;
let onWrite = () => {};

function norm(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}
function params(args) {
  if (args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0]) && !(args[0] instanceof Uint8Array)) {
    const o = {};
    for (const [k, v] of Object.entries(args[0])) o['@' + k] = norm(v);
    return o;
  }
  return (args.length === 1 && Array.isArray(args[0]) ? args[0] : args).map(norm);
}

class Database {
  constructor() {
    this._db = new SQL.Database(initialBytes || undefined);
    initialBytes = null;
    this._depth = 0;
  }
  prepare(sql) {
    const db = this;
    const rows = (args) => {
      const st = db._db.prepare(sql);
      try {
        st.bind(params(args));
        const out = [];
        while (st.step()) out.push(st.getAsObject());
        return out;
      } finally {
        st.free();
      }
    };
    return {
      all: (...a) => rows(a),
      get: (...a) => rows(a)[0],
      run: (...a) => {
        db._db.run(sql, params(a));
        const changes = db._db.getRowsModified();
        const id = db._db.exec('SELECT last_insert_rowid()')[0].values[0][0];
        onWrite();
        return { changes, lastInsertRowid: id };
      },
    };
  }
  exec(sql) {
    this._db.exec(sql);
    onWrite();
    return this;
  }
  pragma(s) {
    if (/journal_mode/i.test(s)) return;
    this._db.exec(`PRAGMA ${s}`);
  }
  transaction(fn) {
    return (...args) => {
      const sp = `sp${this._depth}`;
      this._db.exec(this._depth === 0 ? 'BEGIN' : `SAVEPOINT ${sp}`);
      this._depth++;
      try {
        const r = fn(...args);
        this._depth--;
        this._db.exec(this._depth === 0 ? 'COMMIT' : `RELEASE ${sp}`);
        onWrite();
        return r;
      } catch (err) {
        this._depth--;
        this._db.exec(this._depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
        throw err;
      }
    };
  }
  // browser-only helpers
  exportBytes() {
    const bytes = this._db.export(); // sql.js closes and reopens the connection here
    this._db.exec('PRAGMA foreign_keys = ON');
    return bytes;
  }
}
Database.setSQL = (s) => { SQL = s; };
Database.setInitialBytes = (b) => { initialBytes = b; };
Database.setOnWrite = (fn) => { onWrite = fn; };
module.exports = Database;
