/**
 * CONFIGURATION & DATA MANAGEMENT
 */
const CONFIG = {
    duckCount: 8,
    raceDistance: 800,
    targetDuration: 48,
    roadWidth: 74,
    racerScale: 2.4
};

// Explicit Race State Machine
const RACE_STATE = {
    READY: 'READY',
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

const STORAGE_KEY = 'zoombieRaceData_v1';

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

function setRaceState(nextState) {
    raceState = nextState;
    isCountingDown = (nextState === RACE_STATE.COUNTDOWN);
    isRacing = (nextState === RACE_STATE.RACING || nextState === RACE_STATE.FINISHED);
    raceEnded = (nextState === RACE_STATE.FINISHED);
}

// -- AUDIO SETUP --
const sfxRiver = new Audio('audio/river_looped.mp3');
sfxRiver.loop = true;
sfxRiver.volume = 0.5;

const sfxStart = new Audio('audio/start.mp3');
sfxStart.volume = 1.0;

const sfxWinner = new Audio('audio/winner.mp3');
sfxWinner.volume = 1.0;

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
        storedRaces = JSON.parse(data);
    } else if (typeof DEFAULT_RACES !== 'undefined') {
        storedRaces = JSON.parse(JSON.stringify(DEFAULT_RACES));
    } else {
        storedRaces = [];
    }
    populateRaceSelector();
    updateDuckPreview();
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
        container.innerHTML = `
            <p><strong>${APP_INFO.title}</strong></p>
            <p>${APP_INFO.version}</p>
            <br>
            <p>${APP_INFO.description}</p>
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

// --- PROCEDURAL PURPLE / NAVY GRADIENT NIGHT SKY ---
function createNightSkyTexture() {
    const cvs = document.createElement('canvas');
    cvs.width = 32;
    cvs.height = 512;
    const ctx = cvs.getContext('2d');

    // Top-to-bottom cartoon night sky gradient: deep navy -> twilight indigo -> rich royal purple horizon
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0.00, '#070b1e'); // Deep midnight navy at zenith
    grad.addColorStop(0.28, '#121536'); // Dark twilight blue-indigo
    grad.addColorStop(0.55, '#24174a'); // Rich cartoon Halloween purple
    grad.addColorStop(0.80, '#361d63'); // Vibrant plum-violet near horizon
    grad.addColorStop(1.00, '#1e1136'); // Ground-blend purple
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 512);

    const tex = new THREE.CanvasTexture(cvs);
    tex.encoding = THREE.sRGBEncoding;
    return tex;
}

scene.background = createNightSkyTexture();
// Fog matches the lower-horizon royal purple of the sky gradient for seamless depth
scene.fog = new THREE.FogExp2(0x22133d, 0.0026);

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
moonLight.shadow.camera.left = -65;
moonLight.shadow.camera.right = 65;
moonLight.shadow.camera.top = 85;
moonLight.shadow.camera.bottom = -85;
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
    tex.repeat.set(1, 45);
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

const roadTex = createRoadTexture();
const stoneTex = createCryptStoneTexture();

/**
 * HAUNTED ROAD, MOON, STARS & INSTANCED ENVIRONMENT
 */
const landscapeGroup = new THREE.Group();
scene.add(landscapeGroup);

// 1. Haunted Road
const roadLength = CONFIG.raceDistance + 1200;
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

const leftKerb = new THREE.Mesh(kerbGeo, kerbMat);
leftKerb.position.set(-(CONFIG.roadWidth / 2) - 1.25, 0.45, CONFIG.raceDistance / 2);
leftKerb.receiveShadow = true;
landscapeGroup.add(leftKerb);

const rightKerb = new THREE.Mesh(kerbGeo, kerbMat);
rightKerb.position.set((CONFIG.roadWidth / 2) + 1.25, 0.45, CONFIG.raceDistance / 2);
rightKerb.receiveShadow = true;
landscapeGroup.add(rightKerb);

const vergeGeo = new THREE.BoxGeometry(340, 20, roadLength);
const vergeMat = new THREE.MeshStandardMaterial({ color: 0x19261d, roughness: 0.92 });

const leftVerge = new THREE.Mesh(vergeGeo, vergeMat);
leftVerge.position.set(-208, -9.8, CONFIG.raceDistance / 2);
leftVerge.receiveShadow = true;
landscapeGroup.add(leftVerge);

const rightVerge = new THREE.Mesh(vergeGeo, vergeMat);
rightVerge.position.set(208, -9.8, CONFIG.raceDistance / 2);
rightVerge.receiveShadow = true;
landscapeGroup.add(rightVerge);

// 3. Full Moon & Starfield
const moonGroup = new THREE.Group();
const moonGeo = new THREE.SphereGeometry(58, 32, 32);
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

// Stars
const starCount = 450;
const starPositions = new Float32Array(starCount * 3);
for (let i = 0; i < starCount; i++) {
    starPositions[i * 3] = (Math.random() - 0.5) * 1400;
    starPositions[i * 3 + 1] = 80 + Math.random() * 350;
    starPositions[i * 3 + 2] = -200 + Math.random() * (CONFIG.raceDistance + 1000);
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

function buildHauntedForestCorridor(treeTemplates) {
    forestGroup.clear();
    if (!treeTemplates || treeTemplates.length === 0) return;
    for (let z = -320; z < CONFIG.raceDistance + 320; z += 12) {
        if (Math.random() > 0.12) {
            const template = treeTemplates[Math.floor(Math.random() * treeTemplates.length)];
            const tree = template.clone();
            const scale = 3.2 + Math.random() * 2.2;
            const x = -44 - Math.random() * 110;
            tree.position.set(x, 0, z + (Math.random() - 0.5) * 8);
            tree.rotation.y = Math.random() * Math.PI * 2;
            tree.scale.set(scale, scale * (0.9 + Math.random() * 0.3), scale);
            forestGroup.add(tree);
        }
        if (Math.random() > 0.12) {
            const template = treeTemplates[Math.floor(Math.random() * treeTemplates.length)];
            const tree = template.clone();
            const scale = 3.2 + Math.random() * 2.2;
            const x = 44 + Math.random() * 110;
            tree.position.set(x, 0, z + (Math.random() - 0.5) * 8);
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

    for (let z = -120; z < CONFIG.raceDistance + 120; z += 16) {
        if (Math.random() > 0.28) {
            const clone = graveRoot.clone(true);
            const scale = 1.0 + Math.random() * 0.5;
            const x = -39 - Math.random() * 18;
            clone.position.set(x, -graveMinY * scale, z + (Math.random() - 0.5) * 7);
            clone.rotation.set((Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.2);
            clone.scale.setScalar(scale);
            gravesGroup.add(clone);
        }
        if (Math.random() > 0.28) {
            const clone = graveRoot.clone(true);
            const scale = 1.0 + Math.random() * 0.5;
            const x = 39 + Math.random() * 18;
            clone.position.set(x, -graveMinY * scale, z + (Math.random() - 0.5) * 7);
            clone.rotation.set((Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.2);
            clone.scale.setScalar(scale);
            gravesGroup.add(clone);
        }
    }
}

// 6. Track Sidings (Preserving all sponsor images)
function createTrackSiding(imagePath, x, z, side) {
    const group = new THREE.Group();
    const length = 55, height = 10, depth = 2;
    const baseGeo = new THREE.BoxGeometry(depth, height, length);
    const baseMat = new THREE.MeshStandardMaterial({
        map: stoneTex,
        roughness: 0.88,
        color: 0x605673
    });

    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = height / 2 - 1;
    base.castShadow = true;
    group.add(base);

    const tex = textureLoader.load(imagePath);
    const faceGeo = new THREE.PlaneGeometry(length - 2, height - 2);
    const faceMat = new THREE.MeshBasicMaterial({ map: tex });
    const face = new THREE.Mesh(faceGeo, faceMat);

    const xOffset = (side === -1) ? (depth / 2 + 0.1) : -(depth / 2 + 0.1);
    const yRot = (side === -1) ? Math.PI / 2 : -Math.PI / 2;
    face.position.set(xOffset, height / 2 - 1, 0);
    face.rotation.y = yRot;
    group.add(face);
    group.position.set(x, 1.2, z);
    return group;
}

const adImages = [
    "images/sidings/1.jpg", "images/sidings/2.jpg", "images/sidings/3.jpg",
    "images/sidings/4.jpg", "images/sidings/5.jpg", "images/sidings/6.jpg",
    "images/sidings/7.jpg", "images/sidings/8.jpg", "images/sidings/9.jpg",
    "images/sidings/10.jpg"
];
const sidingInterval = 60;

for (let z = 0; z <= CONFIG.raceDistance; z += sidingInterval) {
    const img1 = adImages[Math.floor(Math.random() * adImages.length)];
    landscapeGroup.add(createTrackSiding(img1, -85, z, -1));
    const img2 = adImages[Math.floor(Math.random() * adImages.length)];
    landscapeGroup.add(createTrackSiding(img2, 85, z, 1));
}

// 7. Roadside Jack-o'-Lanterns
const pumpkinOuterMat = new THREE.MeshStandardMaterial({
    color: 0xff6d00,
    roughness: 0.45,
    emissive: 0x3b1200,
    emissiveIntensity: 0.35
});
const pumpkinGlowMat = new THREE.MeshStandardMaterial({
    color: 0xfff176,
    emissive: 0xff8000,
    emissiveIntensity: 0.85
});

function buildRoadsidePumpkins() {
    const positions = [];
    for (let z = 0; z <= CONFIG.raceDistance; z += 36) {
        positions.push({ x: -35.8, z: z, rot: 0.4 });
        positions.push({ x: 35.8, z: z, rot: -0.4 });
    }
    const bodyGeo = new THREE.SphereGeometry(1.65, 14, 12);
    bodyGeo.scale(1.15, 0.88, 1.15);
    const coreGeo = new THREE.SphereGeometry(1.32, 10, 10);

    const bodyInst = new THREE.InstancedMesh(bodyGeo, pumpkinOuterMat, positions.length);
    const glowInst = new THREE.InstancedMesh(coreGeo, pumpkinGlowMat, positions.length);

    const dummy = new THREE.Object3D();
    positions.forEach((p, idx) => {
        dummy.position.set(p.x, 1.25, p.z);
        dummy.rotation.set(0, p.rot, 0);
        dummy.updateMatrix();
        bodyInst.setMatrixAt(idx, dummy.matrix);

        dummy.position.set(p.x + (p.x < 0 ? 0.38 : -0.38), 1.30, p.z + 0.18);
        dummy.updateMatrix();
        glowInst.setMatrixAt(idx, dummy.matrix);
    });
    scene.add(bodyInst, glowInst);
}
buildRoadsidePumpkins();

// 8. Start & Finish Line Gothic Archway
const finishGroup = new THREE.Group();
const checkCanvas = document.createElement('canvas');
checkCanvas.width = 576;
checkCanvas.height = 64;
const checkCtx = checkCanvas.getContext('2d');
checkCtx.fillStyle = '#180d28';
checkCtx.fillRect(0, 0, 576, 64);
checkCtx.fillStyle = '#ff8000';
for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 18; x++) {
        if ((x + y) % 2 === 0) checkCtx.fillRect(x * 32, y * 32, 32, 32);
    }
}
const checkTex = new THREE.CanvasTexture(checkCanvas);
checkTex.magFilter = THREE.NearestFilter;

const fBanner = new THREE.Mesh(
    new THREE.BoxGeometry(74, 7, 2),
    new THREE.MeshStandardMaterial({ map: checkTex, roughness: 0.6, emissive: 0x1c0b00 })
);
fBanner.position.set(0, 21, CONFIG.raceDistance);
fBanner.castShadow = true;

const pillarMat = new THREE.MeshStandardMaterial({ map: stoneTex, color: 0x524666, roughness: 0.85 });
const p1 = new THREE.Mesh(new THREE.BoxGeometry(3.5, 25, 3.5), pillarMat);
p1.position.set(-36, 12.5, CONFIG.raceDistance);
p1.castShadow = true;
const p2 = p1.clone();
p2.position.set(36, 12.5, CONFIG.raceDistance);

finishGroup.add(p1, p2, fBanner);
scene.add(finishGroup);

// Road Start & Finish Paint Strips
const lineStripGeo = new THREE.PlaneGeometry(CONFIG.roadWidth, 3.5);
const startLineMat = new THREE.MeshBasicMaterial({ map: checkTex, transparent: true, opacity: 0.90 });
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
mistGrad.addColorStop(0, 'rgba(185, 165, 225, 0.52)');
mistGrad.addColorStop(0.5, 'rgba(110, 245, 85, 0.22)');
mistGrad.addColorStop(1, 'rgba(60, 20, 90, 0)');
mistCtx.fillStyle = mistGrad;
mistCtx.fillRect(0, 0, 64, 64);
const mistTex = new THREE.CanvasTexture(mistCanvas);

const MIST_POOL_SIZE = 100;
const mistGeo = new THREE.PlaneGeometry(3.2, 3.2);
const mistPool = [];
let mistPoolIndex = 0;

for (let i = 0; i < MIST_POOL_SIZE; i++) {
    const mat = new THREE.MeshBasicMaterial({
        map: mistTex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });
    const mesh = new THREE.Mesh(mistGeo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.visible = false;
    mistGroup.add(mesh);
    mistPool.push({ mesh, active: false, age: 0, baseScale: 1 });
}

function spawnFootstepMist(x, z, scale) {
    const item = mistPool[mistPoolIndex];
    mistPoolIndex = (mistPoolIndex + 1) % MIST_POOL_SIZE;
    item.active = true;
    item.age = 0;
    item.baseScale = scale;
    item.mesh.position.set(x, 0.12, z);
    item.mesh.scale.set(scale, scale, 1);
    item.mesh.material.opacity = 0.58;
    item.mesh.visible = true;
}

function updateFootstepMist(delta) {
    for (let i = 0; i < MIST_POOL_SIZE; i++) {
        const item = mistPool[i];
        if (!item.active) continue;
        item.age += delta;
        if (item.age >= 0.85) {
            item.active = false;
            item.mesh.visible = false;
        } else {
            const s = item.baseScale + item.age * 2.8;
            item.mesh.scale.set(s, s, 1);
            item.mesh.material.opacity = 0.58 * (1 - item.age / 0.85);
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
    ready: false,

    preloadAll() {
        const startBtn = document.getElementById('start-btn');
        const loadingMsg = document.createElement('div');
        loadingMsg.id = 'loading-msg';
        loadingMsg.textContent = 'Loading arcade assets… 0/10';
        loadingMsg.style.cssText = 'margin-top:10px;font-size:0.85rem;color:#aaa;letter-spacing:1px;';

        const btnParent = startBtn?.parentNode;
        if (btnParent) btnParent.insertBefore(loadingMsg, startBtn);
        if (startBtn) { startBtn.disabled = true; startBtn.style.cursor = 'not-allowed'; }

        let loadedCount = 0;
        const totalItems = 10;

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

                            // Extract individual tree mesh, center X/Z and ground min Y at 0
                            const cloneMesh = child.clone();
                            const geo = cloneMesh.geometry.clone();
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

        return Promise.all([...racerPromises, treePromise, gravePromise]).then(() => {
            this.ready = true;
            if (loadingMsg) loadingMsg.remove();
            const failedNames = MONSTER_MANIFEST.filter(e => this._failed[e.id]).map(e => e.name);
            if (failedNames.length > 0) {
                const errEl = document.createElement('div');
                errEl.style.cssText = 'margin-top:8px;font-size:0.8rem;color:#ff6d00;';
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
    initDucks();
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
        this.wheelRadius = 0.65;
        this.finished = false;
        this.finishTime = 0;
        this.aggressiveness = 0.45 + Math.random() * 0.55;
        this.energyCycle = Math.random() * 10;
        this.stepTimer = 0;
        this.usingGLB = false;

        // Arcade kart dynamics state
        this.currentTilt = 0;
        this.currentHeading = 0;
        this.targetX = startX;
        this.laneTimer = 1.0 + Math.random() * 2.0;
        this.baseKartY = 0;

        // Main tilt group for chassis bank/bounce
        this.kartTiltGroup = new THREE.Group();
        this.mesh.add(this.kartTiltGroup);

        // Load solid clay character asset
        const glbResult = MonsterModelManager.cloneFor(id);
        if (glbResult) {
            this.usingGLB = true;
            this.kartTiltGroup.add(glbResult.group);
            this.characterModel = glbResult.group;
        } else {
            this.buildProceduralKartModel();
        }

        // Build stylized claymation kart wheels
        this.buildKartWheels();

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

    buildKartWheels() {
        this.wheels = [];
        this.frontSteerGroups = [];

        const wheelRadius = this.wheelRadius;
        const wheelWidth = 0.42;
        const halfTrack = 1.48;
        const wheelbaseFront = 1.35;
        const wheelbaseRear = -1.35;

        // Clay tire material
        const tireMat = new THREE.MeshStandardMaterial({
            color: 0x1e1924,
            roughness: 0.72,
            metalness: 0.04
        });
        // Clay rim material matching signature monster color
        const rimMat = new THREE.MeshStandardMaterial({
            color: this.color,
            roughness: 0.48,
            metalness: 0.08
        });
        // Hub nut & spokes
        const nutMat = new THREE.MeshStandardMaterial({
            color: 0xe0d6b8,
            roughness: 0.40,
            metalness: 0.15
        });

        const tireGeo = new THREE.CylinderGeometry(wheelRadius, wheelRadius, wheelWidth, 18);
        tireGeo.rotateZ(Math.PI / 2);
        const rimGeo = new THREE.CylinderGeometry(wheelRadius * 0.62, wheelRadius * 0.62, wheelWidth + 0.04, 18);
        rimGeo.rotateZ(Math.PI / 2);
        const nutGeo = new THREE.CylinderGeometry(wheelRadius * 0.22, wheelRadius * 0.22, wheelWidth + 0.08, 6);
        nutGeo.rotateZ(Math.PI / 2);

        const makeWheelMesh = () => {
            const wheelObj = new THREE.Group();
            const tire = new THREE.Mesh(tireGeo, tireMat);
            tire.castShadow = true;
            tire.receiveShadow = true;
            const rim = new THREE.Mesh(rimGeo, rimMat);
            rim.castShadow = true;
            const nut = new THREE.Mesh(nutGeo, nutMat);
            wheelObj.add(tire, rim, nut);

            // Cross spokes on rim face so spin momentum is visually distinct
            const spokeGeo = new THREE.BoxGeometry(wheelWidth + 0.06, wheelRadius * 0.42, 0.12);
            const spoke1 = new THREE.Mesh(spokeGeo, nutMat);
            const spoke2 = new THREE.Mesh(spokeGeo, nutMat);
            spoke2.rotation.x = Math.PI / 2;
            wheelObj.add(spoke1, spoke2);

            return wheelObj;
        };

        // Front Left (with steering pivot)
        this.steerGroupFL = new THREE.Group();
        this.steerGroupFL.position.set(-halfTrack, wheelRadius, wheelbaseFront);
        this.wheelFL = makeWheelMesh();
        this.steerGroupFL.add(this.wheelFL);
        this.kartTiltGroup.add(this.steerGroupFL);

        // Front Right (with steering pivot)
        this.steerGroupFR = new THREE.Group();
        this.steerGroupFR.position.set(halfTrack, wheelRadius, wheelbaseFront);
        this.wheelFR = makeWheelMesh();
        this.steerGroupFR.add(this.wheelFR);
        this.kartTiltGroup.add(this.steerGroupFR);

        // Rear Left
        this.steerGroupRL = new THREE.Group();
        this.steerGroupRL.position.set(-halfTrack, wheelRadius, wheelbaseRear);
        this.wheelRL = makeWheelMesh();
        this.steerGroupRL.add(this.wheelRL);
        this.kartTiltGroup.add(this.steerGroupRL);

        // Rear Right
        this.steerGroupRR = new THREE.Group();
        this.steerGroupRR.position.set(halfTrack, wheelRadius, wheelbaseRear);
        this.wheelRR = makeWheelMesh();
        this.steerGroupRR.add(this.wheelRR);
        this.kartTiltGroup.add(this.steerGroupRR);

        this.wheels = [this.wheelFL, this.wheelFR, this.wheelRL, this.wheelRR];
        this.frontSteerGroups = [this.steerGroupFL, this.steerGroupFR];
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

        const bodyGeo = new THREE.BoxGeometry(2.4, 1.2, 3.8);
        const bodyMesh = new THREE.Mesh(bodyGeo, kartBodyMat);
        bodyMesh.position.y = 1.0;
        bodyMesh.castShadow = true;

        const noseGeo = new THREE.ConeGeometry(1.2, 1.4, 4);
        noseGeo.rotateX(Math.PI / 2);
        const noseMesh = new THREE.Mesh(noseGeo, kartBodyMat);
        noseMesh.position.set(0, 0.8, 2.3);
        noseMesh.castShadow = true;

        const driverGeo = new THREE.SphereGeometry(0.85, 14, 12);
        const driverMesh = new THREE.Mesh(driverGeo, darkMat);
        driverMesh.position.set(0, 2.0, -0.3);
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

        this.mesh.position.set(this.startX, 0, 0);
        this.mesh.rotation.set(0, 0, 0);
        this.kartTiltGroup.position.set(0, this.baseKartY, 0);
        this.kartTiltGroup.rotation.set(0, 0, 0);

        if (this.steerGroupFL) this.steerGroupFL.rotation.y = 0;
        if (this.steerGroupFR) this.steerGroupFR.rotation.y = 0;
    }

    addNameLabel() {
        const w = 160, h = 128;
        const cvs = document.createElement('canvas');
        cvs.width = w;
        cvs.height = h;
        const ctx = cvs.getContext('2d');
        const mainColor = '#' + this.color.toString(16).padStart(6, '0');

        ctx.beginPath();
        ctx.moveTo(30, 0); ctx.lineTo(w, 0); ctx.lineTo(w - 30, h); ctx.lineTo(0, h);
        ctx.fillStyle = "rgba(18, 10, 32, 0.92)";
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(30, 0); ctx.lineTo(62, 0); ctx.lineTo(32, h); ctx.lineTo(0, h);
        ctx.fillStyle = mainColor;
        ctx.fill();

        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.shadowColor = "rgba(0,0,0,0.9)";
        ctx.shadowBlur = 4;
        ctx.font = "bold 82px 'Rajdhani'";
        ctx.fillText(`${this.id + 1}`, 96, h / 2 + 2);

        const sprite = new THREE.Sprite(
            new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cvs), depthWrite: false, depthTest: true })
        );
        sprite.position.set(0, 6.2, 0);
        sprite.scale.set(3.4, 2.7, 1);
        sprite.frustumCulled = false;
        sprite.renderOrder = 100;
        this.mesh.add(sprite);
    }

    /**
     * Continuous wheel rotation proportional to forward momentum
     */
    updateWheels(delta) {
        const speed = Math.max(0, this.currentSpeed || 0);
        const rotDelta = (speed / this.wheelRadius) * delta;
        if (this.wheels) {
            for (let i = 0; i < this.wheels.length; i++) {
                this.wheels[i].rotation.x += rotDelta;
            }
        }
    }

    /**
     * Restrained starting line stance: karts planted at Z=0, zero wheel spin, gentle engine throb.
     */
    updateReadyPose(time) {
        this.position.set(this.startX, 0, 0);
        this.mesh.position.set(this.startX, 0, 0);
        this.mesh.position.y = 0;
        this.mesh.rotation.set(0, 0, 0);
        this.currentSpeed = 0;

        if (this.steerGroupFL) this.steerGroupFL.rotation.y = 0;
        if (this.steerGroupFR) this.steerGroupFR.rotation.y = 0;
        this.currentTilt = 0;
        this.currentHeading = 0;

        // Subtle idle engine throb / chassis vibration on the line
        const idleThrob = Math.sin(time * 18 + this.id * 2.2) * 0.025;
        this.kartTiltGroup.position.y = this.baseKartY + idleThrob;
        this.kartTiltGroup.rotation.set(0, 0, Math.sin(time * 14 + this.id) * 0.008);
    }

    /**
     * Arcade kart locomotion & physics: steering turns, roll tilt, track bounce, wheel rotation.
     */
    updateRacingMovement(delta, time) {
        const energy = Math.sin(time * 0.5 + this.energyCycle);
        let targetSpeed = this.baseSpeed;
        if (energy > 0.4) targetSpeed *= 1.15 + (this.aggressiveness * 0.2);
        else if (energy < -0.4) targetSpeed *= 0.88;
        targetSpeed += (Math.random() - 0.5) * 1.8;

        const distRemaining = CONFIG.raceDistance - this.position.z;
        if (distRemaining < 120 && distRemaining > 0) targetSpeed *= 1.12;

        this.currentSpeed = targetSpeed;
        this.position.z += targetSpeed * delta;

        // Tactical arcade lane changing
        this.laneTimer -= delta;
        if (this.laneTimer <= 0) {
            this.laneTimer = 1.4 + Math.random() * 2.2;
            const laneWander = (Math.random() - 0.5) * 14;
            this.targetX = THREE.MathUtils.clamp(this.startX + laneWander, -26, 26);
        }

        const dx = this.targetX - this.position.x;
        const lateralSpeed = THREE.MathUtils.clamp(dx * 2.4, -9.5, 9.5);
        this.position.x += lateralSpeed * delta;
        this.position.x = THREE.MathUtils.clamp(this.position.x, -28, 28);

        this.mesh.position.x = this.position.x;
        this.mesh.position.z = this.position.z;

        // Arcade kart dynamics:
        // 1. Front wheels steer smoothly into steering turns
        const steerAngle = THREE.MathUtils.clamp(lateralSpeed * 0.045, -0.38, 0.38);
        if (this.steerGroupFL) this.steerGroupFL.rotation.y = steerAngle;
        if (this.steerGroupFR) this.steerGroupFR.rotation.y = steerAngle;

        // 2. Karts tilt smoothly into steering turns (roll/bank)
        const targetTilt = -lateralSpeed * 0.038;
        this.currentTilt = THREE.MathUtils.lerp(this.currentTilt, targetTilt, 9 * delta);
        this.kartTiltGroup.rotation.z = this.currentTilt;

        // 3. Subtle heading yaw
        const targetHeading = Math.atan2(lateralSpeed, targetSpeed);
        this.currentHeading = THREE.MathUtils.lerp(this.currentHeading, targetHeading, 7 * delta);
        this.kartTiltGroup.rotation.y = this.currentHeading;

        // 4. Bouncing slightly over the track (tactile clay road rumble)
        const bounceRate = 18.0 + (this.currentSpeed / this.baseSpeed) * 8.0;
        const bounceAmt = (this.currentSpeed / this.baseSpeed) * 0.08;
        const bounceY = Math.abs(Math.sin(time * bounceRate + this.id * 1.8)) * bounceAmt;
        this.kartTiltGroup.position.y = this.baseKartY + bounceY;

        // 5. Slight acceleration pitch
        const pitch = Math.sin(time * (bounceRate * 0.5) + this.id) * 0.022;
        this.kartTiltGroup.rotation.x = pitch;

        // 6. Dust mist particles behind wheels
        this.stepTimer += delta;
        if (this.stepTimer > 0.14) {
            spawnFootstepMist(this.position.x - 1.2, this.position.z - 2.0, 0.55 + Math.random() * 0.35);
            spawnFootstepMist(this.position.x + 1.2, this.position.z - 2.0, 0.55 + Math.random() * 0.35);
            this.stepTimer = 0;
        }
    }

    updateCelebrationPose(time) {
        this.mesh.position.x = this.position.x;
        this.mesh.position.z = this.position.z;
        this.currentSpeed = 0;

        const isWinner = (ducks[0] === this);
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
        if (raceState === RACE_STATE.READY || raceState === RACE_STATE.COUNTDOWN) {
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
 * Helper loop that checks the speed of each racer and rotates their wheels
 * continuously to match forward momentum.
 */
function updateAllRacerWheels(delta) {
    if (!ducks) return;
    for (let i = 0; i < ducks.length; i++) {
        ducks[i].updateWheels(delta);
    }
}

/**
 * GAME STATE & DOM CACHING
 */
let ducks = [];
let lbRowsCache = [];

function initDucks() {
    ducks.forEach(d => { scene.remove(d.mesh); d.dispose(); });
    ducks = [];
    resetFootstepMist();

    const raceConfig = storedRaces[currentRaceIndex] || (typeof DEFAULT_RACES !== 'undefined' ? DEFAULT_RACES[0] : null);
    if (!raceConfig) return;

    const names = raceConfig.ducks || [];
    const headerTitle = document.getElementById('header-race-name');
    if (headerTitle) headerTitle.innerText = raceConfig.name.toUpperCase();

    // Evenly spaced, straight starting line across the road width
    const spacing = 7.4;
    const leftBound = -((CONFIG.duckCount - 1) * spacing) / 2;

    for (let i = 0; i < CONFIG.duckCount; i++) {
        const x = leftBound + (i * spacing);
        const name = names[i % names.length] || `Zoombie ${i + 1}`;
        ducks.push(new Zoombie(i, name, x));
    }

    initLeaderboardDOM();
}

function resetRacersToStartGrid() {
    if (ducks.length !== CONFIG.duckCount) {
        initDucks();
        return;
    }
    const spacing = 7.4;
    const leftBound = -((CONFIG.duckCount - 1) * spacing) / 2;
    ducks.sort((a, b) => a.id - b.id);
    for (let i = 0; i < ducks.length; i++) {
        ducks[i].startX = leftBound + (i * spacing);
        ducks[i].resetToStartLine();
    }
    resetFootstepMist();
}

function initLeaderboardDOM() {
    const lbContent = document.getElementById('lb-content');
    if (!lbContent) return;
    lbContent.innerHTML = '';
    lbRowsCache = [];

    for (let i = 0; i < CONFIG.duckCount; i++) {
        const row = document.createElement('div');
        row.className = i === 0 ? 'lb-row leader' : 'lb-row';

        const rank = document.createElement('div');
        rank.className = 'lb-rank';

        const info = document.createElement('div');
        info.className = 'lb-info-container';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'lb-name';

        const distSpan = document.createElement('span');
        distSpan.className = 'lb-dist';

        info.appendChild(nameSpan);
        info.appendChild(distSpan);
        row.appendChild(rank);
        row.appendChild(info);
        lbContent.appendChild(row);

        lbRowsCache.push({ row, rank, nameSpan, distSpan });
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
let winnerColor = '#ff6d00';

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
        const speed = Math.random() * 6;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;
        this.alpha = 1;
        this.decay = 0.012 + Math.random() * 0.02;
    }
    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.vy += 0.1;
        this.alpha -= this.decay;
    }
    draw() {
        fxCtx.save();
        fxCtx.globalAlpha = this.alpha;
        fxCtx.beginPath();
        fxCtx.arc(this.x, this.y, 2.2, 0, Math.PI * 2);
        fxCtx.fillStyle = this.color;
        fxCtx.fill();
        fxCtx.restore();
    }
}

function explode(x, y, color) {
    for (let i = 0; i < 65; i++) particles.push(new Particle(x, y, color));
    for (let i = 0; i < 20; i++) particles.push(new Particle(x, y, '#76ff03'));
}

function updateFireworks() {
    if (!fxCtx) return;
    fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);

    if (doFireworks && Math.random() < 0.25) {
        fireworks.push(new Firework(100 + Math.random() * (fxCanvas.height / 2), winnerColor));
    }

    for (let i = fireworks.length - 1; i >= 0; i--) {
        fireworks[i].update();
        fireworks[i].draw();
        if (fireworks[i].dead) fireworks.splice(i, 1);
    }

    for (let i = particles.length - 1; i >= 0; i--) {
        particles[i].update();
        particles[i].draw();
        if (particles[i].alpha <= 0) particles.splice(i, 1);
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
    if (fxCtx) fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
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
const duckPreview = document.getElementById('duck-preview');

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

function updateDuckPreview() {
    const raceConfig = storedRaces[currentRaceIndex] || (typeof DEFAULT_RACES !== 'undefined' ? DEFAULT_RACES[0] : null);
    if (!raceConfig) return;

    const names = raceConfig.ducks || [];
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
    duckPreview.innerHTML = html;
}

raceSelect.addEventListener('change', (e) => {
    currentRaceIndex = parseInt(e.target.value, 10);
    setRaceState(RACE_STATE.READY);
    firstFinishTriggered = false;
    progressFill.style.width = "0%";
    if (speedEl) speedEl.innerText = "0";
    updateDuckPreview();
    initDucks();
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
    const newRace = { id: "custom_" + Date.now(), name: rName, ducks: dNames };
    storedRaces.push(newRace);
    saveRaceData();
    currentRaceIndex = storedRaces.length - 1;
    setRaceState(RACE_STATE.READY);
    populateRaceSelector();
    updateDuckPreview();
    initDucks();
    configModal.classList.add('hidden');
});

resetDataBtn.addEventListener('click', () => {
    resetData();
    configModal.classList.add('hidden');
});

document.getElementById('start-btn').addEventListener('click', () => {
    startScreen.classList.add('hidden');

    // Reset all racers cleanly onto the starting line in READY/COUNTDOWN stance
    resetRacersToStartGrid();
    firstFinishTriggered = false;
    setRaceState(RACE_STATE.COUNTDOWN);

    camera.position.set(0, 12, 34);
    cameraLookAt.set(0, 3.8, 0);
    camera.lookAt(cameraLookAt);

    raceAudio.init();

    if (fadeInterval) clearInterval(fadeInterval);
    sfxRiver.currentTime = 0;
    sfxRiver.volume = 0.5;
    sfxRiver.play().catch(e => console.warn("Ambience sound failed:", e));

    runCountdownSequence();
});

function runCountdownSequence() {
    if (countdownTimerId) {
        clearInterval(countdownTimerId);
        countdownTimerId = null;
    }

    const cd = document.getElementById('countdown-overlay');
    cd.innerHTML = '';
    cd.style.display = 'flex';

    let count = 3;

    const showNum = (num, color) => {
        cd.innerHTML = `<div style="
            background: #220e38;
            padding: 20px 60px;
            transform: skewX(-15deg);
            border-left: 8px solid #ff6d00;
            display: inline-block;
            box-shadow: 0 5px 30px rgba(0,0,0,0.85), 0 0 20px rgba(255, 109, 0, 0.4);
        ">
            <span style="
                font-family: 'Creepster', 'Rajdhani', sans-serif;
                font-size: 200px;
                color: ${color};
                display: block;
                transform: skewX(15deg);
                text-shadow: 0 0 20px #ff6d00;
            ">${num}</span>
        </div>`;
    };

    // Immediately show '3' so the 3-2-1 sequence is crisp and responsive
    showNum(count, '#ffab40');
    raceAudio.playCountdown(count);
    count--;

    countdownTimerId = setInterval(() => {
        if (count > 0) {
            showNum(count, '#ffab40');
            raceAudio.playCountdown(count);
            count--;
        } else {
            clearInterval(countdownTimerId);
            countdownTimerId = null;
            cd.innerHTML = "";
            cd.style.display = 'none';

            sfxStart.currentTime = 0;
            sfxStart.play().catch(e => console.warn(e));

            // Only now does the race state switch to RACING
            setRaceState(RACE_STATE.RACING);
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
    sfxRiver.pause(); sfxRiver.currentTime = 0; sfxRiver.volume = 0.5;
    sfxWinner.pause(); sfxWinner.currentTime = 0;

    stopFireworks();

    currentRaceIndex = (currentRaceIndex + 1) % storedRaces.length;
    populateRaceSelector();
    updateDuckPreview();

    setRaceState(RACE_STATE.READY);
    firstFinishTriggered = false;

    progressFill.style.width = "0%";
    if (speedEl) speedEl.innerText = "0";
    initDucks();
    camera.position.set(0, 12, 34);
    cameraLookAt.set(0, 3.8, 0);
    camera.lookAt(cameraLookAt);
});

loadRaceData();
loadAboutInfo();

/**
 * CAMERA SYSTEM & DYNAMIC LIGHT/SHADOW TRACKING
 */
const clock = new THREE.Clock();
let camAngle = 0, camTimer = 0;
let cameraLookAt = new THREE.Vector3(0, 3.8, 0);
let cinematicTarget = new THREE.Vector3();
let cinematicLook = new THREE.Vector3();

const LB_SCREEN_FRACTION = 0.33;
const DUCK_PADDING = 5.5;
const MIN_CAM_DIST_Z = 21;
const MAX_CAM_DIST_Z = 38;

function getDuckBounds() {
    let minX = Infinity, maxX = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    for (const d of ducks) {
        if (d.position.x < minX) minX = d.position.x;
        if (d.position.x > maxX) maxX = d.position.x;
        if (d.position.z < minZ) minZ = d.position.z;
        if (d.position.z > maxZ) maxZ = d.position.z;
    }

    return {
        centerX: (minX + maxX) / 2,
        centerZ: (minZ + maxZ) / 2,
        spreadX: (maxX - minX) + DUCK_PADDING * 2,
        spreadZ: (maxZ - minZ) + DUCK_PADDING * 2,
        minX, maxX, minZ, maxZ
    };
}

function calcDistanceForWidth(worldWidth, screenFraction) {
    const fovRad = THREE.MathUtils.degToRad(camera.fov);
    const d = worldWidth / (screenFraction * 2 * Math.tan(fovRad / 2) * camera.aspect);
    return Math.max(MIN_CAM_DIST_Z, Math.min(MAX_CAM_DIST_Z, d));
}

function applyViewOffset() {
    const fullW = window.innerWidth;
    const fullH = window.innerHeight;
    const shiftPixels = -fullW * (LB_SCREEN_FRACTION / 2);
    camera.setViewOffset(fullW, fullH, shiftPixels, 0, fullW, fullH);
}

function updateCamera(time, delta, leadDuck) {
    if (time > camTimer + 10) { camTimer = time; camAngle = (camAngle + 1) % 3; }
    const target = cinematicTarget, look = cinematicLook;

    applyViewOffset();

    const bounds = getDuckBounds();
    const availableFraction = 1.0 - LB_SCREEN_FRACTION;

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
        const winner = ducks[0];
        const t = time - winnerFinishTime;

        const dist = 15 + (t * 2.5);
        const height = 6.5 + (t * 1.6);
        const angle = -0.25 + (t * 0.18);

        target.set(
            winner.position.x + Math.sin(angle) * dist,
            height,
            winner.position.z + Math.cos(angle) * dist
        );
        look.copy(winner.position).add(new THREE.Vector3(0, 3.8, 0));

    } else if (raceState === RACE_STATE.READY || raceState === RACE_STATE.COUNTDOWN) {
        // Front-facing starting grid showcase camera
        const fitDist = calcDistanceForWidth(bounds.spreadX, availableFraction);
        target.set(bounds.centerX, Math.max(9.5, fitDist * 0.34), bounds.centerZ + fitDist * 0.92);
        look.set(bounds.centerX, 3.8, bounds.centerZ);

    } else {
        const distRemaining = CONFIG.raceDistance - leadDuck.position.z;
        const fitDist = calcDistanceForWidth(bounds.spreadX, availableFraction);

        if (distRemaining <= 100) {
            target.set(bounds.centerX, 9.5, leadDuck.position.z - fitDist * 0.65);
            look.set(bounds.centerX, 3.6, leadDuck.position.z + 18);
        } else {
            if (camAngle === 0) {
                const camHeight = Math.max(7.5, fitDist * 0.28);
                target.set(bounds.centerX, camHeight, leadDuck.position.z + fitDist * 0.88);
                look.set(bounds.centerX, 3.6, leadDuck.position.z);
            } else if (camAngle === 1) {
                const camHeight = Math.max(10.5, fitDist * 0.42);
                target.set(bounds.centerX, camHeight, bounds.centerZ + fitDist * 0.98);
                look.set(bounds.centerX, 3.4, bounds.centerZ);
            } else {
                const camHeight = Math.max(7.5, fitDist * 0.28);
                target.set(bounds.minX - fitDist * 0.36, camHeight, leadDuck.position.z + fitDist * 0.58);
                look.set(bounds.centerX + 4, 3.6, leadDuck.position.z);
            }
        }
    }

    camera.position.lerp(target, 3.8 * delta);
    cameraLookAt.lerp(look, 3.8 * delta);
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

function updateUI(leadDuck, sortedDucks, time) {
    if (raceState === RACE_STATE.RACING && speedEl) {
        speedEl.innerText = Math.round(leadDuck.currentSpeed * 3.6);
    } else if (raceState === RACE_STATE.READY || raceState === RACE_STATE.COUNTDOWN) {
        if (speedEl) speedEl.innerText = "0";
    }

    for (let i = 0; i < sortedDucks.length; i++) {
        const d = sortedDucks[i];
        const cache = lbRowsCache[i];
        if (!cache) continue;

        const hexColor = '#' + d.color.toString(16).padStart(6, '0');
        const r = (d.color >> 16) & 255, g = (d.color >> 8) & 255, b = d.color & 255;
        const txtCol = (((r * 299) + (g * 587) + (b * 114)) / 1000) >= 128 ? '#000' : '#fff';

        cache.rank.style.background = hexColor;
        cache.rank.style.color = txtCol;
        cache.rank.textContent = d.id + 1;

        cache.nameSpan.style.color = lightenColor(d.color, 0.4);
        cache.nameSpan.textContent = d.name;

        if (d.finished) {
            cache.distSpan.innerHTML = `<span style="color:#ff6d00">FINISHED</span>`;
        } else if (raceState === RACE_STATE.READY || raceState === RACE_STATE.COUNTDOWN) {
            cache.distSpan.textContent = 'READY';
        } else {
            cache.distSpan.textContent = (i === 0) ? 'LEADER' : `+${Math.floor(leadDuck.position.z - d.position.z)}m`;
        }
    }

    progressFill.style.width = Math.min((leadDuck.position.z / CONFIG.raceDistance) * 100, 100) + '%';
}

function animate() {
    requestAnimationFrame(animate);
    const deltaReal = Math.min(clock.getDelta(), 0.1);
    const delta = deltaReal * gameSpeed;
    const time = clock.getElapsedTime();

    // Flickering candle effect for roadside Jack-o'-Lanterns
    const flicker = 0.72 + Math.sin(time * 14) * 0.16 + Math.cos(time * 23) * 0.12;
    pumpkinGlowMat.emissiveIntensity = flicker;

    if (raceState === RACE_STATE.RACING) updateFootstepMist(delta);
    updateFireworks();

    // Update all racers according to the active raceState
    ducks.forEach(d => {
        d.update(delta, time);
        if (raceState === RACE_STATE.RACING && !d.finished && d.position.z >= CONFIG.raceDistance) {
            d.finished = true;
            d.finishTime = time;
        }
    });

    // Helper loop that checks the speed of each racer and rotates their wheels continuously to match forward momentum
    updateAllRacerWheels(delta);

    if (raceState === RACE_STATE.RACING) {
        // Kart collision avoidance and overtaking room
        const minSep = 5.2;
        const minSepSq = minSep * minSep;
        for (let i = 0; i < ducks.length; i++) {
            for (let j = i + 1; j < ducks.length; j++) {
                const d1 = ducks[i], d2 = ducks[j];
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
                }
            }
        }

        ducks.sort((a, b) => (a.finished && b.finished)
            ? a.finishTime - b.finishTime
            : (a.finished ? -1 : (b.finished ? 1 : b.position.z - a.position.z))
        );

        const leadDuck = ducks[0];

        if (!firstFinishTriggered && ducks.some(d => d.finished)) {
            firstFinishTriggered = true;
            winnerFinishTime = time;

            sfxWinner.currentTime = 0;
            sfxWinner.play().catch(e => console.warn(e));

            startFireworks(leadDuck.color);
        }

        if (ducks.every(d => d.finished) && raceState !== RACE_STATE.FINISHED) {
            setRaceState(RACE_STATE.FINISHED);
            const trueWinner = ducks.reduce((prev, curr) => (prev.finishTime < curr.finishTime) ? prev : curr);

            winnerText.innerText = `WINNER: #${trueWinner.id + 1} ${trueWinner.name.toUpperCase()}!`;
            winnerText.style.color = lightenColor(trueWinner.color, 0.4);
            setTimeout(() => { endScreen.classList.remove('hidden'); }, 2000);

            fadeOutAudio(sfxRiver, 4000);
        }
    }

    const leadDuck = ducks[0];
    if (leadDuck) {
        updateCamera(time, deltaReal, leadDuck);
        updateUI(leadDuck, ducks, time);
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

animate();
