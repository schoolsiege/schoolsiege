// Fortification, 1v1 side swaps, scopes and final kill cam on the real game code.
// node tests/fortify.mjs /path/to/three/build/three.module.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
const THREE = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : 'three');
const noop = () => {};
const paint = new Proxy({ createLinearGradient: () => ({ addColorStop: noop }), measureText: () => ({ width: 20 }) }, { get: (o,k) => o[k] || noop });
function element() {
  const classes = new Set();
  return { style: {}, dataset: {}, children: [], classList: { add: (...xs) => xs.forEach(x => classes.add(x)), remove: (...xs) => xs.forEach(x => classes.delete(x)), contains: x => classes.has(x), toggle: (x,on) => on ? classes.add(x) : classes.delete(x) }, addEventListener: noop, setAttribute: noop, getContext: () => paint, appendChild(e) { this.children.push(e); }, append(...es) { this.children.push(...es); }, prepend: noop, replaceChildren() { this.children = []; }, animate: noop, remove: noop, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 600 }), querySelectorAll: () => [] };
}
const createElement = element;
element = () => ({ ...createElement(), getAnimations: () => [] });
const elements = new Map();
const document = { body: element(), documentElement: element(), createElement: element, getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }, addEventListener: noop, exitPointerLock: noop };
class Renderer {
  constructor() { this.domElement = element(); this.shadowMap = {}; this.capabilities = { getMaxAnisotropy: () => 1 }; }
  setPixelRatio() {} setSize() {} clear() {} render(scene) { scene.updateMatrixWorld(true); } clearDepth() {}
}
const saved = new Map();
const context = vm.createContext({ window: {}, document, THREE: { ...THREE, WebGLRenderer: Renderer }, console, Math, navigator: { maxTouchPoints: 0 }, matchMedia: () => ({ matches: false }), location: { search: '?nolock' }, innerWidth: 1000, innerHeight: 600, devicePixelRatio: 1, addEventListener: noop, requestAnimationFrame: noop, setTimeout: noop, clearTimeout: noop, performance, localStorage: { getItem: k => saved.get(k), setItem: (k,v) => saved.set(k,v) } });
const scripts = readFileSync(new URL('../index.html', import.meta.url), 'utf8').matchAll(/src="(js\/[^"]+)"/g);
for (const [,file] of scripts) vm.runInContext(readFileSync(new URL('../' + file, import.meta.url), 'utf8'), context, { filename: file });
const G = context.window.G;
G.Audio = new Proxy({ ready: false }, { get: (o,k) => k in o ? o[k] : noop });
G.T.build = () => { for (const [,name] of readFileSync(new URL('../js/textures.js', import.meta.url), 'utf8').matchAll(/T\.([A-Za-z0-9_]+)/g)) if (G.T[name] === undefined) G.T[name] = new THREE.Texture(); };
G.Game.init();
context.Math = Object.create(Math); context.Math.random = G.mulberry32(91828);
document.getElementById('crosshair').children = Array.from({length:4}, element);
const game = G.Game, I = G.Input, R = G.Recon, O = G.Operators;
const roof = [], addM = G.Parts.prototype.addM;
G.Parts.prototype.addM = function(geo,mat,m,...rest) {
  const scale = new THREE.Vector3().setFromMatrixScale(m);
  if (mat === G.M.woodDark && Math.abs(scale.x-29.6)<.01) roof.push(m.clone());
  return addM.call(this,geo,mat,m,...rest);
};
function tick(n=1) { for (let i=0;i<n;i++) { game.update(1/60); game.render(1/60); I.pressed = {}; I.mdx = I.mdy = 0; } }
const W = G.W, Fo = G.Fort, p = game.player, V = THREE.Vector3;
// stand in front of a fortify target and face it
function face(center, nx, nz, dist) {
  for (const s of [1, -1]) {
    const x = center.x + nx * s * dist, z = center.z + nz * s * dist;
    if (!W.free(x, z, .32, .36, 1.8)) continue;
    p.pos.set(x, 0.02, z); p.yaw = G.yawOf(center.x - x, center.z - z); p.pitch = -0.12; G.updateHitShapes(p);
    const t = Fo.findTarget(p);
    if (t) return t;
  }
  return null;
}
for (const id of ['harbor', 'warehouse', 'chalet']) {
  game.quitToMenu(); game.selectMap(id);
  const opt = W.panels.filter(q => q.optional);
  assert(opt.length >= 2, id + ' has doors to barricade');
  assert(opt.every(q => !q.alive && !q.placed && q.cells.every(c => !c)), id + ' optional barricades start down');
  // ---- 1v1: attack rounds 1-2, defend 3-4, attack again 5
  game.settings.mode = 'duel'; game.startMatch();
  assert.equal(p.team, 'atk'); assert.equal(game.bots.length, 1); assert.equal(game.bots[0].team, 'def');
  const oppName = game.bots[0].name;
  // defender bot fortifies the objective during prep
  tick(60 * 28);
  assert(W.panels.some(q => q.rf && q.rf.some(Boolean)), id + ' defender bot reinforced nothing');
  const botBars = W.panels.filter(q => q.placed).length;
  assert(game.state === 'prep' || game.state === 'live');
  I.pressed.Enter = true; tick();
  game.endRound('atk', 'TEST'); game.endT = .01; tick();
  assert.equal(game.round, 2); assert.equal(p.team, 'atk');
  assert(!W.panels.some(q => q.rf && q.rf.some(Boolean)), 'reinforcement survived the round reset');
  assert(!W.panels.some(q => q.placed), 'barricade survived the round reset');
  I.pressed.Enter = true; tick();
  game.endRound('def', 'TEST'); game.endT = .01; tick();
  assert.equal(game.round, 3); assert.equal(p.team, 'def', id + ' sides did not swap');
  assert.equal(game.bots[0].team, 'atk'); assert.equal(game.bots[0].name, oppName);
  assert.deepEqual({ ...game.score }, { atk: 1, def: 1 });
  assert.equal(R.active, null, 'defender put in the drone');
  assert.equal(p.fortR, 8); assert.equal(p.fortB, 4);
  // defenders can walk around in prep
  const start = p.pos.clone(); I.keys.KeyW = true; tick(30); I.keys = {};
  assert(p.pos.distanceTo(start) > .3, 'defender frozen during prep');
  // ---- reinforce a wall section
  let t = null;
  for (const q of W.panels) {
    for (const s of Fo.sectionsOf(q)) {
      const c = Fo.center(s);
      t = face(c, q.axis === 'x' ? 0 : 1, q.axis === 'x' ? 1 : 0, 1.1);
      if (t && t.k === 'r' && !t.bad) break;
      t = null;
    }
    if (t) break;
  }
  assert(t, id + ' no reinforceable wall found');
  I.keys.KeyT = true; tick(150); I.keys.KeyT = false; tick();
  const q = t.p, ci = t.c0 + q.cols;
  assert(q.rf && q.rf[ci], id + ' wall not reinforced'); assert.equal(p.fortR, 7);
  assert(Fo.group.children.length >= 1, 'no steel plates');
  // bulletproof and unbreakable
  const b = W.cellBox(q, ci, [0,0,0,0,0,0]), cx = (b[0]+b[3])/2, cy = (b[1]+b[4])/2, cz = (b[2]+b[5])/2;
  const nx = q.axis === 'x' ? 0 : 1, nz = q.axis === 'x' ? 1 : 0;
  const hp0 = q.hp[ci];
  const away = () => { p.pos.set(200, 0, 200); G.updateHitShapes(p); };
  away();
  for (let i = 0; i < 20; i++) G.fireBullet(game.bots[0], cx + nx * 2, cy, cz + nz * 2, -nx, 0, -nz, G.WEAPONS.sg);
  assert(q.cells[ci] && q.hp[ci] === hp0, 'reinforced wall took bullet damage');
  assert.equal(W.destroySphere(cx, cy, cz, 1.2, null, 0, 0, 0) > 0 && q.cells[ci] === 0, false, 'explosion broke reinforcement');
  // ---- barricade a doorway
  let bt = null;
  for (const d of opt) { const c = Fo.center({ k: 'b', p: d }); bt = face(c, d.axis === 'x' ? 0 : 1, d.axis === 'x' ? 1 : 0, 1.0); if (bt && bt.k === 'b') break; bt = null; }
  assert(bt, id + ' no doorway to barricade');
  I.keys.KeyT = true; tick(75); I.keys.KeyT = false; tick();
  assert(bt.p.placed && bt.p.alive && bt.p.cells.every(Boolean), id + ' barricade not placed'); assert.equal(p.fortB, 3);
  assert(!W.free((bt.p.x0+bt.p.x1)/2, (bt.p.z0+bt.p.z1)/2, .3, .36, 1.8), 'placed barricade does not block');
  away();
  for (let i = 0; i < 6; i++) G.fireBullet(game.bots[0], (bt.p.x0+bt.p.x1)/2 + (bt.p.axis==='x'?0:2), 1.5, (bt.p.z0+bt.p.z1)/2 + (bt.p.axis==='x'?2:0), bt.p.axis==='x'?0:-1, 0, bt.p.axis==='x'?-1:0, G.WEAPONS.ar);
  assert(bt.p.broken, "placed barricade is not breakable");
  console.log(`${id}: doorways ${opt.length}, bot barricades ${botBars}, swap, reinforce, barricade pass`);
}
// ---- scopes
game.settings.scope = '1.5';
const scoped = G.VM.get('ar', 'atk', '1.5'), dot = G.VM.get('ar', 'atk', 'std');
assert.notEqual(scoped, dot); assert(G.adsFov(G.WEAPONS.ar, '1.5') < G.WEAPONS.ar.adsFov - 10);
assert.equal(G.adsFov(G.WEAPONS.pistol, '1.5'), G.WEAPONS.pistol.adsFov);
assert(scoped.sight.z < dot.sight.z, 'scope eyepoint');
// ---- final kill cam: a round-ending kill replays for everyone, with the killer's gun
game.quitToMenu(); game.selectMap('harbor'); game.settings.mode = 'duel'; game.startMatch();
I.pressed.Enter = true; tick(); tick(90);
const foe = game.bots[0]; foe.takeDamage(999, p, 'head', 0, 1);
tick();
assert.equal(game.state, 'roundEnd'); assert(G.KillCam.final, 'no final kill cam');
tick(60);
assert(G.KillCam.active, 'final kill cam did not start');
assert.equal(G.VM.cur, G.VM.get(p.w.def.key, p.team, '1.5'), 'kill cam not showing the gun');
tick(60 * 6);
assert(!G.KillCam.active); assert.equal(game.state, 'prep'); assert.equal(game.round, 2);
console.log('scopes and final kill cam pass');
