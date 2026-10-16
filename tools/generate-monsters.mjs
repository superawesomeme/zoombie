/**
 * Zoombie Racing Simulator – Monster GLB Generator (v2 Cartoon Platformer Edition)
 * ================================================================================
 * Produces 8 bright, comical, family-friendly 3D cartoon monster GLB files in ../models/
 * using pure Node.js (zero external npm dependencies).
 *
 * Run with:
 *   node tools/generate-monsters.mjs
 */

import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '../models');
mkdirSync(OUT_DIR, { recursive: true });

const PI = Math.PI;
const cos = Math.cos, sin = Math.sin, sqrt = Math.sqrt;

function norm3(x, y, z) {
    const l = sqrt(x * x + y * y + z * z) || 1;
    return [x / l, y / l, z / l];
}

// ─────────────────────────────────────────────────────────────────────────────
// GEOMETRY BUILDERS
// ─────────────────────────────────────────────────────────────────────────────

function buildSphere(r, latSegs = 16, lonSegs = 16) {
    const positions = [], normals = [], uvs = [], indices = [];
    for (let lat = 0; lat <= latSegs; lat++) {
        const theta = lat * PI / latSegs;
        const sinT = sin(theta), cosT = cos(theta);
        for (let lon = 0; lon <= lonSegs; lon++) {
            const phi = lon * 2 * PI / lonSegs;
            const x = cos(phi) * sinT, y = cosT, z = sin(phi) * sinT;
            positions.push(r * x, r * y, r * z);
            normals.push(x, y, z);
            uvs.push(lon / lonSegs, lat / latSegs);
        }
    }
    for (let lat = 0; lat < latSegs; lat++) {
        for (let lon = 0; lon < lonSegs; lon++) {
            const a = lat * (lonSegs + 1) + lon;
            const b = a + lonSegs + 1;
            indices.push(a, b, a + 1, b, b + 1, a + 1);
        }
    }
    return { positions, normals, indices, uvs };
}

function buildEllipsoid(rx, ry, rz, latSegs = 16, lonSegs = 16) {
    const g = buildSphere(1, latSegs, lonSegs);
    const positions = [], normals = [];
    for (let i = 0; i < g.positions.length; i += 3) {
        const nx = g.normals[i], ny = g.normals[i + 1], nz = g.normals[i + 2];
        positions.push(g.positions[i] * rx, g.positions[i + 1] * ry, g.positions[i + 2] * rz);
        const [nnx, nny, nnz] = norm3(nx / (rx * rx), ny / (ry * ry), nz / (rz * rz));
        normals.push(nnx, nny, nnz);
    }
    return { positions, normals, indices: g.indices, uvs: g.uvs };
}

/** Superellipsoid (rounded box/squircle) for soft cartoon forms */
function buildRoundedForm(rx, ry, rz, power = 0.65, latSegs = 16, lonSegs = 16) {
    const positions = [], normals = [], uvs = [], indices = [];
    const spow = (v, p) => Math.sign(v) * Math.pow(Math.abs(v), p);
    for (let lat = 0; lat <= latSegs; lat++) {
        const theta = (lat * PI / latSegs) - PI / 2;
        const ct = cos(theta), st = sin(theta);
        for (let lon = 0; lon <= lonSegs; lon++) {
            const phi = (lon * 2 * PI / lonSegs) - PI;
            const cp = cos(phi), sp = sin(phi);
            const x = rx * spow(ct, power) * spow(cp, power);
            const y = ry * spow(st, power);
            const z = rz * spow(ct, power) * spow(sp, power);
            positions.push(x, y, z);
            const [nx, ny, nz] = norm3(x / (rx * rx), y / (ry * ry), z / (rz * rz));
            normals.push(nx, ny, nz);
            uvs.push(lon / lonSegs, lat / latSegs);
        }
    }
    for (let lat = 0; lat < latSegs; lat++) {
        for (let lon = 0; lon < lonSegs; lon++) {
            const a = lat * (lonSegs + 1) + lon;
            const b = a + lonSegs + 1;
            indices.push(a, b, a + 1, b, b + 1, a + 1);
        }
    }
    return { positions, normals, indices, uvs };
}

function buildCylinder(rBot, rTop, height, radSegs = 14, openEnded = false) {
    const positions = [], normals = [], uvs = [], indices = [];
    const slope = (rBot - rTop) / (height || 1);
    const nY = slope / sqrt(1 + slope * slope);
    const nR = 1 / sqrt(1 + slope * slope);

    for (let y = 0; y <= 1; y++) {
        const py = y * height;
        const r = y === 0 ? rBot : rTop;
        for (let i = 0; i <= radSegs; i++) {
            const phi = i * 2 * PI / radSegs;
            const cx = cos(phi), cz = sin(phi);
            positions.push(r * cx, py, r * cz);
            normals.push(nR * cx, nY, nR * cz);
            uvs.push(i / radSegs, y);
        }
    }
    for (let i = 0; i < radSegs; i++) {
        const a = i, b = i + radSegs + 1;
        indices.push(a, b + 1, a + 1, a, b, b + 1);
    }

    if (!openEnded) {
        const bCenter = positions.length / 3;
        positions.push(0, 0, 0); normals.push(0, -1, 0); uvs.push(0.5, 0.5);
        for (let i = 0; i <= radSegs; i++) {
            const phi = i * 2 * PI / radSegs;
            positions.push(rBot * cos(phi), 0, rBot * sin(phi));
            normals.push(0, -1, 0); uvs.push(0.5 + 0.5 * cos(phi), 0.5 + 0.5 * sin(phi));
        }
        for (let i = 0; i < radSegs; i++) {
            indices.push(bCenter, bCenter + i + 2, bCenter + i + 1);
        }

        const tCenter = positions.length / 3;
        positions.push(0, height, 0); normals.push(0, 1, 0); uvs.push(0.5, 0.5);
        for (let i = 0; i <= radSegs; i++) {
            const phi = i * 2 * PI / radSegs;
            positions.push(rTop * cos(phi), height, rTop * sin(phi));
            normals.push(0, 1, 0); uvs.push(0.5 + 0.5 * cos(phi), 0.5 + 0.5 * sin(phi));
        }
        for (let i = 0; i < radSegs; i++) {
            indices.push(tCenter, tCenter + i + 1, tCenter + i + 2);
        }
    }
    return { positions, normals, indices, uvs };
}

function buildCone(r, height, radSegs = 12) {
    return buildCylinder(r, 0.01, height, radSegs);
}

/** Curved Dish / Cape / Bandage Strip with subtle curvature */
function buildCurvedCape(wTop, wBot, height, curveZ = -0.25, wSegs = 6, hSegs = 8) {
    const positions = [], normals = [], uvs = [], indices = [];
    for (let iy = 0; iy <= hSegs; iy++) {
        const v = iy / hSegs;
        const w = wTop + (wBot - wTop) * v;
        const y = -v * height;
        for (let ix = 0; ix <= wSegs; ix++) {
            const u = ix / wSegs;
            const nx = (u - 0.5) * 2;
            const x = (u - 0.5) * w;
            const z = (1 - nx * nx) * curveZ * (0.4 + 0.6 * v) - v * v * 0.25;
            positions.push(x, y, z);
            normals.push(0, 0.15, 0.98);
            uvs.push(u, v);
        }
    }
    for (let iy = 0; iy < hSegs; iy++) {
        for (let ix = 0; ix < wSegs; ix++) {
            const a = iy * (wSegs + 1) + ix;
            const b = a + wSegs + 1;
            indices.push(a, b, a + 1, b, b + 1, a + 1);
            indices.push(a + 1, b, a, a + 1, b + 1, b);
        }
    }
    return { positions, normals, indices, uvs };
}

// ─────────────────────────────────────────────────────────────────────────────
// TRANSFORM HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function translateGeo(geo, tx, ty, tz) {
    for (let i = 0; i < geo.positions.length; i += 3) {
        geo.positions[i] += tx;
        geo.positions[i + 1] += ty;
        geo.positions[i + 2] += tz;
    }
    return geo;
}

function rotateGeoX(geo, angle) {
    const c = cos(angle), s = sin(angle);
    for (let i = 0; i < geo.positions.length; i += 3) {
        const y = geo.positions[i + 1], z = geo.positions[i + 2];
        geo.positions[i + 1] = c * y - s * z;
        geo.positions[i + 2] = s * y + c * z;
    }
    for (let i = 0; i < geo.normals.length; i += 3) {
        const y = geo.normals[i + 1], z = geo.normals[i + 2];
        geo.normals[i + 1] = c * y - s * z;
        geo.normals[i + 2] = s * y + c * z;
    }
    return geo;
}

function rotateGeoY(geo, angle) {
    const c = cos(angle), s = sin(angle);
    for (let i = 0; i < geo.positions.length; i += 3) {
        const x = geo.positions[i], z = geo.positions[i + 2];
        geo.positions[i] = c * x + s * z;
        geo.positions[i + 2] = -s * x + c * z;
    }
    for (let i = 0; i < geo.normals.length; i += 3) {
        const x = geo.normals[i], z = geo.normals[i + 2];
        geo.normals[i] = c * x + s * z;
        geo.normals[i + 2] = -s * x + c * z;
    }
    return geo;
}

