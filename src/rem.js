/*

Rem: REST easy.
A flexible HTTP library for using the web like an API.

Reference:
http://roy.gbiv.com/untangled/2008/rest-apis-must-be-hypertext-driven

*/

/**
 * Utilities
 */

function callable (obj) {
  var f = function () {
    return f.call.apply(f, arguments);
  };
  f.__proto__ = obj;
  return f;
};

function clone (obj) {
  return JSON.parse(JSON.stringify(obj));
}

function augment (c, b) {
  for (var k in b) {
    if (Object.prototype.hasOwnProperty.call(b, k) && b[k] != null) {
      c[k] = b[k];
    }
  }
  return c;
}

function safeJSONStringify (data) {
  return JSON.stringify(data).replace(/[\u007f-\uffff]/g, function (c) {
    return "\\u" + ("0000" + c.charCodeAt(0).toString(16)).slice(-4);
  });
}

var Middleware = (function () {

  function Middleware () { }

  Middleware.prototype.pre = function (type, callback) {
    this._middleware || (this._middleware = {});
    (this._middleware[type] || (this._middleware[type] = [])).push(callback);
    return this;
  };

  Middleware.prototype.middleware = function (type) {
    var args = Array.prototype.slice.call(arguments, 1), next = args.pop();
    var fns = (this._middleware && this._middleware[type] || []).slice();
    function nextCallback() {
      if (fns.length == 0) {
        next();
      } else {
        fns.shift().apply(this, args.concat([nextCallback.bind(this)]));
      }
    }
    nextCallback.call(this);
    return this;
  };

  return Middleware;

})();


/**
 * Environment
 */

var envtype = (typeof module !== 'undefined' && module.exports) ? 'node' : 'browser';

if (envtype == 'node') {
  var env = require('./node/env');
}


/**
 * Module
 */

var rem = (envtype == 'node') ? exports : this.rem = {};

// Configuration.
rem.userAgent = 'Mozilla/5.0 (compatible; REMbot/1.0; +http://remlib.org/)';

rem.env = env;

/**
 * Data formats.
 */

/*
rem.url = function () {
  var segments = Array.prototype.slice.call(arguments);
  var query = typeof segments[segments.length - 1] == 'object' ? segments.pop() : {};
  var url = remutil.url.parse(segments.shift());
  url.pathname = remutil.path.join.apply(null, [url.pathname].concat(segments));
  url.query = remutil.modify(url.query, query);

  return new Route(remutil.request.create(url), 'form', function (req, next) {
    req.headers['user-agent'] = req.headers['user-agent'] || rem.userAgent;
    // TODO rem.globalAgent
    remutil.request.send(req, next);
    return req;
  });
};
*/

rem.serializer = {
  json: function (data) {
    return safeJSONStringify(data);
  },

  form: function (data) {

  }
};

rem.parsers = {
  stream: function (res, next) {
    next(res);
  },

  binary: function (res, next) {
    env.consumeStream(res, next);
  },

  text: function (res, next) {
    env.consumeStream(res, function (data) {
      // Strip BOM signatures.
      next(String(data).replace(/^\uFEFF/, ''));
    });
  },

  json: function (res, next) {
    rem.parsers.text(res, function (data) {
      try {
        data = JSON.parse(String(data));
      } catch (e) {
        console.error('Could not parse JSON.', e)
      }
      next(data);
    });
  },

  xml: function (res, next) {
    rem.parsers.text(res, function (data) {
      try {
        env.parseXML(res, next);
      } catch (e) {
        console.error('Could not parse XML.', e)
      }
      next(data);
    });
  }
};


/** 
 * URL functions
 */

// protocol://auth@hostname:port/pathname?query#hash

Url = {

  getHost: function (url) {
    return url.hostname && (url.hostname + (url.port ? ':' + url.port : ''));
  },

  getPath: function (url) {
    return url.pathname
      + (env.qs.stringify(url.query) ? '?' + env.qs.stringify(url.query) : '')
      + (url.hash ? '#' + encodeURIComponent(url.hash) : '');
  }

};

/**
 * Request functions
 */

