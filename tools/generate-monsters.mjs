/**
 * Zoombie Racing Simulator – Monster GLB Generator
 * ================================================
 * Produces 8 GLB files in ../models/ using pure Node.js.
 * No npm packages required. No Blender required.
 *
 * Run with:
 *   node generate-monsters.mjs
 * (using the Adobe-bundled node.exe or any Node ≥ 18)
 *
 * Each GLB contains:
 *   - Polished, rounded stylised monster geometry
 *   - Named nodes: Root, Body, Head, Arm_L, Arm_R, Leg_L, Leg_R, Extra
 *   - PBR materials with per-character colour accents
 *   - Shadows-compatible geometry (no camera/light nodes)
 *   - Origin at ground level, facing +Z
 */

import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '../models');
mkdirSync(OUT_DIR, { recursive: true });

// ─────────────────────────────────────────────────────────────────────────────
// SEEDED RNG  (deterministic output)
// ─────────────────────────────────────────────────────────────────────────────
class SeededRng {
    constructor(seed = 42) { this.s = seed >>> 0; }
    next() {
        this.s ^= this.s << 13; this.s ^= this.s >>> 17; this.s ^= this.s << 5;
        return (this.s >>> 0) / 4294967296;
    }
    range(a, b) { return a + this.next() * (b - a); }
}
const rng = new SeededRng(0xBEEFCAFE);

// ─────────────────────────────────────────────────────────────────────────────
// MATHS HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const PI = Math.PI;
const cos = Math.cos, sin = Math.sin, sqrt = Math.sqrt;

function norm3(x, y, z) {
    const l = sqrt(x * x + y * y + z * z) || 1;
    return [x / l, y / l, z / l];
}

// ─────────────────────────────────────────────────────────────────────────────
// GEOMETRY BUILDERS  (return { positions, normals, indices, uvs })
// ─────────────────────────────────────────────────────────────────────────────