function rotateGeoZ(geo, angle) {
    const c = cos(angle), s = sin(angle);
    for (let i = 0; i < geo.positions.length; i += 3) {
        const x = geo.positions[i], y = geo.positions[i + 1];
        geo.positions[i] = c * x - s * y;
        geo.positions[i + 1] = s * x + c * y;
    }
    for (let i = 0; i < geo.normals.length; i += 3) {
        const x = geo.normals[i], y = geo.normals[i + 1];
        geo.normals[i] = c * x - s * y;
        geo.normals[i + 1] = s * x + c * y;
    }
    return geo;
}

function mergeGeos(...geos) {
    const out = { positions: [], normals: [], uvs: [], indices: [] };
    let offset = 0;
    for (const g of geos) {
        if (!g) continue;
        out.positions.push(...g.positions);
        out.normals.push(...g.normals);
        out.uvs.push(...g.uvs);
        for (const idx of g.indices) out.indices.push(idx + offset);
        offset += g.positions.length / 3;
    }
    return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// CARTOON LIMB & FEATURE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Expressive cartoon eyes with big white sclera, colored iris/glow and dark pupil */
function buildCartoonEyes(sepX, y, z, rx = 0.24, ry = 0.28, browTilt = 0.22) {
    const scleraL = translateGeo(buildEllipsoid(rx, ry, 0.14, 12, 12), -sepX, y, z);
    const scleraR = translateGeo(buildEllipsoid(rx, ry, 0.14, 12, 12), sepX, y, z);

    const pupilL = translateGeo(buildEllipsoid(rx * 0.52, ry * 0.55, 0.09, 10, 10), -sepX * 0.94, y, z + 0.11);
    const pupilR = translateGeo(buildEllipsoid(rx * 0.52, ry * 0.55, 0.09, 10, 10), sepX * 0.94, y, z + 0.11);

    const shineL = translateGeo(buildEllipsoid(rx * 0.20, ry * 0.20, 0.06, 6, 6), -sepX * 0.88 + 0.05, y + 0.07, z + 0.16);
    const shineR = translateGeo(buildEllipsoid(rx * 0.20, ry * 0.20, 0.06, 6, 6), sepX * 0.88 + 0.05, y + 0.07, z + 0.16);

    const browL = buildEllipsoid(rx * 1.35, 0.09, 0.14, 8, 8);
    rotateGeoZ(browL, -browTilt);
    translateGeo(browL, -sepX, y + ry + 0.08, z + 0.06);

    const browR = buildEllipsoid(rx * 1.35, 0.09, 0.14, 8, 8);
    rotateGeoZ(browR, browTilt);
    translateGeo(browR, sepX, y + ry + 0.08, z + 0.06);

    return {
        sclera: mergeGeos(scleraL, scleraR, shineL, shineR),
        pupils: mergeGeos(pupilL, pupilR),
        brows: mergeGeos(browL, browR)
    };
}

/** Cartoon arm with chunky rounded sleeve/forearm and oversized mitten hand */
function makeCartoonArm(len = 1.45, rUpper = 0.27, rLower = 0.23, handScale = 1.0) {
    const shoulder = buildEllipsoid(rUpper * 1.15, rUpper * 1.15, rUpper * 1.15, 10, 10);
    const upper = buildCylinder(rLower, rUpper, len * 0.52, 10);
    translateGeo(upper, 0, -len * 0.52, 0);
    const elbow = buildEllipsoid(rLower * 1.05, rLower * 1.05, rLower * 1.05, 8, 8);
    translateGeo(elbow, 0, -len * 0.52, 0);
    const lower = buildCylinder(rLower * 0.95, rLower, len * 0.48, 10);
    translateGeo(lower, 0, -len, 0);

    const palm = buildEllipsoid(0.32 * handScale, 0.30 * handScale, 0.26 * handScale, 10, 10);
    translateGeo(palm, 0, -len - 0.12 * handScale, 0.04);
    const thumb = buildEllipsoid(0.14 * handScale, 0.18 * handScale, 0.14 * handScale, 8, 8);
    rotateGeoZ(thumb, 0.5);
    translateGeo(thumb, 0.24 * handScale, -len - 0.06 * handScale, 0.14);

    return {
        sleeve: mergeGeos(shoulder, upper, elbow, lower),
        hand: mergeGeos(palm, thumb)
    };
}

/** Cartoon leg with chunky trousers and oversized platformer shoe (bottom at -len) */
function makeCartoonLeg(len = 1.55, rThigh = 0.32, rCalf = 0.25, shoeScale = 1.0) {
    const hip = buildEllipsoid(rThigh, rThigh, rThigh, 8, 8);
    const thigh = buildCylinder(rCalf, rThigh, len * 0.52, 10);
    translateGeo(thigh, 0, -len * 0.52, 0);
    const calf = buildCylinder(rCalf * 0.88, rCalf, len * 0.36, 10);
    translateGeo(calf, 0, -len * 0.88, 0);

    // Oversized rounded platformer boot/shoe resting cleanly at y = -len
    const shoeRear = buildEllipsoid(0.32 * shoeScale, 0.24 * shoeScale, 0.32 * shoeScale, 10, 10);
    translateGeo(shoeRear, 0, -len + 0.22 * shoeScale, 0.02);
    const shoeToe = buildEllipsoid(0.36 * shoeScale, 0.25 * shoeScale, 0.44 * shoeScale, 12, 12);
    translateGeo(shoeToe, 0, -len + 0.22 * shoeScale, 0.28 * shoeScale);
    const sole = buildCylinder(0.36 * shoeScale, 0.36 * shoeScale, 0.08 * shoeScale, 12);
    scaleGeoZ(sole, 1.45);
    translateGeo(sole, 0, -len, 0.16 * shoeScale);

    return {
        leg: mergeGeos(hip, thigh, calf),
        shoe: mergeGeos(shoeRear, shoeToe, sole)
    };
}

function scaleGeoZ(geo, sz) {
    for (let i = 0; i < geo.positions.length; i += 3) {
        geo.positions[i + 2] *= sz;
    }
    return geo;
}

// ─────────────────────────────────────────────────────────────────────────────
// GLB BINARY ENCODER
// ─────────────────────────────────────────────────────────────────────────────
function f32buf(arr) {
    const b = Buffer.allocUnsafe(arr.length * 4);
    for (let i = 0; i < arr.length; i++) b.writeFloatLE(arr[i], i * 4);
    return b;
}
function u16buf(arr) {
    const b = Buffer.allocUnsafe(arr.length * 2);
    for (let i = 0; i < arr.length; i++) b.writeUInt16LE(arr[i], i * 2);
    return b;
}
function u32buf(arr) {
    const b = Buffer.allocUnsafe(arr.length * 4);
    for (let i = 0; i < arr.length; i++) b.writeUInt32LE(arr[i], i * 4);
    return b;
}
function pad4(buf) {
    const rem = buf.length % 4;
    if (rem === 0) return buf;
    return Buffer.concat([buf, Buffer.alloc(4 - rem, 0x20)]);
}

function buildGLB(sceneDesc) {
    const { materials, nodes } = sceneDesc;
    const bufferViews = [], accessors = [], binaryParts = [];
    let byteOffset = 0;

    function addAccessor(data, compType, type, target) {
        const buf = (compType === 5123) ? u16buf(data)
                  : (compType === 5125) ? u32buf(data)
                  : f32buf(data);
        const paddedBuf = pad4(buf);
        binaryParts.push(paddedBuf);

        const bvIdx = bufferViews.length;
        bufferViews.push({
            buffer: 0,
            byteOffset,
            byteLength: buf.length,
            target: target || undefined
        });
        byteOffset += paddedBuf.length;

        const compCount = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[type];
        const count = data.length / compCount;

        let min, max;
        if (type === 'VEC3' && target !== 34963) {
            min = [Infinity, Infinity, Infinity];
            max = [-Infinity, -Infinity, -Infinity];
            for (let i = 0; i < data.length; i += 3) {
                for (let j = 0; j < 3; j++) {
                    if (data[i + j] < min[j]) min[j] = data[i + j];
                    if (data[i + j] > max[j]) max[j] = data[i + j];
                }
            }
        }

        const acc = { bufferView: bvIdx, byteOffset: 0, componentType: compType, count, type };
        if (min) { acc.min = min; acc.max = max; }
        accessors.push(acc);
        return accessors.length - 1;
    }

    function buildMeshForNode(meshItems) {
        const primitives = [];
        for (const { geo, materialIndex } of meshItems) {
            if (!geo || !geo.positions.length) continue;
            const useU32 = geo.positions.length / 3 > 65535;
            const posAcc = addAccessor(geo.positions, 5126, 'VEC3', 34962);
            const normAcc = addAccessor(geo.normals, 5126, 'VEC3', 34962);
            const uvAcc = addAccessor(geo.uvs, 5126, 'VEC2', 34962);
            const idxAcc = addAccessor(geo.indices, useU32 ? 5125 : 5123, 'SCALAR', 34963);
            primitives.push({
                attributes: { POSITION: posAcc, NORMAL: normAcc, TEXCOORD_0: uvAcc },
                indices: idxAcc,
                material: materialIndex
            });
        }
        return primitives.length ? { primitives } : null;
    }

    const gltfNodes = [], gltfMeshes = [];

    function collectNode(nodeDef) {
        const myIdx = gltfNodes.length;
        gltfNodes.push(null);

        const gltfNode = { name: nodeDef.name };
        if (nodeDef.translation) gltfNode.translation = nodeDef.translation;
        if (nodeDef.rotation)    gltfNode.rotation    = nodeDef.rotation;
        if (nodeDef.scale)       gltfNode.scale        = nodeDef.scale;

        if (nodeDef.meshes && nodeDef.meshes.length > 0) {
            const mesh = buildMeshForNode(nodeDef.meshes);
            if (mesh) {
                gltfNode.mesh = gltfMeshes.length;
                gltfMeshes.push(mesh);
            }
        }

        if (nodeDef.children && nodeDef.children.length > 0) {
            gltfNode.children = [];
            for (const childDef of nodeDef.children) {
                const childIdx = gltfNodes.length;
                gltfNode.children.push(childIdx);
                collectNode(childDef);
            }
        }

        gltfNodes[myIdx] = gltfNode;
        return myIdx;
    }

    const rootIndices = [];
    for (const nodeDef of nodes) {
        rootIndices.push(collectNode(nodeDef));
    }

    const binBuffer = binaryParts.length ? Buffer.concat(binaryParts) : Buffer.alloc(4);

    const gltfMaterials = materials.map(m => {
        const mat = {
            name: m.name,
            pbrMetallicRoughness: {
                baseColorFactor: m.baseColorFactor || [1, 1, 1, 1],
                metallicFactor: m.metalness ?? 0.0,
                roughnessFactor: m.roughness ?? 0.55
            },
            doubleSided: m.doubleSided ?? false
        };
        if (m.emissiveFactor && m.emissiveFactor.some(v => v > 0)) {
            mat.emissiveFactor = m.emissiveFactor;
        }
        if (m.alphaMode) {
            mat.alphaMode = m.alphaMode;
        }
        return mat;
    });

    const gltfJson = {
        asset: { version: '2.0', generator: 'ZoombieGLBGenerator/2.0' },
        scene: 0,
        scenes: [{ name: 'Scene', nodes: rootIndices }],
        nodes: gltfNodes,
        meshes: gltfMeshes,
        materials: gltfMaterials,
        accessors,
        bufferViews,
        buffers: [{ byteLength: binBuffer.length }]
    };

    const jsonBuf = pad4(Buffer.from(JSON.stringify(gltfJson), 'utf8'));
    const binBuf = pad4(binBuffer);
    const totalLen = 12 + 8 + jsonBuf.length + 8 + binBuf.length;

    const header = Buffer.allocUnsafe(12);
    header.writeUInt32LE(0x46546C67, 0);
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(totalLen, 8);

    const jsonChunkHeader = Buffer.allocUnsafe(8);
    jsonChunkHeader.writeUInt32LE(jsonBuf.length, 0);
    jsonChunkHeader.writeUInt32LE(0x4E4F534A, 4);

    const binChunkHeader = Buffer.allocUnsafe(8);
    binChunkHeader.writeUInt32LE(binBuf.length, 0);
    binChunkHeader.writeUInt32LE(0x004E4942, 4);

    return Buffer.concat([header, jsonChunkHeader, jsonBuf, binChunkHeader, binBuf]);
}

function hex2rgba(hex, a = 1) {
    return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255, a];
}

