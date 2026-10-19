/**
 * CONFIGURATION & DATA MANAGEMENT
 */
const CONFIG = {
    racerCount: 8,
    duckCount: 8, // legacy alias
    raceDistance: 4200,
    targetDuration: 92,
    roadWidth: 120,
    racerScale: 7.2
};

// Explicit Race State Machine
const RACE_STATE = {
    READY: 'READY',
    INTRO: 'INTRO',
    COUNTDOWN: 'COUNTDOWN',
    RACING: 'RACING',
    FINISHED: 'FINISHED'
};

// Colours for the 8 lanes (matching the monster identities)
const COLORS = [
    0xF42941, // 0: Red - Vampire
    0xE9862A, // 1: Orange - Pumpkin
    0xF0F136, // 2: Yellow - Mummy
    0x50C878, // 3: Green - Monster
    0x00A8FF, // 4: Blue - Ghost
    0x9C27B0, // 5: Purple - Witch
    0x607D8B, // 6: Grey - Werewolf
    0xF3F5F7  // 7: White - Skeleton
];

const STORAGE_KEY = 'zoombieRaceData_v2';

// Preload Creepster font immediately so the countdown glyphs are ready in memory
if (typeof document !== 'undefined' && document.fonts && document.fonts.load) {
    document.fonts.load("200px 'Creepster'").catch(e => console.warn("Creepster preload:", e));
}

// App State
let storedRaces = [];
let currentRaceIndex = 0;
let gameSpeed = 1.0;

// Explicit state tracking + backwards-compatible boolean flags
let raceState = RACE_STATE.READY;
let isRacing = false;
let isCountingDown = false;
let raceEnded = false;
let firstFinishTriggered = false;
let winnerFinishTime = 0;
let countdownTimerId = null;

// Camera start line fly-by state
let introFlybyTimer = 0;
let introFlybyActive = false;

function setRaceState(nextState) {
    raceState = nextState;
    isCountingDown = (nextState === RACE_STATE.COUNTDOWN);
    isRacing = (nextState === RACE_STATE.RACING || nextState === RACE_STATE.FINISHED);
    raceEnded = (nextState === RACE_STATE.FINISHED);
}

// -- AUDIO SETUP (All .ogg arcade sound effects) --
const sfxRace = new Audio('audio/race.ogg');
sfxRace.loop = true;
sfxRace.volume = 0;

const sfxEngine = new Audio('audio/engine.ogg');
sfxEngine.loop = false;
sfxEngine.volume = 0.95;

const sfxStart = new Audio('audio/start.ogg');
sfxStart.volume = 1.0;

const sfxWinner = new Audio('audio/winner.ogg');
sfxWinner.volume = 1.0;

// Collision thud audio pool for punchy, overlapping collision sounds
const THUD_POOL_SIZE = 6;
const thudAudioPool = Array.from({ length: THUD_POOL_SIZE }, () => {
    const a = new Audio('audio/thud.ogg');
    a.volume = 0.90;
    return a;
});
let thudPoolIndex = 0;
let lastThudSoundTime = 0;

function playThudSound(time) {
    if (time !== undefined && time - lastThudSoundTime < 0.08) return;
    if (time !== undefined) lastThudSoundTime = time;

    const audio = thudAudioPool[thudPoolIndex];
    thudPoolIndex = (thudPoolIndex + 1) % THUD_POOL_SIZE;
    audio.currentTime = 0;
    audio.play().catch(e => console.warn("Thud sound failed:", e));
}

// Hazard audio pools (slime.ogg & leaves.ogg)
const SLIME_POOL_SIZE = 4;
const slimeAudioPool = Array.from({ length: SLIME_POOL_SIZE }, () => {
    const a = new Audio('audio/slime.ogg');
    a.volume = 0.95;
    return a;
});
let slimePoolIndex = 0;
let lastSlimeSoundTime = 0;

function playSlimeSound(time) {
    if (time !== undefined && time - lastSlimeSoundTime < 0.10) return;
    if (time !== undefined) lastSlimeSoundTime = time;
    const a = slimeAudioPool[slimePoolIndex];
    slimePoolIndex = (slimePoolIndex + 1) % SLIME_POOL_SIZE;
    a.currentTime = 0;
    a.play().catch(e => console.warn("Slime sound failed:", e));
}

const LEAF_POOL_SIZE = 4;
const leafAudioPool = Array.from({ length: LEAF_POOL_SIZE }, () => {
    const a = new Audio('audio/leaves.ogg');
    a.volume = 0.95;
    return a;
});
let leafPoolIndex = 0;
let lastLeafSoundTime = 0;

function playLeavesSound(time) {
    if (time !== undefined && time - lastLeafSoundTime < 0.10) return;
    if (time !== undefined) lastLeafSoundTime = time;
    const a = leafAudioPool[leafPoolIndex];
    leafPoolIndex = (leafPoolIndex + 1) % LEAF_POOL_SIZE;
    a.currentTime = 0;
    a.play().catch(e => console.warn("Leaves sound failed:", e));
}

// Dynamic race audio state (starts at 100% volume, decreased by 17% per finished racer)
let raceAudioTargetVolume = 1.0;
let isFadingInRaceAudio = false;
let raceAudioFadeTimer = 0;

function startRaceAudio() {
    if (fadeInterval) clearInterval(fadeInterval);
    sfxRace.currentTime = 0;
    sfxRace.volume = 1.0;
    sfxRace.loop = true;
    raceAudioTargetVolume = 1.0;
    isFadingInRaceAudio = false;
    sfxRace.play().catch(e => console.warn("Race audio play failed:", e));
}

function decreaseRaceAudioVolume(percentage = 0.17) {
    raceAudioTargetVolume = Math.max(0, raceAudioTargetVolume - percentage);
}

// --- GENERATED HALLOWEEN AUDIO ENGINE (Spooky Countdown & Ambience) ---
class RaceAudio {
    constructor() {
        this.ctx = null;
        this.gain = null;
    }

    init() {
        if (!this.ctx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AC();
            this.gain = this.ctx.createGain();
            this.gain.connect(this.ctx.destination);
        }
        if (this.ctx.state === 'suspended') this.ctx.resume();
    }

    playSpookyChord(baseFreq, duration) {
        if (!this.ctx) return;
        const freqs = [baseFreq, baseFreq * 1.189, baseFreq * 1.414];
        const now = this.ctx.currentTime;

        freqs.forEach((f) => {
            const osc = this.ctx.createOscillator();
            const env = this.ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(f, now);

            osc.connect(env);
            env.connect(this.gain);

            env.gain.setValueAtTime(0, now);
            env.gain.linearRampToValueAtTime(0.08, now + 0.04);
            env.gain.exponentialRampToValueAtTime(0.001, now + duration);

            osc.start(now);
            osc.stop(now + duration + 0.05);
        });
    }

    playCountdown(step) {
        this.init();
        if (step === 3) this.playSpookyChord(220, 0.45);
        else if (step === 2) this.playSpookyChord(207.65, 0.45);
        else if (step === 1) this.playSpookyChord(196.0, 0.55);
    }
}
const raceAudio = new RaceAudio();

let fadeInterval = null;

function fadeOutAudio(audio, duration) {
    if (fadeInterval) clearInterval(fadeInterval);
    const startVolume = audio.volume;
    const stepTime = 50;
    const steps = duration / stepTime;
    const stepAmount = startVolume / steps;

    fadeInterval = setInterval(() => {
        if (audio.volume > stepAmount) {
            audio.volume -= stepAmount;
        } else {
            audio.volume = 0;
            audio.pause();
            clearInterval(fadeInterval);
            fadeInterval = null;
        }
    }, stepTime);
}

// -- STORAGE LOGIC --
function loadRaceData() {
    const data = localStorage.getItem(STORAGE_KEY);
    if (data) {
        try {
            const parsed = JSON.parse(data);
            const customRaces = Array.isArray(parsed) ? parsed.filter(r => r.id && String(r.id).startsWith('custom_')) : [];
            if (typeof DEFAULT_RACES !== 'undefined') {
                storedRaces = JSON.parse(JSON.stringify(DEFAULT_RACES)).concat(customRaces);
            } else {
                storedRaces = parsed;
            }
        } catch (e) {
            storedRaces = (typeof DEFAULT_RACES !== 'undefined') ? JSON.parse(JSON.stringify(DEFAULT_RACES)) : [];
        }
    } else if (typeof DEFAULT_RACES !== 'undefined') {
        storedRaces = JSON.parse(JSON.stringify(DEFAULT_RACES));
    } else {
        storedRaces = [];
    }
    populateRaceSelector();
    updateRacerPreview();
}

function saveRaceData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(storedRaces));
}

function resetData() {
    if (confirm("Delete all custom races and reset to Halloween defaults?")) {
        localStorage.removeItem(STORAGE_KEY);
        loadRaceData();
        alert("Data reset.");
    }
}

function loadAboutInfo() {
    const container = document.getElementById('about-content-container');
    if (container && typeof APP_INFO !== 'undefined') {
        let creditsHtml = '';
        if (Array.isArray(APP_INFO.credits) && APP_INFO.credits.length > 0) {
            creditsHtml = `
                <div style="margin-top: 15px; border-top: 1px solid rgba(255,255,255,0.15); padding-top: 12px; text-align: left; font-size: 0.85rem; color: #bbb;">
                    <p style="font-weight: bold; margin-bottom: 6px; color: #fff;">Asset Attributions (CC BY 4.0):</p>
                    <ul style="padding-left: 18px; margin: 0 0 10px 0; line-height: 1.4;">
                        ${APP_INFO.credits.map(c => `
                            <li style="margin-bottom: 6px;">
                                <a href="${c.url}" target="_blank" rel="noopener" style="color: #ff9800; text-decoration: underline;">"${c.title}"</a> by ${c.author} is licensed under <a href="${c.licenseUrl}" target="_blank" rel="noopener" style="color: #ff9800; text-decoration: underline;">${c.license}</a>.
                            </li>
                        `).join('')}
                    </ul>
                </div>
            `;
        }
        container.innerHTML = `
            <p><strong>${APP_INFO.title}</strong></p>
            <p>${APP_INFO.version}</p>
            <br>
            <p>${APP_INFO.description}</p>
            ${creditsHtml}
            <br>
            <p style="color:#888; font-size: 0.9rem;">${APP_INFO.copyright}</p>
        `;
    }
}

/**
 * THREE.JS SCENE, PURPLE/NAVY GRADIENT SKY & BALANCED CARTOON NIGHT LIGHTING
 */
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 0.5, 2500);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
// Balanced exposure so colours stay rich and saturated without over-exposing highlights
renderer.toneMappingExposure = 0.98;
container.appendChild(renderer.domElement);

// Deep midnight purple starry night sky background matching scene fog
const SKY_COLOR = 0x22133d;
scene.background = new THREE.Color(SKY_COLOR);
renderer.setClearColor(SKY_COLOR, 1);

// Distance Fog matching the deep midnight purple sky for seamless infinite horizon fade
const FOG_COLOR = SKY_COLOR;
const FOG_NEAR = 180;
const FOG_FAR = 1200;
scene.fog = new THREE.Fog(FOG_COLOR, FOG_NEAR, FOG_FAR);

// --- BALANCED CARTOON NIGHT LIGHTING (Not over-exposed, strong colour separation) ---
const ambientLight = new THREE.AmbientLight(0x3d2b63, 0.42);
scene.add(ambientLight);

const hemiLight = new THREE.HemisphereLight(0x7aa7ff, 0x261342, 0.78);
scene.add(hemiLight);

// Crisp silvery-blue moonlight with dynamic shadow frustum following the racers
const moonLight = new THREE.DirectionalLight(0xc2dcff, 0.95);
moonLight.position.set(45, 95, 60);
moonLight.castShadow = true;
moonLight.shadow.mapSize.width = 2048;
moonLight.shadow.mapSize.height = 2048;
moonLight.shadow.camera.near = 10;
moonLight.shadow.camera.far = 260;
moonLight.shadow.camera.left = -85;
moonLight.shadow.camera.right = 85;
moonLight.shadow.camera.top = 105;
moonLight.shadow.camera.bottom = -105;
moonLight.shadow.bias = -0.0005;
scene.add(moonLight);
scene.add(moonLight.target);

// Gentle warm front fill & cool cyan rim light that track the pack (non-shadow casting)
const packFillLight = new THREE.DirectionalLight(0xffa752, 0.48);
packFillLight.position.set(-18, 28, 35);
scene.add(packFillLight);
scene.add(packFillLight.target);

const packRimLight = new THREE.DirectionalLight(0x66ccff, 0.36);
packRimLight.position.set(0, 32, -45);
scene.add(packRimLight);
scene.add(packRimLight.target);

const textureLoader = new THREE.TextureLoader();

/**
 * PROCEDURAL TEXTURES (High-contrast readable road & stonework)
 */
