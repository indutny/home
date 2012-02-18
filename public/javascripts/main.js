!function() {
  var requestFrame = window.requestAnimationFrame ||
                     window.mozRequestAnimationFrame ||
                     window.webkitRequestAnimationFrame ||
                     window.msRequestAnimationFrame,
      canvas = document.getElementById('drawer'),
      ctx = canvas.getContext('2d'),
      socket = io.connect();

  // No request frame in opera
  if (!requestFrame) {
    requestFrame = function(callback) {
      callback();
    };
  }

  ctx.fillStyle = 'black';
  ctx.lineWidth = 1.5;
  ctx.textAlign = 'center';

  var length = {
    hand: 4.5,
    leg: 6
  };

  function ManPath(head, hands, legs) {
    this.position = {
      x: 0,
      y: 0
    };

    if (head === 'left') {
      this.head = this.line([[6, -90], [2, -45]]);
    } else {
      this.head = this.line([[6, -90], [2, 225]]);
    }
    this.body = this.line([[8, 90]]);
    this.hands = {
      left: this.line([
        [length.hand, hands.left[0]],
        [length.hand, hands.left[1]]
      ]),
      right: this.line([
        [length.hand, hands.right[0]],
        [length.hand, hands.right[1]]
      ])
    };
    this.legs = {
      left: this.line(
        this.body[this.body.length - 1],
        [[length.leg, legs.left[0]], [length.leg, legs.left[1]]]
      ),
      right: this.line(
        this.body[this.body.length - 1],
        [[length.leg, legs.right[0]], [length.leg, legs.right[1]]]
      )
    };

    this.lines = [
      this.head,
      this.body,
      this.hands.left,
      this.hands.right,
      this.legs.left,
      this.legs.right
    ];

    this.height = this.lines.reduce(function(max, line) {
      return line.reduce(function(max, point) {
        return Math.max(max, point.y);
      }, max);
    }, 0) - this.lines.reduce(function(min, line) {
      return line.reduce(function(min, point) {
        return Math.min(min, point.y);
      }, min);
    }, 0);
  };

  ManPath.prototype.line = function line(from, positions) {
    if (positions === undefined) {
      positions = from;
      from = { x: this.position.x, y: this.position.y };
    }

    var result = [from];

    positions.forEach(function(pos) {
      from = {
        x: from.x + pos[0] * Math.cos(pos[1] * Math.PI / 180),
        y: from.y + pos[0] * Math.sin(pos[1] * Math.PI / 180)
      };
      result.push(from);
    });

    return result;
  };

  ManPath.prototype.draw = function draw() {
    var offsetX = this.position.x,
        offsetY = this.position.y;

    ctx.save();
    ctx.beginPath();
    this.lines.forEach(function(line) {
      line.forEach(function(point, i) {
        if (i === 0) {
          ctx.moveTo(line[i].x + offsetX, line[i].y + offsetY);
        } else {
          ctx.lineTo(line[i].x + offsetX, line[i].y + offsetY);
        }
      });
    });
    ctx.stroke();
    ctx.restore();
  };

  function createManPaths(head, hands, legs) {
    var result = [];
    for (var i = 0; i < hands.left.length; i++) {
      result.push(new ManPath(head, {
        left: hands.left[i],
        right: hands.right[i]
      }, {
        left: legs.left[i],
        right: legs.right[i]
      }));
    }
    return result;
  }

  function Man() {
    this.standby = createManPaths('left', {
      left: [[117, 100]],
      right: [[63, 80]]
    }, {
      left: [[100, 95]],
      right: [[80, 85]]
    });
    this.walkLeft = createManPaths('left', {
      left: [[95, 155], [95, 125], [90, 90], [75, 75], [65, 65]],
      right: [[65, 65], [75, 75], [90, 90], [95, 125], [95, 150]]
    }, {
      left: [[105, 100], [97, 95], [90, 90], [86, 78], [83, 70]],
      right: [[86, 65], [96, 48], [106, 55], [116, 91], [110, 110]]
    });
    this.walkRight = createManPaths('right', {
      left: [[115, 115], [105, 105], [90, 90], [85, 55], [85, 30]],
      right: [[85, 30], [85, 55], [90, 90], [105, 105], [115, 115]]
    }, {
      left: [[94, 115], [84, 132], [74, 125], [64, 89], [70, 70]],
      right: [[75, 80], [83, 85], [90, 90], [94, 102], [97, 110]]
    });

    this.text = '';
    this.textTimeout = undefined;

    this.mode = undefined;
    this._active = undefined;
    this._current = undefined;
    this._index = 0;
    this.position = { x: 0, y: 0 };
    this.place = 'basement';
  };

  Man.prototype.activate = function activate(mode) {
    if (!this[mode]) return;

    this._active = this[mode];
    this.mode = mode;
    this._index = 0;
    this.tick();
    if (this === man) socket.emit('mode', mode);
    redraw();
  };

  Man.prototype.move = function move(pos) {
    if (pos) {
      if (this.position) {
        this.position.x = pos.x;
        this.position.y = pos.y;
      } else {
        this.position = pos;
      }
    }
    if (this === man) {
      socket.emit('move', { x: this.position.x, y: this.position.y });
    }
    redraw();
  };

  Man.prototype.add = function add(vector) {
    this.position.x = this.position.x + vector.x;
    this.position.y = this.position.y + vector.y;
    if (this === man) {
      socket.emit('move', { x: this.position.x, y: this.position.y });
    }
    redraw();
  };

  Man.prototype.say = function say(text) {
    this.text += text;
    if (this.text.length > 32) {
      this.text = this.text.slice(0, 32) + '...';
    }

    var self = this;
    clearTimeout(this.textTimeout);
    this.textTimeout = setTimeout(function() {
      self.stopSaying();
    }, 8500);

    if (this === man) socket.emit('say', text);
    redraw();
  };

  Man.prototype.backspaceSaying = function backspaceSaying() {
    this.text = this.text.slice(0, -1);
    clearTimeout(this.textTimeout);
    if (this === man) socket.emit('backspaceSaying');
    redraw();
  };

  Man.prototype.stopSaying = function stopSaying() {
    this.text = '';
    clearTimeout(this.textTimeout);
    if (this === man) socket.emit('stopSaying');
    redraw();
  };

  Man.prototype.tick = function tick() {
    if (!this.mode) this.activate('standby');

    if (this._active) {
      this._index = (this._index + 1) % this._active.length;
    }
    this._current = this._active[this._index];
  };

  Man.prototype.draw = function draw() {
    if (!this._current) return;
    var current = this._current;

    current.position.x = this.position.x;
    current.position.y = this.position.y - current.height;
    current.draw();

    if (this.text) {
      ctx.fillText(this.text, this.position.x, this.position.y - 40);
    }
  };

  var man = new Man(),
      ghosts = [],
      ghostsMap = {};

  man.move({ x: 40, y: 235 });

  var i = 0;
  setInterval(function() {
    if (i++ % 2 === 0) {
      man.tick();
      ghosts.forEach(function(ghost) {
        ghost.tick();
      });
    }

    if (man.place === 'basement') {
      if (man.position.x > 79) {
        if (man.position.y - 1.7 >= 123) {
          man.add({ x: 0, y: -1.7 });
          return;
        } else {
          man.place = 'lift';
          man.position.y = 123;
          man.move();
        }
      } else if (man.position.x <= 22 && man.mode === 'walkLeft') {
        return;
      }
    } else if (man.place === 'lift') {
      if (man.position.y <= 124) {
        if (man.position.x > 99) {
          man.place = 'roof';
        } else if (man.position.x <= 80 && man.mode === 'walkLeft') {
          return;
        }
      }
      if (man.position.y >= 209) {
        if (man.position.x < 75) {
          man.place = 'basement';
        } else if (man.position.x > 80 && man.mode === 'walkRight') {
          return;
        }
      }
    } else if (man.place === 'roof') {
      if (man.position.x <= 82) {
        if (man.position.y + 1.7 <= 235) {
          man.add({ x: 0, y: 1.7 });
          return;
        } else {
          man.place = 'lift';
          man.position.y = 235;
          man.move();
        }
      } else if (man.position.x >= 474 && man.mode === 'walkRight') {
        showInfo();
        return;
      }
    }

    if (man.mode === 'walkLeft') {
      man.add({ x: -0.75, y: 0 });
    } else if (man.mode === 'walkRight') {
      man.add({ x: 0.75, y: 0 });
    }
  }, 20);

  function redraw() {
    requestFrame(function() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      man.draw();
      ghosts.forEach(function(ghost) {
        ghost.draw();
      });
    }, canvas);
  };

  var shown = false;
  function showInfo() {
    if (shown) return;
    shown = true;

    var contacts = document.getElementById('contacts');
    contacts.className = 'visible';
    setTimeout(function() {
      contacts.className = 'visible full';
    }, 3);
  }

  // Controlling our guy

  var keyMap = {
    37: 'left',
    39: 'right'
  };

  window.addEventListener('keydown', function(e) {
    // Process backspace
    if (e.keyCode === 8) {
      e.preventDefault();
      man.backspaceSaying();
      return false;
    }

    var key = keyMap[e.keyCode];

    if (!key) return;

    if (man.mode !== 'standby') return;
    if (key === 'left') {
      man.activate('walkLeft');
    } else if (key === 'right') {
      man.activate('walkRight');
    }
  }, true);

  window.addEventListener('keyup', function(e) {
    var key = keyMap[e.keyCode];
    if (!key) return;

    if (key === 'left' && man.mode === 'walkLeft' ||
        key === 'right' && man.mode === 'walkRight') {
      man.activate('standby');
    }
  }, true);

  // Chat messaging
  window.addEventListener('keypress', function(e) {
    if (e.keyCode === 13) return man.stopSaying();
    var char = String.fromCharCode(e.charCode);
    if (!char || !e.charCode) return;

    man.say(char);
  }, true);

  // Displaying ghosts
  function onGuyEnter(guy) {
    // Ignore myself
    if (guy.id === socket.socket.sessionid) return;
    if (ghostsMap[guy.id]) return;
    ghosts.push(ghostsMap[guy.id] = new Man());
  };

  function onGuyLeave(guy) {
    // I was kicked - refresh page
    if (guy.id === socket.socket.sessionid) {
      location.reload(true);
      return;
    }

    if (!ghostsMap[guy.id]) return;
    var ghost = ghostsMap[guy.id],
        index = ghosts.indexOf(ghost);

    if (index === -1) return;

    delete ghostsMap[guy.id];

    if (index === -1) return;
    ghosts.splice(index, 1);
  };

  function onGuyMode(guy) {
    if (!ghostsMap[guy.id]) return;
    ghostsMap[guy.id].activate(guy.mode);
  };

  function onGuyMove(guy) {
    if (!ghostsMap[guy.id]) return;
    ghostsMap[guy.id].move(guy.position);
  };

  function onGuySay(guy) {
    if (!ghostsMap[guy.id]) return;
    ghostsMap[guy.id].say(guy.text);
  };

  function onGuyBackspaceSaying(guy) {
    if (!ghostsMap[guy.id]) return;
    ghostsMap[guy.id].backspaceSaying();
  };

  function onGuyStopSaying(guy) {
    if (!ghostsMap[guy.id]) return;
    ghostsMap[guy.id].stopSaying();
  };

  var serverVersion;
  socket.on('bulk', function(bulk) {
    bulk.forEach(function(msg) {
      var type = msg[0],
          data = msg[1];

      if (type === 'version') {
        if (serverVersion === undefined) {
          serverVersion = data;
        } else if (serverVersion != data) {
          // Update was deployed
          location.reload(true);
        }
      }
      if (type === 'enter') return onGuyEnter(data);
      if (type === 'leave') return onGuyLeave(data);
      if (type === 'mode') return onGuyMode(data);
      if (type === 'move') return onGuyMove(data);
      if (type === 'say') return onGuySay(data);
      if (type === 'backspaceSaying') return onGuyBackspaceSaying(data);
      if (type === 'stopSaying') return onGuyStopSaying(data);
    });
  });

  setInterval(function() {
    socket.emit('ping');
  }, 3000);
}();
