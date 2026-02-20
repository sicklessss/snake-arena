// Test utilities - HTTP client, result tracking, helpers
const http = require('http');
const https = require('https');
const { URL } = require('url');
const config = require('./config');

// ── Lightweight HTTP client (no external deps) ──

function httpRequest(method, urlStr, { body, headers = {}, timeout = config.HTTP_TIMEOUT } = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(urlStr);
        const isHttps = url.protocol === 'https:';
        const lib = isHttps ? https : http;

        const opts = {
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: url.pathname + url.search,
            method,
            headers: { ...headers },
            timeout,
        };

        if (body) {
            const payload = typeof body === 'string' ? body : JSON.stringify(body);
            opts.headers['Content-Type'] = opts.headers['Content-Type'] || 'application/json';
            opts.headers['Content-Length'] = Buffer.byteLength(payload);
        }

        const req = lib.request(opts, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
                let parsed = data;
                try { parsed = JSON.parse(data); } catch {}
                resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw: data });
            });
        });

        req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout after ${timeout}ms`)); });
        req.on('error', reject);

        if (body) {
            req.write(typeof body === 'string' ? body : JSON.stringify(body));
        }
        req.end();
    });
}

const get  = (url, opts) => httpRequest('GET', url, opts);
const post = (url, opts) => httpRequest('POST', url, opts);

// ── Test result collector ──

class TestRunner {
    constructor(suiteName) {
        this.suite = suiteName;
        this.results = [];
        this.startTime = Date.now();
    }

    async run(name, fn) {
        const t0 = Date.now();
        const entry = { name, suite: this.suite, status: 'pass', duration: 0, detail: null };
        try {
            const detail = await fn();
            entry.detail = detail || null;
        } catch (err) {
            entry.status = 'fail';
            entry.detail = err.message || String(err);
        }
        entry.duration = Date.now() - t0;
        this.results.push(entry);

        const icon = entry.status === 'pass' ? '  PASS' : '  FAIL';
        console.log(`${icon}  ${name} (${entry.duration}ms)`);
        if (entry.status === 'fail') console.log(`        -> ${entry.detail}`);
        return entry;
    }

    summary() {
        const pass = this.results.filter((r) => r.status === 'pass').length;
        const fail = this.results.filter((r) => r.status === 'fail').length;
        return { suite: this.suite, total: this.results.length, pass, fail, elapsed: Date.now() - this.startTime, results: this.results };
    }
}

// ── Assertion helpers ──

function assert(cond, msg) {
    if (!cond) throw new Error(msg || 'assertion failed');
}

function assertEq(a, b, msg) {
    if (a !== b) throw new Error(msg || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

function assertIncludes(arr, val, msg) {
    if (!arr.includes(val)) throw new Error(msg || `expected array to include ${val}`);
}

function assertOk(res, msg) {
    if (res.status < 200 || res.status >= 300) {
        throw new Error(msg || `HTTP ${res.status}: ${typeof res.body === 'string' ? res.body : JSON.stringify(res.body)}`);
    }
}

function assertStatus(res, code, msg) {
    if (res.status !== code) {
        throw new Error(msg || `expected HTTP ${code}, got ${res.status}: ${typeof res.body === 'string' ? res.body.slice(0, 200) : JSON.stringify(res.body).slice(0, 200)}`);
    }
}

function randomId(prefix = 'test') {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

module.exports = { get, post, httpRequest, TestRunner, assert, assertEq, assertIncludes, assertOk, assertStatus, randomId };
