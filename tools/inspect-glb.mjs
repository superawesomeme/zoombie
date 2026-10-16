/**
 * Quick JSON inspection of a single GLB file
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const buf = readFileSync(resolve(__dirname, '../models/vampire.glb'));

const jsonChunkLen = buf.readUInt32LE(12);
const jsonStr = buf.slice(20, 20 + jsonChunkLen).toString('utf8').replace(/\0+$/, '');
const gltf = JSON.parse(jsonStr);

console.log('--- GLTF structure ---');
console.log('scene:', JSON.stringify(gltf.scene));
console.log('scenes:', JSON.stringify(gltf.scenes));
console.log('nodes count:', gltf.nodes?.length);
console.log('node names:', gltf.nodes?.map(n => n.name));
console.log('node children:', gltf.nodes?.map(n => ({ name: n.name, children: n.children })));
console.log('meshes count:', gltf.meshes?.length);
console.log('materials count:', gltf.materials?.length);
console.log('mat names:', gltf.materials?.map(m => m.name));
console.log('accessors count:', gltf.accessors?.length);