// ─────────────────────────────────────────────────────────────────────────────
// 8 STYLIZED CARTOON MONSTER BUILDERS
// ─────────────────────────────────────────────────────────────────────────────

// 0. VAMPIRE (Red #F42941)
function buildVampire() {
    const mats = [
        { name: 'CrimsonVest', baseColorFactor: hex2rgba(0xF42941), roughness: 0.45, metalness: 0.05, emissiveFactor: [0.12, 0.01, 0.02] }, // 0
        { name: 'PlumSuit',    baseColorFactor: hex2rgba(0x2A1B4E), roughness: 0.55, metalness: 0.05 }, // 1
        { name: 'PaleSkin',    baseColorFactor: hex2rgba(0xF5EEFF), roughness: 0.50, metalness: 0.0, emissiveFactor: [0.06, 0.05, 0.08] }, // 2
        { name: 'HairDark',    baseColorFactor: hex2rgba(0x160D29), roughness: 0.40, metalness: 0.1 }, // 3
        { name: 'WhiteEye',    baseColorFactor: [1.0, 1.0, 1.0, 1], roughness: 0.20, metalness: 0.0, emissiveFactor: [0.15, 0.15, 0.15] }, // 4
        { name: 'RedPupil',    baseColorFactor: hex2rgba(0xFF1744), roughness: 0.20, metalness: 0.0, emissiveFactor: [0.55, 0.02, 0.08] }, // 5
        { name: 'GoldMedallion', baseColorFactor: hex2rgba(0xFFD54F), roughness: 0.30, metalness: 0.6, emissiveFactor: [0.15, 0.10, 0.0] }, // 6
        { name: 'CapeRed',     baseColorFactor: hex2rgba(0xFF1E38), roughness: 0.50, metalness: 0.05, doubleSided: true, emissiveFactor: [0.15, 0.01, 0.02] } // 7
    ];

    // Oversized expressive head
    const headMain = buildEllipsoid(1.12, 1.18, 1.05, 18, 18);
    const cheekL = translateGeo(buildEllipsoid(0.45, 0.38, 0.42, 10, 10), -0.68, -0.22, 0.45);
    const cheekR = translateGeo(buildEllipsoid(0.45, 0.38, 0.42, 10, 10), 0.68, -0.22, 0.45);
    const chin = translateGeo(buildEllipsoid(0.52, 0.35, 0.52, 10, 10), 0, -0.88, 0.22);
    const earL = translateGeo(rotateGeoZ(buildCone(0.28, 0.75, 8), 1.15), -1.05, 0.05, 0);
    const earR = translateGeo(rotateGeoZ(buildCone(0.28, 0.75, 8), -1.15), 1.05, 0.05, 0);
    const skinGeo = mergeGeos(headMain, cheekL, cheekR, chin, earL, earR);

    // Swept hair with dramatic widow's peak
    const hairTop = translateGeo(buildEllipsoid(1.16, 0.62, 1.10, 14, 14), 0, 0.76, -0.06);
    const widowPeak = translateGeo(rotateGeoX(buildCone(0.42, 0.65, 8), PI * 0.82), 0, 0.75, 0.92);
    const hairSweepL = translateGeo(rotateGeoZ(buildCone(0.45, 0.85, 8), 0.65), -0.85, 0.95, -0.2);
    const hairSweepR = translateGeo(rotateGeoZ(buildCone(0.45, 0.85, 8), -0.65), 0.85, 0.95, -0.2);
    const eyes = buildCartoonEyes(0.42, 0.12, 0.96, 0.28, 0.32, 0.28);
    const hairAndBrows = mergeGeos(hairTop, widowPeak, hairSweepL, hairSweepR, eyes.brows);

    // Friendly big fangs & grin
    const mouth = translateGeo(buildEllipsoid(0.46, 0.16, 0.14, 10, 8), 0, -0.46, 0.95);
    const fangL = translateGeo(rotateGeoX(buildCone(0.11, 0.36, 8), PI), -0.24, -0.44, 1.02);
    const fangR = translateGeo(rotateGeoX(buildCone(0.11, 0.36, 8), PI), 0.24, -0.44, 1.02);
    const whiteGeo = mergeGeos(eyes.sclera, fangL, fangR);

    // Dramatic high flared collar
    const collarBack = translateGeo(rotateGeoX(buildCylinder(0.85, 1.45, 0.95, 14, true), -0.22), 0, -0.45, -0.25);

    // Compact torso with bright red waistcoat & gold medallion
    const torsoSuit = translateGeo(buildEllipsoid(0.98, 1.08, 0.76, 14, 14), 0, 0.88, 0);
    const vest = translateGeo(buildEllipsoid(0.86, 0.96, 0.78, 14, 14), 0, 0.86, 0.08);
    const bowtieL = translateGeo(rotateGeoZ(buildCone(0.22, 0.42, 8), PI / 2), -0.18, 1.68, 0.68);
    const bowtieR = translateGeo(rotateGeoZ(buildCone(0.22, 0.42, 8), -PI / 2), 0.18, 1.68, 0.68);
    const medallion = translateGeo(buildEllipsoid(0.22, 0.22, 0.10, 10, 10), 0, 1.45, 0.74);

    // Flowing red-lined cape
    const cape = buildCurvedCape(1.5, 2.5, 2.35, -0.35, 6, 8);

    const armL = makeCartoonArm(1.42, 0.28, 0.24, 1.05);
    const armR = makeCartoonArm(1.42, 0.28, 0.24, 1.05);
    const legL = makeCartoonLeg(1.55, 0.32, 0.24, 1.05);
    const legR = makeCartoonLeg(1.55, 0.32, 0.24, 1.05);

    const children = [
        {
            name: 'Body',
            translation: [0, 1.55, 0],
            meshes: [
                { geo: torsoSuit, materialIndex: 1 },
                { geo: mergeGeos(vest, bowtieL, bowtieR), materialIndex: 0 },
                { geo: medallion, materialIndex: 6 }
            ]
        },
        {
            name: 'Head',
            translation: [0, 3.65, 0],
            meshes: [
                { geo: skinGeo, materialIndex: 2 },
                { geo: mergeGeos(hairAndBrows, mouth), materialIndex: 3 },
                { geo: whiteGeo, materialIndex: 4 },
                { geo: eyes.pupils, materialIndex: 5 },
                { geo: collarBack, materialIndex: 0 }
            ]
        },
        {
            name: 'Arm_L',
            translation: [-1.08, 3.15, 0],
            meshes: [
                { geo: armL.sleeve, materialIndex: 1 },
                { geo: armL.hand, materialIndex: 2 }
            ]
        },
        {
            name: 'Arm_R',
            translation: [1.08, 3.15, 0],
            meshes: [
                { geo: armR.sleeve, materialIndex: 1 },
                { geo: armR.hand, materialIndex: 2 }
            ]
        },
        {
            name: 'Leg_L',
            translation: [-0.46, 1.55, 0],
            meshes: [
                { geo: legL.leg, materialIndex: 1 },
                { geo: legL.shoe, materialIndex: 0 }
            ]
        },
        {
            name: 'Leg_R',
            translation: [0.46, 1.55, 0],
            meshes: [
                { geo: legR.leg, materialIndex: 1 },
                { geo: legR.shoe, materialIndex: 0 }
            ]
        },
        {
            name: 'Extra',
            translation: [0, 3.25, -0.35],
            meshes: [{ geo: cape, materialIndex: 7 }]
        }
    ];

    return buildGLB({ materials: mats, nodes: [{ name: 'Root', translation: [0, 0, 0], children }] });
}

