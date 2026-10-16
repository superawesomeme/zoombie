/**
 * Quick GLB structural validator – verifies the binary format is well-formed
 * and that all 8 expected node names are present.
 */
import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = resolve(__dirname, '../models');

const REQUIRED_NODES = ['Root', 'Body', 'Head', 'Arm_L', 'Arm_R', 'Leg_L', 'Leg_R', 'Extra'];
const EXPECTED_FILES = [
    'vampire.glb', 'pumpkin-fiend.glb', 'cursed-mummy.glb', 'franken-zombie.glb',
    'spectral-banshee.glb', 'witch-imp.glb', 'werewolf.glb', 'skeleton.glb'
];

let allPassed = true;

for (const filename of EXPECTED_FILES) {
    const path = resolve(MODELS_DIR, filename);
    process.stdout.write(`Validating ${filename}... `);
    try {
        const buf = readFileSync(path);
        // Check GLB magic
        const magic = buf.readUInt32LE(0);
        if (magic !== 0x46546C67) throw new Error(`Bad magic: 0x${magic.toString(16)}`);
        const version = buf.readUInt32LE(4);
        if (version !== 2) throw new Error(`Expected version 2, got ${version}`);
        const totalLen = buf.readUInt32LE(8);
        if (totalLen !== buf.length) throw new Error(`Length mismatch: header=${totalLen} actual=${buf.length}`);

        // Read JSON chunk
        const jsonChunkLen = buf.readUInt32LE(12);
        const jsonChunkType = buf.readUInt32LE(16);
        if (jsonChunkType !== 0x4E4F534A) throw new Error('Expected JSON chunk');
        const jsonStr = buf.slice(20, 20 + jsonChunkLen).toString('utf8').replace(/\0+$/, '');
        const gltf = JSON.parse(jsonStr);

        // Verify required node names
        const nodeNames = (gltf.nodes || []).map(n => n.name);
        const missing = REQUIRED_NODES.filter(r => !nodeNames.includes(r));
        if (missing.length > 0) throw new Error(`Missing nodes: ${missing.join(', ')}`);

        // Check materials exist
        if (!gltf.materials || gltf.materials.length === 0) throw new Error('No materials');
        // Check meshes
        if (!gltf.meshes || gltf.meshes.length === 0) throw new Error('No meshes');

        const triEstimate = (gltf.accessors || [])
            .filter(a => a.type === 'SCALAR')
            .reduce((s, a) => s + (a.count || 0), 0) / 3;

        console.log(`✓  nodes:[${nodeNames.join(',')}]  mats:${gltf.materials.length}  ~${Math.round(triEstimate)} tris  ${(buf.length/1024).toFixed(1)}KB`);
    } catch (err) {
        console.error(`✗  ${err.message}`);
        allPassed = false;
    }
}

console.log('');
console.log(allPassed ? '✅ All models validated successfully.' : '❌ Validation FAILED – see errors above.');
process.exit(allPassed ? 0 : 1);
