/**
 * CONFIGURATION & DATA MANAGEMENT
 */
const CONFIG = {
    duckCount: 8,
    raceDistance: 800,
    targetDuration: 58,
    roadWidth: 74,
    racerScale: 1.48
};

// Explicit Race State Machine
const RACE_STATE = {
    READY: 'READY',
    COUNTDOWN: 'COUNTDOWN',
    RACING: 'RACING',
    FINISHED: 'FINISHED'
};

// Colours for the 8 lanes (matching the original monster identities)
const COLORS = [
    0xF42941, // 0: Red - Vampire
    0xE9862A, // 1: Orange - Pumpkin Fiend
    0xF0F136, // 2: Yellow - Cursed Mummy
    0x50C878, // 3: Green - Franken-Zombie
    0x0033FF, // 4: Blue - Spectral Banshee
    0x6A2FA0, // 5: Purple - Witch-Imp
    0x37474F, // 6: Grey - Werewolf
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
 * THREE.JS SCENE & MOODY TONED-DOWN LIGHTING SETUP
 */
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();

// Transparent scene background so the CSS purple/navy gradient sky shows through cleanly
scene.background = null;
scene.fog = new THREE.FogExp2(0x130b24, 0.0028);

// --- BALANCED TONE-DOWN LIGHTING ---
const ambientLight = new THREE.AmbientLight(0x281c3d, 0.35);
scene.add(ambientLight);

const hemiLight = new THREE.HemisphereLight(0x6b8ecc, 0x1a0d2e, 0.55);
scene.add(hemiLight);

const moonLight = new THREE.DirectionalLight(0xa6c4ff, 0.75);
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

const packFillLight = new THREE.DirectionalLight(0xff8c32, 0.40);
packFillLight.position.set(-18, 28, 35);
scene.add(packFillLight);
scene.add(packFillLight.target);

const packRimLight = new THREE.DirectionalLight(0x4ca6ff, 0.30);
packRimLight.position.set(0, 32, -45);
scene.add(packRimLight);
scene.add(packRimLight.target);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.10;
container.appendChild(renderer.domElement);

const textureLoader = new THREE.TextureLoader();

/**
 * PROCEDURAL TEXTURES
 */
function createRoadTexture() {
    const cvs = document.createElement('canvas');
    cvs.width = 512;
    cvs.height = 512;
    const ctx = cvs.getContext('2d');

    ctx.fillStyle = '#181522';
    ctx.fillRect(0, 0, 512, 512);

    for (let i = 0; i < 6500; i++) {
        const x = Math.random() * 512;
        const y = Math.random() * 512;
        const v = 22 + Math.floor(Math.random() * 18);
        ctx.fillStyle = `rgb(${v}, ${v - 2}, ${v + 8})`;
        ctx.fillRect(x, y, 2, 2);
    }

    const leftGrad = ctx.createLinearGradient(0, 0, 55, 0);
    leftGrad.addColorStop(0, '#172215');
    leftGrad.addColorStop(1, 'rgba(24, 21, 34, 0)');
    ctx.fillStyle = leftGrad;
    ctx.fillRect(0, 0, 55, 512);

    const rightGrad = ctx.createLinearGradient(512, 0, 457, 0);
    rightGrad.addColorStop(0, '#172215');
    rightGrad.addColorStop(1, 'rgba(24, 21, 34, 0)');
    ctx.fillStyle = rightGrad;
    ctx.fillRect(457, 0, 55, 512);

    ctx.fillStyle = 'rgba(255, 110, 0, 0.60)';
    ctx.fillRect(18, 0, 6, 512);
    ctx.fillRect(488, 0, 6, 512);

    ctx.fillStyle = 'rgba(220, 150, 60, 0.50)';
    ctx.fillRect(249, 0, 4, 512);
    ctx.fillRect(259, 0, 4, 512);

    ctx.fillStyle = 'rgba(180, 175, 205, 0.24)';
    for (let y = 0; y < 512; y += 64) {
        ctx.fillRect(134, y, 4, 34);
        ctx.fillRect(374, y, 4, 34);
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
    ctx.fillStyle = '#332d40';
    ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 800; i++) {
        ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.10)';
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

const kerbGeo = new THREE.BoxGeometry(2.5, 0.9, roadLength);
const kerbMat = new THREE.MeshStandardMaterial({ map: stoneTex, color: 0x544c63, roughness: 0.85 });

const leftKerb = new THREE.Mesh(kerbGeo, kerbMat);
leftKerb.position.set(-(CONFIG.roadWidth / 2) - 1.25, 0.45, CONFIG.raceDistance / 2);
leftKerb.receiveShadow = true;
landscapeGroup.add(leftKerb);

const rightKerb = new THREE.Mesh(kerbGeo, kerbMat);
rightKerb.position.set((CONFIG.roadWidth / 2) + 1.25, 0.45, CONFIG.raceDistance / 2);
rightKerb.receiveShadow = true;
landscapeGroup.add(rightKerb);

const vergeGeo = new THREE.BoxGeometry(340, 20, roadLength);
const vergeMat = new THREE.MeshStandardMaterial({ color: 0x121b14, roughness: 0.92 });

const leftVerge = new THREE.Mesh(vergeGeo, vergeMat);
leftVerge.position.set(-208, -9.8, CONFIG.raceDistance / 2);
leftVerge.receiveShadow = true;
landscapeGroup.add(leftVerge);

const rightVerge = new THREE.Mesh(vergeGeo, vergeMat);
rightVerge.position.set(208, -9.8, CONFIG.raceDistance / 2);
rightVerge.receiveShadow = true;
landscapeGroup.add(rightVerge);

// Full Moon & Starfield
const moonGroup = new THREE.Group();
const moonGeo = new THREE.SphereGeometry(58, 32, 32);
const moonMat = new THREE.MeshBasicMaterial({ color: 0xfff3d1, fog: false });
const moonMesh = new THREE.Mesh(moonGeo, moonMat);
moonGroup.add(moonMesh);

const haloCanvas = document.createElement('canvas');
haloCanvas.width = 128; haloCanvas.height = 128;
const hCtx = haloCanvas.getContext('2d');
const hGrad = hCtx.createRadialGradient(64, 64, 10, 64, 64, 64);
hGrad.addColorStop(0, 'rgba(255, 220, 150, 0.50)');
hGrad.addColorStop(0.5, 'rgba(180, 110, 50, 0.18)');
hGrad.addColorStop(1, 'rgba(120, 50, 200, 0)');
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

const starCount = 450;
const starPositions = new Float32Array(starCount * 3);
for (let i = 0; i < starCount; i++) {
    starPositions[i * 3] = (Math.random() - 0.5) * 1400;
    starPositions[i * 3 + 1] = 80 + Math.random() * 350;
    starPositions[i * 3 + 2] = -200 + Math.random() * (CONFIG.raceDistance + 1000);
}
const starGeo = new THREE.BufferGeometry();
starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, fog: false });
scene.add(new THREE.Points(starGeo, starMat));