function createRoadTexture() {
    const cvs = document.createElement('canvas');
    cvs.width = 512;
    cvs.height = 512;
    const ctx = cvs.getContext('2d');

    // Deep indigo-slate cartoon tarmac for strong monster separation
    ctx.fillStyle = '#211d30';
    ctx.fillRect(0, 0, 512, 512);

    // Subtle stylised road texture
    for (let i = 0; i < 6500; i++) {
        const x = Math.random() * 512;
        const y = Math.random() * 512;
        const v = 28 + Math.floor(Math.random() * 20);
        ctx.fillStyle = `rgb(${v}, ${v - 2}, ${v + 12})`;
        ctx.fillRect(x, y, 2, 2);
    }

    // Mossy/purple-tinted shoulders + bright orange edge stripes
    const leftGrad = ctx.createLinearGradient(0, 0, 55, 0);
    leftGrad.addColorStop(0, '#202e1e');
    leftGrad.addColorStop(1, 'rgba(33, 29, 48, 0)');
    ctx.fillStyle = leftGrad;
    ctx.fillRect(0, 0, 55, 512);

    const rightGrad = ctx.createLinearGradient(512, 0, 457, 0);
    rightGrad.addColorStop(0, '#202e1e');
    rightGrad.addColorStop(1, 'rgba(33, 29, 48, 0)');
    ctx.fillStyle = rightGrad;
    ctx.fillRect(457, 0, 55, 512);

    // Halloween orange road edge lines
    ctx.fillStyle = 'rgba(255, 130, 0, 0.65)';
    ctx.fillRect(18, 0, 6, 512);
    ctx.fillRect(488, 0, 6, 512);

    // Warm double amber centre lines
    ctx.fillStyle = 'rgba(245, 175, 70, 0.58)';
    ctx.fillRect(249, 0, 4, 512);
    ctx.fillRect(259, 0, 4, 512);

    // Clear lane dividers
    ctx.fillStyle = 'rgba(205, 200, 230, 0.30)';
    for (let y = 0; y < 512; y += 64) {
        ctx.fillRect(134, y, 4, 34);
        ctx.fillRect(374, y, 4, 34);
    }

    // Stylised cracks
    ctx.strokeStyle = '#13101d';
    ctx.lineWidth = 2;
    for (let c = 0; c < 14; c++) {
        ctx.beginPath();
        let cx = 40 + Math.random() * 430;
        let cy = Math.random() * 512;
        ctx.moveTo(cx, cy);
        for (let s = 0; s < 5; s++) {
            cx += (Math.random() - 0.5) * 35;
            cy += (Math.random() - 0.5) * 35;
            ctx.lineTo(cx, cy);
        }
        ctx.stroke();
    }

    const tex = new THREE.CanvasTexture(cvs);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 133);
    return tex;
}

function createCryptStoneTexture() {
    const cvs = document.createElement('canvas');
    cvs.width = 128;
    cvs.height = 128;
    const ctx = cvs.getContext('2d');
    ctx.fillStyle = '#453e59';
    ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 800; i++) {
        ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.14)';
        ctx.fillRect(Math.random() * 128, Math.random() * 128, 3, 3);
    }
    const tex = new THREE.CanvasTexture(cvs);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
}

function createWastelandGrassTexture() {
    const cvs = document.createElement('canvas');
    cvs.width = 512;
    cvs.height = 512;
    const ctx = cvs.getContext('2d');

    // 1. Base dark haunted moss & soil ground
    ctx.fillStyle = '#162417';
    ctx.fillRect(0, 0, 512, 512);

    // 2. Seamless wrapped soft organic patches of decayed earth, boggy moss & haunted purple undertones
    function drawWrapBlob(cx, cy, r, color) {
        for (let ox of [-512, 0, 512]) {
            for (let oy of [-512, 0, 512]) {
                const x = cx + ox;
                const y = cy + oy;
                if (x + r < 0 || x - r > 512 || y + r < 0 || y - r > 512) continue;
                const radGrad = ctx.createRadialGradient(x, y, 0, x, y, r);
                radGrad.addColorStop(0, color);
                radGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
                ctx.fillStyle = radGrad;
                ctx.beginPath();
                ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    // Decayed dark soil patches
    for (let i = 0; i < 45; i++) {
        const x = Math.random() * 512;
        const y = Math.random() * 512;
        const r = 35 + Math.random() * 55;
        drawWrapBlob(x, y, r, 'rgba(20, 14, 26, 0.48)');
    }

    // Rich mossy green patches
    for (let i = 0; i < 55; i++) {
        const x = Math.random() * 512;
        const y = Math.random() * 512;
        const r = 30 + Math.random() * 60;
        drawWrapBlob(x, y, r, 'rgba(34, 58, 32, 0.52)');
    }

    // Eerie sickly-lichen patches
    for (let i = 0; i < 30; i++) {
        const x = Math.random() * 512;
        const y = Math.random() * 512;
        const r = 20 + Math.random() * 40;
        drawWrapBlob(x, y, r, 'rgba(50, 78, 44, 0.35)');
    }

    // Haunted purple undertones
    for (let i = 0; i < 25; i++) {
        const x = Math.random() * 512;
        const y = Math.random() * 512;
        const r = 25 + Math.random() * 45;
        drawWrapBlob(x, y, r, 'rgba(40, 22, 54, 0.28)');
    }

    // 3. Dense organic stippling & fine soil grain
    for (let i = 0; i < 20000; i++) {
        const x = Math.floor(Math.random() * 512);
        const y = Math.floor(Math.random() * 512);
        const rand = Math.random();
        if (rand < 0.35) {
            ctx.fillStyle = 'rgba(10, 18, 12, 0.38)';
        } else if (rand < 0.70) {
            ctx.fillStyle = 'rgba(42, 68, 38, 0.30)';
        } else if (rand < 0.90) {
            ctx.fillStyle = 'rgba(65, 102, 58, 0.24)';
        } else {
            ctx.fillStyle = 'rgba(50, 32, 65, 0.22)';
        }
        ctx.fillRect(x, y, 2, 2);
    }

    // 4. Stylized cartoon grass clumps (with seamless boundary wrapping)
    function drawGrassClump(cx, cy, count, baseLen) {
        for (let ox of [-512, 0, 512]) {
            for (let oy of [-512, 0, 512]) {
                const bx = cx + ox;
                const by = cy + oy;
                if (bx < -40 || bx > 552 || by < -40 || by > 552) continue;

                for (let b = 0; b < count; b++) {
                    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.1;
                    const len = baseLen * (0.75 + Math.random() * 0.5);
                    const tipX = bx + Math.cos(angle) * len;
                    const tipY = by + Math.sin(angle) * len;
                    const cpX = bx + Math.cos(angle + (Math.random() - 0.5) * 0.4) * (len * 0.5);
                    const cpY = by + Math.sin(angle) * (len * 0.5);

                    // Blade dark shadow / base
                    ctx.strokeStyle = 'rgba(12, 22, 14, 0.80)';
                    ctx.lineWidth = 2.4;
                    ctx.beginPath();
                    ctx.moveTo(bx, by);
                    ctx.quadraticCurveTo(cpX, cpY, tipX, tipY);
                    ctx.stroke();

                    // Blade midtone green
                    ctx.strokeStyle = Math.random() > 0.4 ? 'rgba(55, 92, 50, 0.85)' : 'rgba(72, 115, 62, 0.80)';
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.moveTo(bx, by);
                    ctx.quadraticCurveTo(cpX, cpY, tipX, tipY);
                    ctx.stroke();

                    // Tiny highlight at the tip
                    ctx.fillStyle = 'rgba(110, 165, 95, 0.75)';
                    ctx.fillRect(tipX - 0.5, tipY - 0.5, 1.5, 1.5);
                }
            }
        }
    }

    // Scatter tufts of wild cartoon grass across the tile
    for (let i = 0; i < 340; i++) {
        const x = Math.random() * 512;
        const y = Math.random() * 512;
        const bladeCount = 3 + Math.floor(Math.random() * 4);
        const bladeLen = 9 + Math.random() * 11;
        drawGrassClump(x, y, bladeCount, bladeLen);
    }

    // 5. Build Texture with Repeat Wrapping and Anisotropic Filtering
    const tex = new THREE.CanvasTexture(cvs);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    // Verge is 1400m wide and 9000m long: 20m x 20m per tile gives isotropic 1:1 square ratio
    tex.repeat.set(70, 450);
    tex.encoding = THREE.sRGBEncoding;
    if (renderer && renderer.capabilities) {
        tex.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
    }
    return tex;
}

const roadTex = createRoadTexture();
const stoneTex = createCryptStoneTexture();
const grassTex = createWastelandGrassTexture();

/**
 * HAUNTED ROAD, MOON, STARS & INSTANCED ENVIRONMENT
 */
const landscapeGroup = new THREE.Group();
scene.add(landscapeGroup);

// 1. Haunted Road, Kerbs & Verges (Extended symmetrically so both start line and finish line look into deep fog)
const roadLength = CONFIG.raceDistance + 4800; // 4200 + 4800 = 9000m (extends 2400m before start and 2400m after finish)
const roadGeo = new THREE.PlaneGeometry(CONFIG.roadWidth, roadLength);
const roadMat = new THREE.MeshStandardMaterial({
    map: roadTex,
    roughness: 0.82,
    metalness: 0.05
});
const roadMesh = new THREE.Mesh(roadGeo, roadMat);
roadMesh.rotation.x = -Math.PI / 2;
roadMesh.position.set(0, 0, CONFIG.raceDistance / 2);
roadMesh.receiveShadow = true;
landscapeGroup.add(roadMesh);

// 2. Raised Stone Kerbs & Haunted Verges
const kerbGeo = new THREE.BoxGeometry(2.5, 0.9, roadLength);
const kerbMat = new THREE.MeshStandardMaterial({ map: stoneTex, color: 0x706687, roughness: 0.85 });

const roadHalf = CONFIG.roadWidth / 2;

const leftKerb = new THREE.Mesh(kerbGeo, kerbMat);
leftKerb.position.set(-roadHalf - 1.25, 0.45, CONFIG.raceDistance / 2);
leftKerb.receiveShadow = true;
landscapeGroup.add(leftKerb);

const rightKerb = new THREE.Mesh(kerbGeo, kerbMat);
rightKerb.position.set(roadHalf + 1.25, 0.45, CONFIG.raceDistance / 2);
rightKerb.receiveShadow = true;
landscapeGroup.add(rightKerb);

const vergeWidth = 1400;
const vergeGeo = new THREE.BoxGeometry(vergeWidth, 20, roadLength);
const vergeMat = new THREE.MeshStandardMaterial({
    map: grassTex,
    roughness: 0.88,
    metalness: 0.05
});

const leftVerge = new THREE.Mesh(vergeGeo, vergeMat);
leftVerge.position.set(-roadHalf - 2.5 - (vergeWidth / 2), -9.8, CONFIG.raceDistance / 2);
leftVerge.receiveShadow = true;
landscapeGroup.add(leftVerge);

const rightVerge = new THREE.Mesh(vergeGeo, vergeMat);
rightVerge.position.set(roadHalf + 2.5 + (vergeWidth / 2), -9.8, CONFIG.raceDistance / 2);
rightVerge.receiveShadow = true;
landscapeGroup.add(rightVerge);

// 3. Full Moon & Starfield (Positioned safely above bird's-eye camera while visible during racing)
const moonGroup = new THREE.Group();
const moonGeo = new THREE.SphereGeometry(60, 32, 32);
const moonMat = new THREE.MeshBasicMaterial({ color: 0xfff5d6, fog: false });
const moonMesh = new THREE.Mesh(moonGeo, moonMat);
moonGroup.add(moonMesh);

const haloCanvas = document.createElement('canvas');
haloCanvas.width = 128; haloCanvas.height = 128;
const hCtx = haloCanvas.getContext('2d');
const hGrad = hCtx.createRadialGradient(64, 64, 10, 64, 64, 64);
hGrad.addColorStop(0, 'rgba(255, 238, 185, 0.58)');
hGrad.addColorStop(0.5, 'rgba(255, 155, 60, 0.22)');
hGrad.addColorStop(1, 'rgba(160, 90, 255, 0)');
hCtx.fillStyle = hGrad;
hCtx.fillRect(0, 0, 128, 128);
const haloSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(haloCanvas),
    blending: THREE.AdditiveBlending,
    fog: false
}));
haloSprite.scale.set(280, 280, 1);
moonGroup.add(haloSprite);
moonGroup.position.set(80, 210, CONFIG.raceDistance + 550);
scene.add(moonGroup);

// Stars placed safely above aerial camera (Y: 130m - 390m) so they twinkle in the night sky during racing without clashing
const starCount = 700;
const starPositions = new Float32Array(starCount * 3);
for (let i = 0; i < starCount; i++) {
    starPositions[i * 3] = (Math.random() - 0.5) * 2200;
    starPositions[i * 3 + 1] = 130 + Math.random() * 260; // Y: 130m to 390m
    starPositions[i * 3 + 2] = -1400 + Math.random() * (CONFIG.raceDistance + 2800);
}
const starGeo = new THREE.BufferGeometry();
starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2.3, fog: false });
scene.add(new THREE.Points(starGeo, starMat));

// 4. GLTF & DRACO Loaders configured for Draco-compressed meshes
const loader = new THREE.GLTFLoader();
const dracoLoader = new THREE.DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
loader.setDRACOLoader(dracoLoader);

// Environment Scenery Groups
const forestGroup = new THREE.Group();
landscapeGroup.add(forestGroup);
const gravesGroup = new THREE.Group();
landscapeGroup.add(gravesGroup);
const rocksGroup = new THREE.Group();
landscapeGroup.add(rocksGroup);
const propsGroup = new THREE.Group();
landscapeGroup.add(propsGroup);

// Track Hazard Groups & Dynamic State (Slime puddles & Autumn Leaf piles)
const hazardsGroup = new THREE.Group();
landscapeGroup.add(hazardsGroup);

let activeHazards = [];

