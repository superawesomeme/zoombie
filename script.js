/**
 * CONFIGURATION & DATA MANAGEMENT
 */
const CONFIG = {
    duckCount: 8,
    raceDistance: 800,
    targetDuration: 58,
    roadWidth: 74
};

// Colours for the 8 lanes (matching the original duck colours)
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

// Flags for race progression
let isRacing = false;
let isCountingDown = false;
let raceEnded = false;
let firstFinishTriggered = false;
let winnerFinishTime = 0;

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
        // Diminished triad for a classic horror organ feel
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
 * THREE.JS SCENE & LIGHTING SETUP
 */
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.5, 2500);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

// --- NIGHT SKY & EERIE FOG ---
const SKY_COLOR = 0x090514;
scene.background = new THREE.Color(SKY_COLOR);
scene.fog = new THREE.FogExp2(0x0c071b, 0.0042);

// --- LIGHTING ---
const hemiLight = new THREE.HemisphereLight(0x8e9eab, 0x1a0f2e, 0.75);
scene.add(hemiLight);

// Moonlight with dynamic shadow frustum that follows the pack for high efficiency
const moonLight = new THREE.DirectionalLight(0xcfd8dc, 1.05);
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

const textureLoader = new THREE.TextureLoader();

/**
 * PROCEDURAL TEXTURES (Zero extra network requests for road & moon)
 */
function createRoadTexture() {
    const cvs = document.createElement('canvas');
    cvs.width = 512;
    cvs.height = 512;
    const ctx = cvs.getContext('2d');

    // Base dark weathered tarmac
    ctx.fillStyle = '#1c1b22';
    ctx.fillRect(0, 0, 512, 512);

    // Asphalt grain and mossy patches
    for (let i = 0; i < 9000; i++) {
        const x = Math.random() * 512;
        const y = Math.random() * 512;
        const v = 20 + Math.floor(Math.random() * 25);
        ctx.fillStyle = `rgb(${v}, ${v - 2}, ${v + 5})`;
        ctx.fillRect(x, y, 2, 2);
    }

    // Muddy/mossy shoulders on left and right edges
    const leftGrad = ctx.createLinearGradient(0, 0, 65, 0);
    leftGrad.addColorStop(0, '#1e2618');
    leftGrad.addColorStop(1, 'rgba(28, 27, 34, 0)');
    ctx.fillStyle = leftGrad;
    ctx.fillRect(0, 0, 65, 512);

    const rightGrad = ctx.createLinearGradient(512, 0, 447, 0);
    rightGrad.addColorStop(0, '#1e2618');
    rightGrad.addColorStop(1, 'rgba(28, 27, 34, 0)');
    ctx.fillStyle = rightGrad;
    ctx.fillRect(447, 0, 65, 512);

    // Faded double yellow/orange centre line
    ctx.fillStyle = 'rgba(210, 140, 40, 0.45)';
    ctx.fillRect(250, 0, 4, 512);
    ctx.fillRect(258, 0, 4, 512);

    // Faded lane dividers
    ctx.fillStyle = 'rgba(180, 180, 195, 0.22)';
    for (let y = 0; y < 512; y += 64) {
        ctx.fillRect(130, y, 3, 34);
        ctx.fillRect(380, y, 3, 34);
    }

    // Cracks in the old road
    ctx.strokeStyle = '#0b0a0e';
    ctx.lineWidth = 2;
    for (let c = 0; c < 18; c++) {
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
    ctx.fillStyle = '#3b3742';
    ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 800; i++) {
        ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.14)';
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

// 1. Old Cracked Road
const roadLength = CONFIG.raceDistance + 1200;
const roadGeo = new THREE.PlaneGeometry(CONFIG.roadWidth, roadLength);
const roadMat = new THREE.MeshStandardMaterial({
    map: roadTex,
    roughness: 0.88,
    metalness: 0.05
});
const roadMesh = new THREE.Mesh(roadGeo, roadMat);
roadMesh.rotation.x = -Math.PI / 2;
roadMesh.position.set(0, 0, CONFIG.raceDistance / 2);
roadMesh.receiveShadow = true;
landscapeGroup.add(roadMesh);

// 2. Raised Stone Kerbs & Haunted Verges
const kerbGeo = new THREE.BoxGeometry(2.5, 0.8, roadLength);
const kerbMat = new THREE.MeshStandardMaterial({ map: stoneTex, color: 0x666170, roughness: 0.9 });

const leftKerb = new THREE.Mesh(kerbGeo, kerbMat);
leftKerb.position.set(-(CONFIG.roadWidth / 2) - 1.25, 0.4, CONFIG.raceDistance / 2);
leftKerb.receiveShadow = true;
landscapeGroup.add(leftKerb);

const rightKerb = new THREE.Mesh(kerbGeo, kerbMat);
rightKerb.position.set((CONFIG.roadWidth / 2) + 1.25, 0.4, CONFIG.raceDistance / 2);
rightKerb.receiveShadow = true;
landscapeGroup.add(rightKerb);

const vergeGeo = new THREE.BoxGeometry(340, 20, roadLength);
const vergeMat = new THREE.MeshStandardMaterial({ color: 0x161f14, roughness: 0.95 });

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
const moonGeo = new THREE.SphereGeometry(55, 32, 32);
const moonMat = new THREE.MeshBasicMaterial({ color: 0xfff3d1, fog: false });
const moonMesh = new THREE.Mesh(moonGeo, moonMat);
moonGroup.add(moonMesh);

// Moon Halo Glow
const haloCanvas = document.createElement('canvas');
haloCanvas.width = 128; haloCanvas.height = 128;
const hCtx = haloCanvas.getContext('2d');
const hGrad = hCtx.createRadialGradient(64, 64, 10, 64, 64, 64);
hGrad.addColorStop(0, 'rgba(255, 235, 180, 0.55)');
hGrad.addColorStop(0.5, 'rgba(255, 160, 60, 0.18)');
hGrad.addColorStop(1, 'rgba(255, 140, 0, 0)');
hCtx.fillStyle = hGrad;
hCtx.fillRect(0, 0, 128, 128);
const haloSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(haloCanvas),
    blending: THREE.AdditiveBlending,
    fog: false
}));
haloSprite.scale.set(260, 260, 1);
moonGroup.add(haloSprite);
moonGroup.position.set(80, 210, CONFIG.raceDistance + 550);
scene.add(moonGroup);

