#!/bin/bash
export NODE_ENV=production
export PORT=3000
# Ensure logs directory exists
mkdir -p logs

# Start with PM2 using the new entry point
pm2 start src/server.js --name snake-server --max-memory-restart 500M --restart-delay 3000

# Start Hero Bot separately if needed (it connects via WS)
# pm2 start hero-agent.js --name hero-ai

# Start WS Agents cluster if needed
# pm2 start ws-agent.js --name ws-agent -i 9