function generateTrackHazards() {
    hazardsGroup.clear();
    activeHazards = [];

    if (!MonsterModelManager.slimeTemplate && !MonsterModelManager.leafTemplate) return;

    const minZ = 0.10 * CONFIG.raceDistance; // 420m (not within first 10%)
    const maxZ = 0.90 * CONFIG.raceDistance; // 3780m (not within last 10%)
    const minSeparation = 0.05 * CONFIG.raceDistance; // 210m (not within 5% of each other)

    // Count between 1 and 4 for each hazard
    const slimeCount = 1 + Math.floor(Math.random() * 4);
    const leafCount = 1 + Math.floor(Math.random() * 4);

    const placedZ = [];

    function pickValidZ() {
        for (let attempts = 0; attempts < 400; attempts++) {
            const candidateZ = minZ + Math.random() * (maxZ - minZ);
            const tooClose = placedZ.some(pz => Math.abs(candidateZ - pz) < minSeparation);
            if (!tooClose) {
                placedZ.push(candidateZ);
                return candidateZ;
            }
        }
        const candidateZ = minZ + Math.random() * (maxZ - minZ);
        placedZ.push(candidateZ);
        return candidateZ;
    }

    // 1. Generate Slime Hazards (slime.glb)
    if (MonsterModelManager.slimeTemplate) {
        for (let i = 0; i < slimeCount; i++) {
            const z = pickValidZ();
            const x = (Math.random() - 0.5) * 78;

            const slimeMesh = MonsterModelManager.slimeTemplate.clone(true);
            const scale = 5.2 + Math.random() * 1.2;
            slimeMesh.scale.setScalar(scale);
            slimeMesh.position.set(x, 0.06, z);
            slimeMesh.rotation.y = Math.random() * Math.PI * 2;
            hazardsGroup.add(slimeMesh);

            activeHazards.push({
                type: 'slime',
                id: 'slime_' + i + '_' + Math.random().toString(36).substr(2, 4),
                mesh: slimeMesh,
                baseScale: scale,
                x: x,
                z: z,
                radius: scale * 0.95,
                hitRacers: new Set()
            });
        }
    }

    // 2. Generate Leaf Pile Hazards (leaf.glb small piles)
    if (MonsterModelManager.leafTemplate) {
        for (let i = 0; i < leafCount; i++) {
            const z = pickValidZ();
            const x = (Math.random() - 0.5) * 78;

            const pileGroup = new THREE.Group();
            pileGroup.position.set(x, 0.05, z);

            const leafCountInPile = 16 + Math.floor(Math.random() * 8);
            const leaves = [];

            for (let j = 0; j < leafCountInPile; j++) {
                const leafMesh = MonsterModelManager.leafTemplate.clone(true);
                const dist = Math.pow(Math.random(), 0.6) * 4.6;
                const angle = Math.random() * Math.PI * 2;
                const lx = Math.cos(angle) * dist;
                const lz = Math.sin(angle) * dist;
                const ly = Math.max(0, (1 - dist / 5.0) * 1.3) + Math.random() * 0.35;

                leafMesh.position.set(lx, ly, lz);
                leafMesh.rotation.set(
                    (Math.random() - 0.5) * 0.9,
                    Math.random() * Math.PI * 2,
                    (Math.random() - 0.5) * 0.9
                );
                const lScale = 1.35 + Math.random() * 0.5;
                leafMesh.scale.setScalar(lScale);
                pileGroup.add(leafMesh);

                leaves.push({
                    mesh: leafMesh,
                    vx: 0, vy: 0, vz: 0,
                    rotVx: 0, rotVy: 0, rotVz: 0
                });
            }

            hazardsGroup.add(pileGroup);

            activeHazards.push({
                type: 'leaf',
                id: 'leaf_' + i + '_' + Math.random().toString(36).substr(2, 4),
                mesh: pileGroup,
                leaves: leaves,
                x: x,
                z: z,
                radius: 5.5,
                scattered: false,
                scatterTime: 0
            });
        }
    }
}

function checkHazardCollisions(time) {
    if (raceState !== RACE_STATE.RACING) return;

    for (let h = 0; h < activeHazards.length; h++) {
        const hazard = activeHazards[h];

        if (hazard.type === 'slime') {
            for (let i = 0; i < racers.length; i++) {
                const racer = racers[i];
                if (racer.finished) continue;
                if (hazard.hitRacers.has(racer.id)) continue;

                const dx = racer.position.x - hazard.x;
                const dz = racer.position.z - hazard.z;
                const hitDist = hazard.radius + 4.2;
                if (dx * dx + dz * dz < hitDist * hitDist) {
                    hazard.hitRacers.add(racer.id);
                    racer.applySlowdown(0.70, 1.5);
                    playSlimeSound(time);
                    spawnFootstepMist(hazard.x, hazard.z, 3.6);
                }
            }
        } else if (hazard.type === 'leaf') {
            if (hazard.scattered) continue; // Once scattered, cannot affect other racers

            for (let i = 0; i < racers.length; i++) {
                const racer = racers[i];
                if (racer.finished) continue;

                const dx = racer.position.x - hazard.x;
                const dz = racer.position.z - hazard.z;
                const hitDist = hazard.radius + 4.5;
                if (dx * dx + dz * dz < hitDist * hitDist) {
                    hazard.scattered = true;
                    hazard.scatterTime = 0;
                    racer.applySlowdown(0.85, 1.0);
                    playLeavesSound(time);

                    // Scatter leaves outward and forward
                    for (let l = 0; l < hazard.leaves.length; l++) {
                        const leaf = hazard.leaves[l];
                        leaf.vx = (Math.random() - 0.5) * 26 + (dx > 0 ? -4 : 4);
                        leaf.vy = 7 + Math.random() * 15;
                        leaf.vz = 18 + Math.random() * 32;
                        leaf.rotVx = (Math.random() - 0.5) * 14;
                        leaf.rotVy = (Math.random() - 0.5) * 14;
                        leaf.rotVz = (Math.random() - 0.5) * 14;
                    }
                    break; // First impact scatters the pile
                }
            }
        }
    }
}

function updateHazardAnimations(delta, time) {
    for (let h = 0; h < activeHazards.length; h++) {
        const hazard = activeHazards[h];
        if (hazard.type === 'slime') {
            // Subtle squishy breathing animation
            const pulse = 1.0 + Math.sin(time * 3.5 + h) * 0.04;
            hazard.mesh.scale.set(hazard.baseScale * pulse, hazard.baseScale * (2 - pulse), hazard.baseScale * pulse);
        } else if (hazard.type === 'leaf' && hazard.scattered) {
            hazard.scatterTime += delta;
            for (let l = 0; l < hazard.leaves.length; l++) {
                const leaf = hazard.leaves[l];
                leaf.mesh.position.x += leaf.vx * delta;
                leaf.mesh.position.y += leaf.vy * delta;
                leaf.mesh.position.z += leaf.vz * delta;
                leaf.vy -= 26 * delta; // Gravity
                leaf.mesh.rotation.x += leaf.rotVx * delta;
                leaf.mesh.rotation.y += leaf.rotVy * delta;
                leaf.mesh.rotation.z += leaf.rotVz * delta;

                if (leaf.mesh.position.y < 0.04) {
                    leaf.mesh.position.y = 0.04;
                    leaf.vx *= 0.65;
                    leaf.vz *= 0.65;
                }
                if (hazard.scatterTime > 2.0) {
                    leaf.mesh.scale.multiplyScalar(Math.max(0, 1 - delta * 3.5));
                }
            }
        }
    }
}

const jackLanternMaterials = [];

// Track Siding Layout Parameters (used for siding placement and tree exclusion)
const SIDING_INTERVAL = 120;
const SIDING_LENGTH = 82.5; // Increased by 50% from 55
const SIDING_POS_X = 95;

function buildHauntedForestCorridor(treeTemplates) {
    forestGroup.clear();
    if (!treeTemplates || treeTemplates.length === 0) return;

    // Helper: place trees safely clear of track siding advertising boards (at |x|=95, z=0, 120, 240, ...)
    function getSidingClearTreeX(isLeft, treeZ) {
        let nearSiding = false;
        for (let sz = 0; sz <= CONFIG.raceDistance; sz += SIDING_INTERVAL) {
            if (Math.abs(treeZ - sz) < 50) {
                nearSiding = true;
                break;
            }
        }
        if (nearSiding) {
            // Place tree safely in deep forest behind the siding board (at least 35m behind siding at |x|=95)
            return isLeft ? (-130 - Math.random() * 85) : (130 + Math.random() * 85);
        } else {
            // In open gaps between sidings, trees can grow naturally from verge edge outward
            const offset = Math.random() * 135;
            return isLeft ? (-82 - offset) : (82 + offset);
        }
    }

    for (let z = -320; z < CONFIG.raceDistance + 320; z += 96) {
        if (Math.random() > 0.15) {
            const template = treeTemplates[Math.floor(Math.random() * treeTemplates.length)];
            const tree = template.clone();
            const scale = 11.5 + Math.random() * 8.5;
            const treeZ = z + (Math.random() - 0.5) * 14;
            const x = getSidingClearTreeX(true, treeZ);
            tree.position.set(x, 0, treeZ);
            tree.rotation.y = Math.random() * Math.PI * 2;
            tree.scale.set(scale, scale * (0.9 + Math.random() * 0.3), scale);
            forestGroup.add(tree);
        }
        if (Math.random() > 0.15) {
            const template = treeTemplates[Math.floor(Math.random() * treeTemplates.length)];
            const tree = template.clone();
            const scale = 11.5 + Math.random() * 8.5;
            const treeZ = z + (Math.random() - 0.5) * 14;
            const x = getSidingClearTreeX(false, treeZ);
            tree.position.set(x, 0, treeZ);
            tree.rotation.y = Math.random() * Math.PI * 2;
            tree.scale.set(scale, scale * (0.9 + Math.random() * 0.3), scale);
            forestGroup.add(tree);
        }
    }
}

function buildTracksideGraves(graveRoot) {
    gravesGroup.clear();
    if (!graveRoot) return;
    const graveBox = new THREE.Box3().setFromObject(graveRoot);
    const graveMinY = graveBox.min.y;

    for (let z = -120; z < CONFIG.raceDistance + 120; z += 180) {
        if (Math.random() > 0.20) {
            const clone = graveRoot.clone(true);
            const scale = 2.6 + Math.random() * 1.2;
            const x = -64 - Math.random() * 18;
            clone.position.set(x, -graveMinY * scale, z + (Math.random() - 0.5) * 12);
            clone.rotation.set((Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.2);
            clone.scale.setScalar(scale);
            gravesGroup.add(clone);
        }
        if (Math.random() > 0.20) {
            const clone = graveRoot.clone(true);
            const scale = 2.6 + Math.random() * 1.2;
            const x = 64 + Math.random() * 18;
            clone.position.set(x, -graveMinY * scale, z + (Math.random() - 0.5) * 12);
            clone.rotation.set((Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.2);
            clone.scale.setScalar(scale);
            gravesGroup.add(clone);
        }
    }
}

function buildTracksideRocks(rockTemplates) {
    rocksGroup.clear();
    if (!rockTemplates || rockTemplates.length === 0) return;
    // Scatter isolated rock meshes sporadically between the graves along the verge
    for (let z = -140; z < CONFIG.raceDistance + 140; z += 80) {
        if (Math.random() > 0.38) {
            const template = rockTemplates[Math.floor(Math.random() * rockTemplates.length)];
            const rock = template.clone();
            const scale = 2.6 + Math.random() * 2.0;
            const x = -63.5 - Math.random() * 22;
            rock.position.set(x, 0, z + (Math.random() - 0.5) * 14);
            rock.rotation.set((Math.random() - 0.5) * 0.3, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.3);
            rock.scale.set(scale, scale * (0.8 + Math.random() * 0.4), scale);
            rocksGroup.add(rock);
        }
        if (Math.random() > 0.38) {
            const template = rockTemplates[Math.floor(Math.random() * rockTemplates.length)];
            const rock = template.clone();
            const scale = 2.6 + Math.random() * 2.0;
            const x = 63.5 + Math.random() * 22;
            rock.position.set(x, 0, z + (Math.random() - 0.5) * 14);
            rock.rotation.set((Math.random() - 0.5) * 0.3, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.3);
            rock.scale.set(scale, scale * (0.8 + Math.random() * 0.4), scale);
            rocksGroup.add(rock);
        }
    }
}

// 6. Track Sidings (Optimized with shared geometries, cached materials and textures)
const sidingLength = SIDING_LENGTH, sidingHeight = 15, sidingDepth = 3;
const sharedSidingBaseGeo = new THREE.BoxGeometry(sidingDepth, sidingHeight, sidingLength);
const sharedSidingBaseMat = new THREE.MeshStandardMaterial({
    map: stoneTex,
    roughness: 0.88,
    color: 0x605673
});
const sharedSidingFaceGeo = new THREE.PlaneGeometry(sidingLength - 3, sidingHeight - 3);

const adImages = [
    "images/sidings/1.jpg", "images/sidings/2.jpg", "images/sidings/3.jpg",
    "images/sidings/4.jpg", "images/sidings/5.jpg", "images/sidings/6.jpg",
    "images/sidings/7.jpg", "images/sidings/8.jpg", "images/sidings/9.jpg",
    "images/sidings/10.jpg"
];

const sidingMaterialsMap = {};
adImages.forEach(img => {
    const tex = textureLoader.load(img);
    tex.encoding = THREE.sRGBEncoding;
    sidingMaterialsMap[img] = new THREE.MeshBasicMaterial({ map: tex });
});

function createTrackSiding(imagePath, x, z, side) {
    const group = new THREE.Group();
    const base = new THREE.Mesh(sharedSidingBaseGeo, sharedSidingBaseMat);
    base.position.y = sidingHeight / 2 - 1;
    group.add(base);

    const faceMat = sidingMaterialsMap[imagePath] || sharedSidingBaseMat;
    const face = new THREE.Mesh(sharedSidingFaceGeo, faceMat);

    const xOffset = (side === -1) ? (sidingDepth / 2 + 0.1) : -(sidingDepth / 2 + 0.1);
    const yRot = (side === -1) ? Math.PI / 2 : -Math.PI / 2;
    face.position.set(xOffset, sidingHeight / 2 - 1, 0);
    face.rotation.y = yRot;
    group.add(face);
    group.position.set(x, 1.2, z);
    return group;
}

const sidingInterval = SIDING_INTERVAL;
for (let z = 0; z <= CONFIG.raceDistance; z += sidingInterval) {
    const img1 = adImages[Math.floor(Math.random() * adImages.length)];
    landscapeGroup.add(createTrackSiding(img1, -SIDING_POS_X, z, -1));
    const img2 = adImages[Math.floor(Math.random() * adImages.length)];
    landscapeGroup.add(createTrackSiding(img2, SIDING_POS_X, z, 1));
}

// 7. Roadside Jack-o'-Lanterns (Scattered on sides every now and then, deduplicated materials)
function buildRoadsideProps(jackTemplate) {
    propsGroup.clear();
    jackLanternMaterials.length = 0;
    if (!jackTemplate) return;

    for (let z = 30; z < CONFIG.raceDistance - 30; z += 120) {
        if (Math.random() > 0.30) {
            const clone = jackTemplate.clone(true);
            const scale = 5.6 * (0.88 + Math.random() * 0.28);
            const x = -68.0 - Math.random() * 4.0;
            clone.position.set(x, 0, z + (Math.random() - 0.5) * 10);
            clone.rotation.y = (Math.PI / 2) + (Math.random() - 0.5) * 0.7;
            clone.scale.setScalar(scale);
            clone.traverse(c => {
                if (c.isMesh && c.material?.emissive && (c.material.emissive.r > 0 || c.material.emissive.g > 0)) {
                    if (!jackLanternMaterials.includes(c.material)) {
                        jackLanternMaterials.push(c.material);
                    }
                }
            });
            propsGroup.add(clone);
        }
        if (Math.random() > 0.30) {
            const clone = jackTemplate.clone(true);
            const scale = 5.6 * (0.88 + Math.random() * 0.28);
            const x = 68.0 + Math.random() * 4.0;
            clone.position.set(x, 0, z + (Math.random() - 0.5) * 10);
            clone.rotation.y = (-Math.PI / 2) + (Math.random() - 0.5) * 0.7;
            clone.scale.setScalar(scale);
            clone.traverse(c => {
                if (c.isMesh && c.material?.emissive && (c.material.emissive.r > 0 || c.material.emissive.g > 0)) {
                    if (!jackLanternMaterials.includes(c.material)) {
                        jackLanternMaterials.push(c.material);
                    }
                }
            });
            propsGroup.add(clone);
        }
    }
}

// 8. Start & Finish Line Gothic Archway (Purple / Lemon Check)
const finishGroup = new THREE.Group();
const checkCanvas = document.createElement('canvas');
checkCanvas.width = 576;
checkCanvas.height = 64;
const checkCtx = checkCanvas.getContext('2d');
checkCtx.fillStyle = '#260b42'; // Deep gothic purple
checkCtx.fillRect(0, 0, 576, 64);
checkCtx.fillStyle = '#fff042'; // Vibrant lemon yellow
for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 18; x++) {
        if ((x + y) % 2 === 0) checkCtx.fillRect(x * 32, y * 32, 32, 32);
    }
}
const checkTex = new THREE.CanvasTexture(checkCanvas);
checkTex.magFilter = THREE.NearestFilter;
checkTex.encoding = THREE.sRGBEncoding;

