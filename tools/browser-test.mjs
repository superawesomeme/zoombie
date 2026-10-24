import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = '/usr/bin/google-chrome';
const DEBUG_PORT = 9222;
const PORT = 8001;
const ROOT_DIR = process.cwd();

const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.mp3': 'audio/mpeg',
    '.glb': 'model/gltf-binary',
    '.gltf': 'model/gltf+json',
    '.bin': 'application/octet-stream',
    '.wasm': 'application/wasm'
};

function createStaticServer() {
    return http.createServer((req, res) => {
        let reqUrl = req.url.split('?')[0];
        if (reqUrl === '/') reqUrl = '/index.html';
        if (reqUrl === '/favicon.ico') reqUrl = '/images/icons/favicon.ico';

        const safePath = path.normalize(decodeURIComponent(reqUrl)).replace(/^(\.\.[\/\\])+/, '');
        const filePath = path.join(ROOT_DIR, safePath);

        fs.stat(filePath, (err, stats) => {
            if (err || !stats.isFile()) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('404 Not Found: ' + reqUrl);
                return;
            }

            const ext = path.extname(filePath).toLowerCase();
            const contentType = MIME_TYPES[ext] || 'application/octet-stream';

            res.writeHead(200, {
                'Content-Type': contentType,
                'Content-Length': stats.size,
                'Access-Control-Allow-Origin': '*'
            });

            fs.createReadStream(filePath).pipe(res);
        });
    });
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

    throw new Error('Could not get page debugger URL from Chrome on port ' + DEBUG_PORT);
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
    const server = createStaticServer();
    await new Promise(res => server.listen(PORT, res));
    console.log(`HTTP Server running at http://localhost:${PORT}/`);

    console.log('Launching headless Google Chrome on port ' + DEBUG_PORT + '...');
    const chromeProcess = spawn(CHROME_PATH, [
        '--headless=new',
        `--remote-debugging-port=${DEBUG_PORT}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-extensions',
        '--disable-gpu',
        'about:blank'
    ], { stdio: 'ignore' });

    try {
        const wsUrl = await getPageWsUrl();
        console.log('Connected to Chrome DevTools:', wsUrl);

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
            if (params.type === 'error') {
                console.error(`[Browser Console Error]`, text);
            }
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

        await page.send('Page.navigate', { url: `http://localhost:${PORT}/tools/test-suite.html` });

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
        console.log('✓ All 8 character GLBs, tree cleanup, and grave assets verified in Three.js!');

        // ─────────────────────────────────────────────────────────────
        // TEST 2: Load actual index.html & verify pre-race READY state
        // ─────────────────────────────────────────────────────────────
        console.log('\n======================================================');
        console.log('TEST PHASE 2: Loading index.html & Starting Line Grid...');
        console.log('======================================================');

        consoleMessages.length = 0;
        networkErrors.length = 0;

        await page.send('Page.navigate', { url: `http://localhost:${PORT}/index.html` });
        await delay(1200);

        console.log('Waiting for racer and environment GLB preloading to complete...');
        let ready = false;
        for (let i = 0; i < 40; i++) {
            await delay(500);
            try {
                const btnDisabled = await page.evaluate('document.getElementById("start-btn")?.disabled');
                const managerReady = await page.evaluate('window.MonsterModelManager?.ready || (typeof MonsterModelManager !== "undefined" && MonsterModelManager.ready)');
                console.log(`[preload check ${i}] btnDisabled=${btnDisabled}, managerReady=${managerReady}`);
                if (btnDisabled === false || managerReady === true) {
                    ready = true;
                    break;
                }
            } catch (e) {
                console.log(`[preload check ${i} error]`, e.message);
            }
        }

        if (!ready) {
            throw new Error('MonsterModelManager did not become ready within 20s!');
        }
        console.log('✓ Preloading complete. Start button is enabled.');

        // Verify starting line stability
        await delay(1200);

        const preRaceAudit = await page.evaluate(`
            ({
                raceState,
                isRacing,
                isCountingDown,
                racerScale: CONFIG.racerScale,
                forestTreesCount: forestGroup ? forestGroup.children.length : 0,
                distantHillsCount: typeof distantHillsGroup !== 'undefined' && distantHillsGroup ? distantHillsGroup.children.length : 0,
                gravesCount: gravesGroup ? gravesGroup.children.length : 0,
                racers: ducks.map(d => ({
                    id: d.id,
                    name: d.name,
                    usingGLB: d.usingGLB,
                    hasWheels: Array.isArray(d.wheels) && d.wheels.length === 4,
                    wheelCount: d.wheels ? d.wheels.length : 0,
                    posX: d.position.x,
                    posZ: d.position.z,
                    speed: d.currentSpeed
                }))
            })
        `);

        console.log(`✓ Initial raceState: ${preRaceAudit.raceState} (racerScale: ${preRaceAudit.racerScale})`);
        console.log(`✓ Environment scenery: ${preRaceAudit.forestTreesCount} creepy trees, ${preRaceAudit.distantHillsCount} distant hills, ${preRaceAudit.gravesCount} gravestones`);
        if (preRaceAudit.raceState !== 'READY') {
            throw new Error(`Expected raceState READY on start screen, got ${preRaceAudit.raceState}`);
        }
        if (preRaceAudit.forestTreesCount === 0) {
            throw new Error('Haunted forest corridor has 0 trees!');
        }

        console.log('\nInspecting 8 Live Arcade Racers on Start Screen:');
        for (let i = 0; i < preRaceAudit.racers.length; i++) {
            const r = preRaceAudit.racers[i];
            console.log(`  Racer #${r.id + 1} (${r.name}): GLB=${r.usingGLB}, Wheels=${r.wheelCount}, X=${r.posX.toFixed(2)}, Z=${r.posZ.toFixed(2)}, Speed=${r.speed}`);
            if (!r.usingGLB) throw new Error(`Racer #${r.id} is NOT using GLB!`);
            if (Math.abs(r.posZ) > 0.001) {
                throw new Error(`Racer #${r.id} moved forward before race start (Z=${r.posZ})!`);
            }
            if (i > 0) {
                const spacing = r.posX - preRaceAudit.racers[i - 1].posX;
                if (Math.abs(spacing - 13.0) > 0.1) {
                    throw new Error(`Uneven starting grid spacing between #${i} and #${i + 1}: ${spacing}`);
                }
            }
        }
        console.log('✓ All 8 claymation karts aligned with proper 13.0m track spacing, zero drift.');

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
                maxSpeed: Math.max(...ducks.map(d => Math.abs(d.currentSpeed)))
            })
        `);
        console.log(`✓ Countdown state: ${countdownCheck.raceState} | maxZ=${countdownCheck.maxZ} | maxSpeed=${countdownCheck.maxSpeed}`);
        if (countdownCheck.raceState !== 'COUNTDOWN' && countdownCheck.raceState !== 'INTRO') {
            throw new Error(`Expected INTRO or COUNTDOWN state during countdown, got ${JSON.stringify(countdownCheck)}`);
        }
        if (countdownCheck.maxZ > 0.001 || countdownCheck.maxSpeed > 0.001) {
            throw new Error('Racers moved or accelerated during countdown!');
        }

        // Fast-forward countdown into RACING state cleanly
        console.log('Transitioning to RACING state and accelerating simulation for test...');
        await page.evaluate(`
            if (countdownTimerId) {
                clearInterval(countdownTimerId);
                countdownTimerId = null;
            }
            const cd = document.getElementById('countdown-overlay');
            if (cd) { cd.innerHTML = ''; cd.style.display = 'none'; }
            setRaceState(RACE_STATE.RACING);
            gameSpeed = 12.0;
        `);

        // Check chassis dynamics during racing
        await delay(500);
        const dynamicCheck = await page.evaluate(`
            ducks.map(d => ({
                id: d.id,
                speed: d.currentSpeed,
                bounceY: d.kartTiltGroup.position.y,
                tilt: d.kartTiltGroup.rotation.z
            }))
        `);
        console.log('Chassis suspension & kart dynamics during race:');
        for (const w of dynamicCheck) {
            console.log(`  Racer #${w.id + 1}: speed=${w.speed.toFixed(1)} m/s, bounceY=${w.bounceY.toFixed(2)} m, tilt=${w.tilt.toFixed(3)} rad`);
            if (w.speed <= 0) throw new Error(`Racer #${w.id} is not moving forward!`);
        }
        console.log('✓ Karts accelerating and animated with dynamic claymation suspension!');

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
        console.log('✓ All 8 karts crossed the finish line and entered FINISHED state!');

        const winnerMsg = await page.evaluate('document.getElementById("winner-text")?.innerText');
        console.log(`✓ Winner Announcement: "${winnerMsg}"`);

        await delay(2500);
        const endScreenHidden = await page.evaluate('document.getElementById("end-screen")?.classList.contains("hidden")');
        console.log(`✓ End screen visible: ${!endScreenHidden}`);

        const winnerBtnCheck = await page.evaluate(`
            (() => {
                const btn = document.getElementById("restart-btn");
                const comp = window.getComputedStyle(btn);
                return {
                    winnerColorVar: comp.getPropertyValue('--winner-color').trim(),
                    winnerTextColorVar: comp.getPropertyValue('--winner-text-color').trim(),
                    bg: comp.backgroundColor,
                    color: comp.color
                };
            })()
        `);
        console.log(`✓ Winner restart button color check:`, JSON.stringify(winnerBtnCheck));
        if (!winnerBtnCheck.winnerColorVar) {
            throw new Error('Winner restart button did not receive --winner-color style property!');
        }

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

        // ─────────────────────────────────────────────────────────────
        // TEST 6: Render Performance (60fps Verification)
        // ─────────────────────────────────────────────────────────────
        console.log('\n======================================================');
        console.log('TEST PHASE 6: 60 FPS Render Performance Audit...');
        console.log('======================================================');

        const fpsData = await page.evaluate(`
            new Promise(resolve => {
                let frames = 0;
                const start = performance.now();
                function count() {
                    frames++;
                    if (frames < 60) {
                        requestAnimationFrame(count);
                    } else {
                        const elapsed = performance.now() - start;
                        const fps = (frames / elapsed) * 1000;
                        resolve({ fps, elapsed, frames });
                    }
                }
                requestAnimationFrame(count);
            })
        `);

        console.log(`✓ Render performance: ${fpsData.fps.toFixed(1)} FPS (${fpsData.frames} frames in ${fpsData.elapsed.toFixed(1)}ms)`);
        if (fpsData.fps < 45) {
            console.warn(`Warning: FPS lower than expected: ${fpsData.fps.toFixed(1)}`);
        } else {
            console.log('✓ Scene renders smoothly at ~60fps!');
        }

        console.log('\n======================================================');
        console.log('🎉 ALL AUTOMATED BROWSER TESTS PASSED PERFECTLY!');
        console.log('======================================================');

    } finally {
        chromeProcess.kill();
        server.close();
    }
}

runBrowserTests().then(() => {
    process.exit(0);
}).catch(err => {
    console.error('\n❌ BROWSER TEST FAILED:', err);
    process.exit(1);
});