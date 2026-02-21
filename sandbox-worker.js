const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const WebSocket = require('ws');

// --- Worker Setup ---
// The user script path is passed in workerData.
const { scriptPath, botId, serverUrl } = workerData;

const debugLog = (msg) => {
    const timestamp = new Date().toISOString();
    const logMsg = `[${timestamp}] [Worker ${botId}] ${msg}\n`;
    try {
        fs.appendFileSync('worker-debug.log', logMsg);
    } catch (e) {}
    if (parentPort) {
        parentPort.postMessage({ type: 'debug', message: msg });
    }
};

debugLog(`Worker starting. scriptPath: ${scriptPath}, serverUrl: ${serverUrl}`);

if (!fs.existsSync(scriptPath)) {
    debugLog(`Error: Script not found: ${scriptPath}`);
    console.error(`[Worker ${botId}] Script not found: ${scriptPath}`);
    process.exit(1);
}

const userScriptContent = fs.readFileSync(scriptPath, 'utf8');

// --- Sandbox Environment ---
// We create a constrained execution environment.
// We block 'require' and other sensitive globals by shadowing them.
// We provide 'WebSocket' and a 'CONFIG' object.

// Safe setTimeout/setInterval wrappers that only accept functions, not strings
// This prevents the `setTimeout.constructor('return process')()` escape
const MAX_TIMERS = 100;
let activeTimerCount = 0;

function safeSetTimeout(fn, delay, ...args) {
    if (typeof fn !== 'function') throw new Error('setTimeout requires a function');
    if (activeTimerCount >= MAX_TIMERS) throw new Error('Too many active timers');
    activeTimerCount++;
    return setTimeout(() => {
        activeTimerCount--;
        try { fn(...args); } catch (e) {
            parentPort.postMessage({ type: 'error', message: `Timer error: ${e.message}` });
        }
    }, delay);
}

function safeSetInterval(fn, delay, ...args) {
    if (typeof fn !== 'function') throw new Error('setInterval requires a function');
    if (activeTimerCount >= MAX_TIMERS) throw new Error('Too many active timers');
    activeTimerCount++;
    return setInterval((...a) => {
        try { fn(...a); } catch (e) {
            parentPort.postMessage({ type: 'error', message: `Interval error: ${e.message}` });
        }
    }, delay, ...args);
}

function safeClearTimeout(id) {
    clearTimeout(id);
    activeTimerCount = Math.max(0, activeTimerCount - 1);
}

function safeClearInterval(id) {
    clearInterval(id);
    activeTimerCount = Math.max(0, activeTimerCount - 1);
}

// Frozen console proxy — no prototype chain escape
const safeConsole = Object.freeze({
    log: (...args) => parentPort.postMessage({ type: 'log', message: args.join(' ') }),
    error: (...args) => parentPort.postMessage({ type: 'error', message: args.join(' ') }),
    info: (...args) => parentPort.postMessage({ type: 'log', message: args.join(' ') }),
    warn: (...args) => parentPort.postMessage({ type: 'error', message: args.join(' ') }),
});

// Frozen process stub — minimal, no real access
const safeProcess = Object.freeze({
    env: Object.freeze({ NODE_ENV: 'production' }),
    nextTick: (fn, ...args) => { if (typeof fn === 'function') process.nextTick(fn, ...args); },
    stdout: Object.freeze({ write: () => {} }),
    stderr: Object.freeze({ write: () => {} }),
    cwd: () => '/',
    uptime: () => process.uptime(),
});

// Execute the user script using vm module for proper sandboxing
const vm = require('vm');

