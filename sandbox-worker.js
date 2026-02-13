const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const WebSocket = require('ws');

// --- Worker Setup ---
// The user script path is passed in workerData.
const { scriptPath, botId, serverUrl } = workerData;

if (!fs.existsSync(scriptPath)) {
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
    // Block sensitive globals
    require: () => { throw new Error("Security Error: 'require' is blocked."); },
    process: { env: {} },
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
    // Create sandbox context with blocked dangerous globals
    const sandbox = {
        ...safeGlobals,
        eval: () => { throw new Error("Security Error: 'eval' is blocked."); },
        Function: () => { throw new Error("Security Error: 'Function' constructor is blocked."); },
        setTimeout: setTimeout,
        setInterval: setInterval,
        clearTimeout: clearTimeout,
        clearInterval: clearInterval,
    };
    
    // Create context from sandbox
    vm.createContext(sandbox);
    
    // Run the user script in the sandboxed context
    vm.runInContext(userScriptContent, sandbox, {
        filename: `bot_${botId}.js`,
        timeout: 30000, // 30 second timeout for script initialization
    });
    
    parentPort.postMessage({ type: 'status', status: 'running' });
    
    // Keep worker alive - the WebSocket connection in sandbox needs the event loop
    setInterval(() => {}, 60000);

} catch (err) {
    parentPort.postMessage({ type: 'error', message: `Sandbox error: ${err.message}` });
    process.exit(1);
}

// Catch any uncaught exceptions in the worker
process.on('uncaughtException', (err) => {
    parentPort.postMessage({ type: 'error', message: `Uncaught exception: ${err.message}` });
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    parentPort.postMessage({ type: 'error', message: `Unhandled rejection: ${reason}` });
});
