import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = '/usr/bin/google-chrome';
const DEBUG_PORT = 9226;
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
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.glb': 'model/gltf-binary'
};

function createStaticServer() {
    return http.createServer((req, res) => {
        let reqUrl = req.url.split('?')[0];
        if (reqUrl === '/') reqUrl = '/index.html';

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
            throw new Error(res.exceptionDetails.text || 'Evaluation failed: ' + JSON.stringify(res.exceptionDetails));
        }
        return res.result?.value;
    }

    close() {
        if (this.ws) this.ws.close();
    }
}

async function runDualScreenTest() {
    const server = createStaticServer();
    await new Promise(res => server.listen(PORT, res));
    console.log(`Server running on http://localhost:${PORT}`);

    const chrome = spawn(CHROME_PATH, [
        '--headless=new',
        `--remote-debugging-port=${DEBUG_PORT}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-gpu',
        'about:blank'
    ], { stdio: 'ignore' });

    try {
        // Tab 1: Projector (index.html)
        const projectorWsUrl = await getPageWsUrl();
        const projectorPage = new PageCDP(projectorWsUrl);
        await projectorPage.connect();
        await projectorPage.send('Runtime.enable');
        await projectorPage.send('Page.enable');
        projectorPage.on('Runtime.consoleAPICalled', (p) => {
            if (p.type === 'error') console.log('Projector console error:', p.args.map(a => a.value || a.description).join(' '));
        });
        projectorPage.on('Runtime.exceptionThrown', (p) => {
            console.error('Projector unhandled exception:', p.exceptionDetails.exception?.description || p.exceptionDetails.text);
        });
        await projectorPage.send('Page.navigate', { url: `http://localhost:${PORT}/index.html` });

        // Tab 2: Admin (admin.html)
        const adminRes = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?about:blank`, { method: 'PUT' });
        const adminData = await adminRes.json();
        const adminPage = new PageCDP(adminData.webSocketDebuggerUrl);
        await adminPage.connect();
        await adminPage.send('Runtime.enable');
        await adminPage.send('Page.enable');
        adminPage.on('Page.javascriptDialogOpening', async () => {
            await adminPage.send('Page.handleJavaScriptDialog', { accept: true });
        });
        await adminPage.send('Page.navigate', { url: `http://localhost:${PORT}/admin.html` });

        await delay(2500);
        await adminPage.evaluate(`window.alert = () => {}; window.confirm = () => true;`);
        await projectorPage.evaluate(`window.alert = () => {}; window.confirm = () => true;`);

        console.log('Dual screen loaded. Checking projector readiness and admin connection...');
        const adminPill = await adminPage.evaluate(`
            document.getElementById('projector-status-text')?.textContent
        `);
        console.log('Admin projector status text:', adminPill);

        // Submit bets from admin
        console.log('Entering bets in admin and submitting...');
        const clickRes = await adminPage.evaluate(`
            (() => {
                const sInp = document.querySelector('.start-ticket-input[data-lane="0"]');
                const nInp = document.querySelector('.next-ticket-input[data-lane="0"]');
                sInp.value = "10";
                sInp.dispatchEvent(new Event('input', { bubbles: true }));
                nInp.value = "30";
                nInp.dispatchEvent(new Event('input', { bubbles: true }));

                const mainBtn = document.getElementById('main-action-btn');
                const beforeText = mainBtn.textContent.trim();
                mainBtn.click(); // SUBMIT BETS TO SCREEN
                const afterText = mainBtn.textContent.trim();
                const session = JSON.parse(localStorage.getItem('zoombieSession_v1'));
                return {
                    beforeText,
                    afterText,
                    betsSubmitted: session?.betsSubmitted,
                    toteState: session?.toteState,
                    bet0: session?.currentBets[0],
                    div0: session?.currentDividends[0]
                };
            })()
        `);
        console.log('Admin click result:', clickRes);

        await delay(1000);

        // Check if projector preview updated with dividend payout
        const projectorPreview = await projectorPage.evaluate(`
            (() => {
                const session = JSON.parse(localStorage.getItem('zoombieSession_v1'));
                const previewPayout = document.querySelector('.preview-payout');
                const previewBox = document.getElementById('racer-preview');
                return {
                    sessionBetsSubmitted: session?.betsSubmitted,
                    hasPayoutBadge: !!previewPayout,
                    payoutText: previewPayout ? previewPayout.textContent : '',
                    previewHtml: previewBox ? previewBox.innerHTML.substring(0, 300) : ''
                };
            })()
        `);
        console.log('Projector preview after bets submitted:', projectorPreview);

        if (!projectorPreview.hasPayoutBadge) {
            throw new Error('Projector did not update preview with dividend badge after submission');
        }

        console.log('\n===========================================');
        console.log('DUAL SCREEN PROJECTOR SYNC PASSED 100%!');
        console.log('===========================================\n');
    } finally {
        chrome.kill();
        server.close();
    }
}

runDualScreenTest().catch(err => {
    console.error('Dual screen test failed:', err);
    process.exit(1);
});
