const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const ivm = require('isolated-vm');
const WebSocket = require('ws');

// --- Worker Setup ---
const { scriptPath, botId, serverUrl } = workerData;

const debugLog = (msg) => {
    if (parentPort) parentPort.postMessage({ type: 'debug', message: msg });
};

debugLog(`Worker starting. scriptPath: ${scriptPath}, serverUrl: ${serverUrl}`);

if (!fs.existsSync(scriptPath)) {
    debugLog(`Error: Script not found: ${scriptPath}`);
    process.exit(1);
}

const userScriptContent = fs.readFileSync(scriptPath, 'utf8');

// --- isolated-vm Sandbox ---
const MAX_WS = 3;        // max WebSocket connections per bot
const MAX_TIMERS = 100;   // max timers per bot
const MEMORY_MB = 16;     // memory limit per isolate
const CALLBACK_TIMEOUT = 5000; // ms timeout for each callback dispatch

const wsConnections = new Map();
let wsIdCounter = 0;
const hostTimers = new Map();
let timerIdCounter = 0;

let isolate, context;

try {
    debugLog('Creating isolated-vm sandbox');

    isolate = new ivm.Isolate({ memoryLimit: MEMORY_MB });
    context = isolate.createContextSync();
    const jail = context.global;
    jail.setSync('global', jail.derefInto());

    // --- Inject host functions ---

    // Console logging
    jail.setSync('$_log', new ivm.Reference((level, msg) => {
        parentPort.postMessage({
            type: level === 'error' ? 'error' : 'log',
            message: String(msg).slice(0, 500),
        });
    }));

    // WebSocket create — returns wsId or -1 on error
    jail.setSync('$_wsCreate', new ivm.Reference((url) => {
        if (wsConnections.size >= MAX_WS) return -2; // too many connections
        try {
            const parsed = new URL(url);
            if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) return -1;
        } catch { return -1; }

        const id = wsIdCounter++;
        const ws = new WebSocket(url);
        wsConnections.set(id, ws);

        ws.on('open', () => {
            try {
                context.evalSync(
                    `(function(){var h=global.__ws[${id}];if(h&&h.oo){h.rs=1;h.oo();}})()`,
                    { timeout: CALLBACK_TIMEOUT }
                );
            } catch (e) { debugLog(`WS open callback error: ${e.message}`); }
        });

        ws.on('message', (data) => {
            const str = data.toString();
            try {
                context.evalSync(
                    `(function(){var h=global.__ws[${id}];if(h&&h.om)h.om({data:${JSON.stringify(str)}});})()`,
                    { timeout: CALLBACK_TIMEOUT }
                );
            } catch (e) { debugLog(`WS message callback error: ${e.message}`); }
        });

        ws.on('close', (code) => {
            try {
                context.evalSync(
                    `(function(){var h=global.__ws[${id}];if(h){h.rs=3;if(h.oc)h.oc({code:${code||1000}});}delete global.__ws[${id}];})()`,
                    { timeout: CALLBACK_TIMEOUT }
                );
            } catch (e) { debugLog(`WS close callback error: ${e.message}`); }
            wsConnections.delete(id);
        });

        ws.on('error', (err) => {
            try {
                context.evalSync(
                    `(function(){var h=global.__ws[${id}];if(h&&h.oe)h.oe({message:'error'});})()`,
                    { timeout: CALLBACK_TIMEOUT }
                );
            } catch (e) { debugLog(`WS error callback error: ${e.message}`); }
        });

        return id;
    }));

    // WebSocket send
    jail.setSync('$_wsSend', new ivm.Reference((id, data) => {
        const ws = wsConnections.get(id);
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(String(data).slice(0, 4096));
    }));

    // WebSocket close
    jail.setSync('$_wsClose', new ivm.Reference((id) => {
        const ws = wsConnections.get(id);
        if (ws) ws.close();
    }));

    // setTimeout — host manages real timers, dispatches into isolate
    jail.setSync('$_setTimeout', new ivm.Reference((id, delay) => {
        if (hostTimers.size >= MAX_TIMERS) return;
        const ms = Math.max(0, Math.min(Number(delay) || 0, 60000));
        const timer = global.setTimeout(() => {
            hostTimers.delete(id);
            try {
                context.evalSync(
                    `(function(){var fn=global.__tm[${id}];if(fn){delete global.__tm[${id}];fn();}})()`,
                    { timeout: CALLBACK_TIMEOUT }
                );
            } catch (e) { debugLog(`Timer ${id} callback error: ${e.message}`); }
        }, ms);
        hostTimers.set(id, timer);
    }));

    // setInterval
    jail.setSync('$_setInterval', new ivm.Reference((id, delay) => {
        if (hostTimers.size >= MAX_TIMERS) return;
        const ms = Math.max(50, Math.min(Number(delay) || 100, 60000));
        const timer = global.setInterval(() => {
            try {
                context.evalSync(
                    `(function(){var fn=global.__tm[${id}];if(fn)fn();})()`,
                    { timeout: CALLBACK_TIMEOUT }
                );
            } catch (e) {
                debugLog(`Interval ${id} callback error: ${e.message}`);
                clearInterval(timer);
                hostTimers.delete(id);
            }
        }, ms);
        hostTimers.set(id, timer);
    }));

    // clearTimeout / clearInterval
    jail.setSync('$_clearTimer', new ivm.Reference((id) => {
        const timer = hostTimers.get(id);
        if (timer) {
            clearTimeout(timer);
            clearInterval(timer);
            hostTimers.delete(id);
        }
    }));

    // --- Wrapper code injected before user script ---
    const wrapperCode = `
// --- WebSocket handlers registry ---
global.__ws = {};
// --- Timer registry ---
global.__tm = {};
var __tmId = 0;

// --- WebSocket class ---
function WebSocket(url) {
    var id = $_wsCreate.applySync(undefined, [url]);
    if (id === -1) throw new Error('Security Error: WebSocket connections only allowed to localhost');
    if (id === -2) throw new Error('Too many WebSocket connections');
    this._id = id;
    this.readyState = 0;
    this.CONNECTING = 0; this.OPEN = 1; this.CLOSING = 2; this.CLOSED = 3;
    global.__ws[id] = { rs: 0, self: this };
}
WebSocket.CONNECTING = 0;
WebSocket.OPEN = 1;
WebSocket.CLOSING = 2;
WebSocket.CLOSED = 3;
WebSocket.prototype.send = function(data) {
    $_wsSend.applySync(undefined, [this._id, String(data)]);
};
WebSocket.prototype.close = function() {
    $_wsClose.applySync(undefined, [this._id]);
};
// Node.js-style .on(event, handler) — used by bot code
WebSocket.prototype.on = function(event, fn) {
    var map = {open:'oo', message:'om', close:'oc', error:'oe'};
    var short = map[event];
    if (!short) return this;
    var h = global.__ws[this._id];
    if (!h) return this;
    var self = this;
    if (short === 'oo') {
        h[short] = function() { self.readyState = 1; fn.call(self); };
    } else if (short === 'oc') {
        h[short] = function(evt) { self.readyState = 3; fn.call(self, evt); };
    } else if (short === 'om') {
        // Node ws: onmessage passes raw data, not {data:...}
        h[short] = function(evt) { fn.call(self, evt.data); };
    } else {
        h[short] = function(evt) { fn.call(self, evt); };
    }
    return this;
};
// Also support browser-style onXxx setters
(function() {
    var props = {onopen:'oo', onmessage:'om', onclose:'oc', onerror:'oe'};
    var keys = ['onopen','onmessage','onclose','onerror'];
    for (var i = 0; i < keys.length; i++) {
        (function(prop, short) {
            Object.defineProperty(WebSocket.prototype, prop, {
                set: function(fn) {
                    var h = global.__ws[this._id];
                    if (h) {
                        var self = this;
                        if (short === 'oo') {
                            h[short] = function() { self.readyState = 1; fn.call(self); };
                        } else if (short === 'oc') {
                            h[short] = function(evt) { self.readyState = 3; fn.call(self, evt); };
                        } else {
                            h[short] = function(evt) { fn.call(self, evt); };
                        }
                    }
                },
                get: function() {
                    var h = global.__ws[this._id];
                    return h ? h[short] : undefined;
                }
            });
        })(keys[i], props[keys[i]]);
    }
})();

// --- Console ---
var console = {
    log: function() { $_log.applySync(undefined, ['log', Array.prototype.slice.call(arguments).join(' ')]); },
    error: function() { $_log.applySync(undefined, ['error', Array.prototype.slice.call(arguments).join(' ')]); },
    info: function() { $_log.applySync(undefined, ['log', Array.prototype.slice.call(arguments).join(' ')]); },
    warn: function() { $_log.applySync(undefined, ['error', Array.prototype.slice.call(arguments).join(' ')]); },
};

// --- Timer functions ---
function setTimeout(fn, delay) {
    if (typeof fn !== 'function') throw new Error('setTimeout requires a function');
    var id = __tmId++;
    global.__tm[id] = fn;
    $_setTimeout.applySync(undefined, [id, Number(delay) || 0]);
    return id;
}
function setInterval(fn, delay) {
    if (typeof fn !== 'function') throw new Error('setInterval requires a function');
    var id = __tmId++;
    global.__tm[id] = fn;
    $_setInterval.applySync(undefined, [id, Number(delay) || 0]);
    return id;
}
function clearTimeout(id) {
    delete global.__tm[id];
    $_clearTimer.applySync(undefined, [id]);
}
function clearInterval(id) {
    delete global.__tm[id];
    $_clearTimer.applySync(undefined, [id]);
}

// --- CONFIG ---
var CONFIG = { serverUrl: ${JSON.stringify(serverUrl)}, botId: ${JSON.stringify(botId)} };

// --- Block dangerous globals ---
var require = undefined;
var module = undefined;
var exports = undefined;
var __dirname = undefined;
var __filename = undefined;
var process = undefined;
var Buffer = undefined;
`;

    // Compile and run wrapper + user script
    debugLog('Running user script in isolate');
    const fullCode = wrapperCode + '\n;\n' + userScriptContent;
    const script = isolate.compileScriptSync(fullCode, { filename: `bot_${botId}.js` });
    script.runSync(context, { timeout: 30000 }); // 30s for initial setup

    debugLog('User script initialization complete');
    parentPort.postMessage({ type: 'status', status: 'running' });

    // Keep worker alive
    const keepAlive = global.setInterval(() => {
        parentPort.postMessage({ type: 'ping', timestamp: Date.now() });
        // Check isolate health
        try {
            const stats = isolate.getHeapStatisticsSync();
            if (stats.used_heap_size > MEMORY_MB * 1024 * 1024 * 0.9) {
                debugLog(`Memory warning: ${(stats.used_heap_size / 1024 / 1024).toFixed(1)}MB used`);
            }
        } catch (e) {
            debugLog('Isolate disposed or unhealthy, exiting');
            process.exit(1);
        }
    }, 10000);

} catch (err) {
    debugLog(`Sandbox error: ${err.message}`);
    parentPort.postMessage({ type: 'error', message: `Sandbox error: ${err.message}` });
    global.setTimeout(() => process.exit(1), 100);
}

// Cleanup function
function cleanup() {
    for (const [id, ws] of wsConnections) { try { ws.close(); } catch {} }
    wsConnections.clear();
    for (const [id, timer] of hostTimers) {
        try { clearTimeout(timer); clearInterval(timer); } catch {}
    }
    hostTimers.clear();
    try { if (isolate && !isolate.isDisposed) isolate.dispose(); } catch {}
}

// Handle stop from parent
parentPort.on('message', (msg) => {
    if (msg.type === 'stop') {
        debugLog('Received stop command, cleaning up');
        cleanup();
        process.exit(0);
    }
});

// Catch uncaught exceptions
process.on('uncaughtException', (err) => {
    debugLog(`Uncaught exception: ${err.message}`);
    parentPort.postMessage({ type: 'error', message: `Uncaught: ${err.message}` });
    cleanup();
    global.setTimeout(() => process.exit(1), 100);
});

process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    debugLog(`Unhandled rejection: ${msg}`);
    parentPort.postMessage({ type: 'error', message: `Unhandled rejection: ${msg}` });
});

process.on('SIGTERM', () => {
    debugLog('Worker received SIGTERM');
    cleanup();
    process.exit(0);
});