const archPillarX = (CONFIG.roadWidth / 2) + 3.0;
const fBanner = new THREE.Mesh(
    new THREE.BoxGeometry(CONFIG.roadWidth + 12, 8.5, 2),
    new THREE.MeshStandardMaterial({ map: checkTex, roughness: 0.6, emissive: 0x160726 })
);
fBanner.position.set(0, 24, CONFIG.raceDistance);
fBanner.castShadow = true;

const pillarMat = new THREE.MeshStandardMaterial({ map: stoneTex, color: 0x524666, roughness: 0.85 });
const p1 = new THREE.Mesh(new THREE.BoxGeometry(4.0, 28, 4.0), pillarMat);
p1.position.set(-archPillarX, 14, CONFIG.raceDistance);
p1.castShadow = true;
const p2 = p1.clone();
p2.position.set(archPillarX, 14, CONFIG.raceDistance);

finishGroup.add(p1, p2, fBanner);
scene.add(finishGroup);

// Road Start & Finish Paint Strips
const lineStripGeo = new THREE.PlaneGeometry(CONFIG.roadWidth, 3.5);
const startLineMat = new THREE.MeshBasicMaterial({ map: checkTex, transparent: true, opacity: 0.95, toneMapped: false });
const startLineStrip = new THREE.Mesh(lineStripGeo, startLineMat);
startLineStrip.rotation.x = -Math.PI / 2;
startLineStrip.position.set(0, 0.04, 0);
scene.add(startLineStrip);

const finishLineStrip = startLineStrip.clone();
finishLineStrip.position.set(0, 0.04, CONFIG.raceDistance);
scene.add(finishLineStrip);

/**
 * OBJECT-POOLED FOOTSTEP DUST / ECTO-MIST SYSTEM
 */
const mistGroup = new THREE.Group();
scene.add(mistGroup);

const mistCanvas = document.createElement('canvas');
mistCanvas.width = 64;
mistCanvas.height = 64;
const mistCtx = mistCanvas.getContext('2d');
const mistGrad = mistCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
mistGrad.addColorStop(0, 'rgba(205, 190, 230, 0.85)');
mistGrad.addColorStop(0.4, 'rgba(165, 145, 195, 0.52)');
mistGrad.addColorStop(0.75, 'rgba(125, 105, 155, 0.20)');
mistGrad.addColorStop(1, 'rgba(75, 55, 100, 0)');
mistCtx.fillStyle = mistGrad;
mistCtx.fillRect(0, 0, 64, 64);
const mistTex = new THREE.CanvasTexture(mistCanvas);

const MIST_POOL_SIZE = 240;
const mistGeo = new THREE.PlaneGeometry(3.6, 3.6);
const mistPool = [];
let mistPoolIndex = 0;

