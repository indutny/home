!function() {
  paper.setup('drawer');
  var socket = io.connect();

  var length = {
    hand: 4.5,
    leg: 6
  };

  function ManPath(head, hands, legs) {
    this.group = new paper.Group();
    this.group.visible = false;

    if (head === 'left') {
      this.head = this.line([[6, -90], [2, -45]]);
    } else {
      this.head = this.line([[6, -90], [2, 225]]);
    }
    this.body = this.line([[8, 90]]);
    this.hands = {
      left: this.line([
        [-length.hand, hands.left[0]],
        [-length.hand, hands.left[1]]
      ]),
      right: this.line([
        [-length.hand, hands.right[0]],
        [-length.hand, hands.right[1]]
      ])
    };
    this.legs = {
      left: this.line(
        this.body.lastSegment.point,
        [[length.leg, legs.left[0]], [length.leg, legs.left[1]]]
      ),
      right: this.line(
        this.body.lastSegment.point,
        [[length.leg, legs.right[0]], [length.leg, legs.right[1]]]
      )
    };

    this.group.addChildren([
      this.head,
      this.body,
      this.hands.left,
      this.hands.right,
      this.legs.left,
      this.legs.right
    ]);
  };

  ManPath.prototype.line = function line(from, positions) {
    if (positions === undefined) {
      positions = from;
      from = this.group.position;
    }

    var p = new paper.Path(),
        last = from;

    p.strokeColor = 'black';
    p.strokeWidth = 1.5;

    p.add(from);
    positions.forEach(function(pos) {
      p.add(from = from.add(new paper.Point({
        length: pos[0],
        angle: pos[1]
      })));
    });

    return p;
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

    this.message = new paper.PointText({ x: 0, y: 0 });
    this.message.fillColor = 'black';
    this.message.content = '';
    this.message.paragraphStyle.justification = 'center';
    this.message.visible = false;

    this.mode = undefined;
    this._active = undefined;
    this._current = undefined;
    this._index = 0;
    this.position = undefined;
    this._changed = false;
    this.place = 'basement';

    this.move(paper.view.center.add(-220, 36));
  };

  Man.prototype.activate = function activate(mode) {
    this._active = this[mode];
    this.mode = mode;
    this._index = 0;
    this.tick();
    this.draw();
    if (this === man) socket.emit('guy:mode', mode);
  };

  Man.prototype.remove = function remove() {
    if (this._current) this._current.group.remove();
    this.message.remove();
  };

  Man.prototype.move = function move(pos) {
    this.position = pos;
    this.message.position = this.position.add({ x: 0, y: -40 });
  };

  Man.prototype.add = function add(vector) {
    this._changed = true;
    this.position = this.position.add(vector);
    this.message.position = this.position.add({ x: 0, y: -40 });
    if (this === man) {
      socket.emit('guy:move', { x: this.position.x, y: this.position.y });
    }
  };

  Man.prototype.say = function say(text) {
    this.message.content += text;
    if (this.message.content.length > 32) {
      this.message.content = this.message.content.slice(0, 32) + '...';
    }
    this.message.visible = true;
    if (this === man) socket.emit('guy:say', text);
  };

  Man.prototype.backspaceSaying = function backspaceSaying() {
    this.message.content = this.message.content.slice(0, -1);
    if (this === man) socket.emit('guy:backspaceSaying');
  };

  Man.prototype.stopSaying = function stopSaying() {
    this.message.content = '';
    this.message.visible = false;
    if (this === man) socket.emit('guy:stopSaying');
  };

  Man.prototype.tick = function tick() {
    this._changed = true;
    if (!this.mode) this.activate('standby');

    this._index = (this._index + 1) % this._active.length;
    if (this._current) this._current.group.visible = false;
    this._current = this._active[this._index];
    this._current.group.visible = true;
  };

  Man.prototype.draw = function draw() {
    if (!this._changed) return;
    this._changed = false;

    if (!this._current) return;
    var current = this._current,
        group = current.group;

    group.position = this.position;
    group.position.y -= group.bounds.height;
  };

  var man = new Man(),
      ghosts = [],
      ghostsMap = {};

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
        if (man.position.y >= 124) {
          man.add(new paper.Point(0, -1.5));
          return;
        } else {
          man.place = 'lift';
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
        if (man.position.y <= 209) {
          man.add(new paper.Point(0, 1.5));
          return;
        } else {
          man.place = 'lift';
        }
      } else if (man.position.x >= 474 && man.mode === 'walkRight') {
        showInfo();
        return;
      }
    }

    if (man.mode === 'walkLeft') {
      man.add(new paper.Point(-0.75, 0));
    } else if (man.mode === 'walkRight') {
      man.add(new paper.Point(0.75, 0));
    }
  }, 20);

  paper.view.onFrame = function() {
    man.draw();
    ghosts.forEach(function(ghost) {
      ghost.draw();
    });
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
    if (!/[\w\s\.?!,&^%$#@<>(){}"':\\/;]/.test(char)) return;

    man.say(char);
    e.preventDefault();
  }, true);

  // Displaying ghosts
  socket.on('guy:enter', function(guy) {
    // Ignore myself
    if (guy.id === socket.socket.sessionid) return;
    ghosts.push(ghostsMap[guy.id] = new Man());
  });

  socket.on('guy:leave', function(guy) {
    if (!ghostsMap[guy.id]) return;
    var ghost = ghostsMap[guy.id],
        index = ghosts.indexOf(ghost);

    ghost.remove();
    delete ghostsMap[guy.id];

    if (index === -1) return;
    ghosts.splice(index, 1);
  });

  socket.on('guy:mode', function(guy) {
    if (!ghostsMap[guy.id]) return;
    ghostsMap[guy.id].activate(guy.mode);
  });

  socket.on('guy:move', function(guy) {
    if (!ghostsMap[guy.id]) return;
    ghostsMap[guy.id].move(new paper.Point(guy.position));
  });

  socket.on('guy:say', function(guy) {
    if (!ghostsMap[guy.id]) return;
    ghostsMap[guy.id].say(guy.text);
  });

  socket.on('guy:backspaceSaying', function(guy) {
    if (!ghostsMap[guy.id]) return;
    ghostsMap[guy.id].backspaceSaying();
  });

  socket.on('guy:stopSaying', function(guy) {
    if (!ghostsMap[guy.id]) return;
    ghostsMap[guy.id].stopSaying();
  });

  paper.view.draw();
}();