function buildInstancedSpookyTrees() {
    const treePlacements = [];
    for (let z = -320; z < CONFIG.raceDistance + 280; z += 14) {
        if (Math.random() > 0.15) {
            treePlacements.push({
                x: -60 - Math.random() * 140,
                z: z + (Math.random() - 0.5) * 8,
                scale: 1.8 + Math.random() * 1.8,
                rotY: Math.random() * Math.PI * 2
            });
        }
        if (Math.random() > 0.15) {
            treePlacements.push({
                x: 60 + Math.random() * 140,
                z: z + (Math.random() - 0.5) * 8,
                scale: 1.8 + Math.random() * 1.8,
                rotY: Math.random() * Math.PI * 2
            });
        }
    }

    const count = treePlacements.length;
    const barkMat = new THREE.MeshStandardMaterial({ color: 0x221726, roughness: 0.90, flatShading: true });
    const trunkGeo = new THREE.CylinderGeometry(0.6, 1.8, 10, 6);
    const branchGeo = new THREE.ConeGeometry(0.65, 6.5, 5);

    const trunkInst = new THREE.InstancedMesh(trunkGeo, barkMat, count);
    const branch1Inst = new THREE.InstancedMesh(branchGeo, barkMat, count);
    const branch2Inst = new THREE.InstancedMesh(branchGeo, barkMat, count);
    const branch3Inst = new THREE.InstancedMesh(branchGeo, barkMat, count);

    trunkInst.castShadow = true;
    branch1Inst.castShadow = true;
    branch2Inst.castShadow = true;

    const dummy = new THREE.Object3D();
    const branchDummy = new THREE.Object3D();

    treePlacements.forEach((t, idx) => {
        dummy.position.set(t.x, t.scale * 4.5, t.z);
        dummy.rotation.set((Math.random() - 0.5) * 0.15, t.rotY, (Math.random() - 0.5) * 0.15);
        dummy.scale.set(t.scale, t.scale, t.scale);
        dummy.updateMatrix();
        trunkInst.setMatrixAt(idx, dummy.matrix);

        branchDummy.position.set(t.x + Math.cos(t.rotY) * 1.8 * t.scale, t.scale * 7.5, t.z + Math.sin(t.rotY) * 1.8 * t.scale);
        branchDummy.rotation.set(0.5, t.rotY, -0.75);
        branchDummy.scale.set(t.scale, t.scale, t.scale);
        branchDummy.updateMatrix();
        branch1Inst.setMatrixAt(idx, branchDummy.matrix);

        branchDummy.position.set(t.x - Math.cos(t.rotY) * 1.6 * t.scale, t.scale * 6.8, t.z - Math.sin(t.rotY) * 1.6 * t.scale);
        branchDummy.rotation.set(-0.4, t.rotY + 1.1, 0.8);
        branchDummy.scale.set(t.scale * 0.9, t.scale * 0.9, t.scale * 0.9);
        branchDummy.updateMatrix();
        branch2Inst.setMatrixAt(idx, branchDummy.matrix);

        branchDummy.position.set(t.x, t.scale * 9.8, t.z);
        branchDummy.rotation.set(0.25, t.rotY + 2.0, 0.2);
        branchDummy.scale.set(t.scale * 0.75, t.scale * 0.85, t.scale * 0.75);
        branchDummy.updateMatrix();
        branch3Inst.setMatrixAt(idx, branchDummy.matrix);
    });

    landscapeGroup.add(trunkInst, branch1Inst, branch2Inst, branch3Inst);
}
buildInstancedSpookyTrees();

