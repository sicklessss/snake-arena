// API endpoint tests - covers all HTTP routes
const config = require('./config');
const { get, post, httpRequest, TestRunner, assert, assertEq, assertOk, assertStatus, randomId } = require('./utils');

const BASE = config.BASE_URL;

async function run() {
    const t = new TestRunner('API Endpoints');

    // ── Shared state across tests ──
    let createdBotId = null;
    let createdBotName = null;

    // ═══════════════════════════════════════════
    //  BOT ROUTES  /api/bot
    // ═══════════════════════════════════════════

    // -- POST /api/bot/register --
    await t.run('POST /api/bot/register - create new bot', async () => {
        createdBotName = 'TestBot_' + randomId();
        const res = await post(`${BASE}/api/bot/register`, {
            body: { name: createdBotName, owner: '0xTestOwner', botType: 'agent' },
        });
        assertOk(res);
        assert(res.body.id, 'should return bot id');
        assert(res.body.name === createdBotName, 'name should match');
        createdBotId = res.body.id;
        return { botId: createdBotId, name: createdBotName };
    });

    await t.run('POST /api/bot/register - duplicate name rejected', async () => {
        const res = await post(`${BASE}/api/bot/register`, {
            body: { name: createdBotName, owner: '0xOther' },
        });
        assertStatus(res, 400);
        assertEq(res.body.error, 'name_taken');
    });

    // -- GET /api/bot/:botId --
    await t.run('GET /api/bot/:botId - get bot by id', async () => {
        const res = await get(`${BASE}/api/bot/${createdBotId}`);
        assertOk(res);
        assertEq(res.body.id, createdBotId);
        assertEq(res.body.name, createdBotName);
    });

    await t.run('GET /api/bot/:botId - 404 for missing bot', async () => {
        const res = await get(`${BASE}/api/bot/bot_nonexistent_999`);
        assertStatus(res, 404);
    });

    // -- GET /api/bot/lookup --
    await t.run('GET /api/bot/lookup - find by name', async () => {
        const res = await get(`${BASE}/api/bot/lookup?name=${encodeURIComponent(createdBotName)}`);
        assertOk(res);
        assertEq(res.body.botId, createdBotId);
        assert(typeof res.body.credits === 'number', 'credits should be number');
    });

    await t.run('GET /api/bot/lookup - missing name param', async () => {
        const res = await get(`${BASE}/api/bot/lookup`);
        assertStatus(res, 400);
    });

    await t.run('GET /api/bot/lookup - 404 for unknown name', async () => {
        const res = await get(`${BASE}/api/bot/lookup?name=NoSuchBot_${Date.now()}`);
        assertStatus(res, 404);
    });

    // -- GET /api/bot/by-name/:name --
    await t.run('GET /api/bot/by-name/:name - get full bot', async () => {
        const res = await get(`${BASE}/api/bot/by-name/${encodeURIComponent(createdBotName)}`);
        assertOk(res);
        assert(res.body.ok === true, 'should have ok:true');
        assertEq(res.body.name, createdBotName);
    });

    await t.run('GET /api/bot/by-name/:name - 404 for unknown', async () => {
        const res = await get(`${BASE}/api/bot/by-name/NoBot_${Date.now()}`);
        assertStatus(res, 404);
    });

    // -- GET /api/bot/:botId/credits --
    await t.run('GET /api/bot/:botId/credits - get credits', async () => {
        const res = await get(`${BASE}/api/bot/${createdBotId}/credits`);
        assertOk(res);
        assert(typeof res.body.credits === 'number', 'credits should be number');
    });

    // -- POST /api/bot/register-unlimited --
    await t.run('POST /api/bot/register-unlimited - mark unlimited', async () => {
        const res = await post(`${BASE}/api/bot/register-unlimited`, {
            body: { botId: createdBotId, txHash: '0xfake_tx_hash_test' },
        });
        assertOk(res);
        assert(res.body.ok === true);
    });

    await t.run('POST /api/bot/register-unlimited - missing botId', async () => {
        const res = await post(`${BASE}/api/bot/register-unlimited`, { body: {} });
        assertStatus(res, 400);
    });

    await t.run('POST /api/bot/register-unlimited - unknown bot', async () => {
        const res = await post(`${BASE}/api/bot/register-unlimited`, {
            body: { botId: 'bot_nonexistent_999' },
        });
        assertStatus(res, 404);
    });

    // -- POST /api/bot/upload --
    await t.run('POST /api/bot/upload - upload script for existing bot', async () => {
        const script = `// test bot\nfunction onTick(state) { return { x: 1, y: 0 }; }`;
        const res = await httpRequest('POST', `${BASE}/api/bot/upload?botId=${createdBotId}&name=${encodeURIComponent(createdBotName)}&owner=0xtestowner`, {
            body: script,
            headers: { 'Content-Type': 'text/javascript' },
        });
        assertOk(res);
        assert(res.body.ok === true);
        assertEq(res.body.botId, createdBotId);
    });

    await t.run('POST /api/bot/upload - create new bot via upload', async () => {
        const newName = 'UploadBot_' + randomId();
        const script = `// new bot\nfunction onTick(state) { return { x: 0, y: 1 }; }`;
        const res = await httpRequest('POST', `${BASE}/api/bot/upload?name=${encodeURIComponent(newName)}&owner=0xuploader`, {
            body: script,
            headers: { 'Content-Type': 'text/javascript' },
        });
        assertOk(res);
        assert(res.body.ok === true);
        assert(res.body.botId, 'should return new botId');
        return { newBotId: res.body.botId };
    });

    await t.run('POST /api/bot/upload - security violation rejected', async () => {
        const evilScript = `const fs = require('fs'); fs.readFileSync('/etc/passwd');`;
        const res = await httpRequest('POST', `${BASE}/api/bot/upload?name=EvilBot_${Date.now()}`, {
            body: evilScript,
            headers: { 'Content-Type': 'text/javascript' },
        });
        assertStatus(res, 400);
        assertEq(res.body.error, 'security_violation');
    });

    await t.run('POST /api/bot/upload - empty body rejected', async () => {
        const res = await httpRequest('POST', `${BASE}/api/bot/upload?name=EmptyBot`, {
            body: '',
            headers: { 'Content-Type': 'text/javascript' },
        });
        assertStatus(res, 400);
    });

    // -- POST /api/bot/claim --
    await t.run('POST /api/bot/claim - missing params', async () => {
        const res = await post(`${BASE}/api/bot/claim`, { body: {} });
        assertStatus(res, 400);
    });

    await t.run('POST /api/bot/claim - 404 unknown bot', async () => {
        const res = await post(`${BASE}/api/bot/claim`, {
            body: { name: 'NoSuchBot_' + Date.now(), address: '0xabc' },
        });
        assertStatus(res, 404);
    });

    // -- GET /api/bot/user/bots --
    await t.run('GET /api/bot/user/bots - list by address', async () => {
        const res = await get(`${BASE}/api/bot/user/bots?address=0xtestowner`);
        assertOk(res);
        assert(res.body.ok === true);
        assert(Array.isArray(res.body.bots), 'bots should be array');
        assert(typeof res.body.count === 'number', 'count should be number');
    });

    await t.run('GET /api/bot/user/bots - missing address', async () => {
        const res = await get(`${BASE}/api/bot/user/bots`);
        assertStatus(res, 400);
    });

    // -- GET /api/bot/fee/registration --
    await t.run('GET /api/bot/fee/registration - get fee', async () => {
        const res = await get(`${BASE}/api/bot/fee/registration`);
        // May return 200 or 503 depending on contract init
        assert(res.status === 200 || res.status === 503, `expected 200 or 503, got ${res.status}`);
        if (res.status === 200) {
            assert(res.body.fee !== undefined, 'should have fee');
            assert(res.body.feeWei !== undefined, 'should have feeWei');
        }
    });

    // -- GET /api/bot/onchain/:botId --
    await t.run('GET /api/bot/onchain/:botId - on-chain info', async () => {
        const res = await get(`${BASE}/api/bot/onchain/${createdBotId}`);
        assert(res.status === 200 || res.status === 500 || res.status === 503,
            `expected 200/500/503, got ${res.status}`);
        if (res.status === 200) {
            assert(res.body.botId !== undefined, 'should have botId');
        }
    });

    // -- GET /api/bot/nft/:botId --
    await t.run('GET /api/bot/nft/:botId - NFT info', async () => {
        const res = await get(`${BASE}/api/bot/nft/${createdBotId}`);
        assert(res.status === 200 || res.status === 500 || res.status === 503,
            `expected 200/500/503, got ${res.status}`);
        if (res.status === 200) {
            assert(typeof res.body.hasNFT === 'boolean', 'hasNFT should be boolean');
        }
    });

    // -- GET /api/bot/rewards/:botId --
    await t.run('GET /api/bot/rewards/:botId - reward info', async () => {
        const res = await get(`${BASE}/api/bot/rewards/${createdBotId}`);
        assert(res.status === 200 || res.status === 500 || res.status === 503,
            `expected 200/500/503, got ${res.status}`);
        if (res.status === 200) {
            assert(res.body.pendingRewards !== undefined, 'should have pendingRewards');
        }
    });

    // ═══════════════════════════════════════════
    //  ARENA ROUTES  /api/arena
    // ═══════════════════════════════════════════

    // -- GET /api/arena/status --
    await t.run('GET /api/arena/status - room status', async () => {
        const res = await get(`${BASE}/api/arena/status`);
        assertOk(res);
        assert(Array.isArray(res.body.performance), 'performance should be array');
        assert(Array.isArray(res.body.competitive), 'competitive should be array');
        if (res.body.performance.length > 0) {
            const r = res.body.performance[0];
            assert(r.id !== undefined, 'room should have id');
            assert(typeof r.players === 'number', 'players should be number');
            assert(r.gameState !== undefined, 'room should have gameState');
        }
        return { performanceRooms: res.body.performance.length, competitiveRooms: res.body.competitive.length };
    });

    // -- POST /api/arena/join --
    await t.run('POST /api/arena/join - join performance', async () => {
        const res = await post(`${BASE}/api/arena/join`, {
            body: { botId: createdBotId, arenaType: 'performance' },
        });
        // May be 200 or 409 if full
        assert(res.status === 200 || res.status === 409, `expected 200 or 409, got ${res.status}`);
        if (res.status === 200) {
            assert(res.body.arenaId, 'should have arenaId');
            assert(res.body.wsUrl, 'should have wsUrl');
        }
    });

    await t.run('POST /api/arena/join - 404 for unknown bot', async () => {
        const res = await post(`${BASE}/api/arena/join`, {
            body: { botId: 'bot_nonexistent', arenaType: 'performance' },
        });
        assertStatus(res, 404);
    });

    // -- POST /api/arena/kick --
    await t.run('POST /api/arena/kick - requires admin key', async () => {
        const res = await post(`${BASE}/api/arena/kick`, {
            body: { arenaId: 'performance-1', targetBotId: 'someone' },
        });
        // Should fail without admin key (401 or 403)
        assert(res.status === 401 || res.status === 403, `expected 401/403 without key, got ${res.status}`);
    });

    await t.run('POST /api/arena/kick - admin key accepted', async () => {
        const res = await post(`${BASE}/api/arena/kick`, {
            body: { arenaId: 'performance-1', targetBotId: 'nonexistent' },
            headers: { 'x-api-key': config.ADMIN_KEY },
        });
        // Either 404 (target not found) or 200 -- just not 401/403
        assert(res.status !== 401 && res.status !== 403, 'admin key should be accepted');
    });

    // -- GET /api/arena/competitive/status --
    await t.run('GET /api/arena/competitive/status', async () => {
        const res = await get(`${BASE}/api/arena/competitive/status`);
        assert(res.status === 200 || res.status === 404, `expected 200/404, got ${res.status}`);
        if (res.status === 200) {
            assert(typeof res.body.matchNumber === 'number', 'matchNumber should be number');
            assert(res.body.gameState, 'gameState should exist');
            assert(typeof res.body.playerCount === 'number', 'playerCount should be number');
        }
    });

    // -- GET /api/arena/competitive/registered --
    await t.run('GET /api/arena/competitive/registered', async () => {
        const res = await get(`${BASE}/api/arena/competitive/registered`);
        assertOk(res);
        assert(Array.isArray(res.body), 'should be array');
        if (res.body.length > 0) {
            assert(res.body[0].botId, 'should have botId');
            assert(res.body[0].name, 'should have name');
        }
    });

    // -- POST /api/arena/competitive/enter --
    await t.run('POST /api/arena/competitive/enter - missing params', async () => {
        const res = await post(`${BASE}/api/arena/competitive/enter`, { body: {} });
        assertStatus(res, 400);
    });

    await t.run('POST /api/arena/competitive/enter - unknown bot', async () => {
        const res = await post(`${BASE}/api/arena/competitive/enter`, {
            body: { botId: 'bot_nonexistent', matchNumber: 999999 },
        });
        assertStatus(res, 404);
    });

    await t.run('POST /api/arena/competitive/enter - valid entry', async () => {
        // Need the current match number first
        const statusRes = await get(`${BASE}/api/arena/competitive/status`);
        if (statusRes.status !== 200) return 'skipped - no competitive room';
        const matchNum = statusRes.body.matchNumber + 1; // future match
        const res = await post(`${BASE}/api/arena/competitive/enter`, {
            body: { botId: createdBotId, matchNumber: matchNum, txHash: '0xtest_tx' },
        });
        // May get 200 or 404 depending on bot type requirements
        assert(res.status === 200 || res.status === 404, `expected 200/404, got ${res.status}`);
    });

    // -- Leaderboards --
    await t.run('GET /api/arena/leaderboard/global', async () => {
        const res = await get(`${BASE}/api/arena/leaderboard/global`);
        assertOk(res);
        assert(Array.isArray(res.body), 'should be array');
        if (res.body.length > 0) {
            assert(res.body[0].name, 'entry should have name');
            assert(typeof res.body[0].wins === 'number', 'entry should have wins');
        }
    });

    await t.run('GET /api/arena/leaderboard/performance', async () => {
        const res = await get(`${BASE}/api/arena/leaderboard/performance`);
        assertOk(res);
        assert(Array.isArray(res.body), 'should be array');
    });

    await t.run('GET /api/arena/leaderboard/competitive', async () => {
        const res = await get(`${BASE}/api/arena/leaderboard/competitive`);
        assertOk(res);
        assert(Array.isArray(res.body), 'should be array');
    });

    await t.run('GET /api/arena/leaderboard/arena/:arenaId', async () => {
        const res = await get(`${BASE}/api/arena/leaderboard/arena/performance-1`);
        assertOk(res);
        assert(Array.isArray(res.body), 'should be array');
    });

    // -- Replays --
    await t.run('GET /api/arena/replays', async () => {
        const res = await get(`${BASE}/api/arena/replays`);
        assertOk(res);
        assert(Array.isArray(res.body), 'should be array');
        if (res.body.length > 0) {
            const r = res.body[0];
            assert(r.matchId !== undefined, 'should have matchId');
            assert(r.arenaId, 'should have arenaId');
        }
        return { replayCount: res.body.length };
    });

    await t.run('GET /api/arena/replay/:matchId - 404 for missing', async () => {
        const res = await get(`${BASE}/api/arena/replay/999999`);
        assertStatus(res, 404);
    });

    await t.run('GET /api/arena/replay/:matchId - valid replay', async () => {
        const listRes = await get(`${BASE}/api/arena/replays`);
        if (!listRes.body.length) return 'skipped - no replays available';
        const matchId = listRes.body[0].matchId;
        const res = await get(`${BASE}/api/arena/replay/${matchId}`);
        assertOk(res);
        assert(res.body.matchId !== undefined, 'replay should have matchId');
        return { matchId };
    });

    // ═══════════════════════════════════════════
    //  BETTING ROUTES  /api/bet
    // ═══════════════════════════════════════════

    // -- POST /api/bet/place --
    await t.run('POST /api/bet/place - missing params', async () => {
        const res = await post(`${BASE}/api/bet/place`, { body: {} });
        assertStatus(res, 400);
    });

    await t.run('POST /api/bet/place - place a bet', async () => {
        const res = await post(`${BASE}/api/bet/place`, {
            body: {
                matchId: 'test_match_' + Date.now(),
                botId: createdBotId,
                amount: 100,
                bettor: '0xTestBettor',
                txHash: '0xbet_tx_test',
            },
        });
        assertOk(res);
        assert(res.body.ok === true, 'should have ok:true');
        assert(typeof res.body.total === 'number', 'should have total');
    });

    // -- GET /api/bet/status --
    await t.run('GET /api/bet/status - no matchId returns empty', async () => {
        const res = await get(`${BASE}/api/bet/status`);
        assertOk(res);
        assertEq(res.body.total, 0);
        assert(Array.isArray(res.body.bets), 'bets should be array');
    });

    await t.run('GET /api/bet/status - with matchId', async () => {
        const res = await get(`${BASE}/api/bet/status?matchId=nonexistent_match`);
        assertOk(res);
        assertEq(res.body.total, 0);
    });

    // ═══════════════════════════════════════════
    //  REFERRAL ROUTES  /api/referral
    // ═══════════════════════════════════════════

    // -- GET /api/referral/info/:address --
    await t.run('GET /api/referral/info/:address - public info', async () => {
        const addr = '0x0000000000000000000000000000000000000001';
        const res = await get(`${BASE}/api/referral/info/${addr}`);
        assertOk(res);
        assert(res.body.ok === true);
        assertEq(res.body.address, addr);
        assert(typeof res.body.inviteeCount === 'number', 'inviteeCount should be number');
    });

    // -- POST /api/referral/record --
    await t.run('POST /api/referral/record - missing params', async () => {
        const res = await post(`${BASE}/api/referral/record`, { body: {} });
        assertStatus(res, 400);
    });

    await t.run('POST /api/referral/record - invalid tx', async () => {
        const res = await post(`${BASE}/api/referral/record`, {
            body: {
                user: '0xuser',
                inviter: '0xinviter',
                txHash: '0xinvalid_tx',
                amount: 0.01,
            },
        });
        assertStatus(res, 400);
    });

    // -- POST /api/referral/my-stats --
    await t.run('POST /api/referral/my-stats - requires signature', async () => {
        const res = await post(`${BASE}/api/referral/my-stats`, {
            body: { address: '0xtest', signature: 'bad', timestamp: Date.now() },
        });
        // Should fail auth (401/403 or 400)
        assert(res.status >= 400, 'should reject without valid signature');
    });

    // -- GET /api/referral/admin/referral-stats --
    await t.run('GET /api/referral/admin/referral-stats - requires admin key', async () => {
        const res = await get(`${BASE}/api/referral/admin/referral-stats`);
        assert(res.status === 401 || res.status === 403, 'should reject without admin key');
    });

    await t.run('GET /api/referral/admin/referral-stats - with admin key', async () => {
        const res = await get(`${BASE}/api/referral/admin/referral-stats`, {
            headers: { 'x-api-key': config.ADMIN_KEY },
        });
        assertOk(res);
        assert(res.body.ok === true);
    });

    // ═══════════════════════════════════════════
    //  EDGE CASES & MISC
    // ═══════════════════════════════════════════

    await t.run('GET / - static root serves index', async () => {
        const res = await get(`${BASE}/`);
        assertOk(res);
    });

    await t.run('GET /nonexistent-route - 404 or static fallback', async () => {
        const res = await get(`${BASE}/api/nonexistent_route_xyz`);
        assert(res.status === 404 || res.status === 200, `expected 404 or 200, got ${res.status}`);
    });

    return t.summary();
}

module.exports = { run };

if (require.main === module) {
    run().then(s => {
        console.log(`\n${s.suite}: ${s.pass}/${s.total} passed (${s.fail} failed) in ${s.elapsed}ms`);
        process.exit(s.fail > 0 ? 1 : 0);
    });
}