for (let i = 0; i < MIST_POOL_SIZE; i++) {
    const mat = new THREE.MeshBasicMaterial({
        map: mistTex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.NormalBlending
    });
    const mesh = new THREE.Mesh(mistGeo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.visible = false;
    mistGroup.add(mesh);
    mistPool.push({ mesh, active: false, age: 0, maxAge: 0.65, baseScale: 1 });
}

function spawnFootstepMist(x, z, scale, maxAge = 0.65) {
    const item = mistPool[mistPoolIndex];
    mistPoolIndex = (mistPoolIndex + 1) % MIST_POOL_SIZE;
    item.active = true;
    item.age = 0;
    item.maxAge = maxAge;
    item.baseScale = scale;
    item.mesh.position.set(x, 0.14, z);
    item.mesh.scale.set(scale, scale, 1);
    item.mesh.material.opacity = 0.68;
    item.mesh.visible = true;
}

function updateFootstepMist(delta) {
    for (let i = 0; i < MIST_POOL_SIZE; i++) {
        const item = mistPool[i];
        if (!item.active) continue;
        item.age += delta;
        if (item.age >= item.maxAge) {
            item.active = false;
            item.mesh.visible = false;
        } else {
            const progress = item.age / item.maxAge;
            const s = item.baseScale + progress * 5.2;
            item.mesh.scale.set(s, s, 1);
            item.mesh.material.opacity = 0.68 * (1 - progress);
        }
    }
}

function resetFootstepMist() {
    for (let i = 0; i < MIST_POOL_SIZE; i++) {
        mistPool[i].active = false;
        mistPool[i].mesh.visible = false;
    }
}


/**
 * MONSTER & ENVIRONMENT ASSET MANAGER
 * Preloads all 8 character GLBs (treated as solid clay assets) plus environment scenery.
 */
const MONSTER_MANIFEST = [
    { id: 0, name: 'vampire',   file: 'models/vampire.glb',   scale: CONFIG.racerScale, rotY: 0 },
    { id: 1, name: 'pumpkin',   file: 'models/pumpkin.glb',   scale: CONFIG.racerScale, rotY: 0 },
    { id: 2, name: 'mummy',     file: 'models/mummy.glb',     scale: CONFIG.racerScale, rotY: 0 },
    { id: 3, name: 'monster',   file: 'models/monster.glb',   scale: CONFIG.racerScale, rotY: 0 },
    { id: 4, name: 'ghost',     file: 'models/ghost.glb',     scale: CONFIG.racerScale, rotY: 0 },
    { id: 5, name: 'witch',     file: 'models/witch.glb',     scale: CONFIG.racerScale, rotY: Math.PI / 2 },
    { id: 6, name: 'werewolf',  file: 'models/werewolf.glb',  scale: CONFIG.racerScale, rotY: Math.PI / 2 },
    { id: 7, name: 'skeleton',  file: 'models/skeleton.glb',  scale: CONFIG.racerScale, rotY: 0 }
];

const MonsterModelManager = {
    _cache: new Array(8).fill(null),
    _failed: new Array(8).fill(false),
    treeTemplates: [],
    graveRoot: null,
    rockTemplates: [],
    jackTemplate: null,
    slimeTemplate: null,
    leafTemplate: null,
    ready: false,

    preloadAll() {
        const startBtn = document.getElementById('start-btn');
        const loadingMsg = document.createElement('div');
        loadingMsg.id = 'loading-msg';
        loadingMsg.textContent = 'Loading arcade assets… 0/14';
        loadingMsg.style.cssText = 'margin-top:10px;font-size:0.85rem;color:#aaa;letter-spacing:1px;';

        const btnParent = startBtn?.parentNode;
        if (btnParent) btnParent.insertBefore(loadingMsg, startBtn);
        if (startBtn) { startBtn.disabled = true; startBtn.style.cursor = 'not-allowed'; }

        let loadedCount = 0;
        const totalItems = 14;

        const updateLoadingProgress = () => {
            loadedCount++;
            if (loadingMsg) loadingMsg.textContent = `Loading arcade assets… ${loadedCount}/${totalItems}`;
        };

        // 1. Preload 8 Character Racers (Draco-compressed Meshy clay assets)
        const racerPromises = MONSTER_MANIFEST.map(entry => new Promise((resolve) => {
            loader.load(
                entry.file,
                (gltf) => {
                    const model = gltf.scene;

                    // Align model forward heading (+Z)
                    if (entry.rotY) {
                        model.rotation.y = entry.rotY;
                    }
                    model.updateMatrixWorld(true);

                    // Compute precise bounds to center horizontally and place on ground
                    const box = new THREE.Box3().setFromObject(model);
                    const center = new THREE.Vector3();
                    box.getCenter(center);

                    model.position.x = -center.x;
                    model.position.z = -center.z;
                    model.position.y = -box.min.y;

                    // Treat Meshy models as solid, high-detail stylized clay assets
                    model.traverse(child => {
                        if (child.isMesh) {
                            child.castShadow = true;
                            child.receiveShadow = true;
                            if (child.material) {
                                child.material.roughness = 0.55;
                                child.material.metalness = 0.05;
                            }
                        }
                    });

                    const templateGroup = new THREE.Group();
                    templateGroup.scale.setScalar(entry.scale);
                    templateGroup.add(model);

                    this._cache[entry.id] = templateGroup;
                    updateLoadingProgress();
                    resolve();
                },
                undefined,
                (err) => {
                    console.warn(`[MonsterModelManager] Failed to load ${entry.file}:`, err);
                    this._failed[entry.id] = true;
                    updateLoadingProgress();
                    resolve();
                }
            );
        }));

        // 2. Preload Environment tree.glb (Clean unwanted white floor plane, extract tree meshes)
        // Attribution: "Toon Tree 02" (https://skfb.ly/JL7F) by Sergio Sotomayor is licensed under CC BY 4.0 (http://creativecommons.org/licenses/by/4.0/)
        const treePromise = new Promise((resolve) => {
            loader.load(
                'models/tree.glb',
                (gltf) => {
                    const treeTemplates = [];
                    const toRemove = [];

                    // Traversal function to identify and remove unwanted white floor plane
                    gltf.scene.traverse((child) => {
                        if (child.isMesh) {
                            const name = (child.name || '').toLowerCase();
                            const parentName = (child.parent?.name || '').toLowerCase();
                            const matName = (Array.isArray(child.material) 
                                ? child.material.map(m => m.name || '').join(' ') 
                                : (child.material?.name || '')).toLowerCase();

                            if (name.includes('plane') || parentName.includes('plane') || matName.includes('plane')) {
                                toRemove.push(child);
                                return;
                            }

                            if (child.material) {
                                child.material.roughness = 0.85;
                                child.material.metalness = 0.05;
                            }
                            child.castShadow = true;
                            child.receiveShadow = true;

                            // Extract individual tree mesh, check geometry orientation, center X/Z and ground min Y at 0
                            const cloneMesh = child.clone();
                            const geo = cloneMesh.geometry.clone();
                            const geoBox = new THREE.Box3().setFromBufferAttribute(geo.attributes.position);
                            const geoSize = new THREE.Vector3();
                            geoBox.getSize(geoSize);
                            // Correct trees authored with Z-up geometry to standard Y-up (rotate -90 deg on X)
                            if (geoSize.z > geoSize.y) {
                                geo.rotateX(-Math.PI / 2);
                            }
                            geo.computeBoundingBox();
                            const b = geo.boundingBox;
                            const cx = (b.min.x + b.max.x) / 2;
                            const cz = (b.min.z + b.max.z) / 2;
                            const minY = b.min.y;
                            geo.translate(-cx, -minY, -cz);
                            cloneMesh.geometry = geo;
                            treeTemplates.push(cloneMesh);
                        }
                    });

                    // Remove identified white floor plane meshes
                    toRemove.forEach(planeMesh => {
                        if (planeMesh.parent) planeMesh.parent.remove(planeMesh);
                        planeMesh.geometry?.dispose();
                    });

                    this.treeTemplates = treeTemplates;
                    // Build haunted forest corridor along left and right track borders
                    buildHauntedForestCorridor(treeTemplates);

                    updateLoadingProgress();
                    resolve();
                },
                undefined,
                (err) => {
                    console.warn('[MonsterModelManager] Failed to load models/tree.glb:', err);
                    updateLoadingProgress();
                    resolve();
                }
            );
        });

        // 3. Preload Environment grave.glb (Place trackside obstacles/scenery)
        const gravePromise = new Promise((resolve) => {
            loader.load(
                'models/grave.glb',
                (gltf) => {
                    const graveRoot = gltf.scene;
                    graveRoot.traverse(c => {
                        if (c.isMesh) {
                            c.castShadow = true;
                            c.receiveShadow = true;
                            if (c.material) {
                                c.material.roughness = 0.85;
                                c.material.metalness = 0.05;
                            }
                        }
                    });
                    this.graveRoot = graveRoot;
                    buildTracksideGraves(graveRoot);

                    updateLoadingProgress();
                    resolve();
                },
                undefined,
                (err) => {
                    console.warn('[MonsterModelManager] Failed to load models/grave.glb:', err);
                    updateLoadingProgress();
                    resolve();
                }
            );
        });

        // 4. Preload Environment rocks.glb (Isolate individual rock meshes and scatter)
        // Attribution: "Low poly Rocks" (https://skfb.ly/pwJCw) by Logan S. is licensed under CC BY 4.0 (http://creativecommons.org/licenses/by/4.0/)
        const rockPromise = new Promise((resolve) => {
            loader.load(
                'models/rocks.glb',
                (gltf) => {
                    const rockTemplates = [];
                    gltf.scene.traverse((child) => {
                        if (child.isMesh) {
                            const cloneMesh = child.clone();
                            const geo = cloneMesh.geometry.clone();
                            geo.computeBoundingBox();
                            const b = geo.boundingBox;
                            const cx = (b.min.x + b.max.x) / 2;
                            const cz = (b.min.z + b.max.z) / 2;
                            const minY = b.min.y;
                            geo.translate(-cx, -minY, -cz);
                            cloneMesh.geometry = geo;
                            if (cloneMesh.material) {
                                cloneMesh.material.roughness = 0.88;
                                cloneMesh.material.metalness = 0.05;
                            }
                            cloneMesh.castShadow = true;
                            cloneMesh.receiveShadow = true;
                            rockTemplates.push(cloneMesh);
                        }
                    });
                    this.rockTemplates = rockTemplates;
                    buildTracksideRocks(rockTemplates);

                    updateLoadingProgress();
                    resolve();
                },
                undefined,
                (err) => {
                    console.warn('[MonsterModelManager] Failed to load models/rocks.glb:', err);
                    updateLoadingProgress();
                    resolve();
                }
            );
        });

        // 5. Preload Environment jack-o-lantern.glb (Scattered trackside props)
        // Attribution: "Jack-o-lantern" (https://skfb.ly/pnNOJ) by Kroko.blend is licensed under CC BY 4.0 (http://creativecommons.org/licenses/by/4.0/)
        const jackPromise = new Promise((resolve) => {
            loader.load(
                'models/jack-o-lantern.glb',
                (gltf) => {
                    const jackRoot = gltf.scene;
                    jackRoot.updateMatrixWorld(true);
                    const box = new THREE.Box3().setFromObject(jackRoot);
                    const center = new THREE.Vector3();
                    box.getCenter(center);

                    jackRoot.position.x = -center.x;
                    jackRoot.position.z = -center.z;
                    jackRoot.position.y = -box.min.y;

                    jackRoot.traverse(child => {
                        if (child.isMesh) {
                            child.castShadow = true;
                            child.receiveShadow = true;
                            if (child.material) {
                                child.material.roughness = 0.55;
                                if (child.material.emissive && (child.material.emissive.r > 0 || child.material.emissive.g > 0)) {
                                    child.material.emissiveIntensity = 2.2;
                                }
                            }
                        }
                    });

                    const group = new THREE.Group();
                    group.add(jackRoot);
                    this.jackTemplate = group;

                    buildRoadsideProps(this.jackTemplate);
                    updateLoadingProgress();
                    resolve();
                },
                undefined,
                (err) => {
                    console.warn('[MonsterModelManager] Failed to load models/jack-o-lantern.glb:', err);
                    updateLoadingProgress();
                    resolve();
                }
            );
        });

        // 6. Preload Environment slime.glb (Track Hazard Slime)
        // Attribution: "Slime" (https://skfb.ly/orDYU) by ColinCharleson is licensed under CC BY 4.0
        const slimePromise = new Promise((resolve) => {
            loader.load(
                'models/slime.glb',
                (gltf) => {
                    const slimeRoot = gltf.scene;
                    slimeRoot.updateMatrixWorld(true);
                    const box = new THREE.Box3().setFromObject(slimeRoot);
                    const center = new THREE.Vector3();
                    box.getCenter(center);

                    slimeRoot.position.x = -center.x;
                    slimeRoot.position.z = -center.z;
                    slimeRoot.position.y = -box.min.y;

                    slimeRoot.traverse((c) => {
                        if (c.isMesh) {
                            c.castShadow = true;
                            c.receiveShadow = true;
                            if (c.material) {
                                c.material.roughness = 0.28;
                                c.material.metalness = 0.12;
                            }
                        }
                    });

                    const group = new THREE.Group();
                    group.add(slimeRoot);
                    this.slimeTemplate = group;

                    updateLoadingProgress();
                    resolve();
                },
                undefined,
                (err) => {
                    console.warn('[MonsterModelManager] Failed to load models/slime.glb:', err);
                    updateLoadingProgress();
                    resolve();
                }
            );
        });

        // 7. Preload Environment leaf.glb (Track Hazard Leaf Pile)
        // Attribution: "Autumn Leaf" (https://skfb.ly/pOpHF) by keatura is licensed under CC BY 4.0
        const leafPromise = new Promise((resolve) => {
            loader.load(
                'models/leaf.glb',
                (gltf) => {
                    const leafMeshGroup = new THREE.Group();
                    gltf.scene.traverse((c) => {
                        if (c.isMesh) {
                            const cloneMesh = c.clone();
                            cloneMesh.castShadow = true;
                            cloneMesh.receiveShadow = true;
                            if (cloneMesh.material) {
                                cloneMesh.material.roughness = 0.84;
                                cloneMesh.material.metalness = 0.05;
                            }
                            leafMeshGroup.add(cloneMesh);
                        }
                    });
                    leafMeshGroup.updateMatrixWorld(true);
                    const box = new THREE.Box3().setFromObject(leafMeshGroup);
                    const center = new THREE.Vector3();
                    box.getCenter(center);
                    leafMeshGroup.position.set(-center.x, -box.min.y, -center.z);

                    const group = new THREE.Group();
                    group.add(leafMeshGroup);
                    this.leafTemplate = group;

                    updateLoadingProgress();
                    resolve();
                },
                undefined,
                (err) => {
                    console.warn('[MonsterModelManager] Failed to load models/leaf.glb:', err);
                    updateLoadingProgress();
                    resolve();
                }
            );
        });

        // 8. Preload Creepster font so countdown numbers render immediately in Creepster font
        const fontPromise = (typeof document !== 'undefined' && document.fonts && document.fonts.load)
            ? document.fonts.load("200px 'Creepster'").catch(e => console.warn("Creepster preload warning:", e))
            : Promise.resolve();

        return Promise.all([
            ...racerPromises,
            treePromise,
            gravePromise,
            rockPromise,
            jackPromise,
            slimePromise,
            leafPromise,
            fontPromise
        ]).then(() => {
            this.ready = true;
            generateTrackHazards();
            if (loadingMsg) loadingMsg.remove();
            const failedNames = MONSTER_MANIFEST.filter(e => this._failed[e.id]).map(e => e.name);
            if (failedNames.length > 0) {
                const errEl = document.createElement('div');
                errEl.style.cssText = 'margin-top:8px;font-size:0.8rem;color:#c042ff;';
                errEl.textContent = `Using fallback for: ${failedNames.join(', ')}`;
                if (btnParent && startBtn) btnParent.insertBefore(errEl, startBtn);
            }
            activateStartButton();
        });
    },

    cloneFor(monsterId) {
        const source = this._cache[monsterId];
        if (!source) return null;
        const clone = source.clone(true);
        return { group: clone };
    },

    disposeCache() {
        for (let i = 0; i < 8; i++) {
            if (this._cache[i]) {
                this._cache[i].traverse(child => {
                    if (child.isMesh) {
                        child.geometry?.dispose();
                        if (Array.isArray(child.material)) {
                            child.material.forEach(m => m.dispose());
                        } else {
                            child.material?.dispose();
                        }
                    }
                });
                this._cache[i] = null;
            }
            this._failed[i] = false;
        }
        this.ready = false;
    }
};

MonsterModelManager.preloadAll();

function activateStartButton() {
    const btn = document.getElementById('start-btn');
    if (btn) {
        btn.disabled = false;
        btn.style.cursor = 'pointer';
    }
    initRacers();
}

/**
 * 3D CLAYMATION ARCADE KART RACER CLASS
 */
class Zoombie {
    constructor(id, name, startX) {
        this.id = id;
        this.name = name;
        this.color = COLORS[id % COLORS.length];
        this.startX = startX;
        this.mesh = new THREE.Group();
        this.position = new THREE.Vector3(startX, 0, 0);
        this.baseSpeed = CONFIG.raceDistance / CONFIG.targetDuration;
        this.currentSpeed = 0;
        this.finished = false;
        this.finishTime = 0;
        this.aggressiveness = 0.45 + Math.random() * 0.55;
        this.energyCycle = Math.random() * 10;
        this.stepTimer = 0;
        this.usingGLB = false;

        // Cached UI presentation properties
        this.hexColor = '#' + this.color.toString(16).padStart(6, '0');
        const r = (this.color >> 16) & 255, g = (this.color >> 8) & 255, b = this.color & 255;
        this.txtColor = (((r * 299) + (g * 587) + (b * 114)) / 1000) >= 128 ? '#000' : '#fff';
        this.lightenedColor = lightenColor(this.color, 0.4);
        this.idPlus1 = String(this.id + 1);

        // Arcade kart dynamics state
        this.currentTilt = 0;
        this.currentHeading = 0;
        this.targetX = startX;
        this.baseKartY = 0;

        // Collision-only dramatic swerve dynamics
        this.swerveRoll = 0;
        this.swerveYaw = 0;
        this.swerveVelX = 0;
        this.swerveDuration = 0;
        this.lastCollisionTime = -10;

        // Hazard slowdown dynamics (slime: 70% for 1.5s; leaves: 85% for 1.0s)
        this.slowdownMultiplier = 1.0;
        this.slowdownTimer = 0;

        // Main tilt group for chassis bank/bounce
        this.kartTiltGroup = new THREE.Group();
        this.mesh.add(this.kartTiltGroup);

        // Load solid clay character asset (with sculpted wheels intact on the model)
        const glbResult = MonsterModelManager.cloneFor(id);
        if (glbResult) {
            this.usingGLB = true;
            this.kartTiltGroup.add(glbResult.group);
            this.characterModel = glbResult.group;
        } else {
            this.buildProceduralKartModel();
        }

        // Backward-compatible dummy rig nodes for tests
        this.rig = {
            bodyGroup: this.kartTiltGroup,
            headGroup: this.kartTiltGroup,
            leftArm: new THREE.Group(),
            rightArm: new THREE.Group(),
            leftLeg: new THREE.Group(),
            rightLeg: new THREE.Group(),
            extra: null
        };

        this.addNameLabel();
        this.resetToStartLine();
        scene.add(this.mesh);
    }

    applySlowdown(multiplier, duration) {
        this.slowdownMultiplier = multiplier;
        this.slowdownTimer = duration;
    }

    triggerCollisionSwerve(otherRacer, time, nx) {
        if (time - this.lastCollisionTime < 0.38) return false;
        this.lastCollisionTime = time;

        const side = (nx !== undefined && Math.abs(nx) > 0.01)
            ? Math.sign(nx)
            : (this.position.x >= otherRacer.position.x ? 1 : -1);

        // Dramatic arcade swerve impulses (triggered ONLY on kart collision!)
        this.swerveVelX = side * (13.0 + Math.random() * 6.0);
        this.swerveRoll = -side * (0.34 + Math.random() * 0.12); // ~20° to 26° sharp arcade bank
        this.swerveYaw = side * (0.28 + Math.random() * 0.10);  // sharp counter-steer
        this.swerveDuration = 0.85;

        // Collision mist burst at the point of impact
        const contactX = (this.position.x + otherRacer.position.x) / 2;
        const contactZ = (this.position.z + otherRacer.position.z) / 2;
        spawnFootstepMist(contactX, contactZ, 2.4);
        return true;
    }

    buildProceduralKartModel() {
        const kartBodyMat = new THREE.MeshStandardMaterial({
            color: this.color,
            roughness: 0.55,
            metalness: 0.05
        });
        const darkMat = new THREE.MeshStandardMaterial({
            color: 0x1f172e,
            roughness: 0.65
        });

        const s = CONFIG.racerScale / 2.4;
        const bodyGeo = new THREE.BoxGeometry(2.4 * s, 1.2 * s, 3.8 * s);
        const bodyMesh = new THREE.Mesh(bodyGeo, kartBodyMat);
        bodyMesh.position.y = 1.0 * s;
        bodyMesh.castShadow = true;

        const noseGeo = new THREE.ConeGeometry(1.2 * s, 1.4 * s, 4);
        noseGeo.rotateX(Math.PI / 2);
        const noseMesh = new THREE.Mesh(noseGeo, kartBodyMat);
        noseMesh.position.set(0, 0.8 * s, 2.3 * s);
        noseMesh.castShadow = true;

        const driverGeo = new THREE.SphereGeometry(0.85 * s, 14, 12);
        const driverMesh = new THREE.Mesh(driverGeo, darkMat);
        driverMesh.position.set(0, 2.0 * s, -0.3 * s);
        driverMesh.castShadow = true;

        this.kartTiltGroup.add(bodyMesh, noseMesh, driverMesh);
    }

    resetToStartLine() {
        this.position.set(this.startX, 0, 0);
        this.currentSpeed = 0;
        this.finished = false;
        this.finishTime = 0;
        this.stepTimer = 0;
        this.currentTilt = 0;
        this.currentHeading = 0;
        this.targetX = this.startX;

        this.swerveRoll = 0;
        this.swerveYaw = 0;
        this.swerveVelX = 0;
        this.swerveDuration = 0;
        this.lastCollisionTime = -10;

        this.slowdownMultiplier = 1.0;
        this.slowdownTimer = 0;

        this.mesh.position.set(this.startX, 0, 0);
        this.mesh.rotation.set(0, 0, 0);
        this.kartTiltGroup.position.set(0, this.baseKartY, 0);
        this.kartTiltGroup.rotation.set(0, 0, 0);
    }

    addNameLabel() {
        const w = 160, h = 128;
        const cvs = document.createElement('canvas');
        cvs.width = w;
        cvs.height = h;
        const ctx = cvs.getContext('2d');
        const mainColor = '#' + this.color.toString(16).padStart(6, '0');

        // Slanted backing container
        ctx.beginPath();
        ctx.moveTo(28, 0); ctx.lineTo(w, 0); ctx.lineTo(w - 28, h); ctx.lineTo(0, h);
        ctx.closePath();
        ctx.fillStyle = "rgba(14, 8, 24, 0.94)";
        ctx.fill();

        // Vivid color accent tab matching the broadcast leaderboard rank color
        ctx.beginPath();
        ctx.moveTo(28, 0); ctx.lineTo(68, 0); ctx.lineTo(40, h); ctx.lineTo(0, h);
        ctx.closePath();
        ctx.fillStyle = mainColor;
        ctx.fill();

        // Accent baseline stripe in the racer's color across the bottom edge
        ctx.beginPath();
        ctx.moveTo(0, h - 3); ctx.lineTo(w - 28, h - 3);
        ctx.strokeStyle = mainColor;
        ctx.lineWidth = 6;
        ctx.stroke();

        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.shadowColor = "rgba(0,0,0,0.95)";
        ctx.shadowBlur = 6;
        ctx.font = "bold 84px 'Rajdhani'";
        ctx.fillText(`${this.id + 1}`, 104, h / 2 + 1);

        const tex = new THREE.CanvasTexture(cvs);
        tex.encoding = THREE.sRGBEncoding;
        const sprite = new THREE.Sprite(
            new THREE.SpriteMaterial({
                map: tex,
                toneMapped: false,
                depthWrite: false,
                depthTest: true
            })
        );
        sprite.position.set(0, 14.2, 0);
        sprite.scale.set(6.2, 4.8, 1);
        sprite.frustumCulled = false;
        sprite.renderOrder = 100;
        this.mesh.add(sprite);
    }

    /**
     * Restrained starting line stance: karts planted at Z=0, gentle engine throb.
     */
    updateReadyPose(time) {
        this.position.set(this.startX, 0, 0);
        this.mesh.position.set(this.startX, 0, 0);
        this.mesh.position.y = 0;
        this.mesh.rotation.set(0, 0, 0);
        this.currentSpeed = 0;
        this.currentTilt = 0;
        this.currentHeading = 0;
        this.swerveRoll = 0;
        this.swerveYaw = 0;
        this.swerveVelX = 0;
        this.swerveDuration = 0;

        // Subtle idle engine throb / chassis vibration on the line
        const idleThrob = Math.sin(time * 18 + this.id * 2.2) * 0.025;
        this.kartTiltGroup.position.y = this.baseKartY + idleThrob;
        this.kartTiltGroup.rotation.set(0, 0, Math.sin(time * 14 + this.id) * 0.008);
    }

    /**
     * Arcade kart locomotion & physics: natural lane holding, dramatic swerves only upon collision.
     */
    updateRacingMovement(delta, time) {
        const energy = Math.sin(time * 0.5 + this.energyCycle);
        let targetSpeed = this.baseSpeed;
        if (energy > 0.4) targetSpeed *= 1.15 + (this.aggressiveness * 0.2);
        else if (energy < -0.4) targetSpeed *= 0.88;
        targetSpeed += (Math.random() - 0.5) * (this.baseSpeed * 0.08);

        const distRemaining = CONFIG.raceDistance - this.position.z;
        if (distRemaining < 320 && distRemaining > 0) targetSpeed *= 1.12;

        // Apply hazard slowdown effect (slime: 70% for 1.5s; leaves: 85% for 1.0s)
        if (this.slowdownTimer > 0) {
            this.slowdownTimer -= delta;
        } else if (this.slowdownMultiplier < 1.0) {
            this.slowdownMultiplier = THREE.MathUtils.lerp(this.slowdownMultiplier, 1.0, Math.min(1.0, 3.2 * delta));
            if (this.slowdownMultiplier > 0.99) this.slowdownMultiplier = 1.0;
        }
        targetSpeed *= this.slowdownMultiplier;

        this.currentSpeed = targetSpeed;
        this.position.z += targetSpeed * delta;

        // Natural, organic lane holding along the raceway
        const targetLaneX = this.startX + Math.sin(time * 0.75 + this.id * 1.6) * 1.6;
        const dx = targetLaneX - this.position.x;
        const maxLateral = this.baseSpeed * 0.15;
        const lateralSpeed = THREE.MathUtils.clamp(dx * 2.2, -maxLateral, maxLateral);
        this.position.x += lateralSpeed * delta;

        // Apply dramatic collision swerve impulse if active
        if (this.swerveDuration > 0) {
            this.swerveDuration -= delta;
            this.position.x += this.swerveVelX * delta;
            this.position.x = THREE.MathUtils.clamp(this.position.x, -50, 50);

            // Damping of lateral push
            this.swerveVelX *= Math.exp(-4.2 * delta);

            // Elastic spring-damper recovery of roll tilt and heading yaw
            this.swerveRoll = THREE.MathUtils.lerp(this.swerveRoll, 0, Math.min(1.0, 5.5 * delta));
            this.swerveYaw = THREE.MathUtils.lerp(this.swerveYaw, 0, Math.min(1.0, 4.8 * delta));
        } else {
            this.swerveVelX = 0;
            this.swerveRoll = 0;
            this.swerveYaw = 0;
        }

        this.position.x = THREE.MathUtils.clamp(this.position.x, -50, 50);
        this.mesh.position.x = this.position.x;
        this.mesh.position.z = this.position.z;

        // Natural subtle roll into lane curves combined with collision bank
        const normalTilt = -lateralSpeed * 0.022;
        this.currentTilt = THREE.MathUtils.lerp(this.currentTilt, normalTilt, 7 * delta);
        this.kartTiltGroup.rotation.z = this.currentTilt + this.swerveRoll;

        // Natural subtle heading combined with collision yaw
        const normalHeading = Math.atan2(lateralSpeed, targetSpeed) * 0.45;
        this.currentHeading = THREE.MathUtils.lerp(this.currentHeading, normalHeading, 6 * delta);
        this.kartTiltGroup.rotation.y = this.currentHeading + this.swerveYaw;

        // Tactile clay road rumble bounce & pitch
        const bounceRate = 18.0 + (this.currentSpeed / this.baseSpeed) * 8.0;
        const bounceAmt = (this.currentSpeed / this.baseSpeed) * 0.08;
        const bounceY = Math.abs(Math.sin(time * bounceRate + this.id * 1.8)) * bounceAmt;
        this.kartTiltGroup.position.y = this.baseKartY + bounceY;

        const pitch = Math.sin(time * (bounceRate * 0.5) + this.id) * 0.022;
        this.kartTiltGroup.rotation.x = pitch;

        // Dense tire smoke and clay dust plume billowing behind the rear wheels
        this.stepTimer += delta * this.currentSpeed;
        if (this.stepTimer >= 1.8) {
            const mistX = 5.2; // Aligned with the outer rear wheels
            const mistZ = -12.2; // Spawning directly behind the rear chassis
            const scale = 2.6 + Math.random() * 0.9;
            spawnFootstepMist(this.position.x - mistX, this.position.z + mistZ, scale);
            spawnFootstepMist(this.position.x + mistX, this.position.z + mistZ, scale);
            if (Math.random() < 0.45) {
                spawnFootstepMist(this.position.x + (Math.random() - 0.5) * 3.2, this.position.z - 13.0, scale * 1.3);
            }
            this.stepTimer = 0;
        }
    }

    updateCelebrationPose(time) {
        this.mesh.position.x = this.position.x;
        this.mesh.position.z = this.position.z;
        this.currentSpeed = 0;
        this.swerveRoll = 0;
        this.swerveYaw = 0;
        this.swerveVelX = 0;
        this.swerveDuration = 0;

        const isWinner = (racers[0] === this);
        if (isWinner) {
            this.kartTiltGroup.position.y = this.baseKartY + Math.abs(Math.sin(time * 7)) * 0.35;
            this.kartTiltGroup.rotation.y += 0.05;
            this.kartTiltGroup.rotation.z = Math.sin(time * 6) * 0.10;
        } else {
            this.kartTiltGroup.position.y = this.baseKartY + Math.sin(time * 6 + this.id) * 0.04;
            this.kartTiltGroup.rotation.set(0, 0, 0);
        }
    }

    update(delta, time) {
        if (raceState === RACE_STATE.READY || raceState === RACE_STATE.INTRO || raceState === RACE_STATE.COUNTDOWN) {
            this.updateReadyPose(time);
            return;
        }

        if (this.finished || raceState === RACE_STATE.FINISHED) {
            this.updateCelebrationPose(time);
            return;
        }

        if (raceState === RACE_STATE.RACING) {
            this.updateRacingMovement(delta, time);
        }
    }

    dispose() {
        this.mesh.traverse(child => {
            if (!this.usingGLB && child.isMesh && child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => m.dispose());
                } else {
                    child.material.dispose();
                }
            }
            if (child.isSprite && child.material) {
                child.material.map?.dispose();
                child.material.dispose();
            }
        });
    }
}

