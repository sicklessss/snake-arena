// WallRider Bot - Patrols edges to control territory, cuts off escape routes
const ws = new WebSocket(CONFIG.serverUrl);
const GRID = 30;
const DIRS = [
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 }
];

let lastDir = null;
let phase = 'grow'; // 'grow' -> 'patrol'
let patrolTarget = null;

function isOpposite(a, b) {
  return a && b && a.x === -b.x && a.y === -b.y;
}

function inBounds(x, y) {
  return x >= 0 && x < GRID && y >= 0 && y < GRID;
}

function buildGrid(state) {
  const grid = Array.from({ length: GRID }, () => new Uint8Array(GRID));
  for (const p of state.players) {
    if (!p.body) continue;
    for (const seg of p.body) {
      if (inBounds(seg.x, seg.y)) grid[seg.y][seg.x] = 1;
    }
  }
  return grid;
}

function floodFill(grid, sx, sy) {
  if (!inBounds(sx, sy) || grid[sy][sx] === 1) return 0;
  const visited = Array.from({ length: GRID }, () => new Uint8Array(GRID));
  const queue = [{ x: sx, y: sy }];
  visited[sy][sx] = 1;
  let count = 0;
  while (queue.length > 0) {
    const cur = queue.shift();
    count++;
    for (const d of DIRS) {
      const nx = cur.x + d.x, ny = cur.y + d.y;
      if (inBounds(nx, ny) && !visited[ny][nx] && grid[ny][nx] !== 1) {
        visited[ny][nx] = 1;
        queue.push({ x: nx, y: ny });
      }
    }
  }
  return count;
}

function dist(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

// Generate patrol waypoints along inner ring (2 cells from wall)
var PATROL_POINTS = [
  { x: 3, y: 3 }, { x: 15, y: 3 }, { x: 26, y: 3 },
  { x: 26, y: 15 }, { x: 26, y: 26 },
  { x: 15, y: 26 }, { x: 3, y: 26 },
  { x: 3, y: 15 }
];
var patrolIdx = 0;

ws.on('open', () => {
  ws.send(JSON.stringify({
    type: 'join',
    name: 'WallRider',
    botType: 'agent',
    botId: CONFIG.botId
  }));
});

ws.on('message', (raw) => {
  const msg = JSON.parse(raw);
  if (msg.type !== 'update') return;

  const state = msg.state;
  const me = state.players.find(p => p.botId === CONFIG.botId);
  if (!me || !me.head) return;

  const grid = buildGrid(state);
  const myLen = me.body ? me.body.length : 1;

  // Phase switch: grow until length 8, then patrol
  if (myLen >= 8) {
    phase = 'patrol';
  } else {
    phase = 'grow';
  }

  // Get current patrol target
  var target = PATROL_POINTS[patrolIdx];
  if (phase === 'patrol' && dist(me.head, target) <= 2) {
    patrolIdx = (patrolIdx + 1) % PATROL_POINTS.length;
    target = PATROL_POINTS[patrolIdx];
  }

  // Enemy info
  var enemies = [];
  for (var i = 0; i < state.players.length; i++) {
    var p = state.players[i];
    if (!p.head || p.botId === CONFIG.botId) continue;
    enemies.push({ x: p.head.x, y: p.head.y, len: p.body ? p.body.length : 1 });
  }

  var candidates = [];
  for (var di = 0; di < DIRS.length; di++) {
    var d = DIRS[di];
    if (isOpposite(d, lastDir)) continue;

    var nx = me.head.x + d.x;
    var ny = me.head.y + d.y;
    if (!inBounds(nx, ny) || grid[ny][nx] === 1) continue;

    var space = floodFill(grid, nx, ny);
    var score = 0;

    // Space safety (always critical)
    if (space < myLen) {
      score -= 20000;
    } else if (space < myLen * 2) {
      score -= 3000;
    }
    score += space * 3;

    if (phase === 'grow') {
      // Growth phase: chase food aggressively
      var foods = state.food || [];
      var minFood = 9999;
      for (var fi = 0; fi < foods.length; fi++) {
        var fd = dist({ x: nx, y: ny }, foods[fi]);
        if (fd < minFood) minFood = fd;
      }
      if (minFood < 9999) {
        score += (GRID * 2 - minFood) * 6;
      }
    } else {
      // Patrol phase: move toward waypoints, creating a wall
      var targetDist = dist({ x: nx, y: ny }, target);
      score += (GRID * 2 - targetDist) * 4;

      // Still eat food if nearby
      var foods2 = state.food || [];
      var minFood2 = 9999;
      for (var fi2 = 0; fi2 < foods2.length; fi2++) {
        var fd2 = dist({ x: nx, y: ny }, foods2[fi2]);
        if (fd2 < minFood2) minFood2 = fd2;
      }
      if (minFood2 <= 4) {
        score += (5 - minFood2) * 200;
      }

      // Bonus for being on the inner ring (3-26 range)
      var onRing = (nx <= 4 || nx >= 25 || ny <= 4 || ny >= 25);
      if (onRing) {
        score += 100;
      }
    }

    // Enemy avoidance
    for (var ei = 0; ei < enemies.length; ei++) {
      var ed = dist({ x: nx, y: ny }, enemies[ei]);
      if (ed <= 2 && enemies[ei].len >= myLen) {
        score -= (3 - ed) * 3000;
      } else if (ed <= 1 && enemies[ei].len < myLen) {
        score += 400; // Bump into weaker ones
      }
    }

    // Hard wall penalty (don't actually touch the wall)
    if (nx === 0 || nx === GRID - 1 || ny === 0 || ny === GRID - 1) {
      score -= 300;
    }

    // Momentum
    if (lastDir && d.x === lastDir.x && d.y === lastDir.y) {
      score += 20;
    }

    candidates.push({ dir: d, score: score });
  }

  if (candidates.length === 0) {
    for (var ri = 0; ri < DIRS.length; ri++) {
      var rd = DIRS[ri];
      var rnx = me.head.x + rd.x;
      var rny = me.head.y + rd.y;
      if (inBounds(rnx, rny) && grid[rny][rnx] !== 1) {
        lastDir = rd;
        ws.send(JSON.stringify({ type: 'move', direction: rd }));
        return;
      }
    }
    return;
  }

  candidates.sort(function(a, b) { return b.score - a.score; });
  lastDir = candidates[0].dir;
  ws.send(JSON.stringify({ type: 'move', direction: candidates[0].dir }));
});

ws.on('close', () => {});
ws.on('error', (err) => { console.error('WS error:', err); });
