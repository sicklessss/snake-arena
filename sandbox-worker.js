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

// Safe globals that can be passed as function params (no reserved words)
const safeGlobals = {
    WebSocket: WebSocket,
    console: {
        log: (...args) => parentPort.postMessage({ type: 'log', message: args.join(' ') }),
        error: (...args) => parentPort.postMessage({ type: 'error', message: args.join(' ') }),
        info: (...args) => parentPort.postMessage({ type: 'log', message: args.join(' ') }),
        warn: (...args) => parentPort.postMessage({ type: 'error', message: args.join(' ') }),
    },
    CONFIG: {
        serverUrl: serverUrl,
        botId: botId
    },
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
    // Let VM use its own TypedArrays
    ArrayBuffer: ArrayBuffer,
    Promise: Promise,
    // Block sensitive globals
    require: () => { throw new Error("Security Error: 'require' is blocked."); },
    process: { 
        env: { NODE_ENV: 'production' },
        nextTick: (fn, ...args) => process.nextTick(fn, ...args),
        stdout: { write: () => {} },
        stderr: { write: () => {} },
        cwd: () => '/',
        uptime: () => process.uptime(),
    },
    Buffer: Buffer,
    module: {},
    exports: {},
    __dirname: null,
    __filename: null,
    // Block networking/filesystem
    fs: null,
    net: null,
    http: null,
    https: null,
    child_process: null,
};

// Execute the user script using vm module for proper sandboxing
const vm = require('vm');

try {
    debugLog('Creating sandbox context');
    
    // Create sandbox context with blocked dangerous globals
    const sandbox = {
        ...safeGlobals,
        eval: () => { throw new Error("Security Error: 'eval' is blocked."); },
        Function: () => { throw new Error("Security Error: 'Function' constructor is blocked."); },
        setTimeout: setTimeout,
        setInterval: setInterval,
        clearTimeout: clearTimeout,
        clearInterval: clearInterval,
        Buffer: Buffer, // Added Buffer for compatibility with some libraries
        Uint8Array: Uint8Array,
    };
    
    // Create context from sandbox
    vm.createContext(sandbox);
    
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
