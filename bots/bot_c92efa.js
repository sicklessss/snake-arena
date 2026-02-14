// Hunter Bot - Aggressive: hunts shorter snakes, eats food fast
const ws = new WebSocket(CONFIG.serverUrl);
const GRID = 30;
const DIRS = [
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 }
];

let lastDir = null;

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

ws.on('open', () => {
  ws.send(JSON.stringify({
    type: 'join',
    name: 'Predator',
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

  // Find prey (shorter snakes) and threats (longer/equal snakes)
  var prey = [];
  var threats = [];
  for (var i = 0; i < state.players.length; i++) {
    var p = state.players[i];
    if (!p.head || p.botId === CONFIG.botId) continue;
    var pLen = p.body ? p.body.length : 1;
    if (pLen < myLen) {
      prey.push({ x: p.head.x, y: p.head.y, len: pLen });
    } else {
      threats.push({ x: p.head.x, y: p.head.y, len: pLen });
    }
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
      score -= 10000;
    }
    score += space * 2;

    // AGGRESSIVE: Chase prey heads - try to cut them off
    for (var pi = 0; pi < prey.length; pi++) {
      var preyDist = dist({ x: nx, y: ny }, prey[pi]);
      if (preyDist <= 8) {
        // Big bonus for getting close to weaker snakes
        score += (10 - preyDist) * 400;
      }
    }

    // Avoid threats
    for (var ti = 0; ti < threats.length; ti++) {
      var threatDist = dist({ x: nx, y: ny }, threats[ti]);
      if (threatDist <= 3) {
        score -= (4 - threatDist) * 2000;
      }
    }

    // Food: prioritize heavily to grow fast and become the predator
    var foods = state.food || [];
    var minFood = 9999;
    for (var fi = 0; fi < foods.length; fi++) {
      var fd = dist({ x: nx, y: ny }, foods[fi]);
      if (fd < minFood) minFood = fd;
    }
    if (minFood < 9999) {
      score += (GRID * 2 - minFood) * 5; // Higher food weight than normal
    }

    // Light edge penalty
    if (nx === 0 || nx === GRID - 1 || ny === 0 || ny === GRID - 1) {
      score -= 50;
    }

    candidates.push({ dir: d, score: score });
  }

  if (candidates.length === 0) {
    // Desperation
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
