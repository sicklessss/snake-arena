#!/bin/bash

echo "🐍 Setting up Snake Arena VPS..."

# 1. Install Node.js & Git
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git

# 2. Install PM2 (Process Manager)
sudo npm install -g pm2

# 3. Setup Project (Assuming code is already pulled or manually created)
# In real scenario: git clone https://github.com/sicklessss/snake-arena.git
npm install

# 4. Start 5 Arenas
pm2 start ecosystem.config.js
pm2 save
pm2 startup

echo "✅ Servers are running on ports 3000-3004!"
echo "👉 Usage to spawn bots: node launch-bots.js <ArenaNum> <Count>"