// 1. PUMPKIN FIEND (Orange #E9862A)
function buildPumpkinFiend() {
    const mats = [
        { name: 'BrightPumpkin', baseColorFactor: hex2rgba(0xFF7714), roughness: 0.42, metalness: 0.02, emissiveFactor: [0.16, 0.05, 0.0] }, // 0
        { name: 'DeepGroove',    baseColorFactor: hex2rgba(0xD84E00), roughness: 0.55, metalness: 0.0 }, // 1
        { name: 'WarmGlow',      baseColorFactor: hex2rgba(0xFFF176), roughness: 0.15, metalness: 0.0, emissiveFactor: [0.85, 0.58, 0.05] }, // 2
        { name: 'VineGreen',     baseColorFactor: hex2rgba(0x43A047), roughness: 0.50, metalness: 0.0, emissiveFactor: [0.02, 0.08, 0.02] }, // 3
        { name: 'LeafBright',    baseColorFactor: hex2rgba(0x76FF03), roughness: 0.45, metalness: 0.0, emissiveFactor: [0.05, 0.14, 0.0] }, // 4
        { name: 'BarkBoot',      baseColorFactor: hex2rgba(0x4E342E), roughness: 0.65, metalness: 0.0 }  // 5
    ];

    // Large rounded ridged pumpkin head
    const coreHead = buildEllipsoid(1.22, 1.05, 1.15, 16, 16);
    const lobes = [];
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * PI * 2;
        const lobe = buildEllipsoid(0.55, 1.08, 0.55, 12, 10);
        translateGeo(lobe, cos(a) * 0.72, 0, sin(a) * 0.66);
        lobes.push(lobe);
    }
    const pumpkinHead = mergeGeos(coreHead, ...lobes);

    // Glowing carved eyes & comical toothy grin
    const eyeL = translateGeo(rotateGeoZ(buildEllipsoid(0.28, 0.30, 0.14, 10, 10), -0.15), -0.44, 0.16, 1.08);
    const eyeR = translateGeo(rotateGeoZ(buildEllipsoid(0.28, 0.30, 0.14, 10, 10), 0.15), 0.44, 0.16, 1.08);
    const grinMain = translateGeo(buildEllipsoid(0.66, 0.24, 0.14, 12, 8), 0, -0.36, 1.06);
    const grinL = translateGeo(rotateGeoZ(buildEllipsoid(0.28, 0.18, 0.12, 8, 8), -0.45), -0.48, -0.26, 0.98);
    const grinR = translateGeo(rotateGeoZ(buildEllipsoid(0.28, 0.18, 0.12, 8, 8), 0.45), 0.48, -0.26, 0.98);
    const glowFeatures = mergeGeos(eyeL, eyeR, grinMain, grinL, grinR);

    //Pumpkin teeth
    const tooth1 = translateGeo(buildEllipsoid(0.13, 0.12, 0.12, 6, 6), -0.22, -0.22, 1.14);
    const tooth2 = translateGeo(buildEllipsoid(0.13, 0.12, 0.12, 6, 6), 0.22, -0.22, 1.14);

    // Crooked stem & leaf collar
    const stemBase = translateGeo(buildCylinder(0.24, 0.16, 0.45, 10), 0, 0.98, 0);
    const stemTip = translateGeo(rotateGeoZ(buildCone(0.16, 0.48, 8), 0.45), -0.08, 1.35, 0);
    const leafHead = translateGeo(rotateGeoZ(buildEllipsoid(0.42, 0.08, 0.24, 8, 8), -0.25), 0.35, 1.02, 0.15);

    // Compact bouncy body with leafy neck ruff
    const belly = translateGeo(buildEllipsoid(1.06, 1.02, 0.94, 14, 14), 0, 0.85, 0);
    const bellyGlow = translateGeo(buildEllipsoid(0.52, 0.45, 0.22, 10, 10), 0, 0.85, 0.82);
    const leaves = [];
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * PI * 2;
        const lf = buildEllipsoid(0.45, 0.10, 0.32, 8, 8);
        rotateGeoY(lf, -a);
        translateGeo(lf, cos(a) * 0.72, 1.68, sin(a) * 0.65);
        leaves.push(lf);
    }

    const armL = makeCartoonArm(1.38, 0.28, 0.24, 1.1);
    const armR = makeCartoonArm(1.38, 0.28, 0.24, 1.1);
    const legL = makeCartoonLeg(1.50, 0.34, 0.26, 1.1);
    const legR = makeCartoonLeg(1.50, 0.34, 0.26, 1.1);

    const children = [
        {
            name: 'Body',
            translation: [0, 1.50, 0],
            meshes: [
                { geo: belly, materialIndex: 0 },
                { geo: bellyGlow, materialIndex: 2 },
                { geo: mergeGeos(...leaves), materialIndex: 4 }
            ]
        },
        {
            name: 'Head',
            translation: [0, 3.55, 0],
            meshes: [
                { geo: mergeGeos(pumpkinHead, tooth1, tooth2), materialIndex: 0 },
                { geo: glowFeatures, materialIndex: 2 },
                { geo: mergeGeos(stemBase, stemTip), materialIndex: 3 },
                { geo: leafHead, materialIndex: 4 }
            ]
        },
        {
            name: 'Arm_L',
            translation: [-1.08, 3.05, 0],
            meshes: [
                { geo: armL.sleeve, materialIndex: 3 },
                { geo: armL.hand, materialIndex: 0 }
            ]
        },
        {
            name: 'Arm_R',
            translation: [1.08, 3.05, 0],
            meshes: [
                { geo: armR.sleeve, materialIndex: 3 },
                { geo: armR.hand, materialIndex: 0 }
            ]
        },
        {
            name: 'Leg_L',
            translation: [-0.46, 1.50, 0],
            meshes: [
                { geo: legL.leg, materialIndex: 3 },
                { geo: legL.shoe, materialIndex: 5 }
            ]
        },
        {
            name: 'Leg_R',
            translation: [0.46, 1.50, 0],
            meshes: [
                { geo: legR.leg, materialIndex: 3 },
                { geo: legR.shoe, materialIndex: 5 }
            ]
        },
        {
            name: 'Extra',
            translation: [0, 3.1, -0.55],
            meshes: [{ geo: buildCurvedCape(0.9, 1.4, 1.4, -0.2, 4, 5), materialIndex: 4 }]
        }
    ];

    return buildGLB({ materials: mats, nodes: [{ name: 'Root', translation: [0, 0, 0], children }] });
}

