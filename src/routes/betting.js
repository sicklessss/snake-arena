const express = require('express');
const router = express.Router();
const { placeBet, getBetStatus } = require('../services/betting');

router.post('/place', (req, res) => {
    const { matchId, botId, amount, bettor, txHash } = req.body || {};
    if (!matchId || !botId || !amount) {
        return res.status(400).json({ error: 'Missing matchId, botId, amount' });
    }
    const result = placeBet(matchId, botId, amount, bettor, txHash);
    res.json(result);
});

router.get('/status', (req, res) => {
    const { matchId } = req.query;
    if (!matchId) return res.json({ total: 0, bets: [] });
    res.json(getBetStatus(matchId));
});

module.exports = router;
