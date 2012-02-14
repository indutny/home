
/**
 * Module dependencies.
 */

var net = require('net'),
    os = require('os'),
    express = require('express'),
    io = require('socket.io'),
    cluster = require('cluster'),
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

if (cluster.isMaster) {
  var workers = [];
  os.cpus().forEach(function(cpu, i) {
    workers[i] = cluster.fork();
    workers[i].on('exit', function() {
      console.error('worker died');
      workers[i] = cluster.fork();
    });
  });

  var sticky = [];

  net.createServer(function(c) {
    var worker,
        id = c.remoteAddress.replace(/^.+\./, '');

    if (!sticky[id]) {
      sticky[id] = workers[(~~Math.random() * 1e9) % workers.length];
    }
    worker = sticky[id];

    c.pause();
    workers[0].send('connection', c._handle);
    c._handle.close();
  }).listen(3000);
} else {
  io = io.listen(app);
  io.disable('log');

  // App-Specific stuff
  require('./home/realtime').init(io, {
    redis: {
      port: +process.env['DB-MAIN-PORT'] || 6379,
      host: +process.env['DB-MAIN-HOST'] || 'localhost',
      password: process.env['DB-MAIN-PASSWORD'],
      channel: 'guys'
    }
  });

  var Buffer = require('buffer').Buffer;
  process.on('message', function(msg, handle) {
    if (msg === 'connection') {
      var socket = new net.Socket({ handle: handle });
      socket.writable = true;
      socket.readable = true;
      socket.pause();
      socket.resume();
      app.emit('connection', socket);
    }
  });

  app.listen(null);
}
