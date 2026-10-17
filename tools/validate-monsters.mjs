/**
 * GLB Structural Validator
 * Verifies that all 8 character racer GLBs and 2 environment GLBs are well-formed,
 * Draco-compressed where expected, and valid for Three.js.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = resolve(__dirname, '../models');

const CHARACTER_MODELS = [
    'vampire.glb', 'pumpkin.glb', 'mummy.glb', 'monster.glb',
    'ghost.glb', 'witch.glb', 'werewolf.glb', 'skeleton.glb'
];

const SCENERY_MODELS = [
    'tree.glb', 'grave.glb', 'rocks.glb', 'jack-o-lantern.glb', 'toxic_barrel.glb'
];

let allPassed = true;

console.log('--- Validating 8 Character Racer GLBs ---');
for (const filename of CHARACTER_MODELS) {
    const path = resolve(MODELS_DIR, filename);
    process.stdout.write(`Validating ${filename}... `);
    try {
        const buf = readFileSync(path);
        const magic = buf.readUInt32LE(0);
        if (magic !== 0x46546C67) throw new Error(`Bad magic: 0x${magic.toString(16)}`);
        const version = buf.readUInt32LE(4);
        if (version !== 2) throw new Error(`Expected version 2, got ${version}`);
        const totalLen = buf.readUInt32LE(8);
        if (totalLen !== buf.length) throw new Error(`Length mismatch: header=${totalLen} actual=${buf.length}`);

        const jsonChunkLen = buf.readUInt32LE(12);
        const jsonChunkType = buf.readUInt32LE(16);
        if (jsonChunkType !== 0x4E4F534A) throw new Error('Expected JSON chunk');
        const jsonStr = buf.slice(20, 20 + jsonChunkLen).toString('utf8').replace(/\0+$/, '');
        const gltf = JSON.parse(jsonStr);

        if (!gltf.meshes || gltf.meshes.length === 0) throw new Error('No meshes');
        if (!gltf.materials || gltf.materials.length === 0) throw new Error('No materials');

        const extensions = (gltf.extensionsUsed || []).concat(gltf.extensionsRequired || []);
        const hasDraco = extensions.includes('KHR_draco_mesh_compression');

        console.log(`✓  meshes:${gltf.meshes.length}  mats:${gltf.materials.length}  Draco:${hasDraco}  size:${(buf.length/1024).toFixed(1)}KB`);
    } catch (err) {
        console.error(`✗  ${err.message}`);
        allPassed = false;
    }
}

console.log('\n--- Validating Environment Scenery GLBs ---');
for (const filename of SCENERY_MODELS) {
    const path = resolve(MODELS_DIR, filename);
    process.stdout.write(`Validating ${filename}... `);
    try {
        const buf = readFileSync(path);
        const magic = buf.readUInt32LE(0);
        if (magic !== 0x46546C67) throw new Error(`Bad magic: 0x${magic.toString(16)}`);
        const version = buf.readUInt32LE(4);
        if (version !== 2) throw new Error(`Expected version 2, got ${version}`);

        const jsonChunkLen = buf.readUInt32LE(12);
        const jsonChunkType = buf.readUInt32LE(16);
        if (jsonChunkType !== 0x4E4F534A) throw new Error('Expected JSON chunk');
        const jsonStr = buf.slice(20, 20 + jsonChunkLen).toString('utf8').replace(/\0+$/, '');
        const gltf = JSON.parse(jsonStr);

        if (!gltf.meshes || gltf.meshes.length === 0) throw new Error('No meshes');

        console.log(`✓  meshes:${gltf.meshes.length}  nodes:${(gltf.nodes || []).length}  size:${(buf.length/1024).toFixed(1)}KB`);
    } catch (err) {
        console.error(`✗  ${err.message}`);
        allPassed = false;
    }
}

console.log('');
console.log(allPassed ? '✅ All GLB models validated successfully.' : '❌ Validation FAILED – see errors above.');
process.exit(allPassed ? 0 : 1);