/**
 * GAME STATE & DOM CACHING
 */
let racers = [];
let ducks = racers; // Backward-compatible alias for console & external scripts
let lbRowsCache = [];

function initRacers() {
    racers.forEach(d => { scene.remove(d.mesh); d.dispose(); });
    racers = [];
    ducks = racers;
    resetFootstepMist();

    const raceConfig = storedRaces[currentRaceIndex] || (typeof DEFAULT_RACES !== 'undefined' ? DEFAULT_RACES[0] : null);
    if (!raceConfig) return;

    const names = raceConfig.racers || raceConfig.ducks || [];
    const headerTitle = document.getElementById('header-race-name');
    if (headerTitle) headerTitle.innerText = raceConfig.name.toUpperCase();

    // Evenly spaced, straight starting line across the road width
    const spacing = 13.0;
    const leftBound = -((CONFIG.racerCount - 1) * spacing) / 2;

    for (let i = 0; i < CONFIG.racerCount; i++) {
        const x = leftBound + (i * spacing);
        const name = names[i % names.length] || `Zoombie ${i + 1}`;
        racers.push(new Zoombie(i, name, x));
    }

    initLeaderboardDOM();
}
const initDucks = initRacers; // Backward-compatible alias

function resetRacersToStartGrid() {
    if (racers.length !== CONFIG.racerCount) {
        initRacers();
        return;
    }
    const spacing = 13.0;
    const leftBound = -((CONFIG.racerCount - 1) * spacing) / 2;
    racers.sort((a, b) => a.id - b.id);
    for (let i = 0; i < racers.length; i++) {
        racers[i].startX = leftBound + (i * spacing);
        racers[i].resetToStartLine();
    }
    resetFootstepMist();
}

function initLeaderboardDOM() {
    const lbContent = document.getElementById('lb-content');
    if (!lbContent) return;
    lbContent.innerHTML = '';
    lbRowsCache = [];

    for (let i = 0; i < CONFIG.racerCount; i++) {
        const row = document.createElement('div');
        row.className = i === 0 ? 'lb-row leader' : 'lb-row';

        const rank = document.createElement('div');
        rank.className = 'lb-rank';

        const info = document.createElement('div');
        info.className = 'lb-info-container';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'lb-name';

        info.appendChild(nameSpan);
        row.appendChild(rank);
        row.appendChild(info);
        lbContent.appendChild(row);

        lbRowsCache.push({ row, rank, nameSpan, _racerId: -1, _isLeader: (i === 0) });
    }
}

/**
 * HALLOWEEN FIREWORKS SYSTEM
 */
const fxCanvas = document.getElementById('fireworks-canvas');
const fxCtx = fxCanvas ? fxCanvas.getContext('2d') : null;
if (fxCanvas) fxCanvas.style.zIndex = "9999";

let fireworks = [];
let particles = [];
let doFireworks = false;
let winnerColor = '#c042ff';

function resizeCanvas() {
    if (fxCanvas) {
        fxCanvas.width = window.innerWidth;
        fxCanvas.height = window.innerHeight;
    }
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

class Firework {
    constructor(targetY, color) {
        this.x = Math.random() * fxCanvas.width;
        this.y = fxCanvas.height;
        this.targetY = targetY;
        this.color = color;
        this.speed = 10 + Math.random() * 5;
        this.angle = -Math.PI / 2 + (Math.random() - 0.5) * 0.5;
        this.vx = Math.cos(this.angle) * this.speed;
        this.vy = Math.sin(this.angle) * this.speed;
        this.dead = false;
    }
    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.vy += 0.05;
        if (this.vy >= 0 || this.y <= this.targetY) {
            this.dead = true;
            explode(this.x, this.y, this.color);
        }
    }
    draw() {
        fxCtx.beginPath();
        fxCtx.arc(this.x, this.y, 3, 0, Math.PI * 2);
        fxCtx.fillStyle = this.color;
        fxCtx.fill();
    }
}

class Particle {
    constructor(x, y, color) {
        this.x = x;
        this.y = y;
        this.color = color;
        const angle = Math.random() * Math.PI * 2;
        const speed = 1.5 + Math.random() * 5.5;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;
        this.alpha = 1;
        this.decay = 0.014 + Math.random() * 0.018;
        this.size = 2.2 + Math.random() * 1.4;
    }
    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.vy += 0.09;
        this.vx *= 0.985;
        this.alpha -= this.decay;
    }
}

function explode(x, y, color) {
    // Fireworks exclusively in the winner's color (no green)
    for (let i = 0; i < 55; i++) {
        particles.push(new Particle(x, y, color));
    }
}

