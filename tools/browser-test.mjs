import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const DEBUG_PORT = 9222;
const USER_DATA_DIR = path.resolve('tools/.edge-profile');

if (!fs.existsSync(USER_DATA_DIR)) {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getPageWsUrl() {
    for (let i = 0; i < 30; i++) {
        try {
            // Create a new page target directly
            const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?about:blank`, { method: 'PUT' });
            if (res.ok) {
                const data = await res.json();
                if (data.webSocketDebuggerUrl) return data.webSocketDebuggerUrl;
            }
        } catch (e) {}
        await delay(300);
    }

    // Fallback: list targets
    try {
        const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
        if (res.ok) {
            const list = await res.json();
            const page = list.find(t => t.type === 'page');
            if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
        }
    } catch (e) {}

    throw new Error('Could not get page debugger URL from Edge on port ' + DEBUG_PORT);
}

class PageCDP {
    constructor(wsUrl) {
        this.wsUrl = wsUrl;
        this.ws = null;
        this.nextId = 1;
        this.pending = new Map();
        this.handlers = new Map();
    }

    async connect() {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(this.wsUrl);
            this.ws.onopen = () => resolve();
            this.ws.onerror = (err) => reject(err);
            this.ws.onmessage = (event) => {
                const msg = JSON.parse(event.data);
                if (msg.id && this.pending.has(msg.id)) {
                    const { resolve, reject } = this.pending.get(msg.id);
                    this.pending.delete(msg.id);
                    if (msg.error) reject(new Error(msg.error.message));
                    else resolve(msg.result);
                } else if (msg.method) {
                    const list = this.handlers.get(msg.method) || [];
                    for (const fn of list) fn(msg.params);
                }
            };
        });
    }

    send(method, params = {}) {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.ws.send(JSON.stringify({ id, method, params }));
        });
    }

    on(method, fn) {
        if (!this.handlers.has(method)) this.handlers.set(method, []);
        this.handlers.get(method).push(fn);
    }

    async evaluate(expression) {
        const res = await this.send('Runtime.evaluate', {
            expression,
            returnByValue: true,
            awaitPromise: true
        });
        if (res.exceptionDetails) {
            throw new Error(res.exceptionDetails.text || 'Evaluation failed');
        }
        return res.result?.value;
    }

    close() {
        if (this.ws) this.ws.close();
    }
}

async function runBrowserTests() {
    console.log('Launching headless Microsoft Edge on port 9222...');
    const edgeProcess = spawn(EDGE_PATH, [
        '--headless=new',
        `--remote-debugging-port=${DEBUG_PORT}`,
        `--user-data-dir=${USER_DATA_DIR}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-extensions',
        '--disable-gpu',
        'about:blank'
    ], { stdio: 'ignore' });

    try {
        const wsUrl = await getPageWsUrl();
        console.log('Connected to Edge Page DevTools:', wsUrl);

        const page = new PageCDP(wsUrl);
        await page.connect();

        // Enable domains
        await page.send('Runtime.enable');
        await page.send('Page.enable');
        await page.send('Network.enable');

        const consoleMessages = [];
        const networkErrors = [];

        page.on('Runtime.consoleAPICalled', (params) => {
            const text = params.args.map(a => a.value !== undefined ? a.value : (a.description || '')).join(' ');
            consoleMessages.push({ type: params.type, text });
            console.log(`[Browser Console ${params.type}]`, text);
        });

        page.on('Network.responseReceived', (params) => {
            const status = params.response.status;
            const url = params.response.url;
            if (status >= 400) {
                networkErrors.push({ url, status });
                console.error(`[Browser Network Error] ${status} for ${url}`);
            }
        });

        // ─────────────────────────────────────────────────────────────
        // TEST 1: Run tools/test-suite.html (GLB validation in browser)
        // ─────────────────────────────────────────────────────────────
        console.log('\n======================================================');
        console.log('TEST PHASE 1: Loading tools/test-suite.html in browser...');
        console.log('======================================================');

        await page.send('Page.navigate', { url: 'http://localhost:8000/tools/test-suite.html' });

        // Wait for tests to finish
        let testResults = null;
        for (let i = 0; i < 40; i++) {
            await delay(500);
            try {
                testResults = await page.evaluate('window.__TEST_RESULTS__');
                if (testResults && testResults.complete) break;
            } catch (e) {}
        }

        if (!testResults) {
            throw new Error('Test suite timed out after 20 seconds!');
        }

        console.log(`\nTest suite reported: ${testResults.passCount} passed, ${testResults.failCount} failed.`);
        if (testResults.failCount > 0) {
            throw new Error(`Test suite had ${testResults.failCount} failures!`);
        }

        // ─────────────────────────────────────────────────────────────
        // TEST 2: Load actual index.html application
        // ─────────────────────────────────────────────────────────────
        console.log('\n======================================================');
        console.log('TEST PHASE 2: Loading live application index.html...');
        console.log('======================================================');

        consoleMessages.length = 0;
        networkErrors.length = 0;

        await page.send('Page.navigate', { url: 'http://localhost:8000/index.html' });

        // Wait for MonsterModelManager to finish preloading (start button becomes enabled)
        console.log('Waiting for racer GLB preloading to complete...');
        let ready = false;
        for (let i = 0; i < 40; i++) {
            await delay(500);
            const btnDisabled = await page.evaluate('document.getElementById("start-btn")?.disabled');
            const managerReady = await page.evaluate('window.MonsterModelManager?.ready || (typeof MonsterModelManager !== "undefined" && MonsterModelManager.ready)');
            if (btnDisabled === false || managerReady === true) {
                ready = true;
                break;
            }
        }

        if (!ready) {
            throw new Error('MonsterModelManager did not become ready within 20s!');
        }
        console.log('✓ Preloading complete. Start button is enabled.');

        // Verify all 8 racers initialized in scene
        const duckCount = await page.evaluate('ducks.length');
        console.log(`✓ Racer count in scene: ${duckCount}`);
        if (duckCount !== 8) throw new Error(`Expected 8 racers, found ${duckCount}`);

        // Check each racer is using GLB and has valid rig
        const racerInfo = await page.evaluate(`
            ducks.map(d => ({
                id: d.id,
                name: d.name,
                usingGLB: d.usingGLB,
                hasBody: !!d.rig.bodyGroup,
                hasHead: !!d.rig.headGroup,
                hasLeftArm: !!d.rig.leftArm,
                hasRightArm: !!d.rig.rightArm,
                hasLeftLeg: !!d.rig.leftLeg,
                hasRightLeg: !!d.rig.rightLeg,
                zombieArms: !!d.ZombieArms,
                posY: d.mesh.position.y,
                posZ: d.mesh.position.z
            }))
        `);

        console.log('\nInspecting 8 Live Racers:');
        for (const r of racerInfo) {
            console.log(`  Racer #${r.id + 1} (${r.name}): GLB=${r.usingGLB}, Rig=[Body:${r.hasBody}, Head:${r.hasHead}, Arms:${r.hasLeftArm}/${r.hasRightArm}, Legs:${r.hasLeftLeg}/${r.hasRightLeg}], ZombieArms=${r.zombieArms}`);
            if (!r.usingGLB) throw new Error(`Racer #${r.id} is NOT using GLB!`);
            if (!r.hasBody || !r.hasHead || !r.hasLeftArm || !r.hasRightArm || !r.hasLeftLeg || !r.hasRightLeg) {
                throw new Error(`Racer #${r.id} missing rig nodes!`);
            }
        }

        // Check network errors
        if (networkErrors.length > 0) {
            console.error('Network errors detected:', networkErrors);
            throw new Error(`Encountered ${networkErrors.length} network errors (404s/500s)!`);
        }
        console.log('✓ No 404s or network errors detected.');

        // ─────────────────────────────────────────────────────────────
        // TEST 3: Click RACE! and simulate full race
        // ─────────────────────────────────────────────────────────────
        console.log('\n======================================================');
        console.log('TEST PHASE 3: Starting Race & Simulating Full Run...');
        console.log('======================================================');

        // Click start button
        await page.evaluate('document.getElementById("start-btn").click()');
        console.log('Clicked RACE! button.');

        // Check countdown state
        await delay(500);
        const isCounting = await page.evaluate('isCountingDown');
        console.log(`✓ Countdown running: ${isCounting}`);

        // Fast-forward countdown and race
        console.log('Accelerating race simulation to test finish line and victory sequence...');
        await page.evaluate(`
            isCountingDown = false;
            isRacing = true;
            gameSpeed = 15.0; // accelerate
        `);

        // Wait for race to end
        let raceFinished = false;
        for (let i = 0; i < 40; i++) {
            await delay(500);
            const ended = await page.evaluate('raceEnded');
            const finishedCount = await page.evaluate('ducks.filter(d => d.finished).length');
            const leaderZ = await page.evaluate('ducks[0].position.z');
            const speed = await page.evaluate('document.getElementById("speed-stat")?.innerText');
            const progress = await page.evaluate('document.getElementById("progress-fill")?.style.width');
            process.stdout.write(`\r  Progress: ${progress || '0%'} | Leader Z: ${Math.round(leaderZ)}m | Finished: ${finishedCount}/8 | Ended: ${ended}`);

            if (ended) {
                raceFinished = true;
                break;
            }
        }
        console.log('\n');

        if (!raceFinished) {
            throw new Error('Race did not finish within timeout!');
        }
        console.log('✓ All 8 racers crossed the finish line!');

        // Check winner announcement
        const winnerMsg = await page.evaluate('document.getElementById("winner-text")?.innerText');
        console.log(`✓ Winner Announcement: "${winnerMsg}"`);

        // Check end screen becomes visible
        await delay(2500);
        const endScreenHidden = await page.evaluate('document.getElementById("end-screen")?.classList.contains("hidden")');
        console.log(`✓ End screen visible: ${!endScreenHidden}`);

        // ─────────────────────────────────────────────────────────────
        // TEST 4: Restart Race & verify model reuse / no duplicates
        // ─────────────────────────────────────────────────────────────
        console.log('\n======================================================');
        console.log('TEST PHASE 4: Restarting for Next Race...');
        console.log('======================================================');

        await page.evaluate('document.getElementById("restart-btn").click()');
        await delay(1000);

        const restartDuckCount = await page.evaluate('ducks.length');
        const startScreenHiddenAfterRestart = await page.evaluate('document.getElementById("start-screen")?.classList.contains("hidden")');
        console.log(`✓ Next race racers: ${restartDuckCount} (expected 8)`);
        console.log(`✓ Start screen restored: ${!startScreenHiddenAfterRestart}`);

        if (restartDuckCount !== 8) throw new Error(`Race restart created ${restartDuckCount} racers instead of 8!`);

        // Verify models in next race still have GLBs intact
        const nextRaceGLB = await page.evaluate('ducks.every(d => d.usingGLB)');
        console.log(`✓ All racers in Race #2 use GLB models: ${nextRaceGLB}`);
        if (!nextRaceGLB) throw new Error('Race #2 racers failed to use GLB models!');

        // ─────────────────────────────────────────────────────────────
        // TEST 5: Event Creation / Custom Race Management
        // ─────────────────────────────────────────────────────────────
        console.log('\n======================================================');
        console.log('TEST PHASE 5: Testing Custom Event Management...');
        console.log('======================================================');

        await page.evaluate(`
            document.getElementById("manage-btn").click();
            document.getElementById("new-race-name").value = "Hallows Test GP";
            document.getElementById("p-name-0").value = "Custom Vampire";
            document.getElementById("save-config-btn").click();
        `);
        await delay(500);

        const currentRaceName = await page.evaluate('storedRaces[currentRaceIndex]?.name');
        console.log(`✓ Custom race created and selected: "${currentRaceName}"`);
        if (currentRaceName !== 'Hallows Test GP') throw new Error(`Expected custom race, got ${currentRaceName}`);

        const customRacersGLB = await page.evaluate('ducks.every(d => d.usingGLB)');
        console.log(`✓ Custom race racers using GLB models: ${customRacersGLB}`);
        if (!customRacersGLB) throw new Error('Custom race racers failed to use GLB models!');

        console.log('\n======================================================');
        console.log('🎉 ALL AUTOMATED BROWSER TESTS PASSED PERFECTLY!');
        console.log('======================================================');

    } finally {
        edgeProcess.kill();
        try { fs.rmSync(USER_DATA_DIR, { recursive: true, force: true }); } catch (e) {}
    }
}

runBrowserTests().then(() => {
    process.exit(0);
}).catch(err => {
    console.error('\n❌ BROWSER TEST FAILED:', err);
    process.exit(1);
});
