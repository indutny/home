
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

app.listen(3000);
console.log("Express server listening on port %d in %s mode", app.address().port, app.settings.env);