// 2. CURSED MUMMY (Cream & Yellow #F0F136)
function buildCursedMummy() {
    const mats = [
        { name: 'CreamBandage',  baseColorFactor: hex2rgba(0xFFF8DC), roughness: 0.60, metalness: 0.0, emissiveFactor: [0.08, 0.07, 0.04] }, // 0
        { name: 'YellowBandage', baseColorFactor: hex2rgba(0xF0F136), roughness: 0.50, metalness: 0.05, doubleSided: true, emissiveFactor: [0.14, 0.14, 0.02] }, // 1
        { name: 'ShadowRecess',  baseColorFactor: hex2rgba(0x231934), roughness: 0.80, metalness: 0.0 }, // 2
        { name: 'GlowingEye',    baseColorFactor: hex2rgba(0xFFEE58), roughness: 0.15, metalness: 0.0, emissiveFactor: [0.85, 0.75, 0.05] }, // 3
        { name: 'PupilDark',     baseColorFactor: hex2rgba(0x1A1026), roughness: 0.20, metalness: 0.0 }, // 4
        { name: 'GoldAmulet',    baseColorFactor: hex2rgba(0xFFB300), roughness: 0.30, metalness: 0.65, emissiveFactor: [0.18, 0.10, 0.0] } // 5
    ];

    // Rounded cartoon head with layered curved bandage rings
    const headCore = buildEllipsoid(1.08, 1.12, 1.04, 16, 16);
    const faceSlot = translateGeo(buildEllipsoid(0.86, 0.42, 0.35, 12, 10), 0, 0.12, 0.78);
    const bandTop = translateGeo(rotateGeoZ(buildEllipsoid(1.16, 0.34, 1.10, 12, 12), 0.08), 0, 0.62, 0);
    const bandMid = translateGeo(rotateGeoZ(buildEllipsoid(1.15, 0.28, 1.10, 12, 12), -0.09), 0, -0.32, 0.04);
    const bandJaw = translateGeo(buildEllipsoid(0.96, 0.36, 0.96, 12, 12), 0, -0.74, 0.05);

    const eyeL = translateGeo(buildEllipsoid(0.28, 0.30, 0.14, 10, 10), -0.36, 0.14, 0.96);
    const eyeR = translateGeo(buildEllipsoid(0.28, 0.30, 0.14, 10, 10), 0.36, 0.14, 0.96);
    const pupilL = translateGeo(buildEllipsoid(0.13, 0.15, 0.09, 8, 8), -0.34, 0.14, 1.06);
    const pupilR = translateGeo(buildEllipsoid(0.13, 0.15, 0.09, 8, 8), 0.34, 0.14, 1.06);

    // Chubby wrapped body with layered bandages & golden scarab belt
    const bodyCore = translateGeo(buildEllipsoid(1.04, 1.08, 0.88, 14, 14), 0, 0.85, 0);
    const wrapB1 = translateGeo(rotateGeoZ(buildEllipsoid(1.10, 0.26, 0.92, 12, 12), 0.10), 0, 1.30, 0);
    const wrapB2 = translateGeo(rotateGeoZ(buildEllipsoid(1.12, 0.28, 0.94, 12, 12), -0.08), 0, 0.85, 0);
    const wrapB3 = translateGeo(rotateGeoZ(buildEllipsoid(1.06, 0.26, 0.90, 12, 12), 0.07), 0, 0.40, 0);
    const scarab = translateGeo(buildEllipsoid(0.32, 0.26, 0.18, 10, 10), 0, 1.15, 0.86);

    // Animated loose bandage ends
    const tail1 = translateGeo(buildCurvedCape(0.38, 0.55, 1.95, -0.30, 4, 7), -0.28, 0, 0);
    const tail2 = translateGeo(buildCurvedCape(0.34, 0.48, 1.65, -0.22, 4, 6), 0.32, -0.15, -0.08);

    const armL = makeCartoonArm(1.38, 0.29, 0.25, 1.08);
    const armR = makeCartoonArm(1.38, 0.29, 0.25, 1.08);
    const legL = makeCartoonLeg(1.48, 0.34, 0.27, 1.08);
    const legR = makeCartoonLeg(1.48, 0.34, 0.27, 1.08);

    const children = [
        {
            name: 'Body',
            translation: [0, 1.48, 0],
            meshes: [
                { geo: mergeGeos(bodyCore, wrapB2), materialIndex: 0 },
                { geo: mergeGeos(wrapB1, wrapB3), materialIndex: 1 },
                { geo: scarab, materialIndex: 5 }
            ]
        },
        {
            name: 'Head',
            translation: [0, 3.52, 0],
            meshes: [
                { geo: mergeGeos(headCore, bandJaw), materialIndex: 0 },
                { geo: mergeGeos(bandTop, bandMid), materialIndex: 1 },
                { geo: faceSlot, materialIndex: 2 },
                { geo: mergeGeos(eyeL, eyeR), materialIndex: 3 },
                { geo: mergeGeos(pupilL, pupilR), materialIndex: 4 }
            ]
        },
        {
            name: 'Arm_L',
            translation: [-1.06, 3.05, 0.15],
            meshes: [
                { geo: armL.sleeve, materialIndex: 0 },
                { geo: armL.hand, materialIndex: 1 }
            ]
        },
        {
            name: 'Arm_R',
            translation: [1.06, 3.05, 0.15],
            meshes: [
                { geo: armR.sleeve, materialIndex: 0 },
                { geo: armR.hand, materialIndex: 1 }
            ]
        },
        {
            name: 'Leg_L',
            translation: [-0.45, 1.48, 0],
            meshes: [
                { geo: legL.leg, materialIndex: 0 },
                { geo: legL.shoe, materialIndex: 1 }
            ]
        },
        {
            name: 'Leg_R',
            translation: [0.45, 1.48, 0],
            meshes: [
                { geo: legR.leg, materialIndex: 0 },
                { geo: legR.shoe, materialIndex: 1 }
            ]
        },
        {
            name: 'Extra',
            translation: [0, 3.15, -0.55],
            meshes: [{ geo: mergeGeos(tail1, tail2), materialIndex: 1 }]
        }
    ];

    return buildGLB({ materials: mats, nodes: [{ name: 'Root', translation: [0, 0, 0], children }] });
}

// 3. FRANKEN-ZOMBIE (Green #50C878)
function buildFrankenZombie() {
    const mats = [
        { name: 'BrightZombieGreen', baseColorFactor: hex2rgba(0x50C878), roughness: 0.48, metalness: 0.02, emissiveFactor: [0.03, 0.12, 0.05] }, // 0
        { name: 'JacketPurple',      baseColorFactor: hex2rgba(0x392359), roughness: 0.60, metalness: 0.05 }, // 1
        { name: 'SilverBolt',        baseColorFactor: hex2rgba(0xCFD8DC), roughness: 0.25, metalness: 0.85, emissiveFactor: [0.06, 0.08, 0.10] }, // 2
        { name: 'DarkHairStitch',    baseColorFactor: hex2rgba(0x161224), roughness: 0.70, metalness: 0.0 }, // 3
        { name: 'WhiteEye',          baseColorFactor: [1.0, 1.0, 1.0, 1], roughness: 0.20, metalness: 0.0, emissiveFactor: [0.15, 0.15, 0.15] }, // 4
        { name: 'LimeGlow',          baseColorFactor: hex2rgba(0xAEEA00), roughness: 0.25, metalness: 0.0, emissiveFactor: [0.35, 0.65, 0.0] }  // 5
    ];

    // Large rounded-square head with softened edges
    const headBlock = buildRoundedForm(1.08, 1.15, 0.98, 0.58, 16, 16);
    const heavyJaw = translateGeo(buildRoundedForm(1.12, 0.48, 1.02, 0.65, 12, 12), 0, -0.62, 0.08);
    const heavyBrow = translateGeo(buildEllipsoid(1.14, 0.26, 0.55, 12, 10), 0, 0.42, 0.65);

    // Chunky dark hair & stitches
    const hairBlock = translateGeo(buildRoundedForm(1.14, 0.44, 1.04, 0.6, 12, 12), 0, 0.96, -0.02);
    const stitchMain = translateGeo(rotateGeoZ(buildEllipsoid(0.38, 0.05, 0.06, 8, 6), 0.25), -0.35, 0.68, 0.96);
    const stitchCross1 = translateGeo(buildEllipsoid(0.05, 0.16, 0.06, 6, 6), -0.48, 0.64, 0.97);
    const stitchCross2 = translateGeo(buildEllipsoid(0.05, 0.16, 0.06, 6, 6), -0.22, 0.72, 0.97);

    // Metallic neck/cheek bolts
    const boltShaftL = translateGeo(rotateGeoZ(buildCylinder(0.16, 0.16, 0.55, 10), PI / 2), -0.95, -0.45, 0);
    const boltCapL = translateGeo(rotateGeoZ(buildCylinder(0.28, 0.28, 0.18, 8), PI / 2), -1.35, -0.45, 0);
    const boltShaftR = translateGeo(rotateGeoZ(buildCylinder(0.16, 0.16, 0.55, 10), -PI / 2), 0.95, -0.45, 0);
    const boltCapR = translateGeo(rotateGeoZ(buildCylinder(0.28, 0.28, 0.18, 8), -PI / 2), 1.35, -0.45, 0);

    const eyes = buildCartoonEyes(0.42, 0.10, 0.94, 0.27, 0.29, -0.14);
    const underbiteToothL = translateGeo(buildCone(0.10, 0.24, 6), -0.26, -0.52, 1.04);
    const underbiteToothR = translateGeo(buildCone(0.10, 0.24, 6), 0.26, -0.52, 1.04);

    // Broad muscular upper body
    const upperTorso = translateGeo(buildRoundedForm(1.24, 1.12, 0.88, 0.65, 14, 14), 0, 0.95, 0);
    const shirtFront = translateGeo(buildEllipsoid(0.92, 0.92, 0.82, 12, 12), 0, 0.88, 0.12);

    const armL = makeCartoonArm(1.52, 0.34, 0.28, 1.25);
    const armR = makeCartoonArm(1.52, 0.34, 0.28, 1.25);
    const legL = makeCartoonLeg(1.55, 0.36, 0.30, 1.25);
    const legR = makeCartoonLeg(1.55, 0.36, 0.30, 1.25);

    const children = [
        {
            name: 'Body',
            translation: [0, 1.55, 0],
            meshes: [
                { geo: upperTorso, materialIndex: 1 },
                { geo: shirtFront, materialIndex: 5 }
            ]
        },
        {
            name: 'Head',
            translation: [0, 3.72, 0],
            meshes: [
                { geo: mergeGeos(headBlock, heavyJaw, heavyBrow), materialIndex: 0 },
                { geo: mergeGeos(hairBlock, stitchMain, stitchCross1, stitchCross2, eyes.brows, eyes.pupils), materialIndex: 3 },
                { geo: mergeGeos(boltShaftL, boltCapL, boltShaftR, boltCapR), materialIndex: 2 },
                { geo: mergeGeos(eyes.sclera, underbiteToothL, underbiteToothR), materialIndex: 4 }
            ]
        },
        {
            name: 'Arm_L',
            translation: [-1.25, 3.25, 0.15],
            meshes: [
                { geo: armL.sleeve, materialIndex: 1 },
                { geo: armL.hand, materialIndex: 0 }
            ]
        },
        {
            name: 'Arm_R',
            translation: [1.25, 3.25, 0.15],
            meshes: [
                { geo: armR.sleeve, materialIndex: 1 },
                { geo: armR.hand, materialIndex: 0 }
            ]
        },
        {
            name: 'Leg_L',
            translation: [-0.50, 1.55, 0],
            meshes: [
                { geo: legL.leg, materialIndex: 1 },
                { geo: legL.shoe, materialIndex: 3 }
            ]
        },
        {
            name: 'Leg_R',
            translation: [0.50, 1.55, 0],
            meshes: [
                { geo: legR.leg, materialIndex: 1 },
                { geo: legR.shoe, materialIndex: 3 }
            ]
        },
        { name: 'Extra', translation: [0, 0, 0], meshes: [] }
    ];

    return buildGLB({ materials: mats, nodes: [{ name: 'Root', translation: [0, 0, 0], children }] });
}