function buildInstancedGravestones() {
    const graves = [];
    for (let z = -150; z < CONFIG.raceDistance + 150; z += 18) {
        if (Math.random() > 0.35) {
            graves.push({ x: -43 - Math.random() * 22, z: z + Math.random() * 10, rot: (Math.random() - 0.5) * 0.5 });
        }
        if (Math.random() > 0.35) {
            graves.push({ x: 43 + Math.random() * 22, z: z + Math.random() * 10, rot: (Math.random() - 0.5) * 0.5 });
        }
    }
    const graveGeo = new THREE.BoxGeometry(2.2, 3.6, 0.6);
    const graveMat = new THREE.MeshStandardMaterial({ map: stoneTex, color: 0x4a4359, roughness: 0.85 });
    const graveInst = new THREE.InstancedMesh(graveGeo, graveMat, graves.length);
    graveInst.castShadow = true;
    graveInst.receiveShadow = true;

    const dummy = new THREE.Object3D();
    graves.forEach((g, i) => {
        dummy.position.set(g.x, 1.8, g.z);
        dummy.rotation.set((Math.random() - 0.5) * 0.2, g.rot, (Math.random() - 0.5) * 0.2);
        dummy.scale.setScalar(0.85 + Math.random() * 0.5);
        dummy.updateMatrix();
        graveInst.setMatrixAt(i, dummy.matrix);
    });
    landscapeGroup.add(graveInst);
}
buildInstancedGravestones();

