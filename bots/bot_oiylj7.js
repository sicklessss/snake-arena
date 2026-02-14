// GuardianFang - Balanced AI with strong survival and strategic offense
// Features: Flood Fill for space, A* for food, active head-on avoidance,
//             smaller snake predation, tail-chasing fallback.

const ws = new WebSocket(CONFIG.serverUrl);
const G = 30; // Grid size

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
  const g = Array.from({ length: G }, () => new Uint8Array(G)); // 0: empty, 1: body/wall, 2: risky enemy head area, 3: lethal enemy head area
  for (const p of state.players) {
    if (!p.body) continue;
    // Mark all body parts of all players as blocked
    for (const seg of p.body) {
      if (inB(seg.x, seg.y)) g[seg.y][seg.x] = 1;
    }
    // Ensure head is marked too
    if (p.head && inB(p.head.x, p.head.y)) g[p.head.y][p.head.x] = 1;
  }
  return g;
}

function markEnemyHeadDanger(grid, state, myId) {
  const me = state.players.find(p => p.botId === myId);
  const myLen = me && me.body ? me.body.length : 1;

  for (const p of state.players) {
    if (p.botId === myId || !p.head) continue;
    const theirLen = p.body ? p.body.length : 1;

    for (const d of DIRS) {
      const nx = p.head.x + d.x;
      const ny = p.head.y + d.y;
      if (inB(nx, ny)) {
        if (grid[ny][nx] === 0) { // Only mark if currently empty
          if (theirLen >= myLen) {
            grid[ny][nx] = 3; // Lethal for us if they move here (we would die)
          } else {
            grid[ny][nx] = 2; // Risky, we might win if they move here
          }
        }
      }
    }
  }
}

// BFS Flood Fill to count reachable safe cells
function floodFill(grid, sx, sy) {
  if (!inB(sx, sy) || grid[sy][sx] === 1) return 0; // Start is blocked or out of bounds
  const visited = Array.from({ length: G }, () => new Uint8Array(G));
  const queue = [{ x: sx, y: sy }];
  visited[sy][sx] = 1;
  let count = 0;
  while (queue.length > 0) {
    const { x, y } = queue.shift();
    count++;
    for (const d of DIRS) {
      const nx = x + d.x, ny = y + d.y;
      if (inB(nx, ny) && !visited[ny][nx] && grid[ny][nx] !== 1) { // Allow moving into danger zones (2, 3) but not bodies (1)
        visited[ny][nx] = 1;
        queue.push({ x: nx, y: ny });
      }
    }
  }
  return count;
}

// A* pathfinding to find shortest path distance to target
function astar(grid, sx, sy, tx, ty) {
  if (!inB(sx, sy) || !inB(tx, ty)) return Infinity;

  const key = (x, y) => y * G + x;
  const distMap = new Map();
  // Use Array as a min-heap (simple for small grids)
  const openSet = [{ x: sx, y: sy, g: 0, f: md({ x: sx, y: sy }, { x: tx, y: ty }) }];
  distMap.set(key(sx, sy), 0);

  while (openSet.length) {
    openSet.sort((a, b) => a.f - b.f); // Sort by F score
    const current = openSet.shift();

    if (current.x === tx && current.y === ty) return current.g; // Reached target

    for (const d of DIRS) {
      const nx = current.x + d.x;
      const ny = current.y + d.y;

      if (!inB(nx, ny) || grid[ny][nx] === 1) continue; // Blocked or out of bounds

      const tentativeG = current.g + 1;
      const k = key(nx, ny);

      if (!distMap.has(k) || tentativeG < distMap.get(k)) {
        distMap.set(k, tentativeG);
        const newF = tentativeG + md({ x: nx, y: ny }, { x: tx, y: ty });
        openSet.push({ x: nx, y: ny, g: tentativeG, f: newF });
      }
    }
  }
  return Infinity; // Target not reachable
}

