#!/bin/bash
cd /root/snake-arena
pkill -9 -f node
sleep 2
nohup node server.js > server.log 2>&1 &
sleep 3
nohup node hero-agent.js > hero.log 2>&1 &
sleep 2
node launch-bots.js 1 9
echo "All started!"
