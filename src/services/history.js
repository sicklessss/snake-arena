const fs = require('fs');
const path = require('path');

const HISTORY_FILE = path.resolve('history.json');
let matchHistory = [];
let matchNumber = 0;

function loadHistory() {
    if (fs.existsSync(HISTORY_FILE)) {
        try {
            matchHistory = JSON.parse(fs.readFileSync(HISTORY_FILE));
            if (matchHistory.length > 0 && matchHistory[0].matchId) {
                matchNumber = matchHistory[0].matchId + 1;
            }
        } catch (e) {
            console.error('Failed to load history:', e);
        }
    }
}

function nextMatchId() {
    const id = matchNumber;
    matchNumber++;
    return id;
}

function saveHistory(arenaId, winnerName, score) {
    matchHistory.unshift({
        matchId: nextMatchId(),
        arenaId,
        timestamp: new Date().toISOString(),
        winner: winnerName,
        score: score,
    });
    // Keep all history (no limit)
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(matchHistory));
    } catch (e) {
        console.error('Failed to save history:', e);
    }
}

function getHistory() {
    return matchHistory;
}

// Initialize
loadHistory();

module.exports = {
    saveHistory,
    getHistory,
    nextMatchId // Exported just in case, but saveHistory handles increment
};
