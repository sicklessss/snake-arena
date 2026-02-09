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

const sandboxGlobals = {
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
    process: { env: {} }, // Minimal mock if needed, or block completely
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
    // Block eval-like
    eval: () => { throw new Error("Security Error: 'eval' is blocked."); },
    Function: () => { throw new Error("Security Error: 'Function' constructor is blocked."); }
};

// Execute the user script
try {
    // Wrap in a function that takes our sandboxed globals as arguments
    const keys = Object.keys(sandboxGlobals);
    const values = Object.values(sandboxGlobals);
    
    // We add "use strict" to prevent global leakage via 'this'
    const wrappedScript = `"use strict";\n${userScriptContent}`;
    
    const run = new Function(...keys, wrappedScript);
    run(...values);
    
    parentPort.postMessage({ type: 'status', status: 'running' });

} catch (err) {
    parentPort.postMessage({ type: 'error', message: err.toString() });
    process.exit(1);
}
