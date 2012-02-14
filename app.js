
/**
 * Module dependencies.
 */

var express = require('express'),
    io = require('socket.io'),
    routes = require('./routes');

var app = module.exports = express.createServer();

// Configuration

app.configure(function(){
  app.set('views', __dirname + '/views');
  app.set('view engine', 'jade');
  app.use(express.bodyParser());
  app.use(express.methodOverride());
  app.use(app.router);
  app.use(express.static(__dirname + '/public'));
});

app.configure('development', function(){
  app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
});

app.configure('production', function(){
  app.use(express.errorHandler());
});

// Routes

app.get('/', routes.index);

io = io.listen(app);

var guys = [],
    guysMap = {};

function Guy(id) {
  this.id = id;
  this.mode = 'standby';
  this.text = '';
  this.position = { x: 0, y: 0 };
};

var buffer = [];

io.sockets.on('connection', function(socket) {
  buffer.push([ 'enter', { id: socket.id } ]);

  var bulk = [];
  guys.forEach(function(guy) {
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

  guys.push(guysMap[socket.id] = new Guy(socket.id));

  socket.on('mode', function(mode) {
    guysMap[socket.id].mode = mode;
    buffer.push([ 'mode', { id: socket.id, mode: mode } ]);
  });

  socket.on('move', function(position) {
    guysMap[socket.id].position = position;
    buffer.push([ 'move', { id: socket.id, position: position } ]);
  });

  socket.on('say', function(text) {
    var guy = guysMap[socket.id];
    guy.text += text;

    // Trim text
    if (guy.text.length > 32) {
      guy.text = guy.text.slice(0, 32) + '...';
    }
    buffer.push([ 'say', { id: socket.id, text: text } ]);
  });

  socket.on('backspaceSaying', function() {
    guysMap[socket.id].text = guysMap[socket.id].text.slice(0, -1);
    buffer.push([ 'backspaceSaying', { id: socket.id } ]);
  });

  socket.on('stopSaying', function() {
    guysMap[socket.id].text = '';
    buffer.push([ 'stopSaying', { id: socket.id } ]);
  });

  socket.on('disconnect', function() {
    var guy = guysMap[socket.id];
    delete guysMap[socket.id];
    guys.splice(guys.indexOf(guy), 1);
    buffer.push([ 'leave', { id: socket.id } ]);
  });
});

setInterval(function() {
  if (buffer.length > 0) {
    io.sockets.emit('bulk', buffer);
  }
  buffer = [];
}, 20);

io.disable('log');

app.listen(3000);
console.log("Express server listening on port %d in %s mode", app.address().port, app.settings.env);
