var util = require('util'),
    redis = require('redis');

function Guy(pool, pid, id) {
  this.pool = pool;
  this.pid = pid;
  this.id = id;
  this.mode = 'standby';
  this.text = '';
  this.position = { x: 0, y: 0 };
  this.timeout = undefined;
  this.destroyed = false;

  this.ping();
};

Guy.prototype.ping = function ping() {
  if (this.destroyed) return;

  console.log('ping %d', this.id);
  var self = this;
  clearTimeout(this.timeout);
  this.timeout = setTimeout(function() {
    console.log('ping timeout %d', this.id);
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

  this.id = ~~(Math.random() * 1e9);
  this.io = io;
  this.options = options;
  this.buffer = [];
  this.pool = [];
  this.map = {};
  this.pmap = {};

  this.publish = this._createRedis();
  this.subscribe = this._createRedis();
  this.subscribe.subscribe(options.redis.channel);

  this.subscribe.on('message', this.onMessage.bind(this));
  this.manageIo(io);

  var self = this;

  this.broadcastTimer = setInterval(function() {
    if (self.buffer.length === 0) return;

    self.publish.publish(
      self.options.redis.channel,
      JSON.stringify(['bulk', self.buffer])
    );
    self.buffer = [];
  }, 7);

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

GuysPool.prototype.insert = function insert(guy, silent) {
  var guyObj = new Guy(this, guy.pid, guy.id);

  if (guy.mode) {
    guyObj.mode = guy.mode;
    guyObj.position = guy.position;
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
    position: guy.position
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
    this.publish.publish(
      this.options.redis.channel,
      JSON.stringify(['bootstrap:reply', msg[1], this.pool])
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
        guy.position = data.position;
      } else if (type === 'say') {
        guy.text += data.text;

        // Trim text
        if (guy.text.length > 32) {
          guy.text = guy.text.slice(0, 32) + '...';
        }
      } else if (type === 'backspaceSaying') {
        guy.text = guy.text.slice(0, -1);
      } else if (type === 'stopSaying') {
        guy.text = '';
      }
    });
  }
  this.io.sockets.emit(msg[0], msg[1]);
};

GuysPool.prototype.manageIo = function manageIo(io) {
  var self = this;

  io.sockets.on('connection', function(socket) {
    var bulk = [];
    self.pool.forEach(function(guy) {
      self.notifyEnter(guy, bulk);
    });
    socket.emit('bulk', bulk);

    self.broadcast('enter', { id: socket.id, pid: self.id });

    socket.on('ping', function() {
      self.broadcast('ping', { id : socket.id });
    });

    socket.on('mode', function(mode) {
      self.broadcast('mode', { id: socket.id, pid: self.id, mode: mode });
    });

    socket.on('move', function(position) {
      self.broadcast('move', {
        id: socket.id,
        pid: self.id,
        position: position
      });
    });

    socket.on('say', function(text) {
      self.broadcast('say', { id: socket.id, pid: self.id, text: text });
    });

    socket.on('backspaceSaying', function() {
      self.broadcast('backspaceSaying', { id: socket.id, pid: self.id });
    });

    socket.on('stopSaying', function() {
      self.broadcast('stopSaying', { id: socket.id, pid: self.id });
    });

    socket.on('disconnect', function() {
      self.broadcast('leave', { id: socket.id, pid: self.id });
    });
  });
};

GuysPool.prototype.broadcast = function broadcast(type, data, acc) {
  (acc || this.buffer).push([type, data]);
};

exports.init = function init(io, options) {
  var pool = new GuysPool(io, options);
};
