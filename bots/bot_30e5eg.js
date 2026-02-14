// Assassin Bot - Cut off enemies by predicting their next move
const ws = new WebSocket(CONFIG.serverUrl);
const GRID = 30;
const DIRS = [
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 }
];

let lastDir = null;
let prevEnemyHeads = new Map();

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

// Predict where an enemy head will be next tick based on velocity
function predictNext(botId, head) {
  var prev = prevEnemyHeads.get(botId);
  if (!prev) return null;
  var dx = head.x - prev.x;
  var dy = head.y - prev.y;
  if (dx === 0 && dy === 0) return null;
  var px = head.x + dx;
  var py = head.y + dy;
  if (inBounds(px, py)) return { x: px, y: py };
  return null;
}

ws.on('open', () => {
  ws.send(JSON.stringify({
    type: 'join',
    name: 'Assassin',
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

  // Gather enemy info with predictions
  var enemies = [];
  for (var i = 0; i < state.players.length; i++) {
    var p = state.players[i];
    if (!p.head || p.botId === CONFIG.botId) continue;
    var pLen = p.body ? p.body.length : 1;
    var predicted = predictNext(p.botId, p.head);
    enemies.push({ head: p.head, len: pLen, predicted: predicted, botId: p.botId });
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

    // Space safety
    if (space < myLen) {
      score -= 20000;
    } else if (space < myLen * 2) {
      score -= 3000;
    }
    score += space * 3;

    // ASSASSIN MECHANIC: intercept predicted enemy positions
    for (var ei = 0; ei < enemies.length; ei++) {
      var e = enemies[ei];
      var headDist = dist({ x: nx, y: ny }, e.head);

      if (e.len < myLen) {
        // We can kill them - move toward their predicted position
        if (e.predicted) {
          var predDist = dist({ x: nx, y: ny }, e.predicted);
          if (predDist <= 5) {
            score += (6 - predDist) * 600;
          }
        }
        if (headDist <= 6) {
          score += (7 - headDist) * 300;
        }
      } else {
        // They can kill us - avoid their predicted path
        if (headDist <= 3) {
          score -= (4 - headDist) * 2500;
        }
        if (e.predicted) {
          var predDist2 = dist({ x: nx, y: ny }, e.predicted);
          if (predDist2 <= 2) {
            score -= (3 - predDist2) * 2000;
          }
        }
      }
    }

    // Food
    var foods = state.food || [];
    var minFood = 9999;
    for (var fi = 0; fi < foods.length; fi++) {
      var fd = dist({ x: nx, y: ny }, foods[fi]);
      if (fd < minFood) minFood = fd;
    }
    if (minFood < 9999) {
      score += (GRID * 2 - minFood) * 3;
    }

    // Edge avoidance
    if (nx <= 1 || nx >= GRID - 2 || ny <= 1 || ny >= GRID - 2) {
      score -= 150;
    }

    // Momentum
    if (lastDir && d.x === lastDir.x && d.y === lastDir.y) {
      score += 15;
    }

    candidates.push({ dir: d, score: score });
  }

  // Save current enemy heads for next tick prediction
  for (var si = 0; si < state.players.length; si++) {
    var sp = state.players[si];
    if (sp.head && sp.botId !== CONFIG.botId) {
      prevEnemyHeads.set(sp.botId, { x: sp.head.x, y: sp.head.y });
    }
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