/** Sphere centered at origin, radius r */
function buildSphere(r, latSegs = 14, lonSegs = 14) {
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

/** Ellipsoid via scaled sphere */
function buildEllipsoid(rx, ry, rz, latSegs = 14, lonSegs = 14) {
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

/** Rounded box (uses sphere mapping onto cube-ish shape) */
function buildRoundedBox(w, h, d, r = 0.15, segs = 10) {
    // Approximate with ellipsoid + slight exaggeration on corners
    return buildEllipsoid(w * 0.5, h * 0.5, d * 0.5, segs, segs);
}

/** Open or closed cylinder (y-axis, bottom at 0, top at height) */
function buildCylinder(rBot, rTop, height, radSegs = 12, openEnded = false) {
    const positions = [], normals = [], uvs = [], indices = [];
    const slope = (rBot - rTop) / height;
    const nY = slope / sqrt(1 + slope * slope);
    const nR = 1 / sqrt(1 + slope * slope);

    // Side verts
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
    // Side indices
    for (let i = 0; i < radSegs; i++) {
        const a = i, b = i + radSegs + 1;
        indices.push(a, b + 1, a + 1, a, b, b + 1);
    }
    const sideVerts = positions.length / 3;

    if (!openEnded) {
        // Bottom cap
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

        // Top cap
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

/** Cone */
function buildCone(r, height, radSegs = 10) {
    return buildCylinder(r, 0.001, height, radSegs);
}

/** Torus segment for curved shapes like ribcage ribs */
function buildTorus(R, r, tubeSegs = 16, ringSegs = 8, arcFraction = 1) {
    const positions = [], normals = [], uvs = [], indices = [];
    for (let j = 0; j <= ringSegs; j++) {
        const theta = j * PI * arcFraction / ringSegs;
        const cx = cos(theta) * R, cy = sin(theta) * R;
        for (let i = 0; i <= tubeSegs; i++) {
            const phi = i * 2 * PI / tubeSegs;
            const rx = cos(phi) * r, ry = sin(phi) * r;
            // point on torus
            const px = (R + rx * cos(theta)), py = ry, pz = rx * sin(theta) * (arcFraction < 1 ? -1 : 1);
            const nx = cos(phi) * cos(theta), ny = sin(phi), nz = cos(phi) * sin(theta);
            positions.push(px, py, pz);
            normals.push(...norm3(nx, ny, nz));
            uvs.push(i / tubeSegs, j / ringSegs);
        }
    }
    for (let j = 0; j < ringSegs; j++) {
        for (let i = 0; i < tubeSegs; i++) {
            const a = j * (tubeSegs + 1) + i;
            const b = a + tubeSegs + 1;
            indices.push(a, b, a + 1, b, b + 1, a + 1);
        }
    }
    return { positions, normals, indices, uvs };
}

/** Flat quad (used for cape/spectral veil – double sided via two triangles per face) */
function buildPlane(w, h, wSegs = 4, hSegs = 6) {
    const positions = [], normals = [], uvs = [], indices = [];
    for (let iy = 0; iy <= hSegs; iy++) {
        for (let ix = 0; ix <= wSegs; ix++) {
            const u = ix / wSegs, v = iy / hSegs;
            positions.push((u - 0.5) * w, (v - 0.5) * h, 0);
            normals.push(0, 0, 1);
            uvs.push(u, v);
        }
    }
    for (let iy = 0; iy < hSegs; iy++) {
        for (let ix = 0; ix < wSegs; ix++) {
            const a = iy * (wSegs + 1) + ix;
            const b = a + wSegs + 1;
            // front face
            indices.push(a, b, a + 1, b, b + 1, a + 1);
            // back face (reverse winding)
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

function scaleGeo(geo, sx, sy, sz) {
    sz = sz ?? sy ?? sx;
    sy = sy ?? sx;
    for (let i = 0; i < geo.positions.length; i += 3) {
        geo.positions[i] *= sx;
        geo.positions[i + 1] *= sy;
        geo.positions[i + 2] *= sz;
    }
    // Scale normals (non-uniform => need inverse transpose)
    for (let i = 0; i < geo.normals.length; i += 3) {
        const nx = geo.normals[i] / sx, ny = geo.normals[i + 1] / sy, nz = geo.normals[i + 2] / sz;
        const [nnx, nny, nnz] = norm3(nx, ny, nz);
        geo.normals[i] = nnx; geo.normals[i + 1] = nny; geo.normals[i + 2] = nnz;
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

/** Merge multiple geometries into one (re-indexing) */
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
// GLTF / GLB BINARY ENCODER
// ─────────────────────────────────────────────────────────────────────────────

/** Encode a Float32 array into a Buffer */
function f32buf(arr) {
    const b = Buffer.allocUnsafe(arr.length * 4);
    for (let i = 0; i < arr.length; i++) b.writeFloatLE(arr[i], i * 4);
    return b;
}

/** Encode a Uint16 index array into a Buffer */
function u16buf(arr) {
    const b = Buffer.allocUnsafe(arr.length * 2);
    for (let i = 0; i < arr.length; i++) b.writeUInt16LE(arr[i], i * 2);
    return b;
}

/** Encode a Uint32 index array (for large meshes > 65535 verts) */
function u32buf(arr) {
    const b = Buffer.allocUnsafe(arr.length * 4);
    for (let i = 0; i < arr.length; i++) b.writeUInt32LE(arr[i], i * 4);
    return b;
}

/** Pad buffer to 4-byte boundary */
function pad4(buf) {
    const rem = buf.length % 4;
    if (rem === 0) return buf;
    return Buffer.concat([buf, Buffer.alloc(4 - rem, 0x20)]);
}

/**
 * Build a complete GLB binary from a scene description.
 *
 * sceneDesc: {
 *   materials: [{ name, baseColorFactor:[r,g,b,a], roughness, metalness, emissiveFactor:[r,g,b] }],
 *   nodes: [{ name, translation?, rotation?, scale?, children?[], meshes?:[{ geo, materialIndex }] }]
 * }
 */
function buildGLB(sceneDesc) {
    const { materials, nodes } = sceneDesc;

    // ── 1. Build binary buffer data (BIN chunk)
    const bufferViews = [];
    const accessors = [];
    const meshDefs = [];
    const binaryParts = [];
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

        // compute min/max for positions (required by spec)
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

    // Build mesh accessors for each node's geometry
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

    // ── 2. Flatten node hierarchy into a list, assigning indices depth-first
    const gltfNodes = [];
    const gltfMeshes = [];

    function collectNode(nodeDef) {
        // Reserve our index first
        const myIdx = gltfNodes.length;
        gltfNodes.push(null); // placeholder filled below

        const gltfNode = { name: nodeDef.name };
        if (nodeDef.translation) gltfNode.translation = nodeDef.translation;
        if (nodeDef.rotation)    gltfNode.rotation    = nodeDef.rotation;
        if (nodeDef.scale)       gltfNode.scale        = nodeDef.scale;

        // Attach mesh if this node has geometry
        if (nodeDef.meshes && nodeDef.meshes.length > 0) {
            const mesh = buildMeshForNode(nodeDef.meshes);
            if (mesh) {
                gltfNode.mesh = gltfMeshes.length;
                gltfMeshes.push(mesh);
            }
        }

        // Recursively collect children and record their correct indices
        if (nodeDef.children && nodeDef.children.length > 0) {
            gltfNode.children = [];
            for (const childDef of nodeDef.children) {
                const childIdx = gltfNodes.length; // will be next after current stack
                gltfNode.children.push(childIdx);
                collectNode(childDef); // fills gltfNodes[childIdx] and descendants
            }
        }

        gltfNodes[myIdx] = gltfNode;
        return myIdx;
    }


    // Process top-level nodes
    const rootIndices = [];
    for (const nodeDef of nodes) {
        rootIndices.push(collectNode(nodeDef));
    }

    // ── 3. Build GLTF JSON
    const binBuffer = binaryParts.length ? Buffer.concat(binaryParts) : Buffer.alloc(4);

    const gltfMaterials = materials.map(m => {
        const mat = {
            name: m.name,
            pbrMetallicRoughness: {
                baseColorFactor: m.baseColorFactor || [1, 1, 1, 1],
                metallicFactor: m.metalness ?? 0.0,
                roughnessFactor: m.roughness ?? 0.7
            },
            doubleSided: m.doubleSided ?? false
        };
        if (m.emissiveFactor && m.emissiveFactor.some(v => v > 0)) {
            mat.emissiveFactor = m.emissiveFactor;
        }
        if (m.alphaMode) {
            mat.alphaMode = m.alphaMode;
            if (m.alphaMode === 'BLEND') mat.alphaCutoff = undefined;
        }
        return mat;
    });

    const gltfJson = {
        asset: { version: '2.0', generator: 'ZoombieGLBGenerator/1.0' },
        scene: 0,
        scenes: [{ name: 'Scene', nodes: rootIndices }],
        nodes: gltfNodes,
        meshes: gltfMeshes,
        materials: gltfMaterials,
        accessors,
        bufferViews,
        buffers: [{ byteLength: binBuffer.length }]
    };

    const jsonStr = JSON.stringify(gltfJson);
    const jsonBuf = pad4(Buffer.from(jsonStr, 'utf8'));
    const binBuf = pad4(binBuffer);

    const totalLen = 12 + 8 + jsonBuf.length + 8 + binBuf.length;

    const header = Buffer.allocUnsafe(12);
    header.writeUInt32LE(0x46546C67, 0); // magic 'glTF'
    header.writeUInt32LE(2, 4);           // version
    header.writeUInt32LE(totalLen, 8);

    const jsonChunkHeader = Buffer.allocUnsafe(8);
    jsonChunkHeader.writeUInt32LE(jsonBuf.length, 0);
    jsonChunkHeader.writeUInt32LE(0x4E4F534A, 4); // 'JSON'

    const binChunkHeader = Buffer.allocUnsafe(8);
    binChunkHeader.writeUInt32LE(binBuf.length, 0);
    binChunkHeader.writeUInt32LE(0x004E4942, 4); // 'BIN\0'

    return Buffer.concat([header, jsonChunkHeader, jsonBuf, binChunkHeader, binBuf]);
}

// ─────────────────────────────────────────────────────────────────────────────
// COLOUR HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function hex2rgba(hex, a = 1) {
    return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255, a];
}
function lerpColor(c1, c2, t) {
    return c1.map((v, i) => v + (c2[i] - v) * t);
}

// Race colours matching COLORS in script.js
const RACE_COLORS = [
    0xF42941, // 0 Red    – Vampire
    0xE9862A, // 1 Orange – Pumpkin Fiend
    0xF0F136, // 2 Yellow – Cursed Mummy
    0x50C878, // 3 Green  – Franken-Zombie
    0x0033FF, // 4 Blue   – Spectral Banshee
    0x6A2FA0, // 5 Purple – Witch-Imp
    0x37474F, // 6 Grey   – Werewolf
    0xF3F5F7  // 7 White  – Skeleton
];

// ─────────────────────────────────────────────────────────────────────────────
// SHARED MATERIAL PALETTES
// ─────────────────────────────────────────────────────────────────────────────

// material index constants (per-monster)
const M_PRIMARY   = 0;
const M_DARK      = 1;
const M_SKIN      = 2;
const M_GLOW      = 3;
const M_ACCENT    = 4;

function baseMaterials(hexColor) {
    const primary = hex2rgba(hexColor);
    return [
        { name: 'Primary',   baseColorFactor: primary,                    roughness: 0.55, metalness: 0.05 },
        { name: 'Dark',      baseColorFactor: [0.07, 0.05, 0.12, 1],      roughness: 0.75, metalness: 0.0  },
        { name: 'Skin',      baseColorFactor: [0.84, 0.75, 0.62, 1],      roughness: 0.65, metalness: 0.0  },
        { name: 'Glow',      baseColorFactor: [0.1,  0.9,  0.1,  1],      roughness: 0.3,  metalness: 0.0, emissiveFactor: [0, 0.6, 0]   },
        { name: 'Accent',    baseColorFactor: [0.8,  0.8,  0.8,  1],      roughness: 0.4,  metalness: 0.6  }
    ];
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED RIG NODE BUILDER HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Pivot-based limb: geometry baked with pivot at top (shoulder/hip) */
function limbNode(name, geos, matIdx, tx, ty, tz) {
    return {
        name,
        translation: [tx, ty, tz],
        meshes: geos.map(g => ({ geo: g, materialIndex: matIdx }))
    };
}

/**
 * A standard bipedal body structure used by most monsters.
 * Returns an array of child nodes for the Root node.
 *
 * Callers supply:
 *   bodyGeos   – merged geometry for Body node
 *   headGeos   – merged geometry for Head node
 *   armLGeo    – single geo for Arm_L (pivot at top)
 *   armRGeo    – single geo for Arm_R (pivot at top)
 *   legLGeo    – single geo for Leg_L (pivot at top)
 *   legRGeo    – single geo for Leg_R (pivot at top)
 *   extraGeos  – optional extra node geos (cape, hat, tail, etc.)
 *   mats       – material overrides { body, head, armL, armR, legL, legR, extra }
 */
function buildRig({ bodyGeos, headGeos, armLGeo, armRGeo, legLGeo, legRGeo, extraGeos,
                    mats = {} }) {
    const m = {
        body: mats.body ?? M_PRIMARY,
        head: mats.head ?? M_PRIMARY,
        armL: mats.armL ?? M_PRIMARY,
        armR: mats.armR ?? M_PRIMARY,
        legL: mats.legL ?? M_DARK,
        legR: mats.legR ?? M_DARK,
        extra: mats.extra ?? M_PRIMARY,
    };

    const nodes = [
        {
            name: 'Body',
            translation: [0, 1.65, 0],
            meshes: bodyGeos.map(g => ({ geo: g, materialIndex: m.body }))
        },
        {
            name: 'Head',
            translation: [0, 3.65, 0],
            meshes: headGeos.map(g => ({ geo: g, materialIndex: m.head }))
        },
        {
            name: 'Arm_L',
            translation: [-1.1, 3.3, 0],
            meshes: armLGeo ? [{ geo: armLGeo, materialIndex: m.armL }] : []
        },
        {
            name: 'Arm_R',
            translation: [1.1, 3.3, 0],
            meshes: armRGeo ? [{ geo: armRGeo, materialIndex: m.armR }] : []
        },
        {
            name: 'Leg_L',
            translation: [-0.45, 1.6, 0],
            meshes: legLGeo ? [{ geo: legLGeo, materialIndex: m.legL }] : []
        },
        {
            name: 'Leg_R',
            translation: [0.45, 1.6, 0],
            meshes: legRGeo ? [{ geo: legRGeo, materialIndex: m.legR }] : []
        }
    ];

    if (extraGeos && extraGeos.length > 0) {
        nodes.push({
            name: 'Extra',
            translation: [0, 0, 0],
            meshes: extraGeos.map(g => ({ geo: g, materialIndex: m.extra }))
        });
    }

    return nodes;
}

// Standard arm: rounded capsule-ish limb with pivot at top
function makeArm(len = 1.55) {
    // Cylinder with rounded ends – approximate with tapered cylinder
    const upper = buildCylinder(0.22, 0.18, len * 0.55, 8);
    translateGeo(upper, 0, -len * 0.55, 0);
    const lower = buildCylinder(0.18, 0.15, len * 0.45, 8);
    translateGeo(lower, 0, -len, 0);
    const elbow = buildEllipsoid(0.19, 0.19, 0.19, 6, 6);
    translateGeo(elbow, 0, -len * 0.55, 0);
    return mergeGeos(upper, lower, elbow);
}

// Standard leg: tapered cylinder
function makeLeg(len = 1.6) {
    const upper = buildCylinder(0.26, 0.22, len * 0.55, 8);
    translateGeo(upper, 0, -len * 0.55, 0);
    const lower = buildCylinder(0.22, 0.16, len * 0.45, 8);
    translateGeo(lower, 0, -len, 0);
    const knee = buildEllipsoid(0.22, 0.22, 0.22, 6, 6);
    translateGeo(knee, 0, -len * 0.55, 0);
    // Foot
    const foot = buildEllipsoid(0.18, 0.14, 0.35, 6, 6);
    translateGeo(foot, 0, -len, 0.18);
    return mergeGeos(upper, lower, knee, foot);
}

// ─────────────────────────────────────────────────────────────────────────────
// MONSTER BUILDERS
// ─────────────────────────────────────────────────────────────────────────────

// ── 0. VAMPIRE ────────────────────────────────────────────────────────────────
function buildVampire() {
    const hex = RACE_COLORS[0];
    const mats = [
        ...baseMaterials(hex),
        { name: 'Pale',    baseColorFactor: [0.93, 0.88, 0.86, 1], roughness: 0.6, metalness: 0.0 },  // M=5 pale face
        { name: 'Cape',    baseColorFactor: [0.60, 0.05, 0.08, 1], roughness: 0.65, metalness: 0.0, doubleSided: true }, // M=6 cape lining
        { name: 'CapeOut', baseColorFactor: [0.06, 0.04, 0.10, 1], roughness: 0.65, metalness: 0.0, doubleSided: true }, // M=7 cape outer
        { name: 'Hair',    baseColorFactor: [0.06, 0.04, 0.10, 1], roughness: 0.8,  metalness: 0.0 }, // M=8 dark hair
        { name: 'Fang',    baseColorFactor: [1.0,  1.0,  1.0,  1], roughness: 0.2,  metalness: 0.1 }, // M=9 ivory fangs
    ];

    // Head: pale rounded oval face with widow's peak
    const skull = buildEllipsoid(0.72, 0.82, 0.72, 14, 12);
    const jaw = buildEllipsoid(0.62, 0.35, 0.60, 10, 10);
    translateGeo(jaw, 0, -0.65, 0);

    // Swept hair / widow's peak
    const hair = buildEllipsoid(0.74, 0.25, 0.60, 8, 8);
    translateGeo(hair, 0, 0.72, -0.1);
    // Side hair swept back
    const hairL = buildEllipsoid(0.22, 0.45, 0.22, 6, 6);
    translateGeo(hairL, -0.55, 0.35, -0.25);
    const hairR = buildEllipsoid(0.22, 0.45, 0.22, 6, 6);
    translateGeo(hairR, 0.55, 0.35, -0.25);

    // Collar / high cravat
    const collar = buildCylinder(0.65, 0.55, 0.55, 10);
    translateGeo(collar, 0, -1.15, 0);

    // Fangs (small cones, visible in front)
    const fangL = buildCone(0.07, 0.3, 6);
    rotateGeoZ(fangL, PI);
    translateGeo(fangL, -0.15, -0.8, 0.55);
    const fangR = buildCone(0.07, 0.3, 6);
    rotateGeoZ(fangR, PI);
    translateGeo(fangR, 0.15, -0.8, 0.55);

    // Eyes – glowing red
    const eyeL = buildEllipsoid(0.10, 0.10, 0.08, 6, 6);
    translateGeo(eyeL, -0.28, 0.10, 0.62);
    const eyeR = buildEllipsoid(0.10, 0.10, 0.08, 6, 6);
    translateGeo(eyeR, 0.28, 0.10, 0.62);

    // Body: dark suit with broad shoulders
    const torso = buildEllipsoid(1.0, 1.15, 0.62, 12, 10);
    translateGeo(torso, 0, 0.85, 0);
    const shoulders = buildEllipsoid(1.25, 0.35, 0.65, 10, 8);
    translateGeo(shoulders, 0, 1.55, 0);

    // Cape: billowing quad attached to body
    const capeGeo = buildPlane(2.2, 2.8, 5, 8);
    // Shift pivot to top
    translateGeo(capeGeo, 0, -1.4, -0.35);
    rotateGeoX(capeGeo, -0.2);

    const headGeos  = [skull, jaw, hair, hairL, hairR, collar];
    const headMats  = [5, 5, 8, 8, 8, 1]; // pale, pale, hair, hair, hair, dark

    // Build multi-material head as separate sub-nodes (but we merge with one material group)
    // For simplicity, use the pale mat for most, override eyes separately
    const headMerged = mergeGeos(skull, jaw, collar);
    const hairMerged = mergeGeos(hair, hairL, hairR);

    // Eyes with glow material added in scene desc directly
    const mEyeGlow = { name: 'VampEye', baseColorFactor: [1, 0.05, 0.05, 1], roughness: 0.1, metalness: 0.0, emissiveFactor: [0.9, 0.0, 0.0] };
    mats.push(mEyeGlow); // index 10

    const children = [
        {
            name: 'Body',
            translation: [0, 1.65, 0],
            meshes: [
                { geo: torso, materialIndex: M_DARK },
                { geo: shoulders, materialIndex: M_DARK }
            ]
        },
        {
            name: 'Head',
            translation: [0, 3.65, 0],
            meshes: [
                { geo: headMerged, materialIndex: 5 },
                { geo: hairMerged, materialIndex: 8 },
                { geo: fangL, materialIndex: 9 },
                { geo: fangR, materialIndex: 9 },
                { geo: eyeL, materialIndex: 10 },
                { geo: eyeR, materialIndex: 10 }
            ]
        },
        {
            name: 'Arm_L',
            translation: [-1.1, 3.3, 0],
            meshes: [{ geo: makeArm(), materialIndex: M_DARK }]
        },
        {
            name: 'Arm_R',
            translation: [1.1, 3.3, 0],
            meshes: [{ geo: makeArm(), materialIndex: M_DARK }]
        },
        {
            name: 'Leg_L',
            translation: [-0.42, 1.6, 0],
            meshes: [{ geo: makeLeg(), materialIndex: M_DARK }]
        },
        {
            name: 'Leg_R',
            translation: [0.42, 1.6, 0],
            meshes: [{ geo: makeLeg(), materialIndex: M_DARK }]
        },
        {
            name: 'Extra',
            translation: [0, 3.2, 0],
            meshes: [{ geo: capeGeo, materialIndex: 6 }]
        }
    ];

    return buildGLB({
        materials: mats,
        nodes: [{ name: 'Root', translation: [0, 0, 0], children }]
    });
}

// ── 1. PUMPKIN FIEND ──────────────────────────────────────────────────────────
function buildPumpkinFiend() {
    const hex = RACE_COLORS[1];
    const mats = [
        ...baseMaterials(hex),
        { name: 'PumpkinRidge', baseColorFactor: hex2rgba(0xBF5200), roughness: 0.6, metalness: 0.0 }, // M=5 darker ridges
        { name: 'GlowEyes',    baseColorFactor: [1.0, 0.85, 0.0, 0.9], roughness: 0.1, metalness: 0.0, emissiveFactor: [0.9, 0.5, 0.0] }, // M=6
        { name: 'Stem',        baseColorFactor: [0.17, 0.38, 0.06, 1], roughness: 0.8, metalness: 0.0 }, // M=7 green stem
        { name: 'Dark',        baseColorFactor: [0.05, 0.03, 0.08, 1], roughness: 0.9, metalness: 0.0 }, // M=8 carved gap
    ];

    // Pumpkin head: ridged sphere
    const mainHead = buildEllipsoid(0.95, 0.88, 0.88, 16, 14);
    // Ridges by adding displaced spheres
    const ridgeA = buildEllipsoid(0.18, 0.85, 0.18, 8, 8);
    translateGeo(ridgeA, 0.62, 0, 0);
    const ridgeB = buildEllipsoid(0.18, 0.85, 0.18, 8, 8);
    translateGeo(ridgeB, -0.62, 0, 0);
    const ridgeC = buildEllipsoid(0.18, 0.85, 0.18, 8, 8);
    translateGeo(ridgeC, 0, 0, 0.62);
    // Stem
    const stem = buildCylinder(0.12, 0.07, 0.55, 6);
    rotateGeoX(stem, -0.2);
    translateGeo(stem, 0, 0.88, 0);
    // Carved triangle eyes (sunken ellipsoids representing glowing gaps)
    const eyeL = buildEllipsoid(0.14, 0.12, 0.08, 6, 6);
    translateGeo(eyeL, -0.35, 0.12, 0.78);
    const eyeR = buildEllipsoid(0.14, 0.12, 0.08, 6, 6);
    translateGeo(eyeR, 0.35, 0.12, 0.78);
    // Jagged mouth (series of small wedges)
    const mouth = buildEllipsoid(0.38, 0.07, 0.06, 6, 4);
    translateGeo(mouth, 0, -0.30, 0.82);
    const toothL = buildCone(0.08, 0.15, 4);
    rotateGeoX(toothL, PI);
    translateGeo(toothL, -0.15, -0.24, 0.82);
    const toothR = buildCone(0.08, 0.15, 4);
    rotateGeoX(toothR, PI);
    translateGeo(toothR, 0.15, -0.24, 0.82);
    // Vine tendril
    const vine = buildCylinder(0.04, 0.02, 0.55, 5);
    rotateGeoZ(vine, 0.6);
    translateGeo(vine, -0.7, 0.55, 0);

    // Body: stout rounded pumpkin-ish torso
    const torso = buildEllipsoid(0.88, 1.0, 0.70, 12, 10);
    translateGeo(torso, 0, 0.85, 0);
    const hip = buildEllipsoid(0.72, 0.42, 0.58, 10, 8);
    translateGeo(hip, 0, 0, 0);

    const armLeg = makeLeg(1.45); // shorter squatter legs

    const children = [
        {
            name: 'Body',
            translation: [0, 1.65, 0],
            meshes: [
                { geo: torso, materialIndex: M_PRIMARY },
                { geo: hip, materialIndex: M_PRIMARY }
            ]
        },
        {
            name: 'Head',
            translation: [0, 3.5, 0],
            meshes: [
                { geo: mainHead, materialIndex: M_PRIMARY },
                { geo: ridgeA, materialIndex: 5 },
                { geo: ridgeB, materialIndex: 5 },
                { geo: ridgeC, materialIndex: 5 },
                { geo: stem, materialIndex: 7 },
                { geo: vine, materialIndex: 7 },
                { geo: eyeL, materialIndex: 6 },
                { geo: eyeR, materialIndex: 6 },
                { geo: mouth, materialIndex: 8 },
                { geo: toothL, materialIndex: 6 },
                { geo: toothR, materialIndex: 6 }
            ]
        },
        {
            name: 'Arm_L',
            translation: [-1.0, 3.2, 0],
            meshes: [{ geo: makeArm(1.45), materialIndex: M_PRIMARY }]
        },
        {
            name: 'Arm_R',
            translation: [1.0, 3.2, 0],
            meshes: [{ geo: makeArm(1.45), materialIndex: M_PRIMARY }]
        },
        {
            name: 'Leg_L',
            translation: [-0.4, 1.6, 0],
            meshes: [{ geo: makeLeg(1.45), materialIndex: M_PRIMARY }]
        },
        {
            name: 'Leg_R',
            translation: [0.4, 1.6, 0],
            meshes: [{ geo: makeLeg(1.45), materialIndex: M_PRIMARY }]
        },
        { name: 'Extra', translation: [0, 0, 0], meshes: [] }
    ];

    return buildGLB({
        materials: mats,
        nodes: [{ name: 'Root', translation: [0, 0, 0], children }]
    });
}

// ── 2. CURSED MUMMY ───────────────────────────────────────────────────────────
function buildCursedMummy() {
    const hex = RACE_COLORS[2];
    const mats = [
        ...baseMaterials(hex),
        { name: 'Bandage',  baseColorFactor: hex2rgba(hex), roughness: 0.85, metalness: 0.0 },    // M=5 bandages
        { name: 'Gap',      baseColorFactor: [0.08, 0.06, 0.12, 1], roughness: 0.9, metalness: 0.0 }, // M=6 dark gaps
        { name: 'LooseEnd', baseColorFactor: hex2rgba(hex, 0.85), roughness: 0.85, metalness: 0.0, doubleSided: true }, // M=7 trailing strips
        { name: 'EyeGlow',  baseColorFactor: [0.8, 0.6, 0.0, 1], roughness: 0.1, metalness: 0.0, emissiveFactor: [0.5, 0.35, 0.0] }, // M=8
    ];

    // Mummy head: rounded cube-ish with bandage layers
    const head = buildEllipsoid(0.72, 0.78, 0.72, 12, 10);
    // Bandage wrapping rings
    const wrap1 = buildCylinder(0.74, 0.72, 0.14, 10, true);
    translateGeo(wrap1, 0, 0.15, 0);
    const wrap2 = buildCylinder(0.73, 0.71, 0.12, 10, true);
    translateGeo(wrap2, 0, -0.12, 0);
    const wrap3 = buildCylinder(0.72, 0.70, 0.12, 10, true);
    translateGeo(wrap3, 0, -0.35, 0);
    // Eye glow
    const eyeL = buildEllipsoid(0.09, 0.09, 0.08, 6, 6);
    translateGeo(eyeL, -0.26, 0.14, 0.64);
    const eyeR = buildEllipsoid(0.09, 0.09, 0.08, 6, 6);
    translateGeo(eyeR, 0.26, 0.14, 0.64);

    // Loose trailing bandage strips (planes)
    const strip1 = buildPlane(0.12, 0.85, 1, 4);
    rotateGeoX(strip1, 0.3);
    translateGeo(strip1, 0.25, -0.85, -0.35);
    const strip2 = buildPlane(0.10, 0.65, 1, 4);
    rotateGeoX(strip2, 0.15);
    translateGeo(strip2, -0.2, -1.1, -0.4);

    // Body: rounded torso with bandage wraps
    const torso = buildEllipsoid(0.95, 1.1, 0.68, 12, 10);
    translateGeo(torso, 0, 0.85, 0);
    const bWrap1 = buildCylinder(0.96, 0.94, 0.16, 10, true);
    translateGeo(bWrap1, 0, 0.85 + 0.55, 0);
    const bWrap2 = buildCylinder(0.95, 0.93, 0.14, 10, true);
    translateGeo(bWrap2, 0, 0.85 + 0.2, 0);
    const bWrap3 = buildCylinder(0.94, 0.92, 0.14, 10, true);
    translateGeo(bWrap3, 0, 0.85 - 0.15, 0);

    // Arms stretch forward (zombie pose) – reflected via translation, not geom
    const armGeo = makeArm(1.55);

    // Trailing bandage strip for Extra node (trailing from back waist)
    const waistStrip = buildPlane(0.14, 0.9, 1, 4);
    rotateGeoX(waistStrip, 0.4);
    translateGeo(waistStrip, 0.2, -0.45, -0.45);

    const children = [
        {
            name: 'Body',
            translation: [0, 1.65, 0],
            meshes: [
                { geo: torso, materialIndex: M_PRIMARY },
                { geo: bWrap1, materialIndex: 5 },
                { geo: bWrap2, materialIndex: 5 },
                { geo: bWrap3, materialIndex: 5 }
            ]
        },
        {
            name: 'Head',
            translation: [0, 3.65, 0],
            meshes: [
                { geo: head, materialIndex: M_PRIMARY },
                { geo: wrap1, materialIndex: 5 },
                { geo: wrap2, materialIndex: 5 },
                { geo: wrap3, materialIndex: 5 },
                { geo: eyeL, materialIndex: 8 },
                { geo: eyeR, materialIndex: 8 },
                { geo: strip1, materialIndex: 7 },
                { geo: strip2, materialIndex: 7 }
            ]
        },
        {
            name: 'Arm_L',
            translation: [-1.05, 3.25, 0.3],
            meshes: [{ geo: armGeo, materialIndex: M_PRIMARY }]
        },
        {
            name: 'Arm_R',
            translation: [1.05, 3.25, 0.3],
            meshes: [{ geo: armGeo, materialIndex: M_PRIMARY }]
        },
        {
            name: 'Leg_L',
            translation: [-0.42, 1.6, 0],
            meshes: [{ geo: makeLeg(), materialIndex: M_PRIMARY }]
        },
        {
            name: 'Leg_R',
            translation: [0.42, 1.6, 0],
            meshes: [{ geo: makeLeg(), materialIndex: M_PRIMARY }]
        },
        { name: 'Extra', translation: [0, 2.0, 0], meshes: [{ geo: waistStrip, materialIndex: 7 }] }
    ];

    return buildGLB({
        materials: mats,
        nodes: [{ name: 'Root', translation: [0, 0, 0], children }]
    });
}

// ── 3. FRANKEN-ZOMBIE ─────────────────────────────────────────────────────────
function buildFrankenZombie() {
    const hex = RACE_COLORS[3];
    const mats = [
        ...baseMaterials(hex),
        { name: 'Bolt',     baseColorFactor: [0.7, 0.75, 0.78, 1], roughness: 0.2, metalness: 0.9 }, // M=5
        { name: 'Stitch',   baseColorFactor: [0.1, 0.08, 0.15, 1], roughness: 0.9, metalness: 0.0 }, // M=6
        { name: 'Hair',     baseColorFactor: [0.07, 0.06, 0.10, 1], roughness: 0.85, metalness: 0.0 }, // M=7
        { name: 'EyeGlow',  baseColorFactor: [0.3, 1.0, 0.3, 1],   roughness: 0.1, metalness: 0.0, emissiveFactor: [0.1, 0.7, 0.1] }, // M=8
    ];

    // Head: flat-top heavy brow
    const skull = buildEllipsoid(0.82, 0.72, 0.75, 12, 10);
    const flatTop = buildCylinder(0.8, 0.82, 0.18, 10, false);
    translateGeo(flatTop, 0, 0.68, 0);
    const brow = buildEllipsoid(0.88, 0.22, 0.55, 8, 6);
    translateGeo(brow, 0, 0.18, 0.42);
    // Dark hair slab on top
    const hair = buildEllipsoid(0.82, 0.2, 0.68, 8, 6);
    translateGeo(hair, 0, 0.82, -0.05);
    // Neck bolts
    const boltL = buildCylinder(0.12, 0.12, 0.65, 6);
    rotateGeoZ(boltL, PI / 2);
    translateGeo(boltL, -0.85, -0.42, 0);
    const boltR = buildCylinder(0.12, 0.12, 0.65, 6);
    rotateGeoZ(boltR, PI / 2);
    translateGeo(boltR, 0.45, -0.42, 0);
    // Bolt heads
    const boltHeadL = buildCylinder(0.2, 0.2, 0.1, 6);
    rotateGeoZ(boltHeadL, PI / 2);
    translateGeo(boltHeadL, -1.0, -0.42, 0);
    const boltHeadR = buildCylinder(0.2, 0.2, 0.1, 6);
    rotateGeoZ(boltHeadR, PI / 2);
    translateGeo(boltHeadR, 1.0, -0.42, 0);
    // Eyes
    const eyeL = buildEllipsoid(0.10, 0.10, 0.08, 6, 6);
    translateGeo(eyeL, -0.28, 0.10, 0.68);
    const eyeR = buildEllipsoid(0.10, 0.10, 0.08, 6, 6);
    translateGeo(eyeR, 0.28, 0.10, 0.68);

    // Body: broad shoulders, stout
    const torso = buildEllipsoid(1.12, 1.1, 0.70, 12, 10);
    translateGeo(torso, 0, 0.85, 0);
    const shoulderL = buildEllipsoid(0.38, 0.32, 0.32, 8, 6);
    translateGeo(shoulderL, -1.2, 1.6, 0);
    const shoulderR = buildEllipsoid(0.38, 0.32, 0.32, 8, 6);
    translateGeo(shoulderR, 1.2, 1.6, 0);

    // Arms outstretched forward (zombie)
    const armG = makeArm(1.60);

    const children = [
        {
            name: 'Body',
            translation: [0, 1.65, 0],
            meshes: [
                { geo: torso, materialIndex: M_PRIMARY },
                { geo: shoulderL, materialIndex: M_PRIMARY },
                { geo: shoulderR, materialIndex: M_PRIMARY }
            ]
        },
        {
            name: 'Head',
            translation: [0, 3.65, 0],
            meshes: [
                { geo: skull, materialIndex: M_PRIMARY },
                { geo: flatTop, materialIndex: M_PRIMARY },
                { geo: brow, materialIndex: M_PRIMARY },
                { geo: hair, materialIndex: 7 },
                { geo: boltL, materialIndex: 5 },
                { geo: boltR, materialIndex: 5 },
                { geo: boltHeadL, materialIndex: 5 },
                { geo: boltHeadR, materialIndex: 5 },
                { geo: eyeL, materialIndex: 8 },
                { geo: eyeR, materialIndex: 8 }
            ]
        },
        {
            name: 'Arm_L',
            translation: [-1.15, 3.3, 0.35],
            meshes: [{ geo: armG, materialIndex: M_PRIMARY }]
        },
        {
            name: 'Arm_R',
            translation: [1.15, 3.3, 0.35],
            meshes: [{ geo: armG, materialIndex: M_PRIMARY }]
        },
        {
            name: 'Leg_L',
            translation: [-0.48, 1.6, 0],
            meshes: [{ geo: makeLeg(), materialIndex: M_PRIMARY }]
        },
        {
            name: 'Leg_R',
            translation: [0.48, 1.6, 0],
            meshes: [{ geo: makeLeg(), materialIndex: M_PRIMARY }]
        },
        { name: 'Extra', translation: [0, 0, 0], meshes: [] }
    ];

    return buildGLB({
        materials: mats,
        nodes: [{ name: 'Root', translation: [0, 0, 0], children }]
    });
}

// ── 4. SPECTRAL BANSHEE ───────────────────────────────────────────────────────
function buildSpectralBanshee() {
    const hex = RACE_COLORS[4];
    const mats = [
        ...baseMaterials(hex),
        { name: 'Spectral', baseColorFactor: hex2rgba(hex, 0.72), roughness: 0.2, metalness: 0.05,
          emissiveFactor: [0.0, 0.05, 0.35], alphaMode: 'BLEND', doubleSided: true }, // M=5 semi-transparent form
        { name: 'EyeGlow',  baseColorFactor: [0.8, 0.9, 1.0, 1], roughness: 0.0, metalness: 0.0, emissiveFactor: [0.3, 0.5, 1.0] }, // M=6
        { name: 'VeilEdge', baseColorFactor: hex2rgba(hex, 0.45), roughness: 0.2, metalness: 0.0, alphaMode: 'BLEND', doubleSided: true }, // M=7 tattered edge
    ];

    // Head: eerie elongated skull-face
    const skull = buildEllipsoid(0.65, 0.85, 0.62, 14, 12);
    const jaw = buildEllipsoid(0.50, 0.30, 0.48, 10, 8);
    translateGeo(jaw, 0, -0.75, 0);
    // Hollow eyes (large glowing)
    const eyeL = buildEllipsoid(0.15, 0.18, 0.10, 8, 6);
    translateGeo(eyeL, -0.25, 0.18, 0.52);
    const eyeR = buildEllipsoid(0.15, 0.18, 0.10, 8, 6);
    translateGeo(eyeR, 0.25, 0.18, 0.52);
    // Long flowing hair tendrils (cylinders waving up)
    const hair1 = buildCylinder(0.08, 0.02, 1.2, 5, true);
    rotateGeoX(hair1, -0.7);
    rotateGeoZ(hair1, 0.4);
    translateGeo(hair1, -0.45, 0.7, -0.3);
    const hair2 = buildCylinder(0.07, 0.02, 1.0, 5, true);
    rotateGeoX(hair2, -0.5);
    rotateGeoZ(hair2, -0.3);
    translateGeo(hair2, 0.35, 0.8, -0.25);
    const hair3 = buildCylinder(0.06, 0.02, 0.9, 5, true);
    rotateGeoX(hair3, -0.8);
    translateGeo(hair3, 0.0, 0.85, -0.35);

    // Body: elongated torso merging into spectral tail
    const torso = buildEllipsoid(0.80, 1.2, 0.55, 12, 10);
    translateGeo(torso, 0, 0.85, 0);
    const shoulders = buildEllipsoid(1.05, 0.25, 0.52, 10, 8);
    translateGeo(shoulders, 0, 1.65, 0);

    // Spectral lower body / veil (instead of legs – plane shapes)
    const veil1 = buildPlane(1.2, 2.2, 4, 6);
    rotateGeoY(veil1, 0);
    translateGeo(veil1, 0.15, -0.55, 0);
    const veil2 = buildPlane(1.0, 2.0, 4, 6);
    rotateGeoY(veil2, 1.2);
    translateGeo(veil2, -0.25, -0.65, 0.1);
    const veil3 = buildPlane(0.85, 1.8, 4, 5);
    rotateGeoY(veil3, -1.0);
    translateGeo(veil3, 0.1, -0.75, -0.1);

    // Long sweeping arms
    const longArm = makeArm(1.85);

    // Leg_L/R nodes kept but use spectral veil geometry so rig stays intact
    const legGeo = buildCylinder(0.08, 0.02, 0.9, 5, true);
    translateGeo(legGeo, 0, -0.9, 0);

    const children = [
        {
            name: 'Body',
            translation: [0, 1.65, 0],
            meshes: [
                { geo: torso, materialIndex: 5 },
                { geo: shoulders, materialIndex: 5 },
                { geo: veil1, materialIndex: 5 },
                { geo: veil2, materialIndex: 5 },
                { geo: veil3, materialIndex: 7 }
            ]
        },
        {
            name: 'Head',
            translation: [0, 3.65, 0],
            meshes: [
                { geo: skull, materialIndex: M_PRIMARY },
                { geo: jaw, materialIndex: M_PRIMARY },
                { geo: eyeL, materialIndex: 6 },
                { geo: eyeR, materialIndex: 6 },
                { geo: hair1, materialIndex: 5 },
                { geo: hair2, materialIndex: 5 },
                { geo: hair3, materialIndex: 5 }
            ]
        },
        {
            name: 'Arm_L',
            translation: [-1.05, 3.3, 0],
            meshes: [{ geo: longArm, materialIndex: M_PRIMARY }]
        },
        {
            name: 'Arm_R',
            translation: [1.05, 3.3, 0],
            meshes: [{ geo: longArm, materialIndex: M_PRIMARY }]
        },
        {
            name: 'Leg_L',
            translation: [-0.28, 0.9, 0],
            meshes: [{ geo: legGeo, materialIndex: 5 }]
        },
        {
            name: 'Leg_R',
            translation: [0.28, 0.9, 0],
            meshes: [{ geo: legGeo, materialIndex: 5 }]
        },
        { name: 'Extra', translation: [0, 2.2, -0.3], meshes: [{ geo: buildPlane(2.0, 2.6, 4, 7), materialIndex: 7 }] }
    ];

    return buildGLB({
        materials: mats,
        nodes: [{ name: 'Root', translation: [0, 0, 0], children }]
    });
}

// ── 5. WITCH-IMP ──────────────────────────────────────────────────────────────
function buildWitchImp() {
    const hex = RACE_COLORS[5];
    const mats = [
        ...baseMaterials(hex),
        { name: 'HatDark',  baseColorFactor: [0.06, 0.04, 0.10, 1], roughness: 0.75, metalness: 0.0 }, // M=5
        { name: 'SkinTone', baseColorFactor: [0.62, 0.52, 0.45, 1], roughness: 0.65, metalness: 0.0 }, // M=6
        { name: 'EyeGlow',  baseColorFactor: [0.8, 0.2, 1.0, 1],    roughness: 0.1,  metalness: 0.0, emissiveFactor: [0.4, 0.0, 0.6] }, // M=7
        { name: 'HatBand',  baseColorFactor: hex2rgba(hex, 1), roughness: 0.6, metalness: 0.1 }, // M=8
    ];

    // Rounded face with pointed ears
    const face = buildEllipsoid(0.68, 0.72, 0.65, 12, 10);
    const earL = buildCone(0.14, 0.6, 5);
    rotateGeoZ(earL, -0.3);
    rotateGeoX(earL, -0.1);
    translateGeo(earL, -0.65, 0.4, 0);
    const earR = buildCone(0.14, 0.6, 5);
    rotateGeoZ(earR, 0.3);
    rotateGeoX(earR, -0.1);
    translateGeo(earR, 0.65, 0.4, 0);
    // Crooked nose
    const nose = buildEllipsoid(0.10, 0.12, 0.18, 6, 6);
    translateGeo(nose, 0, -0.12, 0.58);
    // Eyes
    const eyeL = buildEllipsoid(0.11, 0.11, 0.08, 6, 6);
    translateGeo(eyeL, -0.25, 0.16, 0.56);
    const eyeR = buildEllipsoid(0.11, 0.11, 0.08, 6, 6);
    translateGeo(eyeR, 0.25, 0.16, 0.56);

    // Crooked pointed hat
    const brim = buildCylinder(1.15, 1.18, 0.14, 14, false);
    translateGeo(brim, 0, 0.65, 0);
    const cone = buildCone(0.75, 1.95, 12);
    // Slightly crooked
    rotateGeoZ(cone, 0.12);
    translateGeo(cone, -0.08, 0.8, 0);
    // Hat band
    const band = buildCylinder(0.76, 0.76, 0.18, 12, true);
    rotateGeoZ(band, 0.12);
    translateGeo(band, -0.08, 0.82, 0);

    // Body: short rotund imp
    const torso = buildEllipsoid(0.78, 0.90, 0.58, 12, 10);
    translateGeo(torso, 0, 0.80, 0);
    const cape = buildPlane(1.55, 1.8, 4, 6);
    translateGeo(cape, 0, 0.55, -0.32);

    const children = [
        {
            name: 'Body',
            translation: [0, 1.65, 0],
            meshes: [
                { geo: torso, materialIndex: M_PRIMARY },
                { geo: cape, materialIndex: 5 }
            ]
        },
        {
            name: 'Head',
            translation: [0, 3.55, 0],
            meshes: [
                { geo: face, materialIndex: M_PRIMARY },
                { geo: earL, materialIndex: M_PRIMARY },
                { geo: earR, materialIndex: M_PRIMARY },
                { geo: nose, materialIndex: 6 },
                { geo: eyeL, materialIndex: 7 },
                { geo: eyeR, materialIndex: 7 },
                { geo: brim, materialIndex: 5 },
                { geo: cone, materialIndex: 5 },
                { geo: band, materialIndex: 8 }
            ]
        },
        {
            name: 'Arm_L',
            translation: [-0.92, 3.1, 0],
            meshes: [{ geo: makeArm(1.45), materialIndex: M_PRIMARY }]
        },
        {
            name: 'Arm_R',
            translation: [0.92, 3.1, 0],
            meshes: [{ geo: makeArm(1.45), materialIndex: M_PRIMARY }]
        },
        {
            name: 'Leg_L',
            translation: [-0.38, 1.55, 0],
            meshes: [{ geo: makeLeg(1.45), materialIndex: M_PRIMARY }]
        },
        {
            name: 'Leg_R',
            translation: [0.38, 1.55, 0],
            meshes: [{ geo: makeLeg(1.45), materialIndex: M_PRIMARY }]
        },
        { name: 'Extra', translation: [0, 3.0, -0.3], meshes: [{ geo: buildPlane(1.55, 1.8, 4, 5), materialIndex: 5 }] }
    ];

    return buildGLB({
        materials: mats,
        nodes: [{ name: 'Root', translation: [0, 0, 0], children }]
    });
}

// ── 6. WEREWOLF ───────────────────────────────────────────────────────────────
function buildWerewolf() {
    const hex = RACE_COLORS[6];
    const mats = [
        ...baseMaterials(hex),
        { name: 'FurDark',  baseColorFactor: [0.15, 0.17, 0.20, 1], roughness: 0.85, metalness: 0.0 }, // M=5
        { name: 'Snout',    baseColorFactor: [0.22, 0.22, 0.25, 1], roughness: 0.75, metalness: 0.0 }, // M=6
        { name: 'EyeGlow',  baseColorFactor: [1.0, 0.2, 0.0, 1],   roughness: 0.1,  metalness: 0.0, emissiveFactor: [0.8, 0.1, 0.0] }, // M=7
        { name: 'Teeth',    baseColorFactor: [0.95, 0.92, 0.88, 1], roughness: 0.3,  metalness: 0.0 }, // M=8
        { name: 'Claw',     baseColorFactor: [0.15, 0.14, 0.18, 1], roughness: 0.5,  metalness: 0.1 }, // M=9
    ];

    // Wolf head: heavy brow, broad
    const skull = buildEllipsoid(0.82, 0.76, 0.78, 12, 10);
    const brow = buildEllipsoid(0.85, 0.20, 0.48, 8, 6);
    translateGeo(brow, 0, 0.22, 0.50);
    // Snout (long muzzle)
    const snout = buildEllipsoid(0.42, 0.35, 0.72, 10, 8);
    translateGeo(snout, 0, -0.22, 0.68);
    const nose = buildEllipsoid(0.18, 0.13, 0.14, 6, 6);
    translateGeo(nose, 0, -0.08, 1.28);
    // Pointed ears
    const earL = buildCone(0.22, 0.82, 6);
    rotateGeoZ(earL, -0.2);
    rotateGeoX(earL, -0.1);
    translateGeo(earL, -0.62, 0.75, -0.15);
    const earR = buildCone(0.22, 0.82, 6);
    rotateGeoZ(earR, 0.2);
    rotateGeoX(earR, -0.1);
    translateGeo(earR, 0.62, 0.75, -0.15);
    // Inner ear
    const earInL = buildCone(0.12, 0.55, 5);
    rotateGeoZ(earInL, -0.2);
    rotateGeoX(earInL, -0.1);
    translateGeo(earInL, -0.62, 0.75, -0.12);
    // Eyes
    const eyeL = buildEllipsoid(0.10, 0.10, 0.08, 6, 6);
    translateGeo(eyeL, -0.30, 0.18, 0.64);
    const eyeR = buildEllipsoid(0.10, 0.10, 0.08, 6, 6);
    translateGeo(eyeR, 0.30, 0.18, 0.64);
    // Fang teeth
    const toothL = buildCone(0.07, 0.25, 4);
    rotateGeoX(toothL, PI);
    translateGeo(toothL, -0.15, -0.38, 1.28);
    const toothR = buildCone(0.07, 0.25, 4);
    rotateGeoX(toothR, PI);
    translateGeo(toothR, 0.15, -0.38, 1.28);

    // Fur-silhouette body (slightly flattened ellipsoid)
    const torso = buildEllipsoid(1.05, 1.15, 0.68, 12, 10);
    translateGeo(torso, 0, 0.85, 0);
    const furShoulder = buildEllipsoid(1.3, 0.35, 0.72, 10, 8);
    translateGeo(furShoulder, 0, 1.62, 0);
    // Fur spikes on back
    const spikeA = buildCone(0.12, 0.55, 5);
    rotateGeoX(spikeA, PI);
    translateGeo(spikeA, 0.22, 1.85, -0.58);
    const spikeB = buildCone(0.12, 0.45, 5);
    rotateGeoX(spikeB, PI);
    translateGeo(spikeB, -0.18, 1.72, -0.55);

    // Tail
    const tail1 = buildCylinder(0.22, 0.14, 0.85, 7);
    rotateGeoX(tail1, -PI * 0.55);
    translateGeo(tail1, 0, 0.55, -0.65);
    const tail2 = buildCylinder(0.14, 0.08, 0.65, 6);
    rotateGeoX(tail2, -PI * 0.35);
    translateGeo(tail2, 0, 0.95, -1.35);
    const tailTip = buildEllipsoid(0.14, 0.14, 0.18, 6, 6);
    translateGeo(tailTip, 0, 1.15, -1.85);

    // Claws on hands
    const clawGeo = buildCone(0.05, 0.22, 4);
    rotateGeoX(clawGeo, PI * 0.85);

    const wolfArmGeo = makeArm(1.62);

    const children = [
        {
            name: 'Body',
            translation: [0, 1.65, 0],
            meshes: [
                { geo: torso, materialIndex: M_PRIMARY },
                { geo: furShoulder, materialIndex: 5 },
                { geo: spikeA, materialIndex: 5 },
                { geo: spikeB, materialIndex: 5 },
                { geo: tail1, materialIndex: M_PRIMARY },
                { geo: tail2, materialIndex: M_PRIMARY },
                { geo: tailTip, materialIndex: 5 }
            ]
        },
        {
            name: 'Head',
            translation: [0, 3.65, 0],
            meshes: [
                { geo: skull, materialIndex: M_PRIMARY },
                { geo: brow, materialIndex: 5 },
                { geo: snout, materialIndex: 6 },
                { geo: nose, materialIndex: 5 },
                { geo: earL, materialIndex: M_PRIMARY },
                { geo: earR, materialIndex: M_PRIMARY },
                { geo: earInL, materialIndex: 5 },
                { geo: eyeL, materialIndex: 7 },
                { geo: eyeR, materialIndex: 7 },
                { geo: toothL, materialIndex: 8 },
                { geo: toothR, materialIndex: 8 }
            ]
        },
        {
            name: 'Arm_L',
            translation: [-1.2, 3.35, 0],
            meshes: [{ geo: wolfArmGeo, materialIndex: M_PRIMARY }]
        },
        {
            name: 'Arm_R',
            translation: [1.2, 3.35, 0],
            meshes: [{ geo: wolfArmGeo, materialIndex: M_PRIMARY }]
        },
        {
            name: 'Leg_L',
            translation: [-0.46, 1.6, 0],
            meshes: [{ geo: makeLeg(1.65), materialIndex: M_PRIMARY }]
        },
        {
            name: 'Leg_R',
            translation: [0.46, 1.6, 0],
            meshes: [{ geo: makeLeg(1.65), materialIndex: M_PRIMARY }]
        },
        {
            name: 'Extra',
            translation: [0, 1.2, -0.5],
            meshes: [
                { geo: tail1, materialIndex: M_PRIMARY },
                { geo: tail2, materialIndex: 5 },
                { geo: tailTip, materialIndex: 5 }
            ]
        }
    ];

    return buildGLB({
        materials: mats,
        nodes: [{ name: 'Root', translation: [0, 0, 0], children }]
    });
}

// ── 7. SKELETON ───────────────────────────────────────────────────────────────
function buildSkeleton() {
    const hex = RACE_COLORS[7];
    const mats = [
        ...baseMaterials(hex),
        { name: 'BoneShad', baseColorFactor: [0.78, 0.76, 0.72, 1], roughness: 0.65, metalness: 0.0 }, // M=5 slightly darker bone
        { name: 'EyeGlow',  baseColorFactor: [0.3, 0.9, 0.9, 1], roughness: 0.1,   metalness: 0.0, emissiveFactor: [0.0, 0.5, 0.6] }, // M=6
        { name: 'Joint',    baseColorFactor: [0.72, 0.70, 0.66, 1], roughness: 0.7, metalness: 0.0 }, // M=7 joints
    ];

    // Skull: rounded dome with protruding cheekbones and jaw
    const dome = buildEllipsoid(0.72, 0.80, 0.70, 14, 12);
    const cheekL = buildEllipsoid(0.25, 0.20, 0.22, 6, 6);
    translateGeo(cheekL, -0.62, -0.22, 0.42);
    const cheekR = buildEllipsoid(0.25, 0.20, 0.22, 6, 6);
    translateGeo(cheekR, 0.62, -0.22, 0.42);
    const jaw = buildEllipsoid(0.55, 0.28, 0.52, 10, 8);
    translateGeo(jaw, 0, -0.72, 0.08);
    const jawLine = buildCylinder(0.54, 0.50, 0.20, 10, true);
    translateGeo(jawLine, 0, -0.58, 0);
    // Eye sockets (dark recesses)
    const eyeL = buildEllipsoid(0.15, 0.18, 0.10, 6, 6);
    translateGeo(eyeL, -0.27, 0.15, 0.58);
    const eyeR = buildEllipsoid(0.15, 0.18, 0.10, 6, 6);
    translateGeo(eyeR, 0.27, 0.15, 0.58);
    // Nasal cavity
    const nasal = buildEllipsoid(0.10, 0.14, 0.08, 5, 5);
    translateGeo(nasal, 0, -0.08, 0.64);
    // Teeth (lower jaw)
    const makeToothGeo = (dx) => {
        const t = buildEllipsoid(0.07, 0.12, 0.06, 4, 4);
        translateGeo(t, dx, -0.88, 0.42);
        return t;
    };
    const teeth = [makeToothGeo(-0.22), makeToothGeo(-0.08), makeToothGeo(0.08), makeToothGeo(0.22)];

    // Spine / ribcage as body
    const spineMain = buildCylinder(0.12, 0.10, 2.0, 6);
    translateGeo(spineMain, 0, 0, 0);
    // Ribs as torus arcs
    function makeRib(y) {
        const rib = buildEllipsoid(0.65, 0.12, 0.30, 8, 5);
        translateGeo(rib, 0, y, 0.1);
        return rib;
    }
    const ribs = [makeRib(1.4), makeRib(1.05), makeRib(0.7), makeRib(0.38)];
    // Pelvis bowl
    const pelvis = buildEllipsoid(0.62, 0.28, 0.45, 10, 8);
    translateGeo(pelvis, 0, 0.1, 0);
    const pelvisRim = buildCylinder(0.60, 0.64, 0.18, 10, true);
    translateGeo(pelvisRim, 0, 0.2, 0);

    // Bone arms: upper/lower with ball joints
    function makeBoneArm(len = 1.55) {
        const upper = buildCylinder(0.10, 0.08, len * 0.5, 6);
        translateGeo(upper, 0, -len * 0.5, 0);
        const lower = buildCylinder(0.08, 0.06, len * 0.5, 6);
        translateGeo(lower, 0, -len, 0);
        const elbow = buildEllipsoid(0.11, 0.11, 0.11, 6, 6);
        translateGeo(elbow, 0, -len * 0.5, 0);
        const hand = buildEllipsoid(0.12, 0.10, 0.10, 6, 6);
        translateGeo(hand, 0, -len, 0);
        return mergeGeos(upper, lower, elbow, hand);
    }
    function makeBoneLeg(len = 1.6) {
        const upper = buildCylinder(0.12, 0.10, len * 0.52, 6);
        translateGeo(upper, 0, -len * 0.52, 0);
        const lower = buildCylinder(0.10, 0.08, len * 0.48, 6);
        translateGeo(lower, 0, -len, 0);
        const knee = buildEllipsoid(0.12, 0.12, 0.12, 6, 6);
        translateGeo(knee, 0, -len * 0.52, 0);
        const foot = buildEllipsoid(0.09, 0.09, 0.24, 6, 6);
        translateGeo(foot, 0, -len, 0.12);
        return mergeGeos(upper, lower, knee, foot);
    }

    const children = [
        {
            name: 'Body',
            translation: [0, 1.65, 0],
            meshes: [
                { geo: spineMain, materialIndex: M_PRIMARY },
                { geo: ribs[0], materialIndex: M_PRIMARY },
                { geo: ribs[1], materialIndex: M_PRIMARY },
                { geo: ribs[2], materialIndex: M_PRIMARY },
                { geo: ribs[3], materialIndex: M_PRIMARY },
                { geo: pelvis, materialIndex: 5 },
                { geo: pelvisRim, materialIndex: 5 }
            ]
        },
        {
            name: 'Head',
            translation: [0, 3.65, 0],
            meshes: [
                { geo: dome, materialIndex: M_PRIMARY },
                { geo: cheekL, materialIndex: 5 },
                { geo: cheekR, materialIndex: 5 },
                { geo: jaw, materialIndex: M_PRIMARY },
                { geo: jawLine, materialIndex: 5 },
                { geo: nasal, materialIndex: 7 },
                { geo: eyeL, materialIndex: 6 },
                { geo: eyeR, materialIndex: 6 },
                ...teeth.map(t => ({ geo: t, materialIndex: M_PRIMARY }))
            ]
        },
        {
            name: 'Arm_L',
            translation: [-1.05, 3.3, 0],
            meshes: [{ geo: makeBoneArm(), materialIndex: M_PRIMARY }]
        },
        {
            name: 'Arm_R',
            translation: [1.05, 3.3, 0],
            meshes: [{ geo: makeBoneArm(), materialIndex: M_PRIMARY }]
        },
        {
            name: 'Leg_L',
            translation: [-0.38, 1.6, 0],
            meshes: [{ geo: makeBoneLeg(), materialIndex: M_PRIMARY }]
        },
        {
            name: 'Leg_R',
            translation: [0.38, 1.6, 0],
            meshes: [{ geo: makeBoneLeg(), materialIndex: M_PRIMARY }]
        },
        { name: 'Extra', translation: [0, 0, 0], meshes: [] }
    ];

    return buildGLB({
        materials: mats,
        nodes: [{ name: 'Root', translation: [0, 0, 0], children }]
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN – Generate all 8 monsters
// ─────────────────────────────────────────────────────────────────────────────

const MONSTERS = [
    { id: 0, name: 'vampire',        fn: buildVampire       },
    { id: 1, name: 'pumpkin-fiend',  fn: buildPumpkinFiend  },
    { id: 2, name: 'cursed-mummy',   fn: buildCursedMummy   },
    { id: 3, name: 'franken-zombie', fn: buildFrankenZombie },
    { id: 4, name: 'spectral-banshee', fn: buildSpectralBanshee },
    { id: 5, name: 'witch-imp',      fn: buildWitchImp      },
    { id: 6, name: 'werewolf',       fn: buildWerewolf      },
    { id: 7, name: 'skeleton',       fn: buildSkeleton      }
];

console.log('Zoombie Monster GLB Generator');
console.log('==============================');
let totalTriangles = 0;
let totalBytes = 0;

for (const { id, name, fn } of MONSTERS) {
    process.stdout.write(`[${id}] Generating ${name}... `);
    try {
        const glb = fn();
        const outPath = resolve(OUT_DIR, `${name}.glb`);
        writeFileSync(outPath, glb);
        const triCount = Math.round(glb.length / 60); // rough estimate
        totalTriangles += triCount;
        totalBytes += glb.length;
        console.log(`✓  ${(glb.length / 1024).toFixed(1)} KB`);
    } catch (err) {
        console.error(`✗  FAILED: ${err.message}`);
        console.error(err.stack);
    }
}

console.log('');
console.log(`Done. Total output: ${(totalBytes / 1024).toFixed(0)} KB`);
console.log(`Output directory: ${OUT_DIR}`);