Request = {

  create: function (mod) {
    return Request.update({
      method: 'GET',
      headers: {},
      url: {
        protocol: '',
        hostname: '',
        port: '',
        pathname: '',
        query: {},
        hash: ''
      },
      body: null
    }, mod);
  },

  update: function (opts, mod) {
    if (typeof mod == 'string') {
      mod = env.url.parse(mod);
    }
    if (mod.url) {
      mod.url.query = augment(opts.url ? opts.url.query : {}, mod.url.query);
    }
    mod.url = augment(opts.url || {}, mod.url || {});
    return augment(opts, mod);
  },

  setBody: function (opts, type, body) {
    // Expand payload shorthand.
    if (typeof body == 'object' && !env.isList(body)) {
      if (type == 'form' || type == 'application/x-www-form-urlencoded') {
        type = 'application/x-www-form-urlencoded';
        body = env.qs.stringify(body);
      }
      if (type == 'json' || type == 'application/json') {
        type = 'application/json';
        body = rem.serializer.json(body);
      }
    }

    augment(opts.headers, {
      'content-length': body.length,
      'content-type': type
    });
    return augment(opts, {
      body: body
    });
  },

  send: null

};


/**
 * An HTTP route.
 */

var Route = (function () {

  function Route (req, defaultBodyMime, callback) {
    this.req = req;
    this.defaultBodyMime = defaultBodyMime || 'json';
    this.callback = callback;
  }

  Route.prototype.get = function (query, next) {
    if (typeof query == 'function') {
      next = query;
      query = null;
    }
    return this.callback(Request.update(this.req, {
      url: {
        query: query || {}
      },
      method: 'GET'
    }), next);
  };

  Route.prototype.head = function (query, next) {
    if (typeof query == 'function') {
      next = query;
      query = null;
    }
    return this.callback(Request.update(this.req, {
      url: {
        query: query || {}
      },
      method: 'HEAD'
    }), next);
  };

  Route.prototype.post = function (mime, body, next) {
    if (typeof body == 'function') {
      next = body;
      body = mime;
      mime = this.defaultBodyMime;
    }
    return this.callback(Request.update(Request.setBody(this.req, mime, body), {
      method: 'POST'
    }), next);
  };

  Route.prototype.patch = function (mime, body, next) {
    if (typeof body == 'function') {
      next = body;
      body = mime;
      mime = this.defaultBodyMime;
    }
    return this.callback(Request.update(Request.setBody(this.req, mime, body), {
      method: 'PATCH'
    }), next);
  };

  Route.prototype.put = function (mime, body, next) {
    if (typeof body == 'function') {
      next = body;
      body = mime;
      mime = this.defaultBodyMime;
    }
    return this.callback(Request.update(Request.setBody(this.req, mime, body), {
      method: 'PUT'
    }), next);
  };

  Route.prototype.del = function (next) {
    return this.callback(Request.update(this.req, {
      method: 'DELETE'
    }), next);
  };

  return Route;

})();


/**
 * Client
 */

