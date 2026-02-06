# Snake Arena - Development Log & Roadmap

**Last Updated:** 2026-02-06
**Status:** Alpha (Local Stable)
**Repository:** https://github.com/sicklessss/snake-arena

## 🏗 Architecture Overview

### 1. Game Server (`server.js`)
*   **Mode:** WebSocket Server (Port 3000 default).
*   **Tick Rate:** 125ms (High Speed).
*   **Physics:** 30x30 Grid. Server Authoritative.
*   **Features:**
    *   Collision detection (Walls & Bodies).
    *   Match History Persistence (`history.json`).
    *   Game Over State (3-minute cooldown / 180s).
    *   Multi-Arena Support (via `ecosystem.config.js`).

### 2. The Agents
*   **NPCs (`ws-agent.js`)**:
    *   Lightweight Node.js script.
    *   Logic: Greedy heuristic (Find closest food -> Avoid immediate death).
    *   Communication: WebSocket (Persistent connection).
*   **HERO (`hero-agent.js`)**:
    *   **Hybrid Intelligence**:
        *   *Autopilot*: Uses **A* (A-Star)** algorithm for advanced pathfinding.
        *   *Override*: Listens on HTTP Port 3001 for external commands (`POST /command`).

### 3. Frontend (`public/index.html`)
*   **Style**: Cyberpunk / Neon / Dark Mode.
*   **Tech**: HTML5 Canvas + Native WebSocket.
*   **Features**:
    *   Real-time rendering (interpolated).
    *   Leaderboard & Match History sidebar.
    *   "Winner" Overlay.

---

## 🚀 How to Resume

### Start Everything (One-Liner)
```bash
# 1. Start Server
node server.js &

# 2. Spawn 9 NPCs
for i in {1..9}; do node ws-agent.js "NPC-$i" & done

# 3. Spawn Hero
node hero-agent.js &
```

### Next Steps (Roadmap)

1.  **Deployment**:
    *   Rent VPS (RackNerd/Hetzner).
    *   Run `setup_vps.sh` to install Node/PM2.
    *   Launch 5 Arenas.

2.  **GameFi (Crypto Integration)**:
    *   **Blockchain**: Base (L2).
    *   **Contract**: Entry Fee (0.001 ETH), Betting Pool, Buyout Mechanics.
    *   **Integration**: Server listens to Contract Events -> Spawns bots only when paid.

3.  **UI Polish**:
    *   Add "Connect Wallet" button.
    *   Show betting odds on Frontend.
