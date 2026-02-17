const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { getBot, updateBot } = require('../services/bot-registry');
const { rooms, performanceRooms, competitiveRooms, assignRoomForJoin } = require('../services/room-manager');
const { requireAdminKey } = require('../middleware/auth');
const { getHistory } = require('../services/history');
const log = require('../utils/logger');

// Status
router.get('/status', (req, res) => {
    res.json({
        performance: performanceRooms.map(r => ({
            id: r.id,
            players: Object.keys(r.players).length,
            waiting: Object.keys(r.waitingRoom).length,
            gameState: r.gameState,
        })),
        competitive: competitiveRooms.map(r => ({
            id: r.id,
            matchNumber: r.matchNumber,
            players: Object.keys(r.players).length,
            waiting: Object.keys(r.waitingRoom).length,
            gameState: r.gameState,
            obstacleCount: r.obstacles ? r.obstacles.filter(o => o.solid).length : 0,
        })),
    });
});

// Join
router.post('/join', (req, res) => {
    const { botId, arenaType } = req.body || {};
    const bot = getBot(botId);
    if (!bot) return res.status(404).json({ error: 'bot_not_found' });

    if ((arenaType || 'performance') === 'performance' && bot.botType === 'agent') {
        if (bot.credits <= 0) return res.status(402).json({ error: 'topup_required' });
    }

    const room = assignRoomForJoin({ name: bot.name, botType: bot.botType, botPrice: bot.price || 0, arenaType: arenaType || 'performance' });
    if (!room) return res.status(409).json({ error: 'full_or_payment_required' });

    res.json({
        arenaId: room.id,
        wsUrl: 'ws://' + req.headers.host + '?arenaId=' + room.id
    });
});

// Kick (Admin)
router.post('/kick', requireAdminKey, (req, res) => {
    const { arenaId, targetBotId } = req.body || {};
    const room = rooms.get(arenaId);
    if (!room) return res.status(404).json({ error: 'arena_not_found' });
    const victimId = Object.keys(room.waitingRoom).find(id => room.waitingRoom[id].id === targetBotId || room.waitingRoom[id].name === targetBotId);
    if (!victimId) return res.status(404).json({ error: 'target_not_found_or_in_game' });
    delete room.waitingRoom[victimId];
    res.json({ ok: true });
});

// Competitive Status
router.get('/competitive/status', (req, res) => {
    const room = rooms.get('competitive-1');
    if (!room) return res.status(404).json({ error: 'no_competitive_room' });
    
    const currentMatchId = room.currentMatchId || 0;
    res.json({
        matchNumber: currentMatchId,
        internalMatchNumber: room.matchNumber,
        matchId: currentMatchId,
        gameState: room.gameState,
        timeLeft: room.timerSeconds,
        matchTimeLeft: room.matchTimeLeft,
        obstacleCount: room.obstacles.filter(o => o.solid).length,
        playerCount: Object.keys(room.players).length + Object.keys(room.waitingRoom).length,
        maxPlayers: room.maxPlayers,
    });
});

// Competitive Registered Agents
router.get('/competitive/registered', (req, res) => {
    const agents = Object.entries(require('../services/bot-registry').getAllBots())
        .filter(([_, meta]) => meta.botType === 'agent' && meta.scriptPath)
        .map(([id, meta]) => ({
            botId: id,
            name: meta.name,
            credits: meta.credits,
        }));
    res.json(agents);
});

// Competitive Enter (Paid)
router.post('/competitive/enter', (req, res) => {
    const { botId, matchNumber, txHash } = req.body || {};
    
    if (!botId || !matchNumber) {
        return res.status(400).json({ error: 'missing_params', message: 'botId and matchNumber required' });
    }
    
    const meta = getBot(botId);
    if (!meta || meta.botType !== 'agent') {
        return res.status(404).json({ error: 'bot_not_found', message: 'Bot must be a registered agent' });
    }
    
    const room = rooms.get('competitive-1');
    if (!room) return res.status(500).json({ error: 'no_competitive_room' });
    
    if (matchNumber < room.matchNumber) {
        return res.status(400).json({ error: 'invalid_match', message: 'Match number must be >= current match #' + room.matchNumber });
    }
    
    if (!room.paidEntries[matchNumber]) room.paidEntries[matchNumber] = [];
    room.paidEntries[matchNumber].push(botId);
    
    // Cleanup old paid entries
    for (const mn of Object.keys(room.paidEntries)) {
        if (parseInt(mn) < room.matchNumber) delete room.paidEntries[mn];
    }
    
    log.important(`[Competitive] Paid entry registered: ${meta.name} (${botId}) match #${matchNumber} tx: ${txHash || 'none'}`);
    res.json({ ok: true, matchNumber, botId, message: `Entry confirmed for match #${matchNumber}` });
});

// Leaderboards
function getLeaderboard(filterFn) {
    const history = getHistory();
    const counts = {};
    history.forEach(h => {
        if (filterFn && !filterFn(h)) return;
        if (h.winner === 'No Winner' && h.score === 0) return;
        const key = h.winner || 'No Winner';
        counts[key] = (counts[key] || 0) + 1;
    });
    return Object.entries(counts).map(([name, wins]) => ({ name, wins })).sort((a,b)=>b.wins-a.wins);
}

router.get('/leaderboard/global', (req, res) => {
    res.json(getLeaderboard());
});

router.get('/leaderboard/performance', (req, res) => {
    res.json(getLeaderboard(h => h.arenaId && h.arenaId.startsWith('performance')));
});

router.get('/leaderboard/competitive', (req, res) => {
    res.json(getLeaderboard(h => h.arenaId && h.arenaId.startsWith('competitive')));
});

router.get('/leaderboard/arena/:arenaId', (req, res) => {
    res.json(getLeaderboard(h => h.arenaId === req.params.arenaId));
});

router.post('/admin/reset-leaderboard', requireAdminKey, (req, res) => {
    const historyFile = path.resolve(__dirname, '../../history.json');
    fs.writeFileSync(historyFile, "[]");
    // Reload history in service not strictly exposed, but next write will overwrite or read will reload?
    // We should expose a resetHistory function in service.
    // For now, hacky but works if service re-reads or if we restart.
    // Ideally: require('../services/history').resetHistory();
    log.important("[Admin] Leaderboard reset");
    res.json({ ok: true, message: "Leaderboard reset (restart may be needed to clear memory cache completely)" });
});

// Replays
router.get('/replays', (req, res) => {
    const replayDir = path.resolve(__dirname, '../../replays');
    if (!fs.existsSync(replayDir)) return res.json([]);
    const files = fs.readdirSync(replayDir)
        .filter(f => f.endsWith('.json'))
        .map(f => {
            try {
                const data = JSON.parse(fs.readFileSync(path.join(replayDir, f)));
                return {
                    matchId: data.matchId,
                    arenaId: data.arenaId,
                    timestamp: data.timestamp,
                    winner: data.winner,
                    winnerScore: data.winnerScore,
                    totalFrames: data.totalFrames, // Might be undefined in old formats
                };
            } catch (e) { return null; }
        })
        .filter(Boolean)
        .sort((a, b) => b.matchId - a.matchId)
        .slice(0, 50);
    res.json(files);
});

router.get('/replay/:matchId', (req, res) => {
    const replayPath = path.resolve(__dirname, '../../replays', `match-${req.params.matchId}.json`);
    if (!fs.existsSync(replayPath)) return res.status(404).json({ error: 'Replay not found' });
    const replay = JSON.parse(fs.readFileSync(replayPath));
    res.json(replay);
});

module.exports = router;