var Client = (function () {

  env.inherits(Client, Middleware);

  function Client (options) {
    this.manifest = {}; // TODO What?
    this.options = options || {};

    // Defaults
    this.options.format = this.options.format || 'json';
  }

  // Configuration prompt.

  Client.prototype.configure = function (next) {
    return cont();
  };

  // Invoke as method.
  function invoke (api, segments, send) {
    var query = typeof segments[segments.length - 1] == 'object' ? segments.pop() : {};
    var url = ((segments[0] || '').indexOf('//') != -1 ? segments.shift() : (segments.length ? '/' : ''))
      + (segments.length ? env.joinPath.apply(null, segments) : '');

    return new Route(Request.create({
      url: env.url.parse(url)
    }), api.options.uploadFormat, function (req, next) {
      api.middleware('request', req, function () {
        // Debug flag.
        if (api.debug) {
          console.error('[URL]', env.url.format(req.url));
        }

        send(req, next);
        return req;
      });
    });
  }

  // Formats

  for (var format in rem.parsers) {
    (function (format) {
      Client.prototype[format] = function () {
        return invoke(this, Array.prototype.slice.call(arguments), function (req, next) {
          this.send(req, function (err, res) {
            this.middleware('response', req, res, function () {
              rem.parsers[format](res, function (data) {
                next && next.call(this, res.statusCode >= 400 ? res.statusCode : 0, data, res);
              });
            });
          }.bind(this));
        }.bind(this));
      }
    })(format);
  }

  Client.prototype.call = function () {
    return invoke(this, Array.prototype.slice.call(arguments), function (req, next) {
      this.send(req, function (err, res) {
        if (err) {
          next && next(err, null, res);
        } else {
          this.middleware('response', req, res, function () {
            this.parseStream(req, res, function (data) {
              next && next.call(this, res.statusCode >= 400 ? res.statusCode : 0, data, res);
            }.bind(this));
          }.bind(this));
        }
      }.bind(this));
    }.bind(this));
  };

  Client.prototype.parseStream = function (req, res, next) {
    rem.parsers[this.options.format](res, next);
  };

  Client.prototype.send = function (req, next) {
    env.sendRequest(req, this.agent, next);
  };

  // Root request shorthands.

  Client.prototype.get = function (route) {
    var route = this('');
    return route.get.apply(route, arguments);
  };

  Client.prototype.post = function () {
    var route = this('');
    return route.post.apply(route, arguments);
  };

  Client.prototype.del = function () {
    var route = this('');
    return route.del.apply(route, arguments);
  };

  Client.prototype.head = function () {
    var route = this('');
    return route.head.apply(route, arguments);
  };

  Client.prototype.put = function () {
    var route = this('');
    return route.put.apply(route, arguments);
  };

  Client.prototype.patch = function () {
    var route = this('');
    return route.patch.apply(route, arguments);
  };

  // Throttling.

  /*
  Client.prototype.throttle = function (rate) {
    var api = this, queue = [], rate = rate || 1;

    setInterval(function () {
      var fn = queue.shift();
      if (fn) {
        fn();
      }
    }, 1000/rate)

    var oldsend = api.send;
    api.send = function () {
      var args = arguments;
      queue.push(function () {
        oldsend.apply(api, args);
      });
    };

    return api;
  };
  */

  // Prompt.

  Client.prototype.prompt = function () {
    return env.prompt.apply(null, [rem, this].concat(Array.prototype.slice.apply(arguments)));
  };

  // Return.

  return Client;

})();

// Manifest Client.

var ManifestClient = (function () {

  env.inherits(ManifestClient, Client);

  function ManifestClient (manifest, options) {
    options = options || {};
    options.uploadFormat = options.uploadFormat || manifest.uploadFormat;

    Client.call(this, options);
    this.manifest = manifest;

    // Load format-specific options from the manifest.
    if (!this.manifest.formats) {
      this.manifest.formats = {json: {}};
    }
    if (!this.manifest.formats[this.options.format]) {
      throw new Error("Format \"" + this.options.format + "\" not available. Please specify an available format in the options parameter.");
    }
    augment(this.manifest, this.manifest.formats[this.options.format]);

    // Response. Expand payload shorthand.
    this.pre('request', function (req, next) {
      // Determine base that matches the path name.
      var pathname = req.url.pathname.replace(/^(?!\/)/, '/')
      // Bases can be fixed or an array of (pattern, base) tuples.
      if (env.isList(this.manifest.base)) {
        var base = '';
        this.manifest.base.some(function (tuple) {
          if (pathname.match(new RegExp(tuple[0]))) {
            base = tuple[1];
            return true;
          }
        });
      } else {
        var base = String(this.manifest.base);
      }
      
      // Update the request with base.
      Request.update(req, {
        url: env.url.parse(base)
      });
      Request.update(req, {
        url: {
          pathname: env.joinPath(req.url.pathname, pathname)
        }
      });
      next();
    });

    // User agent.
    this.pre('request', function (req, next) {
      req.headers['user-agent'] = req.headers['user-agent'] || rem.userAgent;
      next();
    });
    // Route root pathname.
    if (this.manifest.basepath) {
      this.pre('request', function (req, next) {
        req.url.pathname = this.manifest.basepath + req.url.pathname;
        next();
      });
    }
    // Route suffix.
    if (this.manifest.suffix) {
      this.pre('request', function (req, next) {
        req.url.pathname += this.manifest.suffix;
        next();
      });
    }
    // Route configuration parameters.
    if (this.manifest.configParams) {
      this.pre('request', function (req, next) {
        var params = this.manifest.configParams;
        for (var key in params) {
          req.url.query[key] = this.options[this.manifest.configParams[key]];
        }
        next();
      });
    }
    // Route static parameters.
    if (this.manifest.params) {
      this.pre('request', function (req, next) {
        var params = this.manifest.params;
        for (var key in params) {
          req.url.query[key] = params[key];
        }
        next();
      });
    }

    this.configure = function (next) {
      return env.configureManifestOptions(this, next);
    };
  }

  return ManifestClient;

})();

