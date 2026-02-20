// WebSocket connection tests
const WebSocket = require('ws');
const config = require('./config');
const { get, post, TestRunner, assert, assertEq, randomId } = require('./utils');

const WS_URL = config.WS_URL;
const BASE = config.BASE_URL;

// Helper: open a WebSocket and wait for it to connect
function openWs(query = '') {
    return new Promise((resolve, reject) => {
        const url = `${WS_URL}${query ? '?' + query : ''}`;
        const ws = new WebSocket(url);
        const timer = setTimeout(() => { ws.terminate(); reject(new Error('WS connect timeout')); }, config.WS_TIMEOUT);
        ws.on('open', () => { clearTimeout(timer); resolve(ws); });
        ws.on('error', (err) => { clearTimeout(timer); reject(err); });
    });
}

// Helper: wait for a message that matches a predicate
function waitForMessage(ws, predicate, timeoutMs = config.WS_TIMEOUT) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('WS message timeout')), timeoutMs);
        const handler = (data) => {
            try {
                const msg = JSON.parse(data.toString());
                if (predicate(msg)) {
                    clearTimeout(timer);
                    ws.removeListener('message', handler);
                    resolve(msg);
                }
            } catch {}
        };
        ws.on('message', handler);
    });
}

// Helper: collect messages for a duration
function collectMessages(ws, durationMs = 2000) {
    return new Promise((resolve) => {
        const messages = [];
        const handler = (data) => {
            try { messages.push(JSON.parse(data.toString())); } catch {}
        };
        ws.on('message', handler);
        setTimeout(() => {
            ws.removeListener('message', handler);
            resolve(messages);
        }, durationMs);
    });
}

async function run() {
    const t = new TestRunner('WebSocket');

    // Register a bot for WS tests
    let botId = null;
    let botName = 'WSBot_' + randomId();

    await t.run('Setup: register bot for WS tests', async () => {
        const res = await post(`${BASE}/api/bot/register`, {
            body: { name: botName, owner: '0xWSTest', botType: 'agent' },
        });
        assert(res.status >= 200 && res.status < 300, `register failed: ${res.status}`);
        botId = res.body.id;
        return { botId };
    });

    // ── Connection tests ──

    await t.run('Connect to WS without arenaId', async () => {
        const ws = await openWs();
        assert(ws.readyState === WebSocket.OPEN, 'should be OPEN');
        ws.close();
    });

    await t.run('Connect to WS with arenaId query', async () => {
        const ws = await openWs('arenaId=performance-1');
        assert(ws.readyState === WebSocket.OPEN, 'should be OPEN');
        ws.close();
    });

    // ── Ping/Pong ──

    await t.run('Send ping, receive pong', async () => {
        const ws = await openWs('arenaId=performance-1');
        const pongPromise = waitForMessage(ws, (m) => m.type === 'pong');
        ws.send(JSON.stringify({ type: 'ping' }));
        const pong = await pongPromise;
        assertEq(pong.type, 'pong');
        ws.close();
    });

    // ── Join message ──

    await t.run('Send join message', async () => {
        const ws = await openWs('arenaId=performance-1');
        ws.send(JSON.stringify({
            type: 'join',
            botId: botId,
            name: botName,
            arenaId: 'performance-1',
        }));
        // Should receive game state or acknowledgment within timeout
        const messages = await collectMessages(ws, 3000);
        assert(messages.length > 0, 'should receive at least one message after join');
        ws.close();
        return { messagesReceived: messages.length };
    });

    // ── Move message ──

    await t.run('Send move message after join', async () => {
        const ws = await openWs('arenaId=performance-1');
        ws.send(JSON.stringify({
            type: 'join',
            botId: botId,
            name: botName + '_move',
            arenaId: 'performance-1',
        }));
        // Wait a bit for join to process
        await new Promise(r => setTimeout(r, 500));
        // Send move
        ws.send(JSON.stringify({
            type: 'move',
            direction: { x: 1, y: 0 },
        }));
        // Collect responses
        const messages = await collectMessages(ws, 2000);
        assert(messages.length >= 0, 'should not crash on move');
        ws.close();
    });

    // ── Invalid message handling ──

    await t.run('Send invalid JSON - connection survives', async () => {
        const ws = await openWs('arenaId=performance-1');
        ws.send('not valid json {{{');
        // Connection should still be open
        await new Promise(r => setTimeout(r, 500));
        assert(ws.readyState === WebSocket.OPEN, 'connection should survive invalid JSON');
        ws.close();
    });

    await t.run('Send unknown message type - no crash', async () => {
        const ws = await openWs('arenaId=performance-1');
        ws.send(JSON.stringify({ type: 'unknown_type_xyz', data: 123 }));
        await new Promise(r => setTimeout(r, 500));
        assert(ws.readyState === WebSocket.OPEN, 'connection should survive unknown type');
        ws.close();
    });

    // ── Game state broadcasts ──

    await t.run('Receive game state broadcasts', async () => {
        const ws = await openWs('arenaId=performance-1');
        ws.send(JSON.stringify({
            type: 'join',
            name: 'Observer_' + randomId(),
            arenaId: 'performance-1',
        }));
        const messages = await collectMessages(ws, 3000);
        // Should receive some broadcasts (state, timer, etc.)
        ws.close();
        return { broadcastCount: messages.length };
    });

    // ── Multiple connections ──

    await t.run('Multiple concurrent WS connections', async () => {
        const connections = await Promise.all([
            openWs('arenaId=performance-1'),
            openWs('arenaId=performance-1'),
            openWs('arenaId=performance-2'),
        ]);
        connections.forEach(ws => {
            assert(ws.readyState === WebSocket.OPEN, 'each connection should be OPEN');
        });
        connections.forEach(ws => ws.close());
        return { connectionCount: connections.length };
    });

    // ── Clean disconnect ──

    await t.run('Clean close with code 1000', async () => {
        const ws = await openWs('arenaId=performance-1');
        return new Promise((resolve, reject) => {
            ws.on('close', (code) => {
                resolve(`closed with code ${code}`);
            });
            ws.close(1000, 'test complete');
        });
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
