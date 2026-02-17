const betPools = {}; // matchId -> { total: 0, bets: [] }

function placeBet(matchId, botId, amount, bettor, txHash) {
    if (!betPools[matchId]) {
        betPools[matchId] = { total: 0, bets: [] };
    }
    
    const bet = { 
        botId, 
        amount: Number(amount),
        bettor: bettor || 'anonymous',
        txHash: txHash || null,
        timestamp: Date.now()
    };
    
    betPools[matchId].bets.push(bet);
    betPools[matchId].total += bet.amount;
    
    return { ok: true, total: betPools[matchId].total, bet };
}

function getBetStatus(matchId) {
    return betPools[matchId] || { total: 0, bets: [] };
}

module.exports = {
    placeBet,
    getBetStatus,
    betPools
};
