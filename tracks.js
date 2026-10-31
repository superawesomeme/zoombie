/* Original low-poly scenery. Static, chunked instances; no textures, lights or animation. */
const SPOOKY_TRACKS = [
    { id: 'graveyard', name: 'Moonstone Cemetery', waves: [[52, 1800, 0], [12, 720, .4]], stone: 0x77788d, roof: 0x393151, glow: 0x9effdb, ground: 0x9699ad, road: 0xbbb7cf },
    { id: 'village', name: 'Crooked Lantern Village', waves: [[64, 2300, .8], [14, 950, 0]], stone: 0x977b91, roof: 0x522943, glow: 0xffc36b, ground: 0xa7a0a8, road: 0xc9b5c6 },
    { id: 'pumpkin', name: 'Harvest Moon Hollow', waves: [[36, 1250, .2], [20, 650, 1]], stone: 0xa06b41, roof: 0x4b354a, glow: 0xffa144, ground: 0xb5a17b, road: 0xc7b7a5 },
    { id: 'castle', name: 'Count’s Castle Causeway', waves: [[76, 2700, 0], [12, 1100, 1]], stone: 0x777d9f, roof: 0x463174, glow: 0xe4b8ff, ground: 0x979eb8, road: 0xb9c2df },
    { id: 'crystal', name: 'Spectral Crystal Ravine', waves: [[62, 1900, 1.3], [18, 780, 0]], stone: 0x505d83, roof: 0x3b798f, glow: 0x7ce8f5, ground: 0x7cabb2, road: 0xa6c9d7 },
    { id: 'witch', name: 'Witchlight Woods', waves: [[46, 1450, .6], [16, 580, .2]], stone: 0x77735f, roof: 0x68365e, glow: 0xc1ef87, ground: 0x98b699, road: 0xb9c7b8 },
    { id: 'dungeon', name: 'Ember Crypt Ruins', waves: [[66, 2100, 2], [22, 900, .5]], stone: 0x8a6470, roof: 0x492d51, glow: 0xff9966, ground: 0xb18c9b, road: 0xcbb3b5 },
    { id: 'carnival', name: 'Lost Souls Moonfair', waves: [[54, 1650, 1], [24, 1000, 2]], stone: 0x9a749b, roof: 0x754d9e, glow: 0xffd87a, ground: 0xb6a0b9, road: 0xd0bdd9 }
];

// Quintic entrance/exit envelope keeps the grid and finish straight, including derivatives.
function createSpookyProfile(track) {
    return { id: track.id, name: track.name, getPoint(z) {
        let e = 1, de = 0, dde = 0;
        const edge = z < 520 ? (z - 180) / 340 : (4080 - z) / 330;
        if (z < 520 || z > 3750) {
            const u = Math.max(0, Math.min(1, edge));
            const rate = z < 520 ? 1 / 340 : -1 / 330;
            e = u * u * u * (10 + u * (-15 + 6 * u));
            de = 30 * u * u * (1 - u) * (1 - u) * rate;
            dde = 60 * u * (1 - u) * (1 - 2 * u) * rate * rate;
        }
        let x = 0, dx = 0, ddx = 0;
        for (const [amplitude, wavelength, phase] of track.waves) {
            const k = 2 * Math.PI / wavelength, a = (z - 200) * k + phase;
            x += amplitude * Math.sin(a);
            dx += amplitude * k * Math.cos(a);
            ddx -= amplitude * k * k * Math.sin(a);
        }
        const slope = de * x + e * dx, norm = Math.hypot(slope, 1);
        const curvature = dde * x + 2 * de * dx + e * ddx;
        return { x: e * x, y: 0, z, dx: slope, d2x: curvature, heading: Math.atan(slope),
            tangent: new THREE.Vector3(slope / norm, 0, 1 / norm),
            right: new THREE.Vector3(1 / norm, 0, -slope / norm),
            normal: new THREE.Vector3(-1 / norm, 0, slope / norm), curvature };
    } };
}

// A persisted assignment is shared with the projector via the existing race storage.
function resolveSpookyTrack(race) {
    const builtIn = /^race_([1-8])$/.exec(race && race.id || '');
    if (builtIn) return SPOOKY_TRACKS[Number(builtIn[1]) - 1];
    let track = SPOOKY_TRACKS.find(t => t.id === (race && race.sceneryMap));
    if (!track) {
        if (race && ensureCustomSceneryMap(race)) saveRaceData();
        track = SPOOKY_TRACKS.find(t => t.id === (race && race.sceneryMap)) || SPOOKY_TRACKS[0];
    }
    return track;
}