function updateFireworks() {
    if (!fxCtx) return;
    // Zero CPU overhead during the race: immediate return when fireworks are idle
    if (!doFireworks && fireworks.length === 0 && particles.length === 0) return;

    fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);

    if (doFireworks && Math.random() < 0.22) {
        fireworks.push(new Firework(80 + Math.random() * (fxCanvas.height * 0.45), winnerColor));
    }

    for (let i = fireworks.length - 1; i >= 0; i--) {
        const fw = fireworks[i];
        fw.update();
        fw.draw();
        if (fw.dead) fireworks.splice(i, 1);
    }

    if (particles.length > 0) {
        fxCtx.fillStyle = winnerColor;
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.update();
            if (p.alpha <= 0) {
                particles.splice(i, 1);
            } else {
                fxCtx.globalAlpha = Math.max(0, p.alpha);
                fxCtx.beginPath();
                fxCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                fxCtx.fill();
            }
        }
        fxCtx.globalAlpha = 1.0;
    }
}

function startFireworks(hexColor) {
    winnerColor = '#' + hexColor.toString(16).padStart(6, '0');
    doFireworks = true;
}

function stopFireworks() {
    doFireworks = false;
    fireworks = [];
    particles = [];
    if (fxCtx) {
        fxCtx.globalAlpha = 1.0;
        fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
    }
}

/**
 * UI & INTERACTION
 */
const cdDiv = document.createElement('div');
cdDiv.id = 'countdown-overlay';
cdDiv.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    display: none; align-items: center; justify-content: center;
    z-index: 9000; pointer-events: none;