// Stars
const starCount = 400;
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

// 4. Instanced Spooky Dead Trees (High performance: 2 draw calls for all trees)
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
    const barkMat = new THREE.MeshStandardMaterial({ color: 0x241914, roughness: 0.95, flatShading: true });
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
        // Main twisted trunk
        dummy.position.set(t.x, t.scale * 4.5, t.z);
        dummy.rotation.set((Math.random() - 0.5) * 0.15, t.rotY, (Math.random() - 0.5) * 0.15);
        dummy.scale.set(t.scale, t.scale, t.scale);
        dummy.updateMatrix();
        trunkInst.setMatrixAt(idx, dummy.matrix);

        // Left gnarly limb
        branchDummy.position.set(t.x + Math.cos(t.rotY) * 1.8 * t.scale, t.scale * 7.5, t.z + Math.sin(t.rotY) * 1.8 * t.scale);
        branchDummy.rotation.set(0.5, t.rotY, -0.75);
        branchDummy.scale.set(t.scale, t.scale, t.scale);
        branchDummy.updateMatrix();
        branch1Inst.setMatrixAt(idx, branchDummy.matrix);

        // Right gnarly limb
        branchDummy.position.set(t.x - Math.cos(t.rotY) * 1.6 * t.scale, t.scale * 6.8, t.z - Math.sin(t.rotY) * 1.6 * t.scale);
        branchDummy.rotation.set(-0.4, t.rotY + 1.1, 0.8);
        branchDummy.scale.set(t.scale * 0.9, t.scale * 0.9, t.scale * 0.9);
        branchDummy.updateMatrix();
        branch2Inst.setMatrixAt(idx, branchDummy.matrix);

        // Top crooked spire
        branchDummy.position.set(t.x, t.scale * 9.8, t.z);
        branchDummy.rotation.set(0.25, t.rotY + 2.0, 0.2);
        branchDummy.scale.set(t.scale * 0.75, t.scale * 0.85, t.scale * 0.75);
        branchDummy.updateMatrix();
        branch3Inst.setMatrixAt(idx, branchDummy.matrix);
    });

    landscapeGroup.add(trunkInst, branch1Inst, branch2Inst, branch3Inst);
}
buildInstancedSpookyTrees();

// 5. Instanced Roadside Gravestones
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
    const graveMat = new THREE.MeshStandardMaterial({ map: stoneTex, color: 0x565264, roughness: 0.9 });
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