class SpookyScenery {
    constructor(parent) {
        this.group = new THREE.Group();
        parent.add(this.group);
        this.geometries = {
            box: new THREE.BoxGeometry(1, 1, 1),
            tower: new THREE.CylinderGeometry(.46, .55, 1, 8),
            roof: new THREE.ConeGeometry(.75, 1, 6),
            gem: new THREE.OctahedronGeometry(.65),
            orb: new THREE.SphereGeometry(.5, 8, 6)
        };
        this.solid = new THREE.MeshStandardMaterial({ roughness: .92, metalness: 0 });
        this.luminous = new THREE.MeshBasicMaterial();
        this.dummy = new THREE.Object3D();
    }
    build(track, profile, distance) {
        // Instanced meshes own buffers; geometry/materials are shared for the page lifetime.
        this.group.children.forEach(mesh => { mesh.dispose(); if (mesh.userData.ownedGeometry) mesh.geometry.dispose(); });
        this.group.clear();
        const buckets = new Map();
        let seed = (SPOOKY_TRACKS.indexOf(track) + 1) * 7919;
        const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
        const add = (shape, x, y, z, sx, sy, sz, color, lit = false, tilt = 0) => {
            // Separate spatial chunks allow normal frustum culling of static instances.
            const key = `${Math.floor(z / 600)}:${shape}:${lit}`;
            if (!buckets.has(key)) buckets.set(key, { shape, lit, items: [] });
            buckets.get(key).items.push({ x, y, z, sx, sy, sz, color, tilt });
        };
        for (let z = 120; z < distance - 100; z += 140) {
            const pt = profile.getPoint(z);
            for (const side of [-1, 1]) {
                // Outside the road, advertising sidings and existing hazard corridor.
                const offset = side * (144 + random() * 48);
                const x = pt.x + offset * pt.right.x, wz = z + offset * pt.right.z;
                const box = (dx, y, dz, sx, sy, sz, color = track.stone, lit = false) => add('box', x + dx, y, wz + dz, sx, sy, sz, color, lit);
                const tower = (dx, h, radius = 15) => {
                    add('tower', x + dx, h / 2, wz, radius, h, radius, track.stone);
                    add('roof', x + dx, h + 10, wz, radius * 1.25, 24, radius * 1.25, track.roof);
                    box(dx, h * .7, -radius * .53, 3, 6, .6, track.glow, true);
                };
                const house = (h = 22) => {
                    box(0, h / 2, 0, 24, h, 20);
                    add('roof', x, h + 9, wz, 29, 23, 25, track.roof);
                    for (const dx of [-6, 6]) box(dx, h * .65, -10.2, 4, 5, .5, track.glow, true);
                    box(0, 5, -10.3, 5, 10, .5, 0x30283e);
                };
                switch (track.id) {
                    case 'graveyard':
                        if (Math.floor(z / 140) % 4 === 0) {
                            house(24); tower(-21, 40, 12);
                        } else for (let j = -1; j <= 1; j++) {
                            box(j * 16, 4, 0, 11, 8, 15, 0x565166);
                            box(j * 16, 11, 5, 7, 17, 3);
                            add('orb', x + j * 16, 19, wz + 5, 8, 8, 3, track.stone);
                            box(j * 16, 14, 3.3, 1, 5, .4, track.glow, true);
                            box(j * 16, 15, 3.2, 4, 1, .4, track.glow, true);
                        }
                        break;
                    case 'village': house(20 + random() * 18); box(19, 8, 0, 1.5, 16, 1.5); box(19, 17, 0, 5, 6, 5, track.glow, true); break;
                    case 'pumpkin':
                        if (Math.floor(z / 140) % 4 === 0) house(28);
                        for (let j = 0; j < 5; j++) {
                            const px = x + (random() - .5) * 55, pz = wz + (random() - .5) * 55, s = 8 + random() * 8;
                            add('orb', px, s * .43, pz, s, s * .85, s, 0xe58b38);
                            add('box', px, s * .9, pz, 1.5, 4, 1.5, 0x63693e);
                            for (const dx of [-1.8, 1.8]) add('gem', px + dx, s * .5, pz - s * .45, 2, 2, 1, track.glow, true);
                        }
                        box(0, 5, 30, 65, 2, 2); for (const dx of [-30, 0, 30]) box(dx, 5, 30, 2, 10, 2);
                        break;
                    case 'castle':
                        tower(-24, 44); tower(24, 58); box(0, 14, 0, 40, 28, 14);
                        for (let j = -2; j <= 2; j++) box(j * 8, 30, 0, 5, 6, 15);
                        box(0, 12, -7.2, 10, 24, .5, 0x30283e); break;
                    case 'crystal':
                        for (let j = 0; j < 5; j++) {
                            const h = 18 + random() * 38;
                            add('gem', x + (j - 2) * 13, h * .4, wz + random() * 25, 13, h, 14, j % 2 ? track.roof : track.glow, j === 2, (random() - .5) * .5);
                        } break;
                    case 'witch':
                        add('tower', x, 10, wz, 4, 20, 4, 0x675047);
                        add('orb', x, 24, wz, 35, 25, 30, 0x665082);
                        for (let j = -1; j <= 1; j++) {
                            add('tower', x + j * 19, 4, wz - 15, 3, 8, 3, track.stone);
                            add('orb', x + j * 19, 10, wz - 15, 17, 9, 17, track.roof);
                            add('orb', x + j * 19 - 2, 12, wz - 21, 3, 2, 2, track.glow, true);
                        }
                        if (Math.floor(z / 140) % 5 === 0) house(20); break;
                    case 'dungeon':
                        for (const dx of [-22, 22]) {
                            box(dx, 16, 0, 9, 32, 12); box(dx, 33, 0, 13, 4, 16);
                            box(dx, 17, -6.3, 3, 8, 1, track.glow, true);
                        }
                        box(0, 35, 0, 54, 7, 14);
                        for (let j = 0; j < 3; j++) box((random() - .5) * 55, 3, -20, 9, 6, 10);
                        break;
                    case 'carnival':
                        box(0, 9, 0, 28, 18, 22);
                        add('roof', x, 28, wz, 35, 28, 35, track.roof);
                        for (let j = -2; j <= 2; j++) {
                            box(j * 5, 11, -11.2, 2.5, 14, .5, j % 2 ? track.glow : 0xd19ec2, true);
                            add('orb', x + j * 9, 26 - Math.abs(j) * 2, wz - 17, 3, 3, 3, track.glow, true);
                        }
                        box(0, 45, 0, 1, 12, 1); box(4, 49, 0, 8, 5, 1, track.glow, true); break;
                }
            }
        }
        const color = new THREE.Color();
        for (const { shape, lit, items } of buckets.values()) {
            const mesh = new THREE.InstancedMesh(this.geometries[shape], lit ? this.luminous : this.solid, items.length);
            items.forEach((item, i) => {
                this.dummy.position.set(item.x, item.y, item.z);
                this.dummy.rotation.set(0, 0, item.tilt);
                this.dummy.scale.set(item.sx, item.sy, item.sz);
                this.dummy.updateMatrix(); mesh.setMatrixAt(i, this.dummy.matrix);
                mesh.setColorAt(i, color.setHex(item.color).convertSRGBToLinear());
            });
            // r128 culls instances using the shared geometry bounds, not instance bounds.
            // Compute per-batch bounds without changing the shared geometry.
            const bounds = new THREE.Box3();
            items.forEach(v => bounds.expandByPoint(new THREE.Vector3(v.x, v.y, v.z)));
            const center = bounds.getCenter(new THREE.Vector3());
            mesh.position.copy(center);
            items.forEach((v, i) => {
                this.dummy.position.set(v.x - center.x, v.y - center.y, v.z - center.z);
                this.dummy.rotation.set(0, 0, v.tilt);
                this.dummy.scale.set(v.sx, v.sy, v.sz); this.dummy.updateMatrix(); mesh.setMatrixAt(i, this.dummy.matrix);
            });
            // Geometry clone only duplicates a tiny primitive; supplies correct r128 culling sphere.
            mesh.geometry = this.geometries[shape].clone();
            mesh.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), bounds.getSize(new THREE.Vector3()).length() / 2 + 100);
            mesh.userData.ownedGeometry = true;
            mesh.frustumCulled = true; // r128 disables this by default on InstancedMesh.
            mesh.instanceMatrix.needsUpdate = true;
            mesh.instanceColor.needsUpdate = true;
            this.group.add(mesh);
        }
        this.group.userData.track = track.id;
    }
}

// Render once on selection, never in the animation loop.
function updateCoursePreview(race) {
    const host = document.getElementById('course-preview');
    if (!host) return;
    const track = resolveSpookyTrack(race), profile = createSpookyProfile(track);
    const points = [];
    for (let i = 0; i <= 84; i++) points.push(`${12 + i * 2.8},${30 - profile.getPoint(i * 50).x * .22}`);
    const line = points.join(' '), tint = '#' + track.glow.toString(16).padStart(6, '0');
    host.innerHTML = `<svg viewBox="0 0 260 60" role="img" aria-label="Course route from start to finish"><polyline points="${line}" fill="none" stroke="${tint}" stroke-opacity=".12" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/><polyline points="${line}" fill="none" stroke="${tint}" stroke-width="3" stroke-linecap="round"/><circle cx="12" cy="30" r="4" fill="${tint}"/><circle cx="247.2" cy="30" r="4" fill="#fff"/></svg><div><span class="course-eyebrow">4.2 KM • POINT TO POINT</span><strong></strong></div>`;
    host.querySelector('strong').textContent = track.name;
}
