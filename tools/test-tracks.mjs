import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = '/usr/bin/google-chrome';
const DEBUG_PORT = 9233;
const PORT = 8011;
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
    '.ogg': 'audio/ogg',
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
            const timeout = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 300000);
            this.pending.set(id, { resolve: value => { clearTimeout(timeout); resolve(value); }, reject: error => { clearTimeout(timeout); reject(error); } });
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
            throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text || 'Evaluation failed');
        }
        return res.result?.value;
    }

    close() {
        if (this.ws) this.ws.close();
    }
}


const assert = (condition, message) => { if (!condition) throw new Error(message); };
const server = createStaticServer();
await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));
console.log('Track test server ready');
const chrome = spawn(CHROME_PATH, ['--headless=new', '--no-sandbox', '--window-size=800,600', '--disable-extensions', '--disable-background-networking', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--remote-debugging-port=${DEBUG_PORT}`, '--user-data-dir=/tmp/zoombie-track-test-v2', 'about:blank'], { stdio: 'ignore' });
let page;
process.on('SIGINT', () => { page?.close(); chrome.kill(); server.close(); process.exit(130); });
try {
    console.log('Connecting to Chrome');
    page = new PageCDP(await getPageWsUrl()); await page.connect();
    console.log('Chrome connected');
    await page.send('Runtime.enable'); await page.send('Page.enable');
    // Drive rendering explicitly so legacy GLB animation cannot monopolize a software GPU.
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.requestAnimationFrame = () => 0;' });
    const errors = [];
    page.on('Runtime.consoleAPICalled', p => console.log('Browser:', ...p.args.map(a => a.value ?? a.description)));
    page.on('Runtime.exceptionThrown', p => errors.push(p.exceptionDetails.exception?.description || p.exceptionDetails.text));
    await page.send('Page.navigate', { url: `http://localhost:${PORT}/` });
    let ready = false;
    for (let i = 0; i < 120; i++) {
        await delay(500);
        ready = await page.evaluate('typeof MonsterModelManager !== "undefined" && MonsterModelManager.ready && racers.length === 8').catch(() => false);
        if (ready) break;
        if (i % 20 === 0) console.log('Waiting for scene', i);
        if (errors.length) throw new Error(errors.join('\n'));
    }
    assert(ready, 'Scene did not become ready');
    console.log('Scene ready; checking tracks');
    const result = await page.evaluate(`(() => {
        renderer.setPixelRatio(1); renderer.setSize(640, 360); renderer.shadowMap.enabled = false;
        // Isolate the changed road/landmark buffers from the existing high-poly GLBs.
        const hidden = [forestGroup, gravesGroup, rocksGroup, propsGroup, hazardsGroup, distantHillsGroup, ...racers.map(r => r.mesh)];
        hidden.forEach(group => { group.visible = false; });
        const reports = [];
        for (let i = 0; i < 8; i++) {
            console.log('Checking map', i); currentRaceIndex = i; updateTrackForCurrentRace();
            renderer.render(scene, camera);
            const profile = activeTrackProfile;
            if (spookyScenery.group.children.some(m => !m.frustumCulled || !m.geometry.boundingSphere)) throw new Error('Missing chunk culling');
            const samples = [180, 360, 1000, 2000, 3800, 4080].map(z => {
                const p = profile.getPoint(z), h = .01;
                const derivative = (profile.getPoint(z+h).x - profile.getPoint(z-h).x) / (2*h);
                if (Math.abs(derivative - p.dx) > .0001) throw new Error('Invalid derivative: ' + profile.id);
                if (!Number.isFinite(p.x + p.heading + p.curvature)) throw new Error('Invalid profile');
                return p.x;
            });
            if (profile.getPoint(0).x !== 0 || profile.getPoint(4200).x !== 0) throw new Error('Grid/finish shifted');
            reports.push({ id: profile.id, samples, batches: spookyScenery.group.children.length,
                instances: spookyScenery.group.children.reduce((n,m) => n + m.count, 0),
                calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries });
        }
        const race = { id: 'custom_track_test', name: 'Track test', racers: DEFAULT_RACES[0].racers };
        storedRaces.push(race);
        const a = resolveSpookyTrack(race), b = resolveSpookyTrack(race);
        if (a !== b || !race.sceneryMap) throw new Error('Custom map not stable');
        if (!JSON.parse(localStorage.getItem(STORAGE_KEY)).some(r => r.sceneryMap === race.sceneryMap)) throw new Error('Assignment not saved');
        storedRaces.pop(); saveRaceData();
        // Rebuilding must dispose GPU buffers instead of growing geometries on every selection.
        for (let n = 0; n < 8; n++) { currentRaceIndex = n % 8; updateTrackForCurrentRace(); renderer.render(scene,camera); }
        const finalMemory = renderer.info.memory.geometries;
        if (finalMemory > reports[7].geometries + 10) throw new Error('Geometry leak');
        spawnCollisionSparks(0, 0); updateCollisionSparks(.1);
        if (!sparkPoints.visible) throw new Error('Sparks did not spawn');
        updateCollisionSparks(.5);
        if (sparkPoints.visible) throw new Error('Sparks did not expire');
        spawnFootstepMist(0,0,2); updateFootstepMist(.2);
        if (!mistPool[0].mesh.visible || mistPool[0].mesh.material.opacity <= 0) throw new Error('Smoke missing');
        resetFootstepMist();
        currentRaceIndex = 0; initRacers();
        racers.forEach(r => { r.mesh.visible = false; });
        return { reports, customMap: a.id, finalMemory, distance: CONFIG.raceDistance, racerCount: racers.length, state: raceState };
    })()`);
    console.log(JSON.stringify(result, null, 2));
    assert(new Set(result.reports.map(r => r.id)).size === 8, 'Maps are not unique');
    assert(new Set(result.reports.map(r => JSON.stringify(r.samples))).size === 8, 'Routes are not unique');
    assert(result.racerCount === 8 && result.distance === 4200, 'Simulation contract changed');
    await page.evaluate(`document.getElementById('start-screen').style.display = 'none'; document.getElementById('ui-layer').style.display = 'none'; updateCamera = () => {}; renderer.setSize(window.innerWidth, window.innerHeight); camera.position.set(260, 100, 1020); camera.lookAt(getActiveTrackPoint(1240).x, 15, 1240); renderer.render(scene, camera);`);
    await page.send('Page.captureScreenshot', { format: 'png' }).then(r => fs.writeFileSync('/tmp/zoombie-tracks.png', Buffer.from(r.data, 'base64')));
    assert(errors.length === 0, errors.join('\n'));
    console.log('Track, persistence, GPU disposal, smoke and spark checks passed.');
} finally {
    page?.close(); chrome.kill(); server.close();
}
