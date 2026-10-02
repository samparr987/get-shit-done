'use strict';
// Tiny Express-compatible router that runs in the page. `host` supplies render/redirect/send.
let host = null;

function compile(path) {
  const keys = [];
  const src = path.replace(/[.]/g, '\\.').replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; });
  return { re: new RegExp(`^${src}/?$`), keys };
}

function express() {
  const stack = [];
  const app = {
    settings: {},
    locals: {},
    set(k, v) { this.settings[k] = v; },
    use(...args) {
      const prefix = typeof args[0] === 'string' ? args.shift() : null;
      for (const fn of args) stack.push({ prefix, fn });
    },
    handle(req, res) {
      let i = 0;
      const next = (err) => {
        while (i < stack.length) {
          const l = stack[i++];
          if (l.method && l.method !== req.method) continue;
          if (l.route) {
            const m = l.route.re.exec(req.path);
            if (!m) continue;
            req.params = {};
            l.route.keys.forEach((k, j) => (req.params[k] = decodeURIComponent(m[j + 1])));
          } else if (l.prefix && !req.path.startsWith(l.prefix)) continue;
          const isErr = l.fn.length === 4;
          if (!!err !== isErr) continue;
          try {
            const r = isErr ? l.fn(err, req, res, next) : l.fn(req, res, next);
            if (r && typeof r.then === 'function') r.catch(next);
          } catch (e) {
            next(e);
          }
          return;
        }
        if (err) host.fatal(err);
      };
      next();
    },
  };
  for (const m of ['get', 'post']) {
    app[m] = (path, ...handlers) => {
      const route = compile(path);
      for (const fn of handlers) stack.push({ method: m.toUpperCase(), route, fn });
    };
  }
  return app;
}
express.urlencoded = () => (req, res, next) => next();
express.static = () => (req, res, next) => next();
express.setHost = (h) => { host = h; };
module.exports = express;
