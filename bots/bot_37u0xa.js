// VoidFang - Aggressive Snake AI
// Strategy: A* food pathing, Flood Fill survival, aggressive cut-off, tail chasing fallback

const ws = new WebSocket(CONFIG.serverUrl);
const G = 30;

let lastDir = null;
let tick = 0;

const DIRS = [
  { x: 0, y: -1, name: 'up' },
  { x: 0, y: 1, name: 'down' },
  { x: -1, y: 0, name: 'left' },
  { x: 1, y: 0, name: 'right' }
];

function opp(a, b) {
  return a && b && a.x === -b.x && a.y === -b.y;
}

function inB(x, y) { return x >= 0 && x < G && y >= 0 && y < G; }
function md(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }

function mkGrid(state) {
  const g = Array.from({ length: G }, () => new Uint8Array(G));
  for (const p of state.players) {
    if (!p.body) continue;
    // Mark body except tail tip (tail will move next tick unless eating)
    for (let i = 0; i < p.body.length; i++) {
      const s = p.body[i];
      if (inB(s.x, s.y)) g[s.y][s.x] = 1;
    }
    if (p.head && inB(p.head.x, p.head.y)) g[p.head.y][p.head.x] = 1;
  }
  return g;
}

function enemyDanger(g, state, myId) {
  for (const p of state.players) {
    if (p.botId === myId || !p.head) continue;
    const myP = state.players.find(pp => pp.botId === myId);
    const myLen = myP && myP.body ? myP.body.length : 1;
    const theirLen = p.body ? p.body.length : 1;
    // Only dangerous if they're >= our length (head-on = we die if same or smaller)
    for (const d of DIRS) {
      const nx = p.head.x + d.x;
      const ny = p.head.y + d.y;
      if (inB(nx, ny) && g[ny][nx] === 0) {
        g[ny][nx] = theirLen >= myLen ? 3 : 2; // 3=lethal, 2=we'd win
      }
    }
  }
}

// BFS flood fill
function flood(g, sx, sy) {
  if (!inB(sx, sy) || g[sy][sx] === 1) return 0;
  const vis = Array.from({ length: G }, () => new Uint8Array(G));
  const q = [{ x: sx, y: sy }];
  vis[sy][sx] = 1;
  let c = 0;
  while (q.length) {
    const { x, y } = q.shift();
    c++;
    for (const d of DIRS) {
      const nx = x + d.x, ny = y + d.y;
      if (inB(nx, ny) && !vis[ny][nx] && g[ny][nx] !== 1) {
        vis[ny][nx] = 1;
        q.push({ x: nx, y: ny });
      }
    }
  }
  return c;
}

// A* shortest path length to target, returns distance or Infinity
function astar(g, sx, sy, tx, ty) {
  if (!inB(sx, sy) || !inB(tx, ty)) return Infinity;
  const key = (x, y) => y * G + x;
  const dist = new Map();
  // min-heap via sorted array (small grid, fine perf)
  const open = [{ x: sx, y: sy, g: 0, f: md({ x: sx, y: sy }, { x: tx, y: ty }) }];
  dist.set(key(sx, sy), 0);

  while (open.length) {
    open.sort((a, b) => a.f - b.f);
    const cur = open.shift();
    if (cur.x === tx && cur.y === ty) return cur.g;

    for (const d of DIRS) {
      const nx = cur.x + d.x, ny = cur.y + d.y;
      if (!inB(nx, ny) || g[ny][nx] === 1) continue;
      const ng = cur.g + 1;
      const k = key(nx, ny);
      if (!dist.has(k) || ng < dist.get(k)) {
        dist.set(k, ng);
        open.push({ x: nx, y: ny, g: ng, f: ng + md({ x: nx, y: ny }, { x: tx, y: ty }) });
      }
    }
  }
  return Infinity;
}

ws.on('open', () => {
  ws.send(JSON.stringify({
    type: 'join',
    name: 'VoidFang',
    botType: 'agent',
    botId: CONFIG.botId
  }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data);
  if (msg.type !== 'update') return;
  const { state } = msg;
  tick++;

  const me = state.players.find(p => p.botId === CONFIG.botId);
  if (!me || !me.head) return;

  const grid = mkGrid(state);
  enemyDanger(grid, state, CONFIG.botId);

  const myLen = me.body ? me.body.length : 1;
  const hx = me.head.x, hy = me.head.y;

  // Get my tail position (for tail-chasing fallback)
  const tail = me.body && me.body.length > 0 ? me.body[me.body.length - 1] : me.head;

  // Valid moves (not opposite, not wall/body)
  let moves = DIRS.filter(d => !opp(d, lastDir));

  let scored = moves.map(d => {
    const nx = hx + d.x, ny = hy + d.y;
    if (!inB(nx, ny) || grid[ny][nx] === 1) return { d, s: -Infinity };

    let s = 0;

    // === SURVIVAL: Flood fill ===
    const space = flood(grid, nx, ny);
    if (space < myLen) {
      s -= 10000; // trap, almost certainly death
    } else if (space < myLen * 1.5) {
      s -= 3000;
    } else if (space < myLen * 3) {
      s -= 500;
    }
    s += space * 1.5;

    // === ENEMY HEAD ZONES ===
    if (grid[ny][nx] === 3) {
      s -= 2000; // lethal head-on
    } else if (grid[ny][nx] === 2) {
      s += 100; // we'd win a head-on, slight bonus
    }

    // === FOOD TARGETING ===
    // Use A* to find real path distance to food
    let bestFoodScore = 0;
    for (const f of state.food) {
      const pathDist = astar(grid, nx, ny, f.x, f.y);
      if (pathDist < Infinity) {
        // Closer food = better, but diminishing returns when we're already long
        const foodValue = myLen < 10 ? 8 : 4; // eat aggressively when small
        bestFoodScore = Math.max(bestFoodScore, (G * 2 - pathDist) * foodValue);
      }
    }
    s += bestFoodScore;

    // === TAIL CHASING FALLBACK ===
    // When no food nearby, chase own tail to stay alive
    if (bestFoodScore === 0 && tail) {
      const tailDist = md({ x: nx, y: ny }, tail);
      s += (G - tailDist) * 2;
    }

    // === POSITIONAL ===
    // Slight center preference
    const cx = Math.abs(nx - G / 2), cy = Math.abs(ny - G / 2);
    s -= (cx + cy) * 0.3;

    // Wall penalty
    if (nx === 0 || nx === G - 1) s -= 30;
    if (ny === 0 || ny === G - 1) s -= 30;
    // Corner extra penalty
    if ((nx === 0 || nx === G - 1) && (ny === 0 || ny === G - 1)) s -= 100;

    // === AGGRESSION: cut off smaller snakes ===
    for (const p of state.players) {
      if (p.botId === CONFIG.botId || !p.head || !p.body) continue;
      if (p.body.length < myLen) {
        // If we're moving closer to a smaller snake's head, bonus
        const dBefore = md({ x: hx, y: hy }, p.head);
        const dAfter = md({ x: nx, y: ny }, p.head);
        if (dAfter < dBefore && dAfter <= 3) {
          s += (myLen - p.body.length) * 50; // more reward for much smaller prey
        }
      }
    }

    return { d, s };
  });

  scored.sort((a, b) => b.s - a.s);
  const best = scored[0];
  const move = best && best.s > -Infinity ? best.d : (moves[0] || DIRS[0]);

  lastDir = move;
  ws.send(JSON.stringify({ type: 'move', direction: move }));
});