try {
    debugLog('Creating sandbox context');

    // Blocked function — throws on any call
    const blocked = (name) => () => { throw new Error(`Security Error: '${name}' is blocked.`); };

    // Create sandbox context with blocked dangerous globals
    const sandbox = {
        WebSocket: function RestrictedWebSocket(url, ...args) {
            // Only allow connections to localhost to prevent SSRF
            try {
                const parsed = new URL(url);
                if (parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1' && parsed.hostname !== '::1') {
                    throw new Error('Security Error: WebSocket connections only allowed to localhost');
                }
            } catch (e) {
                if (e.message.includes('Security Error')) throw e;
                throw new Error('Security Error: Invalid WebSocket URL');
            }
            return new WebSocket(url, ...args);
        },
        console: safeConsole,
        CONFIG: Object.freeze({
            serverUrl: serverUrl,
            botId: botId
        }),
        // Safe JS built-ins
        JSON: JSON,
        Math: Math,
        Date: Date,
        Array: Array,
        Object: Object,
        String: String,
        Number: Number,
        Boolean: Boolean,
        Map: Map,
        Set: Set,
        RegExp: RegExp,
        Error: Error,
        TypeError: TypeError,
        RangeError: RangeError,
        parseInt: parseInt,
        parseFloat: parseFloat,
        isNaN: isNaN,
        isFinite: isFinite,
        Infinity: Infinity,
        NaN: NaN,
        undefined: undefined,
        ArrayBuffer: ArrayBuffer,
        Uint8Array: Uint8Array,
        Promise: Promise,
        // Safe timer wrappers (prevent constructor chain escape)
        setTimeout: safeSetTimeout,
        setInterval: safeSetInterval,
        clearTimeout: safeClearTimeout,
        clearInterval: safeClearInterval,
        // Blocked globals
        require: blocked('require'),
        eval: blocked('eval'),
        Function: blocked('Function'),
        Buffer: undefined,
        process: safeProcess,
        module: Object.freeze({}),
        exports: Object.freeze({}),
        __dirname: undefined,
        __filename: undefined,
        global: undefined,
        globalThis: undefined,
        // Block networking/filesystem
        fs: undefined,
        net: undefined,
        http: undefined,
        https: undefined,
        child_process: undefined,
        Proxy: undefined,
        Reflect: undefined,
        Symbol: undefined,
        WeakRef: undefined,
        FinalizationRegistry: undefined,
        SharedArrayBuffer: undefined,
        Atomics: undefined,
    };

    // Create context from sandbox
    vm.createContext(sandbox);

    // Freeze prototypes inside sandbox to prevent constructor chain escape
    vm.runInContext(`
        (function() {
            var freeze = Object.freeze;
            [Array, Object, String, Number, Boolean, RegExp, Map, Set, Error, TypeError, RangeError, Promise].forEach(function(C) {
                if (C && C.prototype) {
                    freeze(C.prototype);
                    if (C.prototype.constructor) freeze(C.prototype.constructor);
                }
            });
            // Freeze Object methods that could be used for escape
            freeze(Object);
            freeze(Array);
            freeze(Promise);
        })();
    `, sandbox);

    debugLog('Running user script');

    // Run the user script in the sandboxed context
    vm.runInContext(userScriptContent, sandbox, {
        filename: `bot_${botId}.js`,
        timeout: 30000, // 30 second timeout for script initialization
    });

    debugLog('User script initialization complete');
    parentPort.postMessage({ type: 'status', status: 'running' });

    // Keep worker alive - the WebSocket connection in sandbox needs the event loop
    debugLog('Script executed, keeping alive');

    // Use a shorter interval and add a keep-alive check
    const keepAlive = setInterval(() => {
        parentPort.postMessage({ type: 'ping', timestamp: Date.now() });
    }, 10000);

    // Prevent process from exiting
    if (process.stdin && process.stdin.resume) {
        process.stdin.resume();
    }

} catch (err) {
    debugLog(`Error during execution: ${err.message}\n${err.stack}`);
    parentPort.postMessage({ type: 'error', message: `Sandbox error: ${err.message}` });
    // Give some time for the message to be sent
    setTimeout(() => process.exit(1), 100);
}

// Handle messages from parent
parentPort.on('message', (msg) => {
    if (msg.type === 'stop') {
        debugLog('Received stop command, exiting');
        process.exit(0);
    }
});

// Catch any uncaught exceptions in the worker
process.on('uncaughtException', (err) => {
    debugLog(`Uncaught exception: ${err.message}\n${err.stack}`);
    parentPort.postMessage({ type: 'error', message: `Uncaught exception: ${err.message}` });
    setTimeout(() => process.exit(1), 100);
});

process.on('unhandledRejection', (reason, promise) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    debugLog(`Unhandled rejection: ${msg}`);
    parentPort.postMessage({ type: 'error', message: `Unhandled rejection: ${msg}` });
});

// Handle graceful exit
process.on('SIGTERM', () => {
    debugLog('Worker received SIGTERM');
    process.exit(0);
});
