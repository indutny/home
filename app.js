
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

io.sockets.on('connection', function(socket) {
  io.sockets.emit('guy:enter', { id: socket.id });

  guys.forEach(function(guy) {
    socket.emit('guy:enter', { id: guy.id });
    socket.emit('guy:mode', { id: guy.id, mode: guy.mode });
    socket.emit('guy:move', { id: guy.id, position: guy.position });
    if (guy.text) {
      socket.emit('guy:say', { id: guy.id, text: guy.text });
    }
  });
  guys.push(guysMap[socket.id] = new Guy(socket.id));

  socket.on('guy:mode', function(mode) {
    guysMap[socket.id].mode = mode;
    io.sockets.emit('guy:mode', { id: socket.id, mode: mode });
  });

  socket.on('guy:move', function(position) {
    guysMap[socket.id].position = position;
    io.sockets.emit('guy:move', { id: socket.id, position: position });
  });

  socket.on('guy:say', function(text) {
    var guy = guysMap[socket.id];
    guy.text += text;

    // Trim text
    if (guy.text.length > 32) {
      guy.text = guy.text.slice(0, 32) + '...';
    }
    io.sockets.emit('guy:say', { id: socket.id, text: text });
  });

  socket.on('guy:backspaceSaying', function() {
    guysMap[socket.id].text = guysMap[socket.id].text.slice(0, -1);
    io.sockets.emit('guy:backspaceSaying', { id: socket.id });
  });

  socket.on('guy:stopSaying', function() {
    guysMap[socket.id].text = '';
    io.sockets.emit('guy:stopSaying', { id: socket.id });
  });

  socket.on('disconnect', function() {
    var guy = guysMap[socket.id];
    delete guysMap[socket.id];
    guys.splice(guys.indexOf(guy), 1);
    io.sockets.emit('guy:leave', { id: socket.id });
  });
});

io.disable('log');

app.listen(3000);
console.log("Express server listening on port %d in %s mode", app.address().port, app.settings.env);