ws.on('open', () => {
  ws.send(JSON.stringify({
    type: 'join',
    name: 'GuardianFang',
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
  markEnemyHeadDanger(grid, state, CONFIG.botId);

  const myLen = me.body ? me.body.length : 1;
  const hx = me.head.x, hy = me.head.y;

  // Determine possible moves: not opposite direction, not blocked
  let moves = DIRS.filter(d => !opp(d, lastDir));

  let scoredMoves = moves.map(d => {
    const nx = hx + d.x, ny = hy + d.y;
    if (!inB(nx, ny) || grid[ny][nx] === 1) return { d, score: -Infinity }; // Dead end or wall

    let score = 0;

    // 1. Survival Score (Flood Fill)
    // How much space can we reach from the next cell?
    const reachableSpace = floodFill(grid, nx, ny);
    if (reachableSpace < myLen) {
      score -= 10000; // Severe penalty if trapped
    } else if (reachableSpace < myLen * 1.5) {
      score -= 3000; // Significant penalty if space is tight
    } else if (reachableSpace < myLen * 2.5) {
      score -= 500;  // Slight penalty if space is somewhat limited
    }
    score += reachableSpace * 2; // Reward open space

    // 2. Enemy Threat Score
    // Penalize moving into enemy head danger zones
    if (grid[ny][nx] === 3) { // Lethal zone
      score -= 20000;
    } else if (grid[ny][nx] === 2) { // Risky zone (we might win)
      score -= 500; // Slight penalty, as it's still a risk
    }

    // 3. Food Score (A* path distance)
    let bestFoodDist = Infinity;
    let closestFood = null;
    for (const f of state.food) {
      const distToFood = astar(grid, nx, ny, f.x, f.y);
      if (distToFood < bestFoodDist) {
        bestFoodDist = distToFood;
        closestFood = f;
      }
    }

    if (bestFoodDist < Infinity) {
      // Reward moving towards food, especially when small
      const foodValue = myLen < 10 ? 10 : 5; // More aggressive when small
      score += (G * 2 - bestFoodDist) * foodValue;
    }

    // 4. Tail Chasing Fallback (if no food is appealing)
    const tail = me.body && me.body.length > 0 ? me.body[me.body.length - 1] : me.head;
    if (bestFoodDist === Infinity && tail) { // Only if no food can be reached
      const tailDist = md({ x: nx, y: ny }, tail);
      score += (G - tailDist) * 2; // Stay alive by moving
    }

    // 5. Positional Score
    const centerDist = Math.abs(nx - G / 2) + Math.abs(ny - G / 2);
    score -= centerDist * 0.5; // Slightly prefer center

    // Penalize hugging walls or being in corners
    if (nx === 0 || nx === G - 1) score -= 50;
    if (ny === 0 || ny === G - 1) score -= 50;
    if ((nx === 0 || nx === G - 1) && (ny === 0 || ny === G - 1)) score -= 150;

    // 6. Aggression Score (Prey on smaller snakes)
    for (const p of state.players) {
      if (p.botId === CONFIG.botId || !p.head || !p.body) continue;
      if (p.body.length < myLen) {
        const distToPreyHead = md({x: nx, y: ny}, p.head);
        // If moving closer to a smaller snake's head (within 3 steps)
        if (distToPreyHead < 4) {
          score += (myLen - p.body.length) * 60; // Reward for hunting smaller prey
        }
      }
    }
    return { d, score };
  });

  scoredMoves.sort((a, b) => b.score - a.score); // Sort descending by score

  let bestMove = DIRS[0]; // Default to first direction
  if (scoredMoves.length > 0 && scoredMoves[0].score > -Infinity) {
    bestMove = scoredMoves[0].d;
  } else if (moves.length > 0) {
    bestMove = moves[0]; // Fallback to any valid non-opposite move
  }

  lastDir = bestMove;
  ws.send(JSON.stringify({ type: 'move', direction: bestMove }));
});
