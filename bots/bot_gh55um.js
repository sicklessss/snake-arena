// Survivor Bot - Defensive: maximize space, hug safe zones, outlast everyone
const ws = new WebSocket(CONFIG.serverUrl);
const GRID = 30;
const DIRS = [
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 }
];

let lastDir = null;
let turnCount = 0;

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

// Count how many of our own body segments are adjacent (tail-following heuristic)
function adjacentToOwnBody(me, x, y) {
  var count = 0;
  if (!me.body) return 0;
  for (var i = 1; i < me.body.length; i++) {
    var seg = me.body[i];
    if (Math.abs(seg.x - x) + Math.abs(seg.y - y) === 1) count++;
  }
  return count;
}

ws.on('open', () => {
  ws.send(JSON.stringify({
    type: 'join',
    name: 'Survivor',
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

  turnCount++;
  const grid = buildGrid(state);
  const myLen = me.body ? me.body.length : 1;

  // Count alive enemies
  var aliveEnemies = 0;
  var allHeads = [];
  for (var i = 0; i < state.players.length; i++) {
    var p = state.players[i];
    if (!p.head || p.botId === CONFIG.botId) continue;
    aliveEnemies++;
    allHeads.push({ x: p.head.x, y: p.head.y, len: p.body ? p.body.length : 1 });
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

    // SURVIVAL PRIORITY #1: Space is everything
    if (space < myLen) {
      score -= 50000; // Absolutely avoid death traps
    } else if (space < myLen * 3) {
      score -= 5000;
    }
    score += space * 10; // Very high weight on open space

    // SURVIVAL PRIORITY #2: Stay away from ALL other snakes
    for (var hi = 0; hi < allHeads.length; hi++) {
      var hd = dist({ x: nx, y: ny }, allHeads[hi]);
      if (hd <= 4) {
        // Run away from everyone regardless of size
        score -= (5 - hd) * 1500;
      }
    }

    // SURVIVAL PRIORITY #3: Follow own tail (creates safe loops)
    var adjBody = adjacentToOwnBody(me, nx, ny);
    score += adjBody * 200;

    // Food: only eat if it's safe and convenient (not worth risking death)
    var foods = state.food || [];
    var minFood = 9999;
    for (var fi = 0; fi < foods.length; fi++) {
      var fd = dist({ x: nx, y: ny }, foods[fi]);
      if (fd < minFood) minFood = fd;
    }
    // Only chase food if no enemies nearby
    var nearestEnemy = 9999;
    for (var ei = 0; ei < allHeads.length; ei++) {
      var ed = dist({ x: nx, y: ny }, allHeads[ei]);
      if (ed < nearestEnemy) nearestEnemy = ed;
    }
    if (minFood < 9999 && nearestEnemy > 6) {
      score += (GRID - minFood) * 2; // Mild food bonus only when safe
    }

    // SURVIVAL PRIORITY #4: Prefer center (more escape routes)
    var cx = Math.abs(nx - GRID / 2);
    var cy = Math.abs(ny - GRID / 2);
    score -= (cx + cy) * 2;

    // Heavily penalize walls
    if (nx === 0 || nx === GRID - 1 || ny === 0 || ny === GRID - 1) {
      score -= 500;
    }
    if (nx <= 1 || nx >= GRID - 2 || ny <= 1 || ny >= GRID - 2) {
      score -= 200;
    }

    // Momentum (avoid jittery movement)
    if (lastDir && d.x === lastDir.x && d.y === lastDir.y) {
      score += 30;
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
