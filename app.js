
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

io.sockets.on('connection', function(socket) {
  io.sockets.emit('guy:enter', { id: socket.id });

  socket.on('guy:mode', function(mode) {
    io.sockets.emit('guy:mode', { id: socket.id, mode: mode });
  });

  socket.on('guy:add', function(pos) {
    io.sockets.emit('guy:add', { id: socket.id, position: pos });
  });

  socket.on('disconnect', function() {
    io.sockets.emit('guy:leave', { id: socket.id });
  });
});

io.disable('log');

app.listen(3000);
console.log("Express server listening on port %d in %s mode", app.address().port, app.settings.env);
