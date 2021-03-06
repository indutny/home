var util = require('util'),
    redis = require('redis');

function Guy(pool, pid, id, ip) {
  this.pool = pool;
  this.pid = pid;
  this.id = id;
  this.ip = ip;
  this.mode = 'standby';
  this.text = '';
  this.pos = { x: 0, y: 0 };
  this.timeout = undefined;
  this.destroyed = false;

  this.ping();
};

Guy.prototype.ping = function ping() {
  if (this.destroyed) return;

  var self = this;
  clearTimeout(this.timeout);
  this.timeout = setTimeout(function() {
    self.destroyed = true;
    self.pool.remove(self);
  }, 30000);
};

function PMap(pool, pid) {
  this.pool = pool;
  this.pid = pid;
  this.guys = {};

  this.destroyed = false;
  this.timer = undefined;
  this.ping();
};

PMap.prototype.ping = function ping() {
  if (this.destroyed) return;

  var self = this;
  clearTimeout(this.timer);
  this.timer = setTimeout(function() {
    self.remove();
  }, 15000);
};

PMap.prototype.remove = function remove() {
  this.destroyed = true;

  delete this.pool.pmap[this.pid];

  var self = this,
      guys = this.guys;

  Object.keys(guys).forEach(function(key) {
    self.pool.remove(guys[key]);
  });
};

function GuysPool(io, options) {
  process.EventEmitter.call(this);

  this.version = options.version;
  this.id = (~~(Math.random() * 1e9)).toString(36);
  this.io = io;
  this.options = options;
  this.pool = [];
  this.map = {};
  this.pmap = {};

  this.publish = this._createRedis();
  this.subscribe = this._createRedis();
  this.subscribe.subscribe(options.redis.channel);

  this.subscribe.on('message', this.onMessage.bind(this));
  this.manageIo(io);

  var self = this;

  this.keepAliveTimer = setInterval(function() {
    self.publish.publish(
      self.options.redis.channel,
      JSON.stringify(['ping', self.id])
    );
  }, 5000);

  this.bootstrap();
};
util.inherits(GuysPool, process.EventEmitter);

GuysPool.prototype.bootstrap = function bootstrap() {
  this.publish.publish(
     this.options.redis.channel,
     JSON.stringify(['bootstrap', this.id])
  );
};

GuysPool.prototype._createRedis = function _createRedis() {
  var client = redis.createClient(
    this.options.redis.port,
    this.options.redis.host,
    this.options.redis
  );
  if (this.options.redis.password) {
    client.auth(this.options.redis.password);
  }
  return client;
};

GuysPool.prototype.isBanned = function isBanned(ip, callback) {
  this.publish.hget('ban:ips', ip, function(err, value) {
    if (err || !value) return callback(false);
    callback(true);
  });
};

GuysPool.prototype.ban = function ban(guy) {
  this.publish.hset('ban:ips', guy.ip, 1);
  if (this.io.sockets.sockets[guy.id]) {
    this.io.sockets.sockets[guy.id].disconnect();
  }
};

GuysPool.prototype.insert = function insert(guy, silent) {
  var guyObj = new Guy(this, guy.pid, guy.id, guy.ip);

  if (guy.mode) {
    guyObj.mode = guy.mode;
    guyObj.pos = guy.pos;
    guyObj.text = guy.text;
  }

  this.map[guy.id] = guyObj;
  if (!this.pmap[guy.pid]) {
    this.pmap[guy.pid] = new PMap(this, guy.pid);
  }
  this.pmap[guy.pid].guys[guy.id] = guyObj;
  this.pool.push(guyObj);

  if (!silent) this.notifyEnter(guyObj);
};

GuysPool.prototype.notifyEnter = function notifyEnter(guy, bulk) {
  this.broadcast('enter', { id: guy.id, pid: this.id }, bulk);
  this.broadcast('mode', { id: guy.id, pid: this.id, mode: guy.mode }, bulk);
  this.broadcast('move', {
    id: guy.id,
    pid: this.id,
    pos: guy.pos
  }, bulk);
  if (guy.text) {
    this.broadcast('say', { id: guy.id, pid: this.id, text: guy.text }, bulk);
  }
};

GuysPool.prototype.remove = function remove(guy, silent) {
  var index = this.pool.indexOf(guy);

  if (index === -1) return;

  this.pool.splice(index, 1);
  delete this.map[guy.id];
  if (this.pmap[guy.pid]) {
    delete this.pmap[guy.pid].guys[guy.id];
  }

  if (!silent) this.broadcast('leave', { id: guy.id, pid: guy.pid });
};