// 6. Track Sidings (Weathered Haunted Crypt Billboards preserving sponsor images)
function createTrackSiding(imagePath, x, z, side) {
    const group = new THREE.Group();
    const length = 55, height = 10, depth = 2;
    const baseGeo = new THREE.BoxGeometry(depth, height, length);
    const baseMat = new THREE.MeshStandardMaterial({
        map: stoneTex,
        roughness: 0.92,
        color: 0x5c5366
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

// 7. Roadside Jack-o'-Lanterns (Replaces water buoys)
const pumpkinOuterMat = new THREE.MeshStandardMaterial({ color: 0xe65100, roughness: 0.6 });
const pumpkinGlowMat = new THREE.MeshStandardMaterial({
    color: 0xffea00,
    emissive: 0xff6d00,
    emissiveIntensity: 1.0
});

function buildRoadsidePumpkins() {
    const positions = [];
    for (let z = 0; z <= CONFIG.raceDistance; z += 40) {
        positions.push({ x: -35.5, z: z, rot: 0.4 });
        positions.push({ x: 35.5, z: z, rot: -0.4 });
    }
    const bodyGeo = new THREE.SphereGeometry(1.45, 12, 10);
    bodyGeo.scale(1.15, 0.88, 1.15);
    const coreGeo = new THREE.SphereGeometry(1.15, 8, 8);

    const bodyInst = new THREE.InstancedMesh(bodyGeo, pumpkinOuterMat, positions.length);
    const glowInst = new THREE.InstancedMesh(coreGeo, pumpkinGlowMat, positions.length);

    const dummy = new THREE.Object3D();
    positions.forEach((p, idx) => {
        dummy.position.set(p.x, 1.1, p.z);
        dummy.rotation.set(0, p.rot, 0);
        dummy.updateMatrix();
        bodyInst.setMatrixAt(idx, dummy.matrix);

        dummy.position.set(p.x + (p.x < 0 ? 0.35 : -0.35), 1.15, p.z + 0.15);
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
checkCtx.fillStyle = '#140b1c';
checkCtx.fillRect(0, 0, 576, 64);
checkCtx.fillStyle = '#ff6d00';
for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 18; x++) {
        if ((x + y) % 2 === 0) checkCtx.fillRect(x * 32, y * 32, 32, 32);
    }
}
const checkTex = new THREE.CanvasTexture(checkCanvas);
checkTex.magFilter = THREE.NearestFilter;

const fBanner = new THREE.Mesh(
    new THREE.BoxGeometry(74, 7, 2),
    new THREE.MeshStandardMaterial({ map: checkTex, roughness: 0.7 })
);
fBanner.position.set(0, 21, CONFIG.raceDistance);
fBanner.castShadow = true;

const pillarMat = new THREE.MeshStandardMaterial({ map: stoneTex, color: 0x3e3546, roughness: 0.9 });
const p1 = new THREE.Mesh(new THREE.BoxGeometry(3.5, 25, 3.5), pillarMat);
p1.position.set(-36, 12.5, CONFIG.raceDistance);
p1.castShadow = true;
const p2 = p1.clone();
p2.position.set(36, 12.5, CONFIG.raceDistance);

finishGroup.add(p1, p2, fBanner);
scene.add(finishGroup);

// Road Start & Finish Paint Strips
const lineStripGeo = new THREE.PlaneGeometry(CONFIG.roadWidth, 3.5);
const startLineMat = new THREE.MeshBasicMaterial({ map: checkTex, transparent: true, opacity: 0.85 });
const startLineStrip = new THREE.Mesh(lineStripGeo, startLineMat);
startLineStrip.rotation.x = -Math.PI / 2;
startLineStrip.position.set(0, 0.04, 0);
scene.add(startLineStrip);

const finishLineStrip = startLineStrip.clone();
finishLineStrip.position.set(0, 0.04, CONFIG.raceDistance);
scene.add(finishLineStrip);

/**
 * OBJECT-POOLED FOOTSTEP DUST / ECTO-MIST SYSTEM (Zero GC Churn)
 */
const mistGroup = new THREE.Group();
scene.add(mistGroup);

const mistCanvas = document.createElement('canvas');
mistCanvas.width = 64;
mistCanvas.height = 64;
const mistCtx = mistCanvas.getContext('2d');
const mistGrad = mistCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
mistGrad.addColorStop(0, 'rgba(180, 160, 210, 0.55)');
mistGrad.addColorStop(0.5, 'rgba(120, 255, 80, 0.22)');
mistGrad.addColorStop(1, 'rgba(60, 20, 90, 0)');
mistCtx.fillStyle = mistGrad;
mistCtx.fillRect(0, 0, 64, 64);
const mistTex = new THREE.CanvasTexture(mistCanvas);

const MIST_POOL_SIZE = 100;
const mistGeo = new THREE.PlaneGeometry(2.6, 2.6);
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
    item.mesh.material.opacity = 0.65;
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
            const s = item.baseScale + item.age * 2.6;
            item.mesh.scale.set(s, s, 1);
            item.mesh.material.opacity = 0.65 * (1 - item.age / 0.85);
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
 *SHARED GEOMETRIES FOR 3D ARTICULATED ZOOMBIES
 */
const SHARED_GEO = {
    torso: new THREE.BoxGeometry(1.7, 2.1, 1.0),
    headCube: new THREE.BoxGeometry(1.5, 1.5, 1.5),
    headSphere: new THREE.SphereGeometry(0.95, 14, 12),
    limb: new THREE.BoxGeometry(0.55, 1.65, 0.55),
    thinBone: new THREE.CylinderGeometry(0.18, 0.18, 1.65, 6),
    eye: new THREE.SphereGeometry(0.15, 8, 8),
    horn: new THREE.ConeGeometry(0.25, 0.9, 6),
    ear: new THREE.ConeGeometry(0.28, 0.75, 4),
    witchHatBrim: new THREE.CylinderGeometry(1.4, 1.4, 0.12, 12),
    witchHatCone: new THREE.ConeGeometry(0.85, 1.9, 10),
    cape: new THREE.PlaneGeometry(1.9, 2.4),
    bolt: new THREE.CylinderGeometry(0.14, 0.14, 2.0, 8),
    snout: new THREE.BoxGeometry(0.8, 0.6, 0.9),
    rib: new THREE.BoxGeometry(1.55, 0.2, 0.85)
};

// Shift limb pivot to the top joint (shoulder/hip) for natural swinging
SHARED_GEO.limb.translate(0, -0.7, 0);
SHARED_GEO.thinBone.translate(0, -0.7, 0);
SHARED_GEO.cape.translate(0, -1.1, 0);

// Optional GLTF Loader – now managed by MonsterModelManager below
const loader = new THREE.GLTFLoader();
const dracoLoader = new THREE.DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
loader.setDRACOLoader(dracoLoader);

/**
 * MONSTER MODEL MANAGER
 * =====================
 * Preloads all 8 GLBs before the race button becomes active.
 * Each GLB contains named nodes: Root, Body, Head, Arm_L, Arm_R, Leg_L, Leg_R, Extra.
 * Falls back to procedural geometry if a GLB fails to load.
 * Cached source models are cloned per-racer; disposed on race reset.
 */
const MONSTER_MANIFEST = [
    { id: 0, name: 'vampire',          file: 'models/vampire.glb',          scale: 1.0, yOffset: 0 },
    { id: 1, name: 'pumpkin-fiend',    file: 'models/pumpkin-fiend.glb',    scale: 1.0, yOffset: 0 },
    { id: 2, name: 'cursed-mummy',     file: 'models/cursed-mummy.glb',     scale: 1.0, yOffset: 0 },
    { id: 3, name: 'franken-zombie',   file: 'models/franken-zombie.glb',   scale: 1.0, yOffset: 0 },
    { id: 4, name: 'spectral-banshee', file: 'models/spectral-banshee.glb', scale: 1.0, yOffset: 0.25 },
    { id: 5, name: 'witch-imp',        file: 'models/witch-imp.glb',        scale: 1.0, yOffset: 0 },
    { id: 6, name: 'werewolf',         file: 'models/werewolf.glb',         scale: 1.0, yOffset: 0 },
    { id: 7, name: 'skeleton',         file: 'models/skeleton.glb',         scale: 1.0, yOffset: 0 },
];

const MonsterModelManager = {
    /** Cached source gltf.scene objects, indexed by monster id */
    _cache: new Array(8).fill(null),
    /** Which models failed to load (use procedural fallback) */
    _failed: new Array(8).fill(false),
    /** Whether all loads are resolved */
    ready: false,

    /** Load all 8 GLBs. Returns a Promise that resolves when all are done. */
    preloadAll() {
        const startBtn = document.getElementById('start-btn');
        const loadingMsg = document.createElement('div');
        loadingMsg.id = 'loading-msg';
        loadingMsg.textContent = 'Loading racers… 0/8';
        loadingMsg.style.cssText = 'margin-top:10px;font-size:0.85rem;color:#aaa;letter-spacing:1px;';

        const btnParent = startBtn?.parentNode;
        if (btnParent) btnParent.insertBefore(loadingMsg, startBtn);
        if (startBtn) { startBtn.disabled = true; startBtn.style.cursor = 'not-allowed'; }

        let loadedCount = 0;

        const promises = MONSTER_MANIFEST.map(entry => new Promise((resolve) => {
            loader.load(
                entry.file,
                (gltf) => {
                    this._cache[entry.id] = gltf.scene;
                    // Ensure shadow casting on all meshes
                    gltf.scene.traverse(child => {
                        if (child.isMesh) {
                            child.castShadow = true;
                            child.receiveShadow = true;
                        }
                    });
                    loadedCount++;
                    if (loadingMsg) loadingMsg.textContent = `Loading racers… ${loadedCount}/8`;
                    resolve();
                },
                undefined,
                (err) => {
                    console.warn(`[MonsterModelManager] Failed to load ${entry.file}:`, err);
                    this._failed[entry.id] = true;
                    loadedCount++;
                    if (loadingMsg) loadingMsg.textContent = `Loading racers… ${loadedCount}/8`;
                    resolve(); // don't reject – use procedural fallback
                }
            );
        }));

        return Promise.all(promises).then(() => {
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

    /**
     * Clone a cached model for use as one racer's visual.
     * Returns { group, rig } where rig has named nodes keyed as in script.js.
     * Returns null if this id should use procedural fallback.
     */
    cloneFor(monsterId) {
        const source = this._cache[monsterId];
        if (!source) return null;

        const entry = MONSTER_MANIFEST[monsterId];

        // Deep clone the scene graph
        const clone = source.clone(true);

        // Apply per-monster scale
        clone.scale.setScalar(entry.scale);
        clone.position.y = entry.yOffset;

        // Extract named rig nodes
        const rig = {};
        clone.traverse(child => {
            switch (child.name) {
                case 'Body':    rig.bodyGroup  = child; break;
                case 'Head':    rig.headGroup  = child; break;
                case 'Arm_L':   rig.leftArm    = child; break;
                case 'Arm_R':   rig.rightArm   = child; break;
                case 'Leg_L':   rig.leftLeg    = child; break;
                case 'Leg_R':   rig.rightLeg   = child; break;
                case 'Extra':   rig.extra       = child; break;
            }
        });

        return { group: clone, rig };
    },

    /**
     * Dispose all cached source models (call between races if needed).
     * The clones themselves are disposed when removed from scene.
     */
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

// Start preloading immediately
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
 * 3D ARTICULATED ZOOMBIE RACER CLASS
 * Supports GLB models via MonsterModelManager with procedural fallback.
 */
class Zoombie {
    constructor(id, name, startX) {
        this.id = id;
        this.name = name;
        this.color = COLORS[id % COLORS.length];
        this.mesh = new THREE.Group();
        this.position = new THREE.Vector3(startX, 0, 0);
        this.baseSpeed = CONFIG.raceDistance / CONFIG.targetDuration;
        this.currentSpeed = this.baseSpeed;
        this.runCycle = Math.random() * Math.PI * 2;
        this.finished = false;
        this.finishTime = 0;
        this.aggressiveness = Math.random();
        this.energyCycle = Math.random() * 10;
        this.stepTimer = 0;
        this.usingGLB = false; // whether this racer uses a loaded GLB or procedural geo

        // Articulated rig references – populated either from GLB named nodes
        // or from the procedural buildMonsterModel() path
        this.rig = {
            bodyGroup: new THREE.Group(),
            headGroup: new THREE.Group(),
            leftArm: new THREE.Group(),
            rightArm: new THREE.Group(),
            leftLeg: new THREE.Group(),
            rightLeg: new THREE.Group(),
            extra: null
        };

        // Attempt to use GLB model
        const glbResult = MonsterModelManager.cloneFor(id);
        if (glbResult) {
            this.usingGLB = true;
            this.mesh.add(glbResult.group);
            // Merge GLB rig nodes into this.rig, falling back to empty groups for
            // any node not found (keeps animation code safe)
            if (glbResult.rig.bodyGroup) this.rig.bodyGroup = glbResult.rig.bodyGroup;
            if (glbResult.rig.headGroup) this.rig.headGroup = glbResult.rig.headGroup;
            if (glbResult.rig.leftArm)   this.rig.leftArm   = glbResult.rig.leftArm;
            if (glbResult.rig.rightArm)  this.rig.rightArm  = glbResult.rig.rightArm;
            if (glbResult.rig.leftLeg)   this.rig.leftLeg   = glbResult.rig.leftLeg;
            if (glbResult.rig.rightLeg)  this.rig.rightLeg  = glbResult.rig.rightLeg;
            if (glbResult.rig.extra)     this.rig.extra      = glbResult.rig.extra;
        } else {
            // Procedural fallback
            this.buildProceduralMonsterModel();
        }

        if (this.id === 2 || this.id === 3) {
            this.ZombieArms = true;
        }

        this.addNameLabel();

        this.mesh.position.copy(this.position);
        scene.add(this.mesh);
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
        ctx.fillStyle = "rgba(12, 7, 20, 0.88)";
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(30, 0); ctx.lineTo(60, 0); ctx.lineTo(30, h); ctx.lineTo(0, h);
        ctx.fillStyle = mainColor;
        ctx.fill();

        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.shadowColor = "rgba(0,0,0,0.85)";
        ctx.shadowBlur = 4;
        ctx.font = "bold 80px 'Rajdhani'";
        ctx.fillText(`${this.id + 1}`, 95, h / 2 + 2);

        const sprite = new THREE.Sprite(
            new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cvs), depthWrite: false, depthTest: true })
        );
        sprite.position.set(0, 7.2, 0);
        sprite.scale.set(3.2, 2.5, 1);
        sprite.frustumCulled = false;
        sprite.renderOrder = 100;
        this.mesh.add(sprite);
    }

    buildProceduralMonsterModel() {
        const primaryMat = new THREE.MeshStandardMaterial({
            color: this.color,
            roughness: 0.45,
            metalness: 0.1
        });
        const darkSuitMat = new THREE.MeshStandardMaterial({
            color: 0x1a1624,
            roughness: 0.75
        });
        const eyeGlowMat = new THREE.MeshBasicMaterial({
            color: (this.id === 0 || this.id === 6) ? 0xff1744 : 0x76ff03
        });

        const { bodyGroup, headGroup, leftArm, rightArm, leftLeg, rightLeg } = this.rig;
        bodyGroup.position.y = 1.65;

        // Default limb positions
        leftLeg.position.set(-0.48, 1.55, 0);
        rightLeg.position.set(0.48, 1.55, 0);
        leftArm.position.set(-1.15, 3.25, 0);
        rightArm.position.set(1.15, 3.25, 0);
        headGroup.position.set(0, 3.65, 0);

        // Is this the Skeleton (#8 White)? Use thin bone geometry and ribcage
        const limbGeo = (this.id === 7) ? SHARED_GEO.thinBone : SHARED_GEO.limb;

        const lLegMesh = new THREE.Mesh(limbGeo, this.id === 7 ? primaryMat : darkSuitMat);
        const rLegMesh = new THREE.Mesh(limbGeo, this.id === 7 ? primaryMat : darkSuitMat);
        const lArmMesh = new THREE.Mesh(limbGeo, primaryMat);
        const rArmMesh = new THREE.Mesh(limbGeo, primaryMat);

        lLegMesh.castShadow = true;
        rLegMesh.castShadow = true;
        lArmMesh.castShadow = true;
        rArmMesh.castShadow = true;

        leftLeg.add(lLegMesh);
        rightLeg.add(rLegMesh);
        leftArm.add(lArmMesh);
        rightArm.add(rArmMesh);

        // Torso
        if (this.id === 7) {
            // Skeleton ribcage
            const spine = new THREE.Mesh(SHARED_GEO.thinBone, primaryMat);
            spine.position.y = 1.85;
            bodyGroup.add(spine);
            for (let r = 0; r < 3; r++) {
                const rib = new THREE.Mesh(SHARED_GEO.rib, primaryMat);
                rib.position.y = 0.4 + r * 0.5;
                rib.castShadow = true;
                bodyGroup.add(rib);
            }
        } else {
            const torsoMesh = new THREE.Mesh(
                SHARED_GEO.torso,
                (this.id === 0 || this.id === 5) ? darkSuitMat : primaryMat
            );
            torsoMesh.position.y = 0.85;
            torsoMesh.castShadow = true;
            bodyGroup.add(torsoMesh);
        }

        // Monster-specific heads and features
        if (this.id === 0) {
            // 0: RED - Vampire (Cape + High Collar + Pale/Red Head)
            const head = new THREE.Mesh(SHARED_GEO.headCube, primaryMat);
            head.castShadow = true;
            headGroup.add(head);

            const capeMat = new THREE.MeshStandardMaterial({ color: 0xb71c1c, side: THREE.DoubleSide, roughness: 0.6 });
            const cape = new THREE.Mesh(SHARED_GEO.cape, capeMat);
            cape.position.set(0, 1.8, -0.55);
            cape.rotation.x = 0.25;
            bodyGroup.add(cape);
            this.rig.extra = cape;

        } else if (this.id === 1) {
            // 1: ORANGE - Pumpkin Fiend (Carved Jack-o'-Lantern Head)
            const pHead = new THREE.Mesh(SHARED_GEO.headSphere, primaryMat);
            pHead.scale.set(1.25, 1.0, 1.25);
            pHead.castShadow = true;
            const stem = new THREE.Mesh(SHARED_GEO.horn, new THREE.MeshStandardMaterial({ color: 0x33691e }));
            stem.position.y = 1.0;
            headGroup.add(pHead, stem);

        } else if (this.id === 2) {
            // 2: YELLOW - Cursed Mummy (Wrapped head + trailing bandage)
            const mHead = new THREE.Mesh(SHARED_GEO.headCube, primaryMat);
            mHead.castShadow = true;
            headGroup.add(mHead);
            // Outstretched mummy arms
            this.ZombieArms = true;

        } else if (this.id === 3) {
            // 3: GREEN - Franken-Zombie (Flat head + metallic neck bolts + outstretched arms)
            const fHead = new THREE.Mesh(SHARED_GEO.headCube, primaryMat);
            fHead.scale.set(1.05, 1.2, 1.0);
            fHead.castShadow = true;
            const hair = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.35, 1.6), darkSuitMat);
            hair.position.y = 0.8;
            const bolts = new THREE.Mesh(SHARED_GEO.bolt, new THREE.MeshStandardMaterial({ color: 0xb0bec5, metalness: 0.8 }));
            bolts.rotation.z = Math.PI / 2;
            bolts.position.y = -0.3;
            headGroup.add(fHead, hair, bolts);
            this.ZombieArms = true;

        } else if (this.id === 4) {
            // 4: BLUE - Spectral Banshee (Curved Demon Horns + Glowing Core)
            const bHead = new THREE.Mesh(SHARED_GEO.headSphere, primaryMat);
            bHead.castShadow = true;
            const hL = new THREE.Mesh(SHARED_GEO.horn, darkSuitMat);
            hL.position.set(-0.65, 0.85, 0);
            hL.rotation.z = 0.45;
            const hR = new THREE.Mesh(SHARED_GEO.horn, darkSuitMat);
            hR.position.set(0.65, 0.85, 0);
            hR.rotation.z = -0.45;
            headGroup.add(bHead, hL, hR);

        } else if (this.id === 5) {
            // 5: PURPLE - Witch-Imp (Pointed Witch Hat + Cape)
            const wHead = new THREE.Mesh(SHARED_GEO.headCube, primaryMat);
            wHead.castShadow = true;
            const brim = new THREE.Mesh(SHARED_GEO.witchHatBrim, darkSuitMat);
            brim.position.y = 0.78;
            const cone = new THREE.Mesh(SHARED_GEO.witchHatCone, primaryMat);
            cone.position.y = 1.7;
            headGroup.add(wHead, brim, cone);

        } else if (this.id === 6) {
            // 6: GREY - Werewolf (Wolf Snout + Pointed Ears + Tail)
            const wolfHead = new THREE.Mesh(SHARED_GEO.headCube, primaryMat);
            wolfHead.castShadow = true;
            const snout = new THREE.Mesh(SHARED_GEO.snout, primaryMat);
            snout.position.set(0, -0.2, 0.95);
            const earL = new THREE.Mesh(SHARED_GEO.ear, primaryMat);
            earL.position.set(-0.5, 1.0, 0);
            const earR = new THREE.Mesh(SHARED_GEO.ear, primaryMat);
            earR.position.set(0.5, 1.0, 0);
            headGroup.add(wolfHead, snout, earL, earR);

        } else {
            // 7: WHITE - Skeleton (Skull Head)
            const skull = new THREE.Mesh(SHARED_GEO.headSphere, primaryMat);
            skull.scale.set(0.95, 1.1, 1.05);
            skull.castShadow = true;
            headGroup.add(skull);
        }

        // Glowing Monster Eyes (facing forward along +Z)
        const eyeL = new THREE.Mesh(SHARED_GEO.eye, eyeGlowMat);
        eyeL.position.set(-0.35, 0.15, 0.78);
        const eyeR = new THREE.Mesh(SHARED_GEO.eye, eyeGlowMat);
        eyeR.position.set(0.35, 0.15, 0.78);
        headGroup.add(eyeL, eyeR);

        this.mesh.add(bodyGroup, headGroup, leftArm, rightArm, leftLeg, rightLeg);
        this.mesh.scale.set(1.15, 1.15, 1.15);
    }

    update(delta, time) {
        if (!this.finished) {
            const energy = Math.sin(time * 0.5 + this.energyCycle);
            let targetSpeed = this.baseSpeed;
            if (energy > 0.5) targetSpeed *= 1.2 + (this.aggressiveness * 0.2);
            else if (energy < -0.5) targetSpeed *= 0.85;
            targetSpeed += (Math.random() - 0.5) * 2.0;

            const distRemaining = CONFIG.raceDistance - this.position.z;
            if (distRemaining < 100 && distRemaining > 0) targetSpeed *= 1.1;

            this.currentSpeed = targetSpeed;
            this.position.z += targetSpeed * delta;

            if (this.position.x > 26) this.position.x -= 5 * delta;
            else if (this.position.x < -26) this.position.x += 5 * delta;
            else this.position.x += Math.sin(time + this.id * 10) * 2 * delta;
        }

        this.mesh.position.x = this.position.x;
        this.mesh.position.z = this.position.z;

        const { leftLeg, rightLeg, leftArm, rightArm, headGroup, bodyGroup, extra } = this.rig;

        if (this.finished) {
            // Victory Monster Celebration Pose
            const cheer = Math.sin(time * 8 + this.id) * 0.35;
            this.mesh.position.y = Math.abs(Math.sin(time * 6 + this.id)) * 0.6;
            this.mesh.rotation.set(0, Math.sin(time * 3 + this.id) * 0.3, 0);
            leftLeg.rotation.x = 0;
            rightLeg.rotation.x = 0;
            leftArm.rotation.x = Math.PI - 0.4 + cheer;
            rightArm.rotation.x = Math.PI - 0.4 - cheer;
            headGroup.rotation.y = Math.sin(time * 5) * 0.25;
        } else {
            // Articulated Running / Shambling Cycle
            const cycleRate = isRacing ? (this.currentSpeed * 0.95) : 2.2;
            this.runCycle += delta * cycleRate;

            const legSwing = isRacing ? Math.sin(this.runCycle) * 0.95 : Math.sin(this.runCycle) * 0.12;
            const bounce = isRacing ? Math.abs(Math.cos(this.runCycle)) * 0.42 : Math.sin(this.runCycle) * 0.06;

            this.mesh.position.y = bounce;
            // Lean forward while sprinting
            this.mesh.rotation.x = isRacing ? 0.16 : 0;
            this.mesh.rotation.z = Math.cos(this.runCycle) * (isRacing ? 0.08 : 0.02);

            leftLeg.rotation.x = legSwing;
            rightLeg.rotation.x = -legSwing;

            if (this.ZombieArms) {
                // Classic outstretched zombie arms bobbing menacingly
                leftArm.rotation.x = -Math.PI / 2 + Math.sin(this.runCycle * 2) * 0.2;
                rightArm.rotation.x = -Math.PI / 2 + Math.cos(this.runCycle * 2) * 0.2;
            } else {
                leftArm.rotation.x = -legSwing * 0.85;
                rightArm.rotation.x = legSwing * 0.85;
            }

            headGroup.rotation.y = Math.sin(this.runCycle * 0.5) * 0.14;
            bodyGroup.rotation.y = -legSwing * 0.15;

            if (extra) {
                // Billowing vampire cape
                extra.rotation.x = 0.35 + Math.abs(Math.sin(this.runCycle)) * 0.35;
            }

            if (isRacing) {
                this.stepTimer += delta;
                if (this.stepTimer > 0.16) {
                    spawnFootstepMist(this.position.x, this.position.z - 1.2, 0.55 + Math.random() * 0.45);
                    this.stepTimer = 0;
                }
            }
        }
    }

    /** Clean up Three.js resources when this racer is retired */
    dispose() {
        this.mesh.traverse(child => {
            // Only dispose unique materials if not using cached GLB
            if (!this.usingGLB && child.isMesh && child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => m.dispose());
                } else {
                    child.material.dispose();
                }
            }
            // Dispose unique racer name sprite texture & material
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

    const spacing = 5.5;
    const leftBound = -((CONFIG.duckCount - 1) * spacing) / 2;

    for (let i = 0; i < CONFIG.duckCount; i++) {
        const x = leftBound + (i * spacing) + ((Math.random() - 0.5) * 1.2);
        const name = names[i % names.length] || `Zoombie ${i + 1}`;
        ducks.push(new Zoombie(i, name, x));
    }

    initLeaderboardDOM();
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

    camera.position.set(0, 15, -30);
    camera.lookAt(0, 0, 50);

    firstFinishTriggered = false;
    raceEnded = false;
    isRacing = false;
    isCountingDown = true;

    raceAudio.init();

    if (fadeInterval) clearInterval(fadeInterval);
    sfxRiver.currentTime = 0;
    sfxRiver.volume = 0.5;
    sfxRiver.play().catch(e => console.warn("Ambience sound failed:", e));

    runCountdownSequence();
});

function runCountdownSequence() {
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

    const timer = setInterval(() => {
        if (count > 0) {
            showNum(count, '#ffab40');
            raceAudio.playCountdown(count);
            count--;
        } else {
            clearInterval(timer);
            cd.innerHTML = "";
            cd.style.display = 'none';

            sfxStart.currentTime = 0;
            sfxStart.play().catch(e => console.warn(e));

            isCountingDown = false;
            isRacing = true;
        }
    }, 1000);
}

document.getElementById('restart-btn').addEventListener('click', () => {
    endScreen.classList.add('hidden');
    startScreen.classList.remove('hidden');

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
    isRacing = false;
    raceEnded = false;
    isCountingDown = false;
    firstFinishTriggered = false;

    progressFill.style.width = "0%";
    if (speedEl) speedEl.innerText = "0";
    camera.position.set(0, 15, -30);
    camera.lookAt(0, 0, 50);
    initDucks();
});

loadRaceData();
loadAboutInfo();

/**
 * CAMERA SYSTEM & DYNAMIC SHADOW TRACKING
 */
const clock = new THREE.Clock();
let camAngle = 0, camTimer = 0;
let cameraLookAt = new THREE.Vector3(0, 0, 50);
let cinematicTarget = new THREE.Vector3();
let cinematicLook = new THREE.Vector3();

const LB_SCREEN_FRACTION = 0.35;
const DUCK_PADDING = 8;
const MIN_CAM_DIST_Z = 20;
const MAX_CAM_DIST_Z = 50;

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

    // Move directional moonlight shadow frustum along with the pack for crisp shadows
    moonLight.position.set(45, 95, bounds.centerZ + 40);
    moonLight.target.position.set(0, 0, bounds.centerZ);
    moonLight.target.updateMatrixWorld();

    if (firstFinishTriggered) {
        const winner = ducks[0];
        const t = time - winnerFinishTime;

        const dist = 14 + (t * 3.0);
        const height = 5 + (t * 2.0);
        const angle = -0.2 + (t * 0.2);

        target.set(
            winner.position.x + Math.sin(angle) * dist,
            height,
            winner.position.z + Math.cos(angle) * dist
        );
        look.copy(winner.position).add(new THREE.Vector3(0, 2.5, 0));

    } else if (!isRacing) {
        const fitDist = calcDistanceForWidth(bounds.spreadX, availableFraction);
        target.set(bounds.centerX, Math.max(10, fitDist * 0.4), bounds.centerZ + fitDist);
        look.set(bounds.centerX, 1.5, bounds.centerZ);

    } else {
        const distRemaining = CONFIG.raceDistance - leadDuck.position.z;

        if (distRemaining <= 100) {
            const fitDist = calcDistanceForWidth(bounds.spreadX, availableFraction);
            target.set(bounds.centerX, 8, leadDuck.position.z - fitDist * 0.6);
            look.set(bounds.centerX, 2, leadDuck.position.z + 20);
        } else {
            const fitDist = calcDistanceForWidth(bounds.spreadX, availableFraction);

            if (camAngle === 0) {
                const camHeight = Math.max(6, fitDist * 0.25);
                target.set(bounds.centerX, camHeight, leadDuck.position.z + fitDist);
                look.set(bounds.centerX, 2, leadDuck.position.z);
            } else if (camAngle === 1) {
                const camHeight = Math.max(10, fitDist * 0.45);
                target.set(bounds.centerX, camHeight, bounds.centerZ + fitDist * 1.1);
                look.set(bounds.centerX, 1.5, bounds.centerZ);
            } else {
                const camHeight = Math.max(6, fitDist * 0.25);
                target.set(bounds.minX - fitDist * 0.4, camHeight, leadDuck.position.z + fitDist * 0.6);
                look.set(bounds.centerX + 5, 2, leadDuck.position.z);
            }
        }
    }

    camera.position.lerp(target, 3.5 * delta);
    cameraLookAt.lerp(look, 3.5 * delta);
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
    if (isRacing && !raceEnded && speedEl) {
        speedEl.innerText = Math.floor(leadDuck.baseSpeed * 2 + (Math.sin(time * 10) * 5));
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
    const flicker = 0.65 + Math.sin(time * 14) * 0.2 + Math.cos(time * 23) * 0.15;
    pumpkinGlowMat.emissiveIntensity = flicker;

    if (isRacing) updateFootstepMist(delta);
    updateFireworks();

    // Animate idle or racing Zoombies
    ducks.forEach(d => {
        d.update(delta, time);
        if (isRacing && !d.finished && d.position.z >= CONFIG.raceDistance) {
            d.finished = true;
            d.finishTime = time;
        }
    });

    if (isRacing) {
        // Racer collision avoidance
        for (let i = 0; i < ducks.length; i++) {
            for (let j = i + 1; j < ducks.length; j++) {
                const d1 = ducks[i], d2 = ducks[j];
                const dx = d1.position.x - d2.position.x;
                const dz = d1.position.z - d2.position.z;
                const distSq = dx * dx + dz * dz;
                if (distSq < 20.0) {
                    const dist = Math.sqrt(distSq);
                    if (dist < 0.001) { d1.position.x += 0.1; continue; }
                    const overlap = 4.5 - dist;
                    const push = overlap * 0.55;
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

        if (ducks.every(d => d.finished) && !raceEnded) {
            raceEnded = true;
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
    camera.fov = 50;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    resizeCanvas();
});

animate();