// 4. SPECTRAL BANSHEE (Electric Cyan-Blue #0033FF + Bright Rim Accents)
function buildSpectralBanshee() {
    const mats = [
        { name: 'SpectralBlue',  baseColorFactor: hex2rgba(0x1E6BFF), roughness: 0.25, metalness: 0.05, emissiveFactor: [0.06, 0.22, 0.75] }, // 0
        { name: 'GhostVeil',     baseColorFactor: hex2rgba(0x40C4FF, 0.84), roughness: 0.20, metalness: 0.0, alphaMode: 'BLEND', doubleSided: true, emissiveFactor: [0.10, 0.45, 0.90] }, // 1
        { name: 'CyanGlowCore',  baseColorFactor: hex2rgba(0xE0F7FA), roughness: 0.10, metalness: 0.0, emissiveFactor: [0.45, 0.90, 1.0] }, // 2
        { name: 'DeepIndigo',    baseColorFactor: hex2rgba(0x0D1B4C), roughness: 0.50, metalness: 0.0 }  // 3
    ];

    // Large expressive ghostly head with flowing spectral hair plumes
    const headMain = buildEllipsoid(1.08, 1.12, 1.02, 16, 16);
    const cheekL = translateGeo(buildEllipsoid(0.42, 0.35, 0.38, 10, 10), -0.65, -0.15, 0.42);
    const cheekR = translateGeo(buildEllipsoid(0.42, 0.35, 0.38, 10, 10), 0.65, -0.15, 0.42);

    const plumeCenter = translateGeo(rotateGeoX(buildCone(0.68, 1.45, 12), -0.55), 0, 0.85, -0.15);
    const plumeL = translateGeo(rotateGeoZ(rotateGeoX(buildCone(0.48, 1.25, 10), -0.45), 0.45), -0.58, 0.68, -0.15);
    const plumeR = translateGeo(rotateGeoZ(rotateGeoX(buildCone(0.48, 1.25, 10), -0.45), -0.45), 0.58, 0.68, -0.15);

    const eyeL = translateGeo(buildEllipsoid(0.30, 0.34, 0.14, 12, 12), -0.38, 0.15, 0.92);
    const eyeR = translateGeo(buildEllipsoid(0.30, 0.34, 0.14, 12, 12), 0.38, 0.15, 0.92);
    const pupilL = translateGeo(buildEllipsoid(0.14, 0.16, 0.08, 8, 8), -0.36, 0.15, 1.02);
    const pupilR = translateGeo(buildEllipsoid(0.14, 0.16, 0.08, 8, 8), 0.36, 0.15, 1.02);
    const wailMouth = translateGeo(buildEllipsoid(0.28, 0.32, 0.14, 10, 10), 0, -0.42, 0.94);

    // Rounded floating upper body tapering into swirling ghost tail
    const chest = translateGeo(buildEllipsoid(1.02, 0.95, 0.85, 14, 14), 0, 1.05, 0);
    const heartGlow = translateGeo(buildEllipsoid(0.48, 0.45, 0.25, 10, 10), 0, 1.10, 0.72);
    const tailUpper = translateGeo(buildCylinder(0.52, 0.96, 1.15, 14), 0, -0.05, 0);
    const tailLower = translateGeo(rotateGeoX(buildCone(0.52, 1.20, 12), PI * 0.88), 0, -0.05, -0.10);

    // Swirling side wisps for Leg_L / Leg_R
    const wispL = translateGeo(rotateGeoX(buildCone(0.34, 1.15, 10), PI * 0.88), 0, 0, 0);
    const wispR = translateGeo(rotateGeoX(buildCone(0.34, 1.15, 10), PI * 0.88), 0, 0, 0);

    const armL = makeCartoonArm(1.38, 0.26, 0.20, 1.05);
    const armR = makeCartoonArm(1.38, 0.26, 0.20, 1.05);

    const children = [
        {
            name: 'Body',
            translation: [0, 1.45, 0],
            meshes: [
                { geo: chest, materialIndex: 0 },
                { geo: mergeGeos(tailUpper, tailLower), materialIndex: 1 },
                { geo: heartGlow, materialIndex: 2 }
            ]
        },
        {
            name: 'Head',
            translation: [0, 3.60, 0],
            meshes: [
                { geo: mergeGeos(headMain, cheekL, cheekR), materialIndex: 0 },
                { geo: mergeGeos(plumeCenter, plumeL, plumeR), materialIndex: 1 },
                { geo: mergeGeos(eyeL, eyeR), materialIndex: 2 },
                { geo: mergeGeos(pupilL, pupilR, wailMouth), materialIndex: 3 }
            ]
        },
        {
            name: 'Arm_L',
            translation: [-1.05, 3.15, 0],
            meshes: [
                { geo: armL.sleeve, materialIndex: 1 },
                { geo: armL.hand, materialIndex: 2 }
            ]
        },
        {
            name: 'Arm_R',
            translation: [1.05, 3.15, 0],
            meshes: [
                { geo: armR.sleeve, materialIndex: 1 },
                { geo: armR.hand, materialIndex: 2 }
            ]
        },
        {
            name: 'Leg_L',
            translation: [-0.42, 1.35, 0],
            meshes: [{ geo: wispL, materialIndex: 1 }]
        },
        {
            name: 'Leg_R',
            translation: [0.42, 1.35, 0],
            meshes: [{ geo: wispR, materialIndex: 1 }]
        },
        {
            name: 'Extra',
            translation: [0, 3.15, -0.45],
            meshes: [{ geo: buildCurvedCape(1.3, 2.2, 2.1, -0.35, 5, 7), materialIndex: 1 }]
        }
    ];

    return buildGLB({ materials: mats, nodes: [{ name: 'Root', translation: [0, 0, 0], children }] });
}

