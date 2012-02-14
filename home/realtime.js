var util = require('util'),
    redis = require('redis');

function Guy(id) {
  this.id = id;
  this.mode = 'standby';
  this.text = '';
  this.position = { x: 0, y: 0 };
};

function GuysPool(io, options) {
  process.EventEmitter.call(this);

  this.io = io;
  this.options = options;
  this.buffer = [];
  this.pool = [];
  this.map = {};

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
  }, 20);
};
util.inherits(GuysPool, process.EventEmitter);

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

GuysPool.prototype.onMessage = function onMessage(channel, data) {
  var self = this,
      msg = JSON.parse(data);

  if (msg[0] === 'bulk') {
    msg[1].forEach(function(event) {
      var type = event[0],
          data = event[1],
          guy = self.map[data.id];

      if (type === 'enter' && !guy) {
        self.pool.push(self.map[data.id] = new Guy(data.id));
      }
      if (!guy) return;

      if (type === 'leave') {
        var index = self.pool.indexOf(guy);
        self.pool.splice(index, 1);
        delete self.map[data.id];
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
      bulk.push(['enter', { id: guy.id }]);
      bulk.push(['mode', { id: guy.id, mode: guy.mode }]);
      bulk.push(['move', { id: guy.id, position: guy.position }]);
      if (guy.text) {
        bulk.push(['say', { id: guy.id, text: guy.text }]);
      }
    });
    if (bulk.length > 0) {
      socket.emit('bulk', bulk);
    }

    self.broadcast('enter', { id: socket.id });

    socket.on('mode', function(mode) {
      self.broadcast('mode', { id: socket.id, mode: mode });
    });

    socket.on('move', function(position) {
      self.broadcast('move', { id: socket.id, position: position });
    });

    socket.on('say', function(text) {
      self.broadcast('say', { id: socket.id, text: text });
    });

    socket.on('backspaceSaying', function() {
      self.broadcast('backspaceSaying', { id: socket.id });
    });

    socket.on('stopSaying', function() {
      self.broadcast('stopSaying', { id: socket.id });
    });

    socket.on('disconnect', function() {
      self.broadcast('leave', { id: socket.id });
    });
  });
};

GuysPool.prototype.broadcast = function broadcast(type, data) {
  this.buffer.push([type, data]);
};

exports.init = function init(io, options) {
  var pool = new GuysPool(io, options);
};
