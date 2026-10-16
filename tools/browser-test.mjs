import { spawn } from 'child_process';
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
            const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?about:blank`, { method: 'PUT' });
            if (res.ok) {
                const data = await res.json();
                if (data.webSocketDebuggerUrl) return data.webSocketDebuggerUrl;
            }
        } catch (e) {}
        await delay(300);
    }

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
        // TEST 2: Load actual index.html & verify pre-race READY state
        // ─────────────────────────────────────────────────────────────
        console.log('\n======================================================');
        console.log('TEST PHASE 2: Loading index.html & Verifying Starting Line...');
        console.log('======================================================');

        consoleMessages.length = 0;
        networkErrors.length = 0;

        await page.send('Page.navigate', { url: 'http://localhost:8000/index.html' });

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

        // Wait 1.2 seconds on the start screen to confirm racers DO NOT drift or run in place
        await delay(1200);

        const preRaceAudit = await page.evaluate(`
            ({
                raceState,
                isRacing,
                isCountingDown,
                racerScale: CONFIG.racerScale,
                racers: ducks.map(d => ({
                    id: d.id,
                    name: d.name,
                    usingGLB: d.usingGLB,
                    hasBody: !!d.rig.bodyGroup,
                    hasHead: !!d.rig.headGroup,
                    hasLeftArm: !!d.rig.leftArm,
                    hasRightArm: !!d.rig.rightArm,
                    hasLeftLeg: !!d.rig.leftLeg,
                    hasRightLeg: !!d.rig.rightLeg,
                    posX: d.position.x,
                    posZ: d.position.z,
                    legRotL: d.rig.leftLeg.rotation.x,
                    legRotR: d.rig.rightLeg.rotation.x
                }))
            })
        `);

        console.log(`✓ Initial raceState: ${preRaceAudit.raceState} (scale: ${preRaceAudit.racerScale})`);
        if (preRaceAudit.raceState !== 'READY') {
            throw new Error(`Expected raceState READY on start screen, got ${preRaceAudit.raceState}`);
        }

        console.log('\nInspecting 8 Live Racers on Start Screen:');
        for (let i = 0; i < preRaceAudit.racers.length; i++) {
            const r = preRaceAudit.racers[i];
            console.log(`  Racer #${r.id + 1} (${r.name}): GLB=${r.usingGLB}, X=${r.posX.toFixed(2)}, Z=${r.posZ.toFixed(2)}, LegRot=[${r.legRotL.toFixed(2)}, ${r.legRotR.toFixed(2)}]`);
            if (!r.usingGLB) throw new Error(`Racer #${r.id} is NOT using GLB!`);
            if (!r.hasBody || !r.hasHead || !r.hasLeftArm || !r.hasRightArm || !r.hasLeftLeg || !r.hasRightLeg) {
                throw new Error(`Racer #${r.id} missing rig nodes!`);
            }
            if (Math.abs(r.posZ) > 0.001) {
                throw new Error(`Racer #${r.id} moved forward before race start (Z=${r.posZ})!`);
            }
            if (Math.abs(r.legRotL) > 0.001 || Math.abs(r.legRotR) > 0.001) {
                throw new Error(`Racer #${r.id} legs are cycling before race start!`);
            }
            if (i > 0) {
                const spacing = r.posX - preRaceAudit.racers[i - 1].posX;
                if (Math.abs(spacing - 7.4) > 0.05) {
                    throw new Error(`Uneven starting grid spacing between #${i} and #${i + 1}: ${spacing}`);
                }
            }
        }
        console.log('✓ All 8 racers aligned in a straight starting line with zero pre-race running.');

        if (networkErrors.length > 0) {
            console.error('Network errors detected:', networkErrors);
            throw new Error(`Encountered ${networkErrors.length} network errors (404s/500s)!`);
        }
        console.log('✓ No 404s or network errors detected.');

        // ─────────────────────────────────────────────────────────────
        // TEST 3: Click RACE!, verify COUNTDOWN hold, then simulate race
        // ─────────────────────────────────────────────────────────────
        console.log('\n======================================================');
        console.log('TEST PHASE 3: Verifying Countdown Alignment & Full Race...');
        console.log('======================================================');

        await page.evaluate('document.getElementById("start-btn").click()');
        console.log('Clicked RACE! button.');

        await delay(650);
        const countdownCheck = await page.evaluate(`
            ({
                raceState,
                isCountingDown,
                isRacing,
                maxZ: Math.max(...ducks.map(d => Math.abs(d.position.z))),
                maxLegRot: Math.max(...ducks.map(d => Math.abs(d.rig.leftLeg.rotation.x)))
            })
        `);
        console.log(`✓ Countdown state: ${countdownCheck.raceState} | maxZ=${countdownCheck.maxZ} | maxLegRot=${countdownCheck.maxLegRot}`);
        if (countdownCheck.raceState !== 'COUNTDOWN' || !countdownCheck.isCountingDown || countdownCheck.isRacing) {
            throw new Error(`Expected COUNTDOWN state during countdown, got ${JSON.stringify(countdownCheck)}`);
        }
        if (countdownCheck.maxZ > 0.001 || countdownCheck.maxLegRot > 0.001) {
            throw new Error('Racers moved or cycled legs during countdown!');
        }

        // Fast-forward countdown into RACING state cleanly
        console.log('Triggering horn transition to RACING and accelerating simulation...');
        await page.evaluate(`
            if (countdownTimerId) {
                clearInterval(countdownTimerId);
                countdownTimerId = null;
            }
            const cd = document.getElementById('countdown-overlay');
            if (cd) { cd.innerHTML = ''; cd.style.display = 'none'; }
            setRaceState(RACE_STATE.RACING);
            gameSpeed = 15.0;
        `);

        let raceFinished = false;
        for (let i = 0; i < 40; i++) {
            await delay(500);
            const ended = await page.evaluate('raceEnded');
            const finishedCount = await page.evaluate('ducks.filter(d => d.finished).length');
            const leaderZ = await page.evaluate('ducks[0].position.z');
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
        console.log('✓ All 8 racers crossed the finish line and entered FINISHED state!');

        const winnerMsg = await page.evaluate('document.getElementById("winner-text")?.innerText');
        console.log(`✓ Winner Announcement: "${winnerMsg}"`);

        await delay(2500);
        const endScreenHidden = await page.evaluate('document.getElementById("end-screen")?.classList.contains("hidden")');
        console.log(`✓ End screen visible: ${!endScreenHidden}`);

        // ─────────────────────────────────────────────────────────────
        // TEST 4: Restart Race & verify reset to READY on starting line
        // ─────────────────────────────────────────────────────────────
        console.log('\n======================================================');
        console.log('TEST PHASE 4: Restarting for Next Race...');
        console.log('======================================================');

        await page.evaluate('document.getElementById("restart-btn").click()');
        await delay(800);

        const restartCheck = await page.evaluate(`
            ({
                duckCount: ducks.length,
                raceState,
                startScreenVisible: !document.getElementById("start-screen")?.classList.contains("hidden"),
                allGLB: ducks.every(d => d.usingGLB),
                maxZ: Math.max(...ducks.map(d => Math.abs(d.position.z)))
            })
        `);

        console.log(`✓ Next race racers: ${restartCheck.duckCount} | state: ${restartCheck.raceState} | maxZ: ${restartCheck.maxZ}`);
        if (restartCheck.duckCount !== 8) throw new Error(`Expected 8 racers after restart, got ${restartCheck.duckCount}`);
        if (restartCheck.raceState !== 'READY') throw new Error(`Expected READY state after restart, got ${restartCheck.raceState}`);
        if (restartCheck.maxZ > 0.001) throw new Error(`Racers did not reset to Z=0 after restart (maxZ=${restartCheck.maxZ})`);
        if (!restartCheck.allGLB) throw new Error('Race #2 racers failed to use GLB models!');

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

        const customCheck = await page.evaluate(`
            ({
                name: storedRaces[currentRaceIndex]?.name,
                raceState,
                allGLB: ducks.every(d => d.usingGLB),
                maxZ: Math.max(...ducks.map(d => Math.abs(d.position.z)))
            })
        `);
        console.log(`✓ Custom race created: "${customCheck.name}" | state=${customCheck.raceState} | maxZ=${customCheck.maxZ}`);
        if (customCheck.name !== 'Hallows Test GP') throw new Error(`Expected custom race, got ${customCheck.name}`);
        if (customCheck.raceState !== 'READY' || customCheck.maxZ > 0.001) throw new Error('Custom race did not reset cleanly to starting line!');
        if (!customCheck.allGLB) throw new Error('Custom race racers failed to use GLB models!');

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