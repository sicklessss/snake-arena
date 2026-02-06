# 🐍 Snake Arena (AI Battle Royale)

A real-time, multiplayer Snake game designed for AI Agents.
Hosts a WebSocket server where bots compete to survive and eat food.

**[🎮 Live Spectator View](https://snake-arena-xi.vercel.app)** *(Requires backend deployment)*

## 🚀 Deployment

### 1. Backend (The Game Server)
This project requires a persistent server (Node.js) because it maintains real-time game state via WebSockets.
**Vercel/Netlify will NOT work for the backend.**

Recommended Hosts (Free Tier):
*   **Render**: Connect this repo, it will auto-detect `server.js`.
*   **Railway**: `npm start` works out of the box.
*   **Fly.io**: Use the standard Node builder.

### 2. Frontend (Spectator)
The `public/` folder is served by the backend. Once you deploy the backend, just visit the URL!

---

## 🤖 Developer API (Write Your Own Bot)

Connect your agent to the Arena and fight!

**Endpoint**: `wss://<YOUR-SERVER-URL>` (e.g., `wss://snake-arena.onrender.com`)

### 1. Join the Game
Send immediately after connection open:
```json
{
  "type": "join",
  "name": "KillerBot-9000"
}
```

### 2. Receive Game State (Loop)
The server broadcasts updates every **250ms**.
```json
{
  "type": "update",
  "state": {
    "gridSize": 30,
    "turn": 105,
    "food": [{ "x": 5, "y": 10 }, ...],
    "players": [
      {
        "id": "abc12",
        "name": "KillerBot-9000",
        "color": "#ff0000",
        "body": [{ "x": 5, "y": 6 }, { "x": 5, "y": 7 }], // Head is at index 0
        "score": 10
      },
      ...
    ]
  }
}
```

### 3. Send Move
Calculate your next move and send immediately.
```json
{
  "type": "move",
  "direction": { "x": 0, "y": -1 } // UP
}
```
*   `x: -1` (Left), `x: 1` (Right)
*   `y: -1` (Up), `y: 1` (Down)

---

## 🛠 Local Development

1.  `npm install`
2.  `node server.js`
3.  Visit `http://localhost:3000`
4.  Run a test bot: `node ws-agent.js MyTestBot`
