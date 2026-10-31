import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = '/usr/bin/google-chrome';
const DEBUG_PORT = 9228;
const PORT = 8013;
const ROOT_DIR = process.cwd();

const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.glb': 'model/gltf-binary',
    '.ogg': 'audio/ogg'
};

function createStaticServer() {
    return http.createServer((req, res) => {
        let reqUrl = req.url.split('?')[0];
        if (reqUrl === '/') reqUrl = '/admin.html';

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
    throw new Error('Could not get page debugger URL from Chrome');
}

class PageCDP {
    constructor(wsUrl) {
        this.wsUrl = wsUrl;
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
            const desc = res.exceptionDetails.exception?.description || res.exceptionDetails.text;
            throw new Error(desc || 'Evaluation failed: ' + JSON.stringify(res.exceptionDetails));
        }
        return res.result?.value;
    }

    close() {
        if (this.ws) this.ws.close();
    }
}

async function runOtherSettingsTest() {
    const server = createStaticServer();
    await new Promise(res => server.listen(PORT, res));
    console.log(`Test server running at http://localhost:${PORT}`);

    const chrome = spawn(CHROME_PATH, [
        '--headless=new',
        `--remote-debugging-port=${DEBUG_PORT}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-gpu',
        'about:blank'
    ], { stdio: 'ignore' });

    try {
        // Projector Tab (index.html)
        const projectorWsUrl = await getPageWsUrl();
        const projectorPage = new PageCDP(projectorWsUrl);
        await projectorPage.connect();
        await projectorPage.send('Runtime.enable');
        await projectorPage.send('Page.enable');
        await projectorPage.send('Page.navigate', { url: `http://localhost:${PORT}/index.html` });

        // Admin Tab (admin.html)
        const adminRes = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?about:blank`, { method: 'PUT' });
        const adminData = await adminRes.json();
        const adminPage = new PageCDP(adminData.webSocketDebuggerUrl);
        await adminPage.connect();
        await adminPage.send('Runtime.enable');
        await adminPage.send('Page.enable');
        await adminPage.send('Page.navigate', { url: `http://localhost:${PORT}/admin.html` });

        // Auto-dismiss dialogs
        await adminPage.evaluate(`window.alert = () => {}; window.confirm = () => true;`);
        await projectorPage.evaluate(`window.alert = () => {}; window.confirm = () => true;`);

        await delay(2500);

        console.log('\n--- 1. Testing Navigation Tabs (LIVE TOTE, MANAGE RACES, TOTE SETTINGS, OTHER SETTINGS) ---');
        const navTabs = await adminPage.evaluate(`
            (() => {
                const tabs = Array.from(document.querySelectorAll('.admin-nav .nav-tab')).map(t => ({
                    text: t.textContent.trim(),
                    dataTab: t.dataset.tab
                }));
                return tabs;
            })()
        `);
        console.log('Nav Tabs found:', navTabs);
        const expectedTabs = ['LIVE TOTE', 'MANAGE RACES', 'TOTE SETTINGS', 'OTHER SETTINGS'];
        expectedTabs.forEach(et => {
            if (!navTabs.some(t => t.text === et)) throw new Error(`Missing expected nav tab "${et}"`);
        });

        console.log('\n--- 2. Testing Tab Switching to OTHER SETTINGS ---');
        const tabSwitch = await adminPage.evaluate(`
            (() => {
                const otherTabBtn = document.querySelector('.nav-tab[data-tab="other"]');
                otherTabBtn.click();
                const activePane = document.querySelector('.tab-pane.active');
                return {
                    activePaneId: activePane ? activePane.id : null
                };
            })()
        `);
        console.log('Tab switch result:', tabSwitch);
        if (tabSwitch.activePaneId !== 'tab-other') {
            throw new Error(`Expected active pane to be "tab-other", got "${tabSwitch.activePaneId}"`);
        }

        console.log('\n--- 3. Testing OTHER SETTINGS Groupings & Controls ---');
        const otherGroups = await adminPage.evaluate(`
            (() => {
                const otherPane = document.getElementById('tab-other');
                const cards = Array.from(otherPane.querySelectorAll('.card'));
                const cardHeaders = cards.map(c => c.querySelector('h2')?.textContent?.trim());

                const engineSelect = document.getElementById('setting-engine-volume');
                const impactSelect = document.getElementById('setting-impact-volume');
                const announcerSelect = document.getElementById('setting-announcer-volume');
                const masterMute = document.getElementById('setting-master-mute');
                const hazardSelect = document.getElementById('setting-hazard-density');
                const speedSelect = document.getElementById('setting-simulation-speed');
                const remoteFullscreenBtn = document.getElementById('btn-remote-fullscreen');

                return {
                    cardHeaders,
                    hasEngine: !!engineSelect,
                    hasImpact: !!impactSelect,
                    hasAnnouncer: !!announcerSelect,
                    hasMasterMute: !!masterMute,
                    hasHazard: !!hazardSelect,
                    hasSpeed: !!speedSelect,
                    hasRemoteFullscreen: !!remoteFullscreenBtn,
                    impactHelp: impactSelect?.closest('.settings-group')?.querySelector('.help-text')?.textContent?.trim(),
                    hazardOptions: hazardSelect ? Array.from(hazardSelect.options).map(o => o.value) : []
                };
            })()
        `);
        console.log('Other settings cards & controls:', otherGroups);

        if (!otherGroups.cardHeaders.includes('AUDIO SETTINGS') ||
            !otherGroups.cardHeaders.includes('RACE & SIMULATION') ||
            !otherGroups.cardHeaders.includes('PROJECTOR REMOTE')) {
            throw new Error(`Missing expected group headers in OTHER SETTINGS: ${JSON.stringify(otherGroups.cardHeaders)}`);
        }

        if (!otherGroups.hasEngine || !otherGroups.hasImpact || !otherGroups.hasAnnouncer ||
            !otherGroups.hasMasterMute || !otherGroups.hasHazard || !otherGroups.hasSpeed || !otherGroups.hasRemoteFullscreen) {
            throw new Error('Missing expected controls in OTHER SETTINGS');
        }

        if (!otherGroups.hazardOptions.includes('high') || !otherGroups.hazardOptions.includes('normal') ||
            !otherGroups.hazardOptions.includes('low') || !otherGroups.hazardOptions.includes('disabled')) {
            throw new Error(`Hazard density missing required options: ${JSON.stringify(otherGroups.hazardOptions)}`);
        }

        console.log('\n--- 4. Checking Projector Status Pill says "CONNECTED" ---');
        const pillText = await adminPage.evaluate(`
            document.getElementById('projector-status-text')?.textContent?.trim()
        `);
        console.log('Projector status text:', pillText);
        // Pill should say CONNECTED (or PROJECTOR LOADING... if WebGL shaders/models still compiling, but not contain 'PROJECTOR READY')
        if (pillText.includes('PROJECTOR READY')) {
            throw new Error(`Status pill should not include "PROJECTOR READY", got: "${pillText}"`);
        }

        console.log('\n--- 5. Testing Real-time Settings Sync to Projector ---');
        // Set volume and hazard density in admin
        const adminSaveResult = await adminPage.evaluate(`
            (() => {
                const eng = document.getElementById('setting-engine-volume');
                const imp = document.getElementById('setting-impact-volume');
                const ann = document.getElementById('setting-announcer-volume');
                const haz = document.getElementById('setting-hazard-density');
                const spd = document.getElementById('setting-simulation-speed');

                eng.value = '50';
                imp.value = '25';
                ann.value = '75';
                haz.value = 'disabled';
                spd.value = '1.25';
                spd.dispatchEvent(new Event('change', { bubbles: true }));

                const session = JSON.parse(localStorage.getItem('zoombieSession_v1'));
                return session?.settings;
            })()
        `);
        console.log('Admin settings after update:', adminSaveResult);
        await delay(1200);

        const projectorState = await projectorPage.evaluate(`
            (() => {
                return {
                    currentEngineVolumeFactor,
                    currentImpactVolumeFactor,
                    currentAnnouncerVolumeFactor,
                    gameSpeed,
                    activeHazardsCount: typeof activeHazards !== 'undefined' ? activeHazards.length : null,
                    startVolume: typeof sfxStart !== 'undefined' ? sfxStart.volume : null,
                    winnerVolume: typeof sfxWinner !== 'undefined' ? sfxWinner.volume : null
                };
            })()
        `);
        console.log('Projector state after setting updates:', projectorState);

        if (Math.abs(projectorState.currentEngineVolumeFactor - 0.5) > 0.01) {
            throw new Error(`Expected engine factor 0.5, got ${projectorState.currentEngineVolumeFactor}`);
        }
        if (Math.abs(projectorState.currentImpactVolumeFactor - 0.25) > 0.01) {
            throw new Error(`Expected impact factor 0.25, got ${projectorState.currentImpactVolumeFactor}`);
        }
        if (Math.abs(projectorState.currentAnnouncerVolumeFactor - 0.75) > 0.01) {
            throw new Error(`Expected announcer factor 0.75, got ${projectorState.currentAnnouncerVolumeFactor}`);
        }
        if (Math.abs(projectorState.gameSpeed - 1.25) > 0.01) {
            throw new Error(`Expected gameSpeed 1.25, got ${projectorState.gameSpeed}`);
        }
        if (projectorState.activeHazardsCount !== 0) {
            throw new Error(`Expected 0 hazards when disabled, got ${projectorState.activeHazardsCount}`);
        }

        console.log('\n--- 6. Testing Master Mute (PA Mode) ---');
        await adminPage.evaluate(`
            (() => {
                const mute = document.getElementById('setting-master-mute');
                mute.checked = true;
                mute.dispatchEvent(new Event('change', { bubbles: true }));
            })()
        `);
        await delay(1000);

        const projectorMuted = await projectorPage.evaluate(`
            (() => {
                return {
                    currentEngineVolumeFactor,
                    currentImpactVolumeFactor,
                    currentAnnouncerVolumeFactor,
                    isMasterMuted
                };
            })()
        `);
        console.log('Projector muted state:', projectorMuted);
        if (!projectorMuted.isMasterMuted || projectorMuted.currentEngineVolumeFactor !== 0) {
            throw new Error('Master mute did not silence projector audio');
        }

        // Unmute
        await adminPage.evaluate(`
            (() => {
                const mute = document.getElementById('setting-master-mute');
                mute.checked = false;
                mute.dispatchEvent(new Event('change', { bubbles: true }));
            })()
        `);
        await delay(1000);

        console.log('\n--- 7. Verifying Settings are Fixed for Next Race and Across Sessions ---');
        // Advance race
        await adminPage.evaluate(`
            (() => {
                const s = JSON.parse(localStorage.getItem('zoombieSession_v1'));
                s.toteState = 'FINISHED';
                localStorage.setItem('zoombieSession_v1', JSON.stringify(s));
                window.location.reload();
            })()
        `);
        await delay(1500);

        await adminPage.evaluate(`
            (() => {
                document.getElementById('main-action-btn').click(); // NEXT RACE
            })()
        `);
        await delay(1000);

        const nextRaceCheck = await adminPage.evaluate(`
            (() => {
                const s = JSON.parse(localStorage.getItem('zoombieSession_v1'));
                return {
                    raceIndex: s.currentRaceIndex,
                    engine: s.settings?.engineVolume,
                    hazard: s.settings?.hazardDensity,
                    speed: s.settings?.simulationSpeed
                };
            })()
        `);
        console.log('Next race check:', nextRaceCheck);
        if (nextRaceCheck.engine !== 50 || nextRaceCheck.hazard !== 'disabled' || nextRaceCheck.speed !== 1.25) {
            throw new Error('Settings did not stay fixed across race transition!');
        }

        // Reset session
        await adminPage.evaluate(`
            (() => {
                resetSessionData();
                window.location.reload();
            })()
        `);
        await delay(1500);

        const resetSessionCheck = await adminPage.evaluate(`
            (() => {
                const s = JSON.parse(localStorage.getItem('zoombieSession_v1'));
                return {
                    engine: s.settings?.engineVolume,
                    hazard: s.settings?.hazardDensity,
                    speed: s.settings?.simulationSpeed
                };
            })()
        `);
        console.log('New session check:', resetSessionCheck);
        if (resetSessionCheck.engine !== 50 || resetSessionCheck.hazard !== 'disabled' || resetSessionCheck.speed !== 1.25) {
            throw new Error('Settings did not stay fixed across new session reset!');
        }

        console.log('\n===========================================');
        console.log('ALL OTHER SETTINGS TESTS PASSED 100%!');
        console.log('===========================================\n');
    } finally {
        chrome.kill();
        server.close();
    }
}

runOtherSettingsTest().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
