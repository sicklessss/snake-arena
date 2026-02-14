// OpenClaw Snake Bot v2 - Advanced: Flood Fill + Food Chase + Head Dodge
const ws = new WebSocket(CONFIG.serverUrl);
const GRID = 30;
const DIRS = [
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 }
];

let lastDir = null;
let stuckCount = 0;
let lastHead = null;

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
    name: 'OpenClaw',
    botType: 'agent',
    botId: CONFIG.botId
  }));
  console.log('OpenClaw bot joined!');
});

ws.on('message', (raw) => {
  const msg = JSON.parse(raw);
  if (msg.type !== 'update') return;

  const state = msg.state;
  const me = state.players.find(p => p.botId === CONFIG.botId);
  if (!me || !me.head) return;

  // Stuck detection
  if (lastHead && lastHead.x === me.head.x && lastHead.y === me.head.y) {
    stuckCount++;
  } else {
    stuckCount = 0;
  }
  lastHead = { x: me.head.x, y: me.head.y };

  const grid = buildGrid(state);
  const myLen = me.body ? me.body.length : 1;

  // Collect enemy heads for threat detection
  var enemyHeads = [];
  for (var i = 0; i < state.players.length; i++) {
    var p = state.players[i];
    if (!p.head || p.botId === CONFIG.botId) continue;
    enemyHeads.push({ x: p.head.x, y: p.head.y, len: p.body ? p.body.length : 1 });
  }

  // Evaluate each candidate direction
  var candidates = [];
  for (var di = 0; di < DIRS.length; di++) {
    var d = DIRS[di];
    if (isOpposite(d, lastDir)) continue;

    var nx = me.head.x + d.x;
    var ny = me.head.y + d.y;
    if (!inBounds(nx, ny) || grid[ny][nx] === 1) continue;

    var space = floodFill(grid, nx, ny);

    // Find nearest food
    var foodDist = 9999;
    var foods = state.food || [];
    for (var fi = 0; fi < foods.length; fi++) {
      var fd = dist({ x: nx, y: ny }, foods[fi]);
      if (fd < foodDist) foodDist = fd;
    }

    // Scoring system
    var score = 0;

    // 1) Space is king - avoid trapping ourselves
    if (space < myLen) {
      score -= 10000;
    } else if (space < myLen * 2) {
      score -= 2000;
    }
    score += space * 3;

    // 2) Food proximity
    if (foodDist < 9999) {
      score += (GRID * 2 - foodDist) * 2;
    }

    // 3) Enemy head avoidance
    for (var ei = 0; ei < enemyHeads.length; ei++) {
      var eh = enemyHeads[ei];
      var headDist = dist({ x: nx, y: ny }, eh);
      if (headDist <= 2 && eh.len >= myLen) {
        // Dangerous: enemy is same length or longer and nearby
        score -= (3 - headDist) * 3000;
      } else if (headDist <= 1 && eh.len < myLen) {
        // We're longer, slight aggression bonus
        score += 500;
      }
    }

    // 4) Center preference (avoid edges)
    var cx = Math.abs(nx - GRID / 2);
    var cy = Math.abs(ny - GRID / 2);
    score -= (cx + cy) * 0.5;

    // 5) Momentum bonus (smoother pathing)
    if (lastDir && d.x === lastDir.x && d.y === lastDir.y) {
      score += 10;
    }

    // 6) Edge penalty: strongly avoid being 1 cell from wall
    if (nx === 0 || nx === GRID - 1 || ny === 0 || ny === GRID - 1) {
      score -= 100;
    }

    candidates.push({ dir: d, space: space, foodDist: foodDist, score: score });
  }

  if (candidates.length === 0) {
    // Desperation: try any direction
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

  // If stuck, randomize
  if (stuckCount > 3) {
    var pick = candidates[Math.floor(Math.random() * candidates.length)];
    lastDir = pick.dir;
    ws.send(JSON.stringify({ type: 'move', direction: pick.dir }));
    return;
  }

  // Sort by score descending, pick best
  candidates.sort(function(a, b) { return b.score - a.score; });
  var best = candidates[0];

  lastDir = best.dir;
  ws.send(JSON.stringify({ type: 'move', direction: best.dir }));
});

ws.on('close', () => {});
ws.on('error', (err) => { console.error('WS error:', err); });
