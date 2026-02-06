const { spawn } = require('child_process');

// Usage: node launch-bots.js <ArenaNumber> <BotCount>
// Example: node launch-bots.js 1 20  (Launches 20 bots connecting to port 3000)

const arenaNum = parseInt(process.argv[2]) || 1;
const botCount = parseInt(process.argv[3]) || 5;
const basePort = 3000;
const targetPort = basePort + (arenaNum - 1);
const targetUrl = `ws://localhost:${targetPort}`;

console.log(`🚀 Launching ${botCount} bots into Arena ${arenaNum} (${targetUrl})...`);

for (let i = 1; i <= botCount; i++) {
    const botName = `A${arenaNum}-Bot-${i}`;
    const botProcess = spawn('node', ['ws-agent.js', botName, targetUrl], {
        stdio: 'ignore', // Run in background, don't spam console
        detached: true
    });
    botProcess.unref(); // Allow parent to exit
}

console.log(`✅ Done! ${botCount} bots are running in the background.`);
