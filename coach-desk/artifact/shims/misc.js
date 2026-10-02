'use strict';
// Stand-ins for Node modules the server code touches but the browser build never needs.
module.exports = {
  join: (...a) => a.join('/'),
  dirname: (p) => String(p).split('/').slice(0, -1).join('/'),
  mkdirSync: () => {},
  networkInterfaces: () => ({}),
  randomBytes: (n) => {
    const b = crypto.getRandomValues(new Uint8Array(n));
    return { toString: () => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('') };
  },
};