// 5. WITCH-IMP (Purple #6A2FA0)
function buildWitchImp() {
    const mats = [
        { name: 'RoyalPurple',   baseColorFactor: hex2rgba(0x8E38D5), roughness: 0.45, metalness: 0.05, emissiveFactor: [0.10, 0.02, 0.16] }, // 0
        { name: 'ImpSkin',       baseColorFactor: hex2rgba(0xCE93D8), roughness: 0.50, metalness: 0.0, emissiveFactor: [0.06, 0.03, 0.08] }, // 1
        { name: 'DarkVelvetHat', baseColorFactor: hex2rgba(0x23113A), roughness: 0.55, metalness: 0.05 }, // 2
        { name: 'GoldBuckle',    baseColorFactor: hex2rgba(0xFFD54F), roughness: 0.25, metalness: 0.70, emissiveFactor: [0.22, 0.16, 0.0] }, // 3
        { name: 'WhiteSclera',   baseColorFactor: [1.0, 1.0, 1.0, 1], roughness: 0.20, metalness: 0.0, emissiveFactor: [0.15, 0.15, 0.15] }, // 4
        { name: 'MagentaGlow',   baseColorFactor: hex2rgba(0xFF4081), roughness: 0.20, metalness: 0.0, emissiveFactor: [0.55, 0.05, 0.25] }  // 5
    ];

    // Expressive imp head with large pointed ears & mischievous grin
    const headMain = buildEllipsoid(1.06, 1.02, 1.00, 16, 16);
    const earL = translateGeo(rotateGeoZ(buildCone(0.28, 0.95, 8), 1.18), -0.98, 0.08, 0);
    const earR = translateGeo(rotateGeoZ(buildCone(0.28, 0.95, 8), -1.18), 0.98, 0.08, 0);
    const nose = translateGeo(rotateGeoX(buildCone(0.18, 0.45, 8), PI * 0.45), 0, -0.05, 0.96);

    const eyes = buildCartoonEyes(0.40, 0.12, 0.90, 0.28, 0.30, 0.24);
    const grin = translateGeo(buildEllipsoid(0.45, 0.16, 0.12, 10, 8), 0, -0.42, 0.90);

    // Large crooked pointed witch hat with bright ribbon & gold buckle
    const hatBrim = translateGeo(buildEllipsoid(1.75, 0.14, 1.72, 16, 12), 0, 0.68, 0);
    const hatConeLower = translateGeo(buildCylinder(1.02, 0.58, 1.05, 14), 0, 0.72, 0);
    const hatConeTip = translateGeo(rotateGeoZ(buildCone(0.58, 1.15, 12), 0.42), -0.18, 1.68, -0.05);
    const hatBand = translateGeo(buildCylinder(1.05, 0.95, 0.24, 14, true), 0, 0.76, 0);
    const hatBuckle = translateGeo(buildRoundedForm(0.36, 0.32, 0.12, 0.5, 8, 8), 0, 0.88, 0.98);

    // Compact tunic body
    const tunic = translateGeo(buildCylinder(1.08, 0.78, 1.45, 14), 0, 0.22, 0);
    const belt = translateGeo(buildCylinder(0.98, 0.95, 0.22, 14, true), 0, 0.72, 0);
    const beltBuckle = translateGeo(buildRoundedForm(0.32, 0.28, 0.12, 0.5, 8, 8), 0, 0.82, 0.94);

    const armL = makeCartoonArm(1.35, 0.26, 0.22, 1.12);
    const armR = makeCartoonArm(1.35, 0.26, 0.22, 1.12);
    const legL = makeCartoonLeg(1.48, 0.30, 0.24, 1.15);
    const legR = makeCartoonLeg(1.48, 0.30, 0.24, 1.15);

    const children = [
        {
            name: 'Body',
            translation: [0, 1.48, 0],
            meshes: [
                { geo: tunic, materialIndex: 0 },
                { geo: belt, materialIndex: 2 },
                { geo: beltBuckle, materialIndex: 3 }
            ]
        },
        {
            name: 'Head',
            translation: [0, 3.42, 0],
            meshes: [
                { geo: mergeGeos(headMain, earL, earR, nose), materialIndex: 1 },
                { geo: mergeGeos(hatBrim, hatConeLower, hatConeTip, eyes.brows, grin), materialIndex: 2 },
                { geo: mergeGeos(hatBand, eyes.pupils), materialIndex: 5 },
                { geo: hatBuckle, materialIndex: 3 },
                { geo: eyes.sclera, materialIndex: 4 }
            ]
        },
        {
            name: 'Arm_L',
            translation: [-1.02, 2.98, 0],
            meshes: [
                { geo: armL.sleeve, materialIndex: 0 },
                { geo: armL.hand, materialIndex: 1 }
            ]
        },
        {
            name: 'Arm_R',
            translation: [1.02, 2.98, 0],
            meshes: [
                { geo: armR.sleeve, materialIndex: 0 },
                { geo: armR.hand, materialIndex: 1 }
            ]
        },
        {
            name: 'Leg_L',
            translation: [-0.42, 1.48, 0],
            meshes: [
                { geo: legL.leg, materialIndex: 2 },
                { geo: legL.shoe, materialIndex: 0 }
            ]
        },
        {
            name: 'Leg_R',
            translation: [0.42, 1.48, 0],
            meshes: [
                { geo: legR.leg, materialIndex: 2 },
                { geo: legR.shoe, materialIndex: 0 }
            ]
        },
        {
            name: 'Extra',
            translation: [0, 3.05, -0.35],
            meshes: [{ geo: buildCurvedCape(1.2, 1.9, 1.75, -0.28, 5, 6), materialIndex: 0 }]
        }
    ];

    return buildGLB({ materials: mats, nodes: [{ name: 'Root', translation: [0, 0, 0], children }] });
}

// 6. WEREWOLF (Slate Grey #37474F + Contrasting Silver Ruff & Red Plaid Vest)
function buildWerewolf() {
    const mats = [
        { name: 'CharcoalFur',   baseColorFactor: hex2rgba(0x4B606E), roughness: 0.55, metalness: 0.02, emissiveFactor: [0.03, 0.05, 0.07] }, // 0
        { name: 'SilverMane',    baseColorFactor: hex2rgba(0xCFD8DC), roughness: 0.50, metalness: 0.02, emissiveFactor: [0.08, 0.09, 0.10] }, // 1
        { name: 'RedTornVest',   baseColorFactor: hex2rgba(0xE53935), roughness: 0.50, metalness: 0.02, emissiveFactor: [0.10, 0.01, 0.01] }, // 2
        { name: 'DarkNoseClaw',  baseColorFactor: hex2rgba(0x161B22), roughness: 0.35, metalness: 0.10 }, // 3
        { name: 'WhiteTeethEye', baseColorFactor: [1.0, 1.0, 1.0, 1], roughness: 0.20, metalness: 0.0, emissiveFactor: [0.15, 0.15, 0.15] }, // 4
        { name: 'AmberEyeGlow',  baseColorFactor: hex2rgba(0xFFB300), roughness: 0.15, metalness: 0.0, emissiveFactor: [0.75, 0.45, 0.0] }   // 5
    ];

    // Large cartoon wolf head with big rounded muzzle, cheek tufts & oversized ears
    const headSkull = buildEllipsoid(1.08, 1.02, 1.02, 16, 16);
    const muzzleUpper = translateGeo(buildEllipsoid(0.62, 0.44, 0.72, 12, 12), 0, -0.22, 0.85);
    const muzzleBridge = translateGeo(buildEllipsoid(0.45, 0.36, 0.52, 10, 10), 0, -0.10, 0.82);
    const noseBall = translateGeo(buildEllipsoid(0.24, 0.18, 0.20, 10, 10), 0, -0.04, 1.48);

    const earL = translateGeo(rotateGeoZ(buildCone(0.36, 0.98, 10), 0.25), -0.72, 0.82, -0.05);
    const earR = translateGeo(rotateGeoZ(buildCone(0.36, 0.98, 10), -0.25), 0.72, 0.82, -0.05);
    const innerEarL = translateGeo(rotateGeoZ(buildCone(0.20, 0.68, 8), 0.25), -0.72, 0.82, 0.08);
    const innerEarR = translateGeo(rotateGeoZ(buildCone(0.20, 0.68, 8), -0.25), 0.72, 0.82, 0.08);

    // Silhouette cheek fur tufts
    const tuftL1 = translateGeo(rotateGeoZ(buildCone(0.32, 0.72, 8), 1.35), -0.92, -0.18, 0.15);
    const tuftL2 = translateGeo(rotateGeoZ(buildCone(0.26, 0.58, 8), 1.55), -0.88, -0.45, 0.15);
    const tuftR1 = translateGeo(rotateGeoZ(buildCone(0.32, 0.72, 8), -1.35), 0.92, -0.18, 0.15);
    const tuftR2 = translateGeo(rotateGeoZ(buildCone(0.26, 0.58, 8), -1.55), 0.88, -0.45, 0.15);

    const eyes = buildCartoonEyes(0.42, 0.24, 0.88, 0.27, 0.30, 0.26);
    const fangL = translateGeo(buildCone(0.10, 0.28, 6), -0.28, -0.32, 1.32);
    const fangR = translateGeo(buildCone(0.10, 0.28, 6), 0.28, -0.32, 1.32);

    // Broad chest with contrasting silver chest fur & red vest
    const torso = translateGeo(buildEllipsoid(1.12, 1.12, 0.86, 14, 14), 0, 0.92, 0);
    const chestMane = translateGeo(buildEllipsoid(0.78, 0.72, 0.52, 12, 12), 0, 1.18, 0.55);
    const vestSideL = translateGeo(buildEllipsoid(0.55, 0.95, 0.82, 10, 10), -0.58, 0.92, 0.08);
    const vestSideR = translateGeo(buildEllipsoid(0.55, 0.95, 0.82, 10, 10), 0.58, 0.92, 0.08);

    // Fluffy animated tail
    const tailBase = translateGeo(rotateGeoX(buildEllipsoid(0.36, 0.85, 0.36, 12, 10), -0.85), 0, 0.35, -0.65);
    const tailTip = translateGeo(rotateGeoX(buildCone(0.38, 0.78, 10), -2.2), 0, 0.75, -1.25);

    const armL = makeCartoonArm(1.48, 0.32, 0.28, 1.20);
    const armR = makeCartoonArm(1.48, 0.32, 0.28, 1.20);
    const legL = makeCartoonLeg(1.55, 0.36, 0.28, 1.18);
    const legR = makeCartoonLeg(1.55, 0.36, 0.28, 1.18);

    const children = [
        {
            name: 'Body',
            translation: [0, 1.55, 0],
            meshes: [
                { geo: torso, materialIndex: 0 },
                { geo: chestMane, materialIndex: 1 },
                { geo: mergeGeos(vestSideL, vestSideR), materialIndex: 2 }
            ]
        },
        {
            name: 'Head',
            translation: [0, 3.65, 0],
            meshes: [
                { geo: mergeGeos(headSkull, muzzleBridge, earL, earR), materialIndex: 0 },
                { geo: mergeGeos(muzzleUpper, innerEarL, innerEarR, tuftL1, tuftL2, tuftR1, tuftR2), materialIndex: 1 },
                { geo: mergeGeos(noseBall, eyes.brows), materialIndex: 3 },
                { geo: mergeGeos(eyes.sclera, fangL, fangR), materialIndex: 4 },
                { geo: eyes.pupils, materialIndex: 5 }
            ]
        },
        {
            name: 'Arm_L',
            translation: [-1.18, 3.20, 0],
            meshes: [
                { geo: armL.sleeve, materialIndex: 0 },
                { geo: armL.hand, materialIndex: 1 }
            ]
        },
        {
            name: 'Arm_R',
            translation: [1.18, 3.20, 0],
            meshes: [
                { geo: armR.sleeve, materialIndex: 0 },
                { geo: armR.hand, materialIndex: 1 }
            ]
        },
        {
            name: 'Leg_L',
            translation: [-0.48, 1.55, 0],
            meshes: [
                { geo: legL.leg, materialIndex: 0 },
                { geo: legL.shoe, materialIndex: 1 }
            ]
        },
        {
            name: 'Leg_R',
            translation: [0.48, 1.55, 0],
            meshes: [
                { geo: legR.leg, materialIndex: 0 },
                { geo: legR.shoe, materialIndex: 1 }
            ]
        },
        {
            name: 'Extra',
            translation: [0, 1.85, -0.45],
            meshes: [
                { geo: tailBase, materialIndex: 0 },
                { geo: tailTip, materialIndex: 1 }
            ]
        }
    ];

    return buildGLB({ materials: mats, nodes: [{ name: 'Root', translation: [0, 0, 0], children }] });
}

