const fs = require('fs');
const path = require('path');
const log = require('../utils/logger');

const REFERRAL_DATA_FILE = path.join(__dirname, '../../data', 'referrals.json');
const REFERRAL_RATE_L1 = 0.05; // 5%
const REFERRAL_RATE_L2 = 0.02; // 2%

let referralData = { users: {}, rewards: {} };

function loadReferralData() {
    try {
        if (fs.existsSync(REFERRAL_DATA_FILE)) {
            referralData = JSON.parse(fs.readFileSync(REFERRAL_DATA_FILE, 'utf8'));
            log.info(`[Referral] Loaded ${Object.keys(referralData.users).length} referral records`);
        }
    } catch (e) {
        log.error('[Referral] Failed to load data:', e.message);
    }
}

function saveReferralData() {
    try {
        const dataDir = path.dirname(REFERRAL_DATA_FILE);
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(REFERRAL_DATA_FILE, JSON.stringify(referralData, null, 2));
    } catch (e) {
        log.error('[Referral] Failed to save data:', e.message);
    }
}

loadReferralData();

function recordReferral(user, inviter, txHash, amount) {
    if (!user || !inviter || user.toLowerCase() === inviter.toLowerCase()) return false;
    
    const userLower = user.toLowerCase();
    const inviterLower = inviter.toLowerCase();
    
    if (referralData.users[userLower]) return false;
    
    referralData.users[userLower] = {
        inviter: inviterLower,
        registeredAt: Date.now(),
        txHash: txHash,
        amount: amount
    };
    
    if (!referralData.rewards[inviterLower]) {
        referralData.rewards[inviterLower] = { l1: 0, l2: 0, history: [] };
    }
    
    const l1Reward = amount * REFERRAL_RATE_L1;
    referralData.rewards[inviterLower].l1 += l1Reward;
    referralData.rewards[inviterLower].history.push({
        type: 'l1',
        from: userLower,
        amount: amount,
        reward: l1Reward,
        timestamp: Date.now(),
        txHash: txHash
    });
    
    const l2Inviter = referralData.users[inviterLower]?.inviter;
    if (l2Inviter) {
        if (!referralData.rewards[l2Inviter]) {
            referralData.rewards[l2Inviter] = { l1: 0, l2: 0, history: [] };
        }
        const l2Reward = amount * REFERRAL_RATE_L2;
        referralData.rewards[l2Inviter].l2 += l2Reward;
        referralData.rewards[l2Inviter].history.push({
            type: 'l2',
            from: userLower,
            via: inviterLower,
            amount: amount,
            reward: l2Reward,
            timestamp: Date.now(),
            txHash: txHash
        });
    }
    
    saveReferralData();
    log.important(`[Referral] ${userLower} invited by ${inviterLower}, L1: ${l1Reward} ETH`);
    return true;
}

function getReferralStats(address) {
    const addrLower = address.toLowerCase();
    const user = referralData.users[addrLower];
    const rewards = referralData.rewards[addrLower] || { l1: 0, l2: 0, history: [] };
    
    const invitees = Object.entries(referralData.users)
        .filter(([_, data]) => data.inviter === addrLower)
        .map(([addr, data]) => ({ address: addr, registeredAt: data.registeredAt }));
    
    return {
        hasInviter: !!user,
        inviter: user?.inviter || null,
        registeredAt: user?.registeredAt || null,
        invitees: invitees,
        inviteeCount: invitees.length,
        rewards: {
            l1: rewards.l1,
            l2: rewards.l2,
            total: rewards.l1 + rewards.l2
        },
        history: rewards.history
    };
}

module.exports = {
    recordReferral,
    getReferralStats
};