function createTrackSiding(imagePath, x, z, side) {
    const group = new THREE.Group();
    const length = 55, height = 10, depth = 2;
    const baseGeo = new THREE.BoxGeometry(depth, height, length);
    const baseMat = new THREE.MeshStandardMaterial({
        map: stoneTex,
        roughness: 0.88,
        color: 0x473f54
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

const pumpkinOuterMat = new THREE.MeshStandardMaterial({
    color: 0xd94800,
    roughness: 0.45,
    emissive: 0x2b0e00,
    emissiveIntensity: 0.25
});
const pumpkinGlowMat = new THREE.MeshStandardMaterial({
    color: 0xffea00,
    emissive: 0xff6d00,
    emissiveIntensity: 0.70
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

const finishGroup = new THREE.Group();
const checkCanvas = document.createElement('canvas');
checkCanvas.width = 576;
checkCanvas.height = 64;
const checkCtx = checkCanvas.getContext('2d');
checkCtx.fillStyle = '#10071a';
checkCtx.fillRect(0, 0, 576, 64);
checkCtx.fillStyle = '#e66000';
for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 18; x++) {
        if ((x + y) % 2 === 0) checkCtx.fillRect(x * 32, y * 32, 32, 32);
    }
}
const checkTex = new THREE.CanvasTexture(checkCanvas);
checkTex.magFilter = THREE.NearestFilter;

const fBanner = new THREE.Mesh(
    new THREE.BoxGeometry(74, 7, 2),
    new THREE.MeshStandardMaterial({ map: checkTex, roughness: 0.6, emissive: 0x140800 })
);
fBanner.position.set(0, 21, CONFIG.raceDistance);
fBanner.castShadow = true;

const pillarMat = new THREE.MeshStandardMaterial({ map: stoneTex, color: 0x3d334f, roughness: 0.85 });
const p1 = new THREE.Mesh(new THREE.BoxGeometry(3.5, 25, 3.5), pillarMat);
p1.position.set(-36, 12.5, CONFIG.raceDistance);
p1.castShadow = true;
const p2 = p1.clone();
p2.position.set(36, 12.5, CONFIG.raceDistance);

finishGroup.add(p1, p2, fBanner);
scene.add(finishGroup);

const lineStripGeo = new THREE.PlaneGeometry(CONFIG.roadWidth, 3.5);
const startLineMat = new THREE.MeshBasicMaterial({ map: checkTex, transparent: true, opacity: 0.88 });
const startLineStrip = new THREE.Mesh(lineStripGeo, startLineMat);
startLineStrip.rotation.x = -Math.PI / 2;
startLineStrip.position.set(0, 0.04, 0);
scene.add(startLineStrip);

const finishLineStrip = startLineStrip.clone();
finishLineStrip.position.set(0, 0.04, CONFIG.raceDistance);
scene.add(finishLineStrip);

/**
 * OBJECT-POOLED FOOTSTEP MIST
 */
const mistGroup = new THREE.Group();
scene.add(mistGroup);

const mistCanvas = document.createElement('canvas');
mistCanvas.width = 64;
mistCanvas.height = 64;
const mistCtx = mistCanvas.getContext('2d');
const mistGrad = mistCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
mistGrad.addColorStop(0, 'rgba(155, 135, 195, 0.45)');
mistGrad.addColorStop(0.5, 'rgba(80, 220, 60, 0.16)');
mistGrad.addColorStop(1, 'rgba(40, 10, 60, 0)');
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
    item.mesh.material.opacity = 0.50;
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
            item.mesh.material.opacity = 0.50 * (1 - item.age / 0.85);
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
 * 3D ARTICULATED ZOOMBIE RACER CLASS
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
        this.runCycle = this.id * 0.75;
        this.idlePhase = this.id * 0.95;
        this.finished = false;
        this.finishTime = 0;
        this.aggressiveness = Math.random();
        this.energyCycle = Math.random() * 10;
        this.stepTimer = 0;
        this.usingGLB = false;

        this.rig = {
            bodyGroup: new THREE.Group(),
            headGroup: new THREE.Group(),
            leftArm: new THREE.Group(),
            rightArm: new THREE.Group(),
            leftLeg: new THREE.Group(),
            rightLeg: new THREE.Group(),
            extra: null
        };

        const glbResult = MonsterModelManager.cloneFor(id);
        if (glbResult) {
            this.usingGLB = true;
            this.mesh.add(glbResult.group);
            if (glbResult.rig.bodyGroup) this.rig.bodyGroup = glbResult.rig.bodyGroup;
            if (glbResult.rig.headGroup) this.rig.headGroup = glbResult.rig.headGroup;
            if (glbResult.rig.leftArm)   this.rig.leftArm   = glbResult.rig.leftArm;
            if (glbResult.rig.rightArm)  this.rig.rightArm  = glbResult.rig.rightArm;
            if (glbResult.rig.leftLeg)   this.rig.leftLeg   = glbResult.rig.leftLeg;
            if (glbResult.rig.rightLeg)  this.rig.rightLeg  = glbResult.rig.rightLeg;
            if (glbResult.rig.extra)     this.rig.extra     = glbResult.rig.extra;
        }

        this.baseRig = {
            bodyY: this.rig.bodyGroup.position.y,
            headY: this.rig.headGroup.position.y,
            extraRotX: this.rig.extra ? this.rig.extra.rotation.x : 0
        };

        this.addNameLabel();
        this.resetToStartLine();
        scene.add(this.mesh);
    }

    resetToStartLine() {
        this.position.set(this.startX, 0, 0);
        this.currentSpeed = 0;
        this.finished = false;
        this.finishTime = 0;
        this.stepTimer = 0;
        this.mesh.position.set(this.startX, 0, 0);
        this.mesh.rotation.set(0, 0, 0);

        const { leftLeg, rightLeg, leftArm, rightArm, headGroup, bodyGroup, extra } = this.rig;
        bodyGroup.position.y = this.baseRig.bodyY;
        bodyGroup.rotation.set(0, 0, 0);
        headGroup.position.y = this.baseRig.headY;
        headGroup.rotation.set(0, 0, 0);
        leftLeg.rotation.set(0, 0, 0);
        rightLeg.rotation.set(0, 0, 0);
        leftArm.rotation.set(0, 0, 0);
        rightArm.rotation.set(0, 0, 0);
        if (extra) extra.rotation.set(this.baseRig.extraRotX, 0, 0);
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
        ctx.fillStyle = "rgba(12, 6, 20, 0.92)";
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
        sprite.position.set(0, 9.6, 0);
        sprite.scale.set(3.8, 3.0, 1);
        sprite.frustumCulled = false;
        sprite.renderOrder = 100;
        this.mesh.add(sprite);
    }

    updateReadyPose(time) {
        this.position.set(this.startX, 0, 0);
        this.mesh.position.x = this.startX;
        this.mesh.position.z = 0;

        const { leftLeg, rightLeg, leftArm, rightArm, headGroup, bodyGroup, extra } = this.rig;
        const t = time * 2.4 + this.idlePhase;
        const breathe = Math.sin(t) * 0.05;

        leftLeg.rotation.set(0, 0, 0);
        rightLeg.rotation.set(0, 0, 0);
        this.mesh.position.y = 0;
        this.mesh.rotation.set(0, 0, 0);

        bodyGroup.position.y = this.baseRig.bodyY + breathe;
        bodyGroup.rotation.set(0, 0, 0);
        headGroup.position.y = this.baseRig.headY + breathe * 0.5;
        headGroup.rotation.set(Math.sin(t * 0.7) * 0.04, Math.sin(t * 0.5) * 0.08, 0);

        switch (this.id) {
            case 0:
                leftArm.rotation.set(-0.22, 0, 0.15);
                rightArm.rotation.set(-0.35, 0, -0.22);
                if (extra) extra.rotation.set(0.18 + Math.sin(t * 1.4) * 0.07, Math.cos(t) * 0.05, 0);
                break;
            case 1:
                bodyGroup.position.y = this.baseRig.bodyY + Math.abs(Math.sin(t * 1.3)) * 0.11;
                headGroup.rotation.z = Math.sin(t * 1.3) * 0.06;
                leftArm.rotation.set(-0.15, 0, 0.20 + Math.sin(t * 1.3) * 0.05);
                rightArm.rotation.set(-0.15, 0, -0.20 - Math.sin(t * 1.3) * 0.05);
                break;
            case 2:
                bodyGroup.rotation.z = Math.sin(t * 0.9) * 0.06;
                headGroup.rotation.z = Math.sin(t * 0.9 - 0.5) * 0.08;
                leftArm.rotation.set(-0.55 + Math.sin(t) * 0.06, 0, 0.08);
                rightArm.rotation.set(-0.50 + Math.cos(t) * 0.06, 0, -0.08);
                if (extra) extra.rotation.set(0.22 + Math.sin(t * 1.6) * 0.10, Math.sin(t) * 0.08, 0);
                break;
            case 3:
                bodyGroup.position.y = this.baseRig.bodyY + Math.sin(t * 0.8) * 0.07;
                bodyGroup.rotation.x = 0.05 + Math.sin(t * 0.8) * 0.03;
                leftArm.rotation.set(-0.32 + Math.sin(t * 0.8) * 0.05, 0, 0.12);
                rightArm.rotation.set(-0.32 + Math.sin(t * 0.8) * 0.05, 0, -0.12);
                break;
            case 4:
                this.mesh.position.y = 0.22 + Math.sin(t * 1.2) * 0.18;
                bodyGroup.rotation.z = Math.sin(t * 0.8) * 0.05;
                leftArm.rotation.set(-0.28 + Math.sin(t * 1.2) * 0.08, 0, 0.25);
                rightArm.rotation.set(-0.28 + Math.cos(t * 1.2) * 0.08, 0, -0.25);
                if (extra) extra.rotation.set(0.25 + Math.sin(t * 1.8) * 0.10, 0, 0);
                break;
            case 5:
                bodyGroup.position.y = this.baseRig.bodyY + Math.abs(Math.sin(t * 1.5)) * 0.08;
                headGroup.rotation.z = 0.05 + Math.sin(t * 1.5) * 0.07;
                leftArm.rotation.set(-0.20, 0, 0.18);
                rightArm.rotation.set(-0.20, 0, -0.18);
                break;
            case 6:
                bodyGroup.position.y = this.baseRig.bodyY - 0.08 + breathe;
                bodyGroup.rotation.x = 0.14;
                leftArm.rotation.set(-0.38, 0, 0.16);
                rightArm.rotation.set(-0.38, 0, -0.16);
                if (extra) extra.rotation.set(0.10, Math.sin(t * 2.8) * 0.28, Math.sin(t * 2.8) * 0.15);
                break;
            case 7:
                bodyGroup.rotation.y = Math.sin(t * 1.4) * 0.07;
                headGroup.rotation.z = Math.sin(t * 2.8) * 0.05;
                leftArm.rotation.set(-0.12, 0, 0.14 + Math.sin(t * 2.8) * 0.03);
                rightArm.rotation.set(-0.12, 0, -0.14 - Math.sin(t * 2.8) * 0.03);
                break;
        }
    }

    updateRacingMovement(delta, time) {
        const energy = Math.sin(time * 0.5 + this.energyCycle);
        let targetSpeed = this.baseSpeed;
        if (energy > 0.5) targetSpeed *= 1.2 + (this.aggressiveness * 0.2);
        else if (energy < -0.5) targetSpeed *= 0.85;
        targetSpeed += (Math.random() - 0.5) * 2.0;

        const distRemaining = CONFIG.raceDistance - this.position.z;
        if (distRemaining < 100 && distRemaining > 0) targetSpeed *= 1.1;

        this.currentSpeed = targetSpeed;
        this.position.z += targetSpeed * delta;

        if (this.position.x > 27) this.position.x -= 5 * delta;
        else if (this.position.x < -27) this.position.x += 5 * delta;
        else this.position.x += Math.sin(time + this.id * 10) * 1.8 * delta;

        this.mesh.position.x = this.position.x;
        this.mesh.position.z = this.position.z;

        const { leftLeg, rightLeg, leftArm, rightArm, headGroup, bodyGroup, extra } = this.rig;
        const cycleRate = this.currentSpeed * 0.92;
        this.runCycle += delta * cycleRate;
        const c = this.runCycle;

        switch (this.id) {
            case 0: {
                const swing = Math.sin(c) * 1.05;
                this.mesh.position.y = Math.abs(Math.cos(c)) * 0.52;
                this.mesh.rotation.set(0.22, 0, Math.cos(c) * 0.07);
                leftLeg.rotation.x = swing;
                rightLeg.rotation.x = -swing;
                leftArm.rotation.set(-swing * 0.95 - 0.2, 0, 0.18);
                rightArm.rotation.set(swing * 0.95 - 0.2, 0, -0.18);
                headGroup.rotation.y = Math.sin(c * 0.5) * 0.14;
                bodyGroup.rotation.y = -swing * 0.16;
                if (extra) extra.rotation.set(0.55 + Math.abs(Math.sin(c)) * 0.42, Math.sin(c) * 0.12, 0);
                break;
            }
            case 1: {
                const swing = Math.sin(c) * 0.92;
                this.mesh.position.y = Math.abs(Math.cos(c)) * 0.72;
                this.mesh.rotation.set(0.14, 0, Math.sin(c) * 0.11);
                leftLeg.rotation.x = swing;
                rightLeg.rotation.x = -swing;
                leftArm.rotation.set(-swing * 0.85, 0, 0.28);
                rightArm.rotation.set(swing * 0.85, 0, -0.28);
                headGroup.rotation.z = -Math.sin(c) * 0.12;
                bodyGroup.rotation.y = -swing * 0.14;
                break;
            }
            case 2: {
                const swing = Math.sin(c * 0.95) * 0.86;
                this.mesh.position.y = Math.abs(Math.cos(c * 0.95)) * 0.38;
                this.mesh.rotation.set(0.18, 0, Math.sin(c * 0.95) * 0.15);
                leftLeg.rotation.x = swing;
                rightLeg.rotation.x = -swing;
                leftArm.rotation.set(-Math.PI * 0.46 + Math.sin(c * 1.9) * 0.22, 0, 0.08);
                rightArm.rotation.set(-Math.PI * 0.46 + Math.cos(c * 1.9) * 0.22, 0, -0.08);
                headGroup.rotation.z = Math.cos(c * 0.95) * 0.14;
                if (extra) extra.rotation.set(0.65 + Math.abs(Math.sin(c * 1.5)) * 0.35, Math.sin(c) * 0.20, 0);
                break;
            }
            case 3: {
                const swing = Math.sin(c * 0.85) * 0.95;
                this.mesh.position.y = Math.abs(Math.cos(c * 0.85)) * 0.46;
                this.mesh.rotation.set(0.20, 0, Math.cos(c * 0.85) * 0.12);
                leftLeg.rotation.x = swing;
                rightLeg.rotation.x = -swing;
                leftArm.rotation.set(-0.65 - swing * 0.70, 0, 0.16);
                rightArm.rotation.set(-0.65 + swing * 0.70, 0, -0.16);
                bodyGroup.rotation.y = -swing * 0.22;
                headGroup.rotation.y = Math.sin(c * 0.42) * 0.12;
                break;
            }
            case 4: {
                this.mesh.position.y = 0.48 + Math.sin(c * 0.75) * 0.42;
                this.mesh.rotation.set(0.28, Math.sin(c * 0.4) * 0.10, Math.cos(c * 0.5) * 0.10);
                leftLeg.rotation.x = 0.35 + Math.sin(c * 1.4) * 0.25;
                rightLeg.rotation.x = 0.35 + Math.cos(c * 1.4) * 0.25;
                leftArm.rotation.set(-0.45 + Math.sin(c * 0.8) * 0.35, 0, 0.35);
                rightArm.rotation.set(-0.45 + Math.cos(c * 0.8) * 0.35, 0, -0.35);
                headGroup.rotation.x = -0.15;
                if (extra) extra.rotation.set(0.65 + Math.sin(c * 1.6) * 0.28, 0, 0);
                break;
            }
            case 5: {
                const swing = Math.sin(c * 1.18) * 1.08;
                this.mesh.position.y = Math.abs(Math.cos(c * 1.18)) * 0.54;
                this.mesh.rotation.set(0.20, 0, Math.cos(c * 1.18) * 0.09);
                leftLeg.rotation.x = swing;
                rightLeg.rotation.x = -swing;
                leftArm.rotation.set(-swing * 1.05, 0, 0.22);
                rightArm.rotation.set(swing * 1.05, 0, -0.22);
                headGroup.rotation.z = Math.sin(c * 1.18) * 0.10;
                if (extra) extra.rotation.x = 0.50 + Math.abs(Math.sin(c * 1.18)) * 0.35;
                break;
            }
            case 6: {
                const swing = Math.sin(c * 0.95) * 1.12;
                this.mesh.position.y = Math.abs(Math.sin(c * 0.95)) * 0.64;
                this.mesh.rotation.set(0.28 + Math.cos(c * 0.95) * 0.08, 0, 0);
                leftLeg.rotation.x = swing;
                rightLeg.rotation.x = -swing * 0.85;
                leftArm.rotation.set(-swing * 0.95 - 0.25, 0, 0.14);
                rightArm.rotation.set(swing * 0.95 - 0.25, 0, -0.14);
                if (extra) extra.rotation.set(0.35 + Math.sin(c * 1.9) * 0.25, Math.cos(c) * 0.22, 0);
                break;
            }
            case 7:
            default: {
                const swing = Math.sin(c * 1.08) * 1.12;
                this.mesh.position.y = Math.abs(Math.cos(c * 1.08)) * 0.62;
                this.mesh.rotation.set(0.15, 0, Math.cos(c * 1.08) * 0.11);
                leftLeg.rotation.x = swing;
                rightLeg.rotation.x = -swing;
                leftArm.rotation.set(-swing * 1.10, 0, 0.22);
                rightArm.rotation.set(swing * 1.10, 0, -0.22);
                headGroup.rotation.y = Math.sin(c * 1.08) * 0.18;
                headGroup.rotation.z = Math.cos(c * 2.16) * 0.08;
                bodyGroup.rotation.y = -swing * 0.22;
                break;
            }
        }

        this.stepTimer += delta;
        if (this.stepTimer > 0.16) {
            spawnFootstepMist(this.position.x, this.position.z - 1.5, 0.65 + Math.random() * 0.45);
            this.stepTimer = 0;
        }
    }

    updateCelebrationPose(time) {
        const { leftLeg, rightLeg, leftArm, rightArm, headGroup, bodyGroup } = this.rig;
        const cheer = Math.sin(time * 8 + this.id) * 0.38;
        this.mesh.position.x = this.position.x;
        this.mesh.position.z = this.position.z;
        this.mesh.position.y = Math.abs(Math.sin(time * 6 + this.id)) * 0.75;
        this.mesh.rotation.set(0, Math.sin(time * 3 + this.id) * 0.35, 0);
        bodyGroup.rotation.set(0, 0, 0);
        leftLeg.rotation.x = 0;
        rightLeg.rotation.x = 0;
        leftArm.rotation.set(Math.PI - 0.4 + cheer, 0, 0.2);
        rightArm.rotation.set(Math.PI - 0.4 - cheer, 0, -0.2);
        headGroup.rotation.set(0, Math.sin(time * 5) * 0.25, 0);
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
 * FIREWORKS SYSTEM
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
 * CAMERA SYSTEM
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
        speedEl.innerText = Math.floor(leadDuck.baseSpeed * 2 + (Math.sin(time * 10) * 5));
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

    const flicker = 0.85 + Math.sin(time * 14) * 0.2 + Math.cos(time * 23) * 0.15;
    pumpkinGlowMat.emissiveIntensity = flicker;

    if (raceState === RACE_STATE.RACING) updateFootstepMist(delta);
    updateFireworks();

    ducks.forEach(d => {
        d.update(delta, time);
        if (raceState === RACE_STATE.RACING && !d.finished && d.position.z >= CONFIG.raceDistance) {
            d.finished = true;
            d.finishTime = time;
        }
    });

    if (raceState === RACE_STATE.RACING) {
        const minSep = 5.8;
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