// 7. SKELETON (Bright Off-White #F3F5F7)
function buildSkeleton() {
    const mats = [
        { name: 'BrightBone',   baseColorFactor: hex2rgba(0xF8FAFC), roughness: 0.38, metalness: 0.05, emissiveFactor: [0.10, 0.11, 0.12] }, // 0
        { name: 'WarmBoneShad', baseColorFactor: hex2rgba(0xDCE2EA), roughness: 0.50, metalness: 0.02, emissiveFactor: [0.05, 0.05, 0.06] }, // 1
        { name: 'SocketDark',   baseColorFactor: hex2rgba(0x140E24), roughness: 0.75, metalness: 0.0 }, // 2
        { name: 'CyanPupilGlow', baseColorFactor: hex2rgba(0x00E5FF), roughness: 0.15, metalness: 0.0, emissiveFactor: [0.15, 0.85, 1.0] }, // 3
        { name: 'RedBowtie',    baseColorFactor: hex2rgba(0xFF1744), roughness: 0.45, metalness: 0.05, emissiveFactor: [0.12, 0.01, 0.02] } // 4
    ];

    // Oversized rounded cranium & comical jaw
    const cranium = translateGeo(buildEllipsoid(1.12, 1.08, 1.06, 18, 18), 0, 0.18, 0);
    const cheekL = translateGeo(buildEllipsoid(0.42, 0.30, 0.38, 10, 10), -0.68, -0.22, 0.48);
    const cheekR = translateGeo(buildEllipsoid(0.42, 0.30, 0.38, 10, 10), 0.68, -0.22, 0.48);
    const jaw = translateGeo(buildRoundedForm(0.76, 0.38, 0.68, 0.65, 12, 12), 0, -0.74, 0.16);
    const browL = translateGeo(rotateGeoZ(buildEllipsoid(0.38, 0.12, 0.22, 8, 8), -0.18), -0.42, 0.56, 0.88);
    const browR = translateGeo(rotateGeoZ(buildEllipsoid(0.38, 0.12, 0.22, 8, 8), 0.18), 0.42, 0.56, 0.88);

    // Expressive eye sockets with glowing cyan pinprick pupils
    const socketL = translateGeo(buildEllipsoid(0.32, 0.34, 0.16, 12, 12), -0.40, 0.16, 0.92);
    const socketR = translateGeo(buildEllipsoid(0.32, 0.34, 0.16, 12, 12), 0.40, 0.16, 0.92);
    const noseHole = translateGeo(buildCone(0.16, 0.28, 6), 0, -0.18, 0.98);
    const pupilL = translateGeo(buildEllipsoid(0.14, 0.14, 0.10, 8, 8), -0.38, 0.16, 1.04);
    const pupilR = translateGeo(buildEllipsoid(0.14, 0.14, 0.10, 8, 8), 0.38, 0.16, 1.04);

    // Big rounded cartoon teeth
    const teeth = [];
    for (let i = -2; i <= 2; i++) {
        teeth.push(translateGeo(buildEllipsoid(0.11, 0.16, 0.10, 8, 8), i * 0.16, -0.54, 0.84));
    }

    // Curved ribcage & recognisable pelvis
    const spine = translateGeo(buildCylinder(0.22, 0.20, 1.85, 10), 0, 0, -0.12);
    const rib1 = translateGeo(buildEllipsoid(0.95, 0.20, 0.62, 14, 10), 0, 1.42, 0.05);
    const rib2 = translateGeo(buildEllipsoid(0.88, 0.19, 0.58, 14, 10), 0, 1.05, 0.05);
    const rib3 = translateGeo(buildEllipsoid(0.76, 0.18, 0.52, 14, 10), 0, 0.68, 0.05);
    const sternum = translateGeo(buildEllipsoid(0.22, 0.58, 0.18, 10, 10), 0, 1.08, 0.58);
    const pelvis = translateGeo(buildRoundedForm(0.86, 0.36, 0.62, 0.65, 12, 12), 0, 0.18, 0);
    const bowtie = translateGeo(buildEllipsoid(0.38, 0.18, 0.14, 8, 8), 0, 1.72, 0.48);

    // Rounded bone limbs with ball joints & oversized skeletal hands/feet
    function makeBoneArm(len = 1.45) {
        const jTop = buildEllipsoid(0.24, 0.24, 0.24, 8, 8);
        const shaft1 = translateGeo(buildCylinder(0.14, 0.16, len * 0.5, 8), 0, -len * 0.5, 0);
        const jMid = translateGeo(buildEllipsoid(0.22, 0.22, 0.22, 8, 8), 0, -len * 0.5, 0);
        const shaft2 = translateGeo(buildCylinder(0.14, 0.14, len * 0.5, 8), 0, -len, 0);
        const hand = translateGeo(buildEllipsoid(0.32, 0.30, 0.26, 10, 10), 0, -len - 0.12, 0.05);
        return mergeGeos(jTop, shaft1, jMid, shaft2, hand);
    }

    function makeBoneLeg(len = 1.55) {
        const jHip = buildEllipsoid(0.26, 0.26, 0.26, 8, 8);
        const femur = translateGeo(buildCylinder(0.16, 0.18, len * 0.52, 8), 0, -len * 0.52, 0);
        const knee = translateGeo(buildEllipsoid(0.24, 0.24, 0.24, 8, 8), 0, -len * 0.52, 0);
        const tibia = translateGeo(buildCylinder(0.15, 0.16, len * 0.42, 8), 0, -len * 0.92, 0);
        const foot = translateGeo(buildEllipsoid(0.34, 0.22, 0.48, 12, 10), 0, -len + 0.20, 0.22);
        return mergeGeos(jHip, femur, knee, tibia, foot);
    }

    const children = [
        {
            name: 'Body',
            translation: [0, 1.55, 0],
            meshes: [
                { geo: mergeGeos(rib1, rib2, rib3, sternum), materialIndex: 0 },
                { geo: mergeGeos(spine, pelvis), materialIndex: 1 },
                { geo: bowtie, materialIndex: 4 }
            ]
        },
        {
            name: 'Head',
            translation: [0, 3.65, 0],
            meshes: [
                { geo: mergeGeos(cranium, cheekL, cheekR, browL, browR, ...teeth), materialIndex: 0 },
                { geo: jaw, materialIndex: 1 },
                { geo: mergeGeos(socketL, socketR, noseHole), materialIndex: 2 },
                { geo: mergeGeos(pupilL, pupilR), materialIndex: 3 }
            ]
        },
        {
            name: 'Arm_L',
            translation: [-1.08, 3.15, 0],
            meshes: [{ geo: makeBoneArm(), materialIndex: 0 }]
        },
        {
            name: 'Arm_R',
            translation: [1.08, 3.15, 0],
            meshes: [{ geo: makeBoneArm(), materialIndex: 0 }]
        },
        {
            name: 'Leg_L',
            translation: [-0.44, 1.55, 0],
            meshes: [{ geo: makeBoneLeg(), materialIndex: 0 }]
        },
        {
            name: 'Leg_R',
            translation: [0.44, 1.55, 0],
            meshes: [{ geo: makeBoneLeg(), materialIndex: 0 }]
        },
        { name: 'Extra', translation: [0, 0, 0], meshes: [] }
    ];

    return buildGLB({ materials: mats, nodes: [{ name: 'Root', translation: [0, 0, 0], children }] });
}

// ─────────────────────────────────────────────────────────────────────────────
// GENERATE ALL 8 MONSTERS
// ─────────────────────────────────────────────────────────────────────────────
const MONSTERS = [
    { id: 0, name: 'vampire',          fn: buildVampire },
    { id: 1, name: 'pumpkin-fiend',    fn: buildPumpkinFiend },
    { id: 2, name: 'cursed-mummy',     fn: buildCursedMummy },
    { id: 3, name: 'franken-zombie',   fn: buildFrankenZombie },
    { id: 4, name: 'spectral-banshee', fn: buildSpectralBanshee },
    { id: 5, name: 'witch-imp',        fn: buildWitchImp },
    { id: 6, name: 'werewolf',         fn: buildWerewolf },
    { id: 7, name: 'skeleton',         fn: buildSkeleton }
];

console.log('Zoombie Monster GLB Generator v2');
console.log('================================');
let totalBytes = 0;

for (const { id, name, fn } of MONSTERS) {
    process.stdout.write(`[${id}] Generating ${name}.glb... `);
    const glb = fn();
    const outPath = resolve(OUT_DIR, `${name}.glb`);
    writeFileSync(outPath, glb);
    totalBytes += glb.length;
    console.log(`✓  ${(glb.length / 1024).toFixed(1)} KB`);
}

console.log(`\nCompleted all 8 GLBs (${(totalBytes / 1024).toFixed(1)} KB total) -> ${OUT_DIR}`);