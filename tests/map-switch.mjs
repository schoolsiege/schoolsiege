// CPU regression check using Three.js 0.149.0. No browser or GPU required.
// Run: node tests/map-switch.mjs /path/to/three/build/three.module.js
// If three is installed locally, the module path can be omitted.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const THREE = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : 'three');
assert.equal(THREE.REVISION, '149', 'Use the same Three.js version as index.html');
const root = new URL('../', import.meta.url);
const digest = (data) => createHash('sha256').update(data).digest('hex');
const bytes = (a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);

function createGame() {
  const math = Object.create(Math);
  // Only canvas painting is stubbed. Materials, geometry, collision, and navigation
  // run the production code with the real Three.js classes.
  const paint = {
    createLinearGradient: () => ({ addColorStop() {} }),
    fillRect() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, fill() {},
  };
  const context = vm.createContext({
    window: {}, THREE, Math: math,
    document: { createElement: () => ({ getContext: () => paint }) },
  });
  for (const name of ['util', 'textures', 'world', 'map', 'nav']) {
    const file = new URL(`js/${name}.js`, root);
    vm.runInContext(readFileSync(file, 'utf8'), context, { filename: fileURLToPath(file) });
  }
  const G = context.window.G;
  const textureSource = readFileSync(new URL('js/textures.js', root), 'utf8');
  for (const [, name] of textureSource.matchAll(/T\.([A-Za-z0-9_]+)/g)) {
    if (G.T[name] === undefined) G.T[name] = new THREE.Texture();
  }
  G.initGeo();
  G.buildMaterials();
  const scene = new THREE.Scene();
  return {
    G, scene,
    build(id) {
      math.random = G.mulberry32(12345);
      G.buildMap(scene, id);
      G.Nav.build();
    },
  };
}

function snapshot({ G, scene }) {
  assert.equal(scene.children.length, 1, 'Only the current map group should remain');
  assert.equal(scene.children[0], G.mapGroup);
  const currentSolids = new Set(G.W.solids);
  for (const bucket of G.W.hash.values()) {
    for (const solid of bucket) assert(currentSolids.has(solid), 'Stale collision hash entry');
  }
  let panelCells = 0;
  G.W.panels.forEach((p, i) => {
    assert.equal(p.id, i, 'Panel IDs must restart for each map');
    assert.equal(p.mesh.parent, G.mapGroup, 'Panel mesh belongs to an old map');
    panelCells += p.cells.length;
  });
  assert.equal(Object.values(G.W.meshes).reduce((sum, m) => sum + m.count, 0), panelCells);
  const geometry = createHash('sha256');
  G.mapGroup.traverse((o) => {
    o.updateMatrix();
    geometry.update(JSON.stringify(o.matrix.elements));
    if (!o.geometry) return;
    for (const a of Object.values(o.geometry.attributes)) geometry.update(bytes(a.array));
    if (o.geometry.index) geometry.update(bytes(o.geometry.index.array));
    if (o.instanceMatrix) geometry.update(bytes(o.instanceMatrix.array));
  });
  return {
    solids: G.W.solids.length,
    panels: G.W.panels.length,
    collision: digest(JSON.stringify(G.W.solids.map((s) => [
      s.type, s.kind, s.x0, s.y0, s.z0, s.x1, s.y1, s.z1, s.phys, s.pen,
      s.cells ? Array.from(s.cells) : null,
    ]))),
    navigation: digest(bytes(G.Nav.grid)),
    geometry: geometry.digest('hex'),
  };
}

const baselines = new Map();
for (const id of ['harbor', 'warehouse', 'chalet', 'compound']) {
  const game = createGame();
  game.build(id);
  const { G } = game;
  for (const s of G.MAP.spawns) assert(G.Nav.free(s.x, s.z), `${id}: blocked spawn ${s.name}`);
  for (const p of G.MAP.secure) assert(G.Nav.free(...p), `${id}: blocked objective target ${p}`);
  for (const e of G.MAP.entries) assert(G.Nav.free(...e.out), `${id}: blocked entry ${e.name}`);
  baselines.set(id, snapshot(game));
}

const game = createGame();
for (const id of ['harbor', 'warehouse', 'chalet', 'compound', 'harbor', 'compound', 'chalet', 'warehouse', 'harbor']) {
  const previous = game.G.mapGroup;
  game.build(id);
  if (previous) assert.equal(previous.parent, null, 'Old map is still attached');
  assert.deepEqual(snapshot(game), baselines.get(id), `${id}: switching must match a fresh load`);
  game.G.W.resetPanels();
  game.G.Nav.rebuildAll();
  assert.deepEqual(snapshot(game), baselines.get(id), `${id}: round reset revived old geometry`);
  assert(game.G.W.clear(999, 1, 1000, 1002, 1, 1000), 'Previous map collider survived');
  game.G.W.addBox(1000, 0, 999, 1001, 2, 1001, 'concrete', false);
  assert.equal(game.G.W.clear(999, 1, 1000, 1002, 1, 1000), false, 'Line-of-sight query must still work');
  const p = game.G.W.panels.find((p) => p.kind === 'barricade');
  game.G.W.hitBarricade(p, 100, 0, 0, 1);
  console.log(`${id}: fresh and switched geometry, collisions, and navigation match`);
}