`;
document.body.appendChild(cdDiv);

const startScreen = document.getElementById('start-screen');
const endScreen = document.getElementById('end-screen');
const winnerText = document.getElementById('winner-text');
const progressFill = document.getElementById('progress-fill');
const speedEl = document.getElementById('speed-stat');
const raceSelect = document.getElementById('race-select');
const racerPreview = document.getElementById('racer-preview') || document.getElementById('duck-preview');
const duckPreview = racerPreview; // Backward-compatible alias

const aboutBtn = document.getElementById('about-btn');
const aboutModal = document.getElementById('about-modal');
const closeAboutBtn = document.getElementById('close-about-btn');

const manageBtn = document.getElementById('manage-btn');
const configModal = document.getElementById('config-modal');
const cancelConfigBtn = document.getElementById('cancel-config-btn');
const saveConfigBtn = document.getElementById('save-config-btn');
const resetDataBtn = document.getElementById('reset-data-btn');

function populateRaceSelector() {
    raceSelect.innerHTML = '';
    storedRaces.forEach((race, index) => {
        const opt = document.createElement('option');
        opt.value = index;
        opt.innerText = race.name;
        if (index === currentRaceIndex) opt.selected = true;
        raceSelect.appendChild(opt);
    });
}

function updateRacerPreview() {
    const raceConfig = storedRaces[currentRaceIndex] || (typeof DEFAULT_RACES !== 'undefined' ? DEFAULT_RACES[0] : null);
    if (!raceConfig) return;

    const names = raceConfig.racers || raceConfig.ducks || [];
    const types = (typeof MONSTER_TYPES !== 'undefined') ? MONSTER_TYPES : [];
    let html = '';
    for (let i = 0; i < 8; i++) {
        const color = COLORS[i];
        const r = (color >> 16) & 255, g = (color >> 8) & 255, b = color & 255;
        const txtCol = (((r * 299) + (g * 587) + (b * 114)) / 1000) >= 128 ? '#000' : '#fff';
        const hex = '#' + color.toString(16).padStart(6, '0');
        const name = names[i] || `Zoombie ${i + 1}`;
        const mType = types[i] || '';
        html += `
            <div class="preview-item">
                <div class="preview-num" style="background:${hex}; color:${txtCol};">${i + 1}</div>
                <div class="preview-name">${name}</div>
                <div class="preview-type">${mType}</div>
            </div>`;
    }
    if (racerPreview) racerPreview.innerHTML = html;
}
const updateDuckPreview = updateRacerPreview; // Backward-compatible alias

raceSelect.addEventListener('change', (e) => {
    currentRaceIndex = parseInt(e.target.value, 10);
    setRaceState(RACE_STATE.READY);
    firstFinishTriggered = false;
    progressFill.style.width = "0%";
    if (speedEl) speedEl.innerText = "0";
    updateRacerPreview();
    initRacers();
    generateTrackHazards();
});

if (aboutBtn && aboutModal && closeAboutBtn) {
    aboutBtn.addEventListener('click', () => aboutModal.classList.remove('hidden'));
    closeAboutBtn.addEventListener('click', () => aboutModal.classList.add('hidden'));
}

manageBtn.addEventListener('click', () => {
    configModal.classList.remove('hidden');
    for (let i = 0; i < 8; i++) document.getElementById(`p-name-${i}`).value = "";
    document.getElementById('new-race-name').value = "";
});

cancelConfigBtn.addEventListener('click', () => configModal.classList.add('hidden'));

saveConfigBtn.addEventListener('click', () => {
    const rName = document.getElementById('new-race-name').value.trim() || "Untitled Haunt";
    const dNames = [];
    for (let i = 0; i < 8; i++) {
        const val = document.getElementById(`p-name-${i}`).value.trim();
        dNames.push(val || `Zoombie ${i + 1}`);
    }
    const newRace = { id: "custom_" + Date.now(), name: rName, racers: dNames, ducks: dNames };
    storedRaces.push(newRace);
    saveRaceData();
    currentRaceIndex = storedRaces.length - 1;
    setRaceState(RACE_STATE.READY);
    populateRaceSelector();
    updateRacerPreview();
    initRacers();
    generateTrackHazards();
    configModal.classList.add('hidden');
});

resetDataBtn.addEventListener('click', () => {
    resetData();
    configModal.classList.add('hidden');
});

document.getElementById('start-btn').addEventListener('click', async () => {
    // Guarantee Creepster font is 100% loaded and ready in browser before countdown starts
    if (typeof document !== 'undefined' && document.fonts && document.fonts.load) {
        try {
            await document.fonts.load("200px 'Creepster'");
            if (document.fonts.ready) await document.fonts.ready;
        } catch (e) {
            console.warn("Creepster font loading check:", e);
        }
    }

    startScreen.classList.add('hidden');

    // Reset all racers cleanly onto the starting line in READY/INTRO stance
    resetRacersToStartGrid();
    generateTrackHazards();
    firstFinishTriggered = false;

    // Start camera intro flyby panning across the racers
    introFlybyTimer = 0;
    introFlybyActive = true;
    setRaceState(RACE_STATE.INTRO);

    raceAudio.init();

    // Engine rev repeats while camera is panning racers at the start
    sfxEngine.currentTime = 0;
    sfxEngine.loop = true;
    sfxEngine.volume = 0.95;
    sfxEngine.play().catch(e => console.warn("Engine sound failed:", e));
});

function runCountdownSequence() {
    if (countdownTimerId) {
        clearInterval(countdownTimerId);
        countdownTimerId = null;
    }

    const cd = document.getElementById('countdown-overlay');
    cd.innerHTML = '';
    cd.style.display = 'flex';

    // Play start.ogg (countdown sfx with 3 spaced beeps) as camera reaches starting position
    sfxStart.currentTime = 0;
    sfxStart.volume = 1.0;
    sfxStart.play().catch(e => console.warn("Start sound failed:", e));

    let count = 3;

    const showNum = (num, color) => {
        cd.innerHTML = `<div style="
            background: #220e38;
            padding: 20px 60px;
            transform: skewX(-15deg);
            border-left: 8px solid #c042ff;
            display: inline-block;
            box-shadow: 0 5px 30px rgba(0,0,0,0.85), 0 0 20px rgba(192, 66, 255, 0.45);
        ">
            <span style="
                font-family: 'Creepster', 'Rajdhani', sans-serif;
                font-size: 200px;
                color: ${color};
                display: block;
                transform: skewX(15deg);
                text-shadow: 0 0 20px #c042ff;
            ">${num}</span>
        </div>`;
    };

    // Immediately display '3'
    showNum(count, '#e1bee7');
    count--;

    countdownTimerId = setInterval(() => {
        if (count > 0) {
            showNum(count, '#e1bee7');
            count--;
        } else {
            clearInterval(countdownTimerId);
            countdownTimerId = null;
            cd.innerHTML = "";
            cd.style.display = 'none';

            // Exactly 3 seconds after the start of start.ogg, the race begins!
            setRaceState(RACE_STATE.RACING);
            startRaceAudio();
        }
    }, 1000);
}

document.getElementById('restart-btn').addEventListener('click', () => {
    endScreen.classList.add('hidden');
    startScreen.classList.remove('hidden');

    if (countdownTimerId) {
        clearInterval(countdownTimerId);
        countdownTimerId = null;
    }
    if (fadeInterval) {
        clearInterval(fadeInterval);
        fadeInterval = null;
    }
    sfxRace.pause();
    sfxRace.currentTime = 0;
    sfxRace.volume = 0;

    sfxEngine.pause();
    sfxEngine.currentTime = 0;
    sfxEngine.loop = false;

    sfxStart.pause();
    sfxStart.currentTime = 0;

    sfxWinner.pause();
    sfxWinner.currentTime = 0;

    introFlybyActive = false;
    introFlybyTimer = 0;
    isFadingInRaceAudio = false;
    raceAudioTargetVolume = 1.0;

    stopFireworks();

    currentRaceIndex = (currentRaceIndex + 1) % storedRaces.length;
    populateRaceSelector();
    updateRacerPreview();

    setRaceState(RACE_STATE.READY);
    firstFinishTriggered = false;

    progressFill.style.width = "0%";
    if (speedEl) speedEl.innerText = "0";
    initRacers();
    generateTrackHazards();
    camera.position.set(0, 18, 54);
    cameraLookAt.set(0, 6.0, 0);
    camera.lookAt(cameraLookAt);
});

loadRaceData();
loadAboutInfo();

/**
 * CAMERA SYSTEM & DYNAMIC LIGHT/SHADOW TRACKING
 */
const clock = new THREE.Clock();
let camAngle = 0, camTimer = 0;
let cameraLookAt = new THREE.Vector3(0, 6.0, 0);
let cinematicTarget = new THREE.Vector3();
let cinematicLook = new THREE.Vector3();

const LB_SCREEN_FRACTION = 0.185;
const RACER_PADDING = 5.5;
const DUCK_PADDING = RACER_PADDING; // Backward-compatible alias
const MIN_CAM_DIST_Z = 36;

const cachedBounds = {
    centerX: 0,
    centerZ: 0,
    spreadX: 0,
    spreadZ: 0,
    minX: 0,
    maxX: 0,
    minZ: 0,
    maxZ: 0
};

function getRacerBounds() {
    let minX = Infinity, maxX = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    for (let i = 0; i < racers.length; i++) {
        const p = racers[i].position;
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.z < minZ) minZ = p.z;
        if (p.z > maxZ) maxZ = p.z;
    }

    cachedBounds.centerX = (minX + maxX) * 0.5;
    cachedBounds.centerZ = (minZ + maxZ) * 0.5;
    cachedBounds.spreadX = (maxX - minX) + RACER_PADDING * 2;
    cachedBounds.spreadZ = (maxZ - minZ) + RACER_PADDING * 2;
    cachedBounds.minX = minX;
    cachedBounds.maxX = maxX;
    cachedBounds.minZ = minZ;
    cachedBounds.maxZ = maxZ;

    return cachedBounds;
}
const getDuckBounds = getRacerBounds; // Backward-compatible alias

function calcDistanceForWidth(worldWidth, screenFraction) {
    const fovRad = THREE.MathUtils.degToRad(camera.fov);
    const d = worldWidth / (screenFraction * 2 * Math.tan(fovRad / 2) * camera.aspect);
    return Math.max(MIN_CAM_DIST_Z, d);
}

// Exact 3D bounding-box solver: guarantees all riders fit inside safe area for any view direction
function calcFitDistanceForAngle(bounds, unitDir, lookPoint, safeFracX = 0.80, safeFracY = 0.82) {
    const fovRad = THREE.MathUtils.degToRad(camera.fov);
    const tanHalfFovY = Math.tan(fovRad / 2);
    const tanHalfFovX = tanHalfFovY * camera.aspect;

    const tanSafeX = tanHalfFovX * safeFracX;
    const tanSafeY = tanHalfFovY * safeFracY;

    // View direction vector from camera to lookPoint is -unitDir
    const vx = -unitDir.x, vy = -unitDir.y, vz = -unitDir.z;

    // Camera right vector r = v x worldUp (0, 1, 0)
    let rx = -vz, ry = 0, rz = vx;
    const rLen = Math.hypot(rx, rz);
    if (rLen < 0.0001) { rx = 1; ry = 0; rz = 0; } else { rx /= rLen; rz /= rLen; }

    // Camera up vector = r x v
    const upX = ry * vz - rz * vy;
    const upY = rz * vx - rx * vz;
    const upZ = rx * vy - ry * vx;

    // Bounding box corners around all racers with generous padding
    const padX = 7.5;
    const padZ = 8.5;
    const xs = [bounds.minX - padX, bounds.maxX + padX];
    const ys = [0.0, 9.0]; // Ground up to racer name label
    const zs = [bounds.minZ - padZ, bounds.maxZ + padZ];

    let maxDist = 38.0;

    for (let i = 0; i < 2; i++) {
        const qx = xs[i] - lookPoint.x;
        for (let j = 0; j < 2; j++) {
            const qy = ys[j] - lookPoint.y;
            for (let k = 0; k < 2; k++) {
                const qz = zs[k] - lookPoint.z;

                const distAlongV = qx * vx + qy * vy + qz * vz;
                const distAlongR = Math.abs(qx * rx + qy * ry + qz * rz);
                const distAlongUp = Math.abs(qx * upX + qy * upY + qz * upZ);

                const reqX = (distAlongR / tanSafeX) - distAlongV;
                const reqY = (distAlongUp / tanSafeY) - distAlongV;

                const req = Math.max(reqX, reqY);
                if (req > maxDist) maxDist = req;
            }
        }
    }

    return maxDist;
}

function applyViewOffset() {
    const fullW = window.innerWidth;
    const fullH = window.innerHeight;
    const shiftPixels = -fullW * (LB_SCREEN_FRACTION / 2);
    camera.setViewOffset(fullW, fullH, shiftPixels, 0, fullW, fullH);
}

const winnerCamOffset = new THREE.Vector3(0, 6.0, 0);

function updateCamera(time, delta, leadRacer) {
    if (time > camTimer + 10) { camTimer = time; camAngle = (camAngle + 1) % 3; }
    const target = cinematicTarget, look = cinematicLook;

    const bounds = getRacerBounds();

    // Move directional moonlight & non-shadow fill/rim lights along with the pack
    moonLight.position.set(45, 95, bounds.centerZ + 40);
    moonLight.target.position.set(0, 0, bounds.centerZ);
    moonLight.target.updateMatrixWorld();

    packFillLight.position.set(bounds.centerX - 16, 26, bounds.centerZ + 36);
    packFillLight.target.position.set(bounds.centerX, 3.5, bounds.centerZ);
    packFillLight.target.updateMatrixWorld();

    packRimLight.position.set(bounds.centerX + 12, 30, bounds.centerZ - 38);
    packRimLight.target.position.set(bounds.centerX, 3.5, bounds.centerZ);
    packRimLight.target.updateMatrixWorld();

    if (firstFinishTriggered) {
        const winner = racers[0];
        const t = time - winnerFinishTime;

        const dist = 24 + (t * 2.5);
        const height = 11.0 + (t * 1.6);
        const angle = -0.25 + (t * 0.18);

        target.set(
            winner.position.x + Math.sin(angle) * dist,
            height,
            winner.position.z + Math.cos(angle) * dist
        );
        look.copy(winner.position).add(winnerCamOffset);

    } else if (raceState === RACE_STATE.INTRO) {
        // Camera start line zoom-in and flyby panning across all racers
        introFlybyTimer += delta;
        const flybyDuration = 4.2;
        const p = Math.min(1.0, introFlybyTimer / flybyDuration);

        const lookPoint = new THREE.Vector3(bounds.centerX, 4.0, bounds.centerZ);
        const unitDir = new THREE.Vector3(0, 0.32, 0.95).normalize();
        const fitDist = calcFitDistanceForAngle(bounds, unitDir, lookPoint, 0.80, 0.82);
        const showcaseTarget = new THREE.Vector3().copy(lookPoint).addScaledVector(unitDir, fitDist);
        const showcaseLook = lookPoint;

        const leftX = bounds.minX - 9.0;
        const rightX = bounds.maxX + 9.0;

        if (p < 0.28) {
            // Stage 1: Zoom in from starting showcase to low-angle left side of starting grid
            const u = p / 0.28;
            const ease = u * u * (3 - 2 * u);
            target.lerpVectors(showcaseTarget, new THREE.Vector3(leftX, 5.5, 17.5), ease);
            look.lerpVectors(showcaseLook, new THREE.Vector3(bounds.minX + 4.0, 3.2, 0.0), ease);
        } else if (p < 0.72) {
            // Stage 2: Low-angle dramatic flyby panning across all 8 racers lined up
            const u = (p - 0.28) / (0.72 - 0.28);
            const ease = u * u * (3 - 2 * u);
            const curX = THREE.MathUtils.lerp(leftX, rightX, ease);
            target.set(curX, 5.2 + Math.sin(ease * Math.PI) * 0.9, 17.0);
            look.set(curX + 5.0, 3.2, 0.0);
        } else {
            // Stage 3: Smoothly pull back to starting showcase position
            const u = (p - 0.72) / (1.0 - 0.72);
            const ease = u * u * (3 - 2 * u);
            target.lerpVectors(new THREE.Vector3(rightX, 6.0, 17.5), showcaseTarget, ease);
            look.lerpVectors(new THREE.Vector3(bounds.maxX, 3.2, 0.0), showcaseLook, ease);
        }

        if (p >= 1.0) {
            // As camera completes pulling back to starting position:
            // Stop engine rev, transition to COUNTDOWN, and play start.ogg
            introFlybyActive = false;
            sfxEngine.pause();
            sfxEngine.currentTime = 0;
            sfxEngine.loop = false;
            setRaceState(RACE_STATE.COUNTDOWN);
            runCountdownSequence();
        }

    } else if (raceState === RACE_STATE.READY || raceState === RACE_STATE.COUNTDOWN) {
        // Front-facing starting grid showcase camera fitted to safe area
        const lookPoint = new THREE.Vector3(bounds.centerX, 4.0, bounds.centerZ);
        const unitDir = new THREE.Vector3(0, 0.32, 0.95).normalize();
        const fitDist = calcFitDistanceForAngle(bounds, unitDir, lookPoint, 0.80, 0.82);
        target.copy(lookPoint).addScaledVector(unitDir, fitDist);
        look.copy(lookPoint);

    } else {
        const distRemaining = CONFIG.raceDistance - leadRacer.position.z;
        const finishApproachDist = CONFIG.raceDistance * 0.05; // 5% from finish line (210m for 4200m track)

        if (distRemaining <= finishApproachDist) {
            // High aerial bird's-eye view framing all 8 karts and the finish line from optimal broadcast height
            const birdsEyeHeight = Math.min(82.0, Math.max(56.0, bounds.spreadZ * 0.32 + 36.0));
            const birdsEyeDistZ = Math.min(88.0, Math.max(50.0, bounds.spreadZ * 0.35 + 26.0));
            target.set(bounds.centerX, birdsEyeHeight, bounds.centerZ - birdsEyeDistZ);
            look.set(bounds.centerX, 2.5, Math.min(CONFIG.raceDistance + 10, bounds.centerZ + 35));
        } else {
            if (camAngle === 0) {
                // Front chase broadcast camera
                const lookPoint = new THREE.Vector3(bounds.centerX, 4.0, bounds.centerZ * 0.70 + leadRacer.position.z * 0.30);
                const unitDir = new THREE.Vector3(0, 0.32, 0.95).normalize();
                const fitDist = calcFitDistanceForAngle(bounds, unitDir, lookPoint, 0.80, 0.82);
                target.copy(lookPoint).addScaledVector(unitDir, fitDist);
                look.copy(lookPoint);
            } else if (camAngle === 1) {
                // High elevated overview camera
                const lookPoint = new THREE.Vector3(bounds.centerX, 3.5, bounds.centerZ);
                const unitDir = new THREE.Vector3(0, 0.58, 0.81).normalize();
                const fitDist = calcFitDistanceForAngle(bounds, unitDir, lookPoint, 0.80, 0.82);
                target.copy(lookPoint).addScaledVector(unitDir, fitDist);
                look.copy(lookPoint);
            } else {
                // Right-side 3/4 dynamic broadcast camera (angled across track to keep pack in open center-right safe area)
                const lookPoint = new THREE.Vector3(bounds.centerX - 2.0, 4.0, bounds.centerZ);
                const unitDir = new THREE.Vector3(0.48, 0.35, 0.80).normalize();
                const fitDist = calcFitDistanceForAngle(bounds, unitDir, lookPoint, 0.80, 0.82);
                target.copy(lookPoint).addScaledVector(unitDir, fitDist);
                look.copy(lookPoint);
            }
        }
    }

    camera.position.lerp(target, Math.min(1.0, 4.5 * delta));
    cameraLookAt.lerp(look, Math.min(1.0, 4.5 * delta));
    camera.lookAt(cameraLookAt);
}

function lightenColor(hex, amount) {
    let r = (hex >> 16) & 255;
    let g = (hex >> 8) & 255;
    let b = hex & 255;

    r = Math.min(255, Math.round(r + (255 - r) * amount));
    g = Math.min(255, Math.round(g + (255 - g) * amount));
    b = Math.min(255, Math.round(b + (255 - b) * amount));

    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

let lastSpeedDisplay = -1;
let lastProgressPct = -1;

function updateUI(leadRacer, sortedRacers, time) {
    if (speedEl) {
        let curSpeed = 0;
        if (raceState === RACE_STATE.RACING) {
            const ratio = leadRacer.currentSpeed / (leadRacer.baseSpeed || 140);
            const speedValue = Math.round(98 * ratio + Math.sin(time * 6.0 + leadRacer.id) * 1.5);
            curSpeed = Math.min(120, Math.max(0, speedValue));
        }
        if (lastSpeedDisplay !== curSpeed) {
            speedEl.textContent = curSpeed;
            lastSpeedDisplay = curSpeed;
        }
    }

    for (let i = 0; i < sortedRacers.length; i++) {
        const d = sortedRacers[i];
        const cache = lbRowsCache[i];
        if (!cache) continue;

        if (cache._racerId !== d.id) {
            cache.rank.style.background = d.hexColor;
            cache.rank.style.color = d.txtColor;
            cache.rank.textContent = d.idPlus1;
            cache.nameSpan.style.color = d.lightenedColor;
            cache.nameSpan.textContent = d.name;
            cache._racerId = d.id;
        }

        const isLeader = (i === 0);
        if (cache._isLeader !== isLeader) {
            cache.row.className = isLeader ? 'lb-row leader' : 'lb-row';
            cache._isLeader = isLeader;
        }
    }

    const pct = Math.min((leadRacer.position.z / CONFIG.raceDistance) * 100, 100);
    if (Math.abs(lastProgressPct - pct) > 0.05) {
        progressFill.style.width = pct.toFixed(1) + '%';
        lastProgressPct = pct;
    }
}

function animate() {
    requestAnimationFrame(animate);
    const deltaReal = Math.min(clock.getDelta(), 0.1);
    const delta = deltaReal * gameSpeed;
    const time = clock.getElapsedTime();

    // Flickering candle effect for roadside Jack-o'-Lantern faces (optimized single material update)
    if (jackLanternMaterials.length > 0) {
        const flicker = 1.6 + Math.sin(time * 14) * 0.4 + Math.cos(time * 23) * 0.3;
        for (let i = 0; i < jackLanternMaterials.length; i++) {
            jackLanternMaterials[i].emissiveIntensity = flicker;
        }
    }

    if (raceState === RACE_STATE.RACING) {
        updateFootstepMist(delta);
        checkHazardCollisions(time);
    }
    updateHazardAnimations(delta, time);
    updateFireworks();

    // Update all racers according to the active raceState
    for (let i = 0; i < racers.length; i++) {
        const d = racers[i];
        d.update(delta, time);
        if (raceState === RACE_STATE.RACING && !d.finished && d.position.z >= CONFIG.raceDistance) {
            d.finished = true;
            d.finishTime = time;
            // As each kart reaches the finish line, decrease volume of race.ogg by 17%
            decreaseRaceAudioVolume(0.17);
        }
    }

    // Dynamic race audio volume management (decreased by 17% per finished racer)
    if (sfxRace && !sfxRace.paused) {
        if (Math.abs(sfxRace.volume - raceAudioTargetVolume) > 0.005) {
            sfxRace.volume = THREE.MathUtils.lerp(sfxRace.volume, raceAudioTargetVolume, Math.min(1.0, deltaReal * 4.0));
        } else {
            sfxRace.volume = raceAudioTargetVolume;
        }
    }

    if (raceState === RACE_STATE.RACING) {
        // Kart collision avoidance and overtaking room with dramatic collision swerves
        const minSep = 12.0;
        const minSepSq = minSep * minSep;
        for (let i = 0; i < racers.length; i++) {
            for (let j = i + 1; j < racers.length; j++) {
                const d1 = racers[i], d2 = racers[j];
                const dx = d1.position.x - d2.position.x;
                const dz = d1.position.z - d2.position.z;
                const distSq = dx * dx + dz * dz;
                if (distSq < minSepSq) {
                    const dist = Math.sqrt(distSq);
                    if (dist < 0.001) { d1.position.x += 0.1; continue; }
                    const overlap = minSep - dist;
                    const push = overlap * 0.52;
                    const nx = dx / dist, nz = dz / dist;
                    d1.position.x += nx * push; d1.position.z += nz * push;
                    d2.position.x -= nx * push; d2.position.z -= nz * push;

                    // Trigger dramatic swerves & thud sound ONLY upon collision with another kart
                    const c1 = d1.triggerCollisionSwerve(d2, time, nx);
                    const c2 = d2.triggerCollisionSwerve(d1, time, -nx);
                    if (c1 || c2) {
                        playThudSound(time);
                    }
                }
            }
        }

        racers.sort((a, b) => (a.finished && b.finished)
            ? a.finishTime - b.finishTime
            : (a.finished ? -1 : (b.finished ? 1 : b.position.z - a.position.z))
        );

        let anyFinished = false;
        let allFinished = true;
        let trueWinner = racers[0];

        for (let i = 0; i < racers.length; i++) {
            const d = racers[i];
            if (d.finished) {
                anyFinished = true;
                if (d.finishTime < trueWinner.finishTime) {
                    trueWinner = d;
                }
            } else {
                allFinished = false;
            }
        }

        if (!firstFinishTriggered && anyFinished) {
            firstFinishTriggered = true;
            winnerFinishTime = time;

            sfxWinner.currentTime = 0;
            sfxWinner.play().catch(e => console.warn(e));

            startFireworks(racers[0].color);
        }

        if (allFinished && raceState !== RACE_STATE.FINISHED) {
            setRaceState(RACE_STATE.FINISHED);

            winnerText.innerText = `WINNER: #${trueWinner.id + 1} ${trueWinner.name.toUpperCase()}!`;
            winnerText.style.color = trueWinner.lightenedColor || lightenColor(trueWinner.color, 0.4);
            setTimeout(() => { endScreen.classList.remove('hidden'); }, 2000);

            fadeOutAudio(sfxRace, 3000);
        }
    }

    const leadRacer = racers[0];
    if (leadRacer) {
        updateCamera(time, deltaReal, leadRacer);
        updateUI(leadRacer, racers, time);
    }

    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    applyViewOffset();
    camera.fov = 46;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    resizeCanvas();
});

applyViewOffset();
animate();
