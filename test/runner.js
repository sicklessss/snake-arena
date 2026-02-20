#!/usr/bin/env node
// Main test runner - orchestrates all suites and generates JSON report
const fs = require('fs');
const path = require('path');

const suites = [
    { name: 'API Endpoints', module: './api.test' },
    { name: 'WebSocket',     module: './websocket.test' },
    { name: 'Blockchain',    module: './blockchain.test' },
];

async function runAll() {
    const startTime = Date.now();
    const report = {
        timestamp: new Date().toISOString(),
        target: require('./config').BASE_URL,
        suites: [],
        totals: { total: 0, pass: 0, fail: 0, elapsed: 0 },
    };

    console.log('═══════════════════════════════════════════');
    console.log('  Snake Arena - Automated Test Suite');
    console.log(`  Target: ${report.target}`);
    console.log(`  Time:   ${report.timestamp}`);
    console.log('═══════════════════════════════════════════\n');

    for (const suite of suites) {
        console.log(`\n── ${suite.name} ──────────────────────────`);
        try {
            const mod = require(suite.module);
            const result = await mod.run();
            report.suites.push(result);
            report.totals.total += result.total;
            report.totals.pass += result.pass;
            report.totals.fail += result.fail;
            console.log(`  => ${result.pass}/${result.total} passed (${result.elapsed}ms)\n`);
        } catch (err) {
            const failResult = {
                suite: suite.name,
                total: 1,
                pass: 0,
                fail: 1,
                elapsed: 0,
                results: [{ name: 'Suite crashed', suite: suite.name, status: 'fail', duration: 0, detail: err.message }],
            };
            report.suites.push(failResult);
            report.totals.total += 1;
            report.totals.fail += 1;
            console.error(`  => SUITE CRASHED: ${err.message}\n`);
        }
    }

    report.totals.elapsed = Date.now() - startTime;

    // Summary
    console.log('\n═══════════════════════════════════════════');
    console.log('  RESULTS');
    console.log('═══════════════════════════════════════════');
    for (const s of report.suites) {
        const icon = s.fail === 0 ? 'OK' : 'FAIL';
        console.log(`  [${icon}] ${s.suite}: ${s.pass}/${s.total} passed`);
    }
    console.log('───────────────────────────────────────────');
    console.log(`  Total: ${report.totals.pass}/${report.totals.total} passed, ${report.totals.fail} failed`);
    console.log(`  Elapsed: ${report.totals.elapsed}ms`);
    console.log('═══════════════════════════════════════════\n');

    // Write JSON report
    const reportPath = path.join(__dirname, 'report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`Report written to ${reportPath}`);

    // Also list failed tests
    const failures = report.suites.flatMap(s => s.results.filter(r => r.status === 'fail'));
    if (failures.length > 0) {
        console.log(`\nFailed tests (${failures.length}):`);
        failures.forEach(f => console.log(`  - [${f.suite}] ${f.name}: ${f.detail}`));
    }

    return report;
}

runAll().then(report => {
    process.exit(report.totals.fail > 0 ? 1 : 0);
}).catch(err => {
    console.error('Runner fatal error:', err);
    process.exit(2);
});
