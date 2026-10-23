import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = '/usr/bin/google-chrome';
const DEBUG_PORT = 9275;
const PORT = 8000;

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
    const chrome = spawn(CHROME_PATH, [
        '--headless=new',
        `--remote-debugging-port=${DEBUG_PORT}`,
        '--no-first-run',
        '--window-size=1280,720',
        'about:blank'
    ]);

    try {
        await delay(1000);
        const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
        const list = await res.json();
        const ws = new WebSocket(list[0].webSocketDebuggerUrl);
        await new Promise(r => ws.onopen = r);

        let id = 1;
        function send(method, params = {}) {
            return new Promise((resolve, reject) => {
                const reqId = id++;
                const handler = (e) => {
                    const d = JSON.parse(e.data);
                    if (d.id === reqId) {
                        ws.removeEventListener('message', handler);
                        if (d.error) reject(new Error(d.error.message));
                        else resolve(d.result);
                    }
                };
                ws.addEventListener('message', handler);
                ws.send(JSON.stringify({ id: reqId, method, params }));
            });
        }

        await send('Page.enable');
        await send('Page.navigate', { url: `http://localhost:${PORT}/index.html` });
        await delay(2500);

        const testRes = await send('Runtime.evaluate', {
            expression: `
                new Promise((resolve) => {
                    loader.load('models/bat.glb', (gltf) => {
                        const batMesh = gltf.scene;
                        const clip = gltf.animations[0];
                        const mixer = new THREE.AnimationMixer(batMesh);
                        const action = mixer.clipAction(clip);
                        action.play();
                        
                        const camPos = camera.position.clone();
                        const camDir = new THREE.Vector3();
                        camera.getWorldDirection(camDir);
                        
                        // Place bat right in front of camera
                        batMesh.position.copy(camPos).addScaledVector(camDir, 18);
                        batMesh.scale.setScalar(0.7);
                        batMesh.lookAt(camPos); // Face towards camera
                        batMesh.rotation.y += Math.PI; // Correct for head forward
                        
                        scene.add(batMesh);
                        mixer.update(0.5);
                        renderer.render(scene, camera);
                        
                        resolve({ ok: true, pos: batMesh.position });
                    });
                })
            `,
            awaitPromise: true,
            returnByValue: true
        });

        console.log('Placed bat in front of camera:', testRes.result?.value);
        await delay(200);

        const shot = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync('tools/bat-test-render.png', Buffer.from(shot.data, 'base64'));
        console.log('Saved tools/bat-test-render.png');

        ws.close();
    } finally {
        chrome.kill('SIGKILL');
        process.exit(0);
    }
}

run().catch(console.error);