GuysPool.prototype.onMessage = function onMessage(channel, data) {
  var self = this,
      msg = JSON.parse(data);

  if (msg[0] === 'bootstrap') {
    if (msg[1] === this.id) return;
    var pool = this.pool.map(function(guy) {
      return {
        id: guy.id,
        pid: guy.pid,
        ip: guy.ip,
        pos: guy.pos,
        mode: guy.mode,
        text: guy.text
      };
    });
    this.publish.publish(
      this.options.redis.channel,
      JSON.stringify(['bootstrap:reply', msg[1], pool])
    );
    return;
  }

  if (msg[0] === 'bootstrap:reply') {
    if (msg[1] !== this.id) return;
    msg[2].forEach(function(guy) {
      if (self.map[guy.id]) return;
      self.insert(guy);
    });
    return;
  }

  if (msg[0] === 'ping') {
    if (!this.pmap[msg[1]]) {
      this.pmap[msg[1]] = new PMap(this, msg[1]);
    } else {
      this.pmap[msg[1]].ping();
    }
    return;
  }

  if (msg[0] === 'bulk') {
    msg[1].forEach(function(event) {
      var type = event[0],
          data = event[1],
          guy = self.map[data.id];

      if (type === 'enter' && !guy) {
        self.insert(data, true);
        return;
      }
      if (!guy) return;

      if (type === 'ping') {
        guy.ping();
      } else if (type === 'leave') {
        self.remove(guy, true);
      } else if (type === 'mode') {
        guy.mode = data.mode;
      } else if (type === 'move') {
        if (guy.pos && data.pos &&
            guy.pos.x !== 0 && guy.pos.y !== 0) {
          var dx = guy.pos.x - data.pos.x,
              dy = guy.pos.y - data.pos.y,
              len = dx*dx + dy*dy;

          if (len > 50 * 50) self.ban(guy);
        }
        guy.pos = data.pos;
        if (!guy.pos|| guy.pos.y < 100 || guy.pos.y > 250) {
          self.ban(guy);
        }
      } else if (type === 'say') {
        guy.text += data.text;
        if (/penis|ху[йё]|пизд|еба[тн]|gaynode/i.test(guy.text)) {
          self.ban(guy);
        }

        // Trim text
        if (guy.text.length > 32) {
          guy.text = guy.text.slice(0, 32) + '...';
        }
      } else if (type === 'say:remove') {
        guy.text = guy.text.slice(0, -1);
      } else if (type === 'say:stop') {
        guy.text = '';
      }
    });
  }
  this.io.sockets.emit(msg[0], msg[1]);
};

GuysPool.prototype.manageIo = function manageIo(io) {
  var self = this;

  io.sockets.on('connection', function(socket) {
    var ip = io.handshaken[socket.id].address.address;
    self.isBanned(ip, function(banned) {
      if (banned) return socket.disconnect();

      var bulk = [ ['version', self.version] ];
      self.pool.forEach(function(guy) {
        self.notifyEnter(guy, bulk);
      });
      socket.emit('bulk', bulk);

      self.broadcast('enter', { id: socket.id, pid: self.id, ip: ip });

      socket.on('ping', function() {
        self.broadcast('ping', { id : socket.id });
      });

      socket.on('mode', function(mode) {
        self.broadcast('mode', { id: socket.id, pid: self.id, mode: mode });
      });

      socket.on('move', function(pos) {
        self.broadcast('move', {
          id: socket.id,
          pid: self.id,
          pos: pos
        });
      });

      socket.on('say', function(text) {
        self.broadcast('say', { id: socket.id, pid: self.id, text: text });
      });

      socket.on('say:remove', function() {
        self.broadcast('say:remove', { id: socket.id, pid: self.id });
      });

      socket.on('say:stop', function() {
        self.broadcast('say:stop', { id: socket.id, pid: self.id });
      });

      socket.on('disconnect', function() {
        self.broadcast('leave', { id: socket.id, pid: self.id });
      });
    });
  });
};

GuysPool.prototype.broadcast = function broadcast(type, data, acc) {
  if (acc) {
    acc.push([type, data]);
  } else {
    this.publish.publish(
      this.options.redis.channel,
      JSON.stringify(['bulk', [[type, data]]])
    );
  }
};

exports.init = function init(io, options) {
  var pool = new GuysPool(io, options);
};