/**
 * Public API.
 */

rem.Client = Client;
rem.ManifestClient = ManifestClient;

rem.create = function (manifest, opts) {
  if (typeof manifest == 'string') {
    manifest = { base: manifest };
  }
  return callable(new ManifestClient(manifest, opts));
};

function createFromManifest (manifest, name, version, opts) {
  version = version = '*' ? Number(version) || '*' : '*';
  if (!manifest || !manifest[version]) {
    if (version == '*' && manifest) {
      var version = Object.keys(manifest).sort().pop();
      if (!manifest[version]) {
        throw new Error('Unable to find API ' + JSON.stringify(name) + ' version ' + JSON.stringify(Number(version)) + '. For the latest API, use "*".');
      }
    } else if (manifest) {
      throw new Error('Unable to find API ' + JSON.stringify(name) + ' version ' + JSON.stringify(Number(version)) + '. For the latest API, use "*".');
    } else {
      throw new Error('Unable to find API ' + JSON.stringify(name) + '.');
    }
  }
  manifest = manifest[version];
  manifest.id = name;
  manifest.version = version;
  return rem.create(manifest, opts);
}

// TODO Be able to load manifest files locally.
rem.load = function (name, version, opts) {
  return createFromManifest(env.lookupManifestSync(name), name, version, opts);
};

rem.loadAsync = function (name, version, opts, next) {
  if (!next) {
    next = opts;
    opts = {};
  }
  env.lookupManifest(name, function (err, manifest) {
    if (err) {
      next(err);
    } else {
      next(null, createFromManifest(manifest, name, version, opts));
    }
  })
};

/**
 * Default client request methods.
 */

var defaultClient = (new rem.Client());

Object.keys(rem.parsers).forEach(function (format) {
  rem[format] = function () {
    return defaultClient[format].apply(defaultClient, arguments);
  };
});

/**
 * Polling
 */

/*
function jsonpath (obj, keys) {
  keys.split('.').filter(String).forEach(function (key) {
    obj = obj && obj[key];
  });
  return obj;
}

rem.poll = function (endpoint, opts, callback) {
  // opts is an optional argument with a 'interval', 'root', and 'date' param.
  callback = typeof callback == 'function' ? callback : opts;
  opts = typeof opts == 'object' ? opts : {};
  var interval = opts.interval || 1000;
  var ARRAY_ROOT = opts.root || '';
  var DATE_KEY = opts.date || 'created_at';

  var latest = null;
  setInterval(function () {
    endpoint.get(function (err, json) {
      if (json && jsonpath(json, ARRAY_ROOT)) {
        var root = jsonpath(json, ARRAY_ROOT);
        for (var i = 0; i < root.length; i++) {
          if (latest && new Date(jsonpath(root[i], DATE_KEY)) <= latest) {
            break;
          }
        }
        if (i > 0) {
          var items = root.slice(0, i);
          callback(null, items);
          latest = new Date(jsonpath(items[0], DATE_KEY));
        }
      }
    });
  }, interval);
}
*/

/**
 * Includes
 */

if (envtype == 'node') {
  // Authentication methods.
  require('./node/oauth');
  require('./node/session');
  //require('./node/aws');
}
