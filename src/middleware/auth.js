const { ethers } = require('ethers');
const { ADMIN_KEY, BOT_UPLOAD_KEY } = require('../config/constants');

function getClientIp(req) {
    const xf = req.headers['x-forwarded-for'];
    if (xf) return xf.split(',')[0].trim();
    return req.socket.remoteAddress || 'unknown';
}

function rateLimit({ windowMs, max }) {
    const store = new Map();
    return (req, res, next) => {
        const ip = getClientIp(req);
        const now = Date.now();
        let entry = store.get(ip) || { count: 0, reset: now + windowMs };
        if (now > entry.reset) {
            entry = { count: 0, reset: now + windowMs };
        }
        entry.count += 1;
        store.set(ip, entry);
        if (entry.count > max) {
            return res.status(429).json({ error: 'rate_limited' });
        }
        next();
    };
}

function requireAdminKey(req, res, next) {
    if (!ADMIN_KEY) return next();
    const key = req.header('x-api-key');
    if (!key || key !== ADMIN_KEY) return res.status(401).json({ error: 'unauthorized' });
    next();
}

function requireUploadKey(req, res, next) {
    if (!BOT_UPLOAD_KEY) return next();
    const key = req.header('x-api-key');
    if (!key || key !== BOT_UPLOAD_KEY) return res.status(401).json({ error: 'unauthorized' });
    next();
}

// Signature Verification for Referrals
async function verifyWalletSignature(address, message, signature) {
    try {
        const recovered = ethers.verifyMessage(message, signature);
        return recovered.toLowerCase() === address.toLowerCase();
    } catch (e) {
        return false;
    }
}

function requireSignatureAuth(req, res, next) {
    const { address, signature, timestamp } = req.body || req.query || {};
    
    if (!address || !signature) {
        return res.status(401).json({ error: 'auth_required', message: 'Wallet signature required' });
    }
    
    // Check timestamp (prevent replay attacks) - 5 minute window
    const ts = parseInt(timestamp);
    if (!ts || Math.abs(Date.now() - ts) > 5 * 60 * 1000) {
        return res.status(401).json({ error: 'auth_expired', message: 'Signature expired' });
    }
    
    // Verify signature
    const message = `SnakeArena Referral Auth\nAddress: ${address}\nTimestamp: ${timestamp}`;
    // Note: Verify logic is async, but here we can use the synchronous verifyMessage helper wrapped nicely or use promise
    // But verifyMessage is sync in v6 usually.
    try {
        const recovered = ethers.verifyMessage(message, signature);
        if (recovered.toLowerCase() !== address.toLowerCase()) {
             throw new Error('Invalid signer');
        }
        req.authenticatedAddress = address.toLowerCase();
        next();
    } catch (e) {
        return res.status(401).json({ error: 'auth_invalid', message: 'Invalid signature' });
    }
}

module.exports = {
    getClientIp,
    rateLimit,
    requireAdminKey,
    requireUploadKey,
    requireSignatureAuth
};
