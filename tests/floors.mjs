// Multi-floor map: navigation across stairs, reachable objective sites, bots and the player climbing floors.
// node tests/floors.mjs /path/to/three/build/three.module.js
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
document.createTextNode = (t) => ({ textContent: t });
function tick(n=1) { for (let i=0;i<n;i++) { game.update(1/60); game.render(1/60); I.pressed = {}; I.mdx = I.mdy = 0; } }
const Nav = G.Nav, MAP = () => G.MAP;
game.selectMap('compound');
const M = MAP();
assert.equal(M.sites.length, 3);
const floors = new Set(M.sites.map(s => s.zone.y0));
assert.equal(floors.size, 3, 'sites on three different floors');
// every gameplay point stands on a free surface at its floor
const at = (p, y, what) => assert(Nav.free(p[0], p[1], y), `${what} blocked: ${p.join(',')}`);
for (const [i, s] of M.sites.entries()) {
  M.setSite(i);
  for (const a of s.anchors) at(a, a[4], s.name + ' anchor');
  for (const a of s.support) at(a, a[4], s.name + ' support');
  for (const a of s.secure) at(a, a[2], s.name + ' secure');
}
for (const r of M.roam) at(r, r[4], 'roam');
for (const e of M.entries) { at(e.out, e.out[2], e.name + ' out'); at(e.in, e.in[2], e.name + ' in'); }
for (const s of M.spawns) at([s.x, s.z], 0, 'spawn ' + s.name);
// paths: every spawn reaches every site, and every entry leads inside
const len = (p) => p.reduce((a, q, i) => a + (i ? Math.hypot(q.x - p[i - 1].x, q.z - p[i - 1].z) : 0), 0);
for (const s of M.spawns) for (const site of M.sites) {
  const g = site.secure[0];
  const p = Nav.findPath(s.x, 0, s.z, g[0], g[2], g[1], true);
  assert(p && p.length, `no path ${s.name} -> ${site.name}`);
  const end = p[p.length - 1];
  assert(Math.abs(end.y - g[2]) < 0.3, `${s.name} -> ${site.name} ends on the wrong floor (${end.y})`);
}
for (const e of M.entries) {
  const p = Nav.findPath(e.out[0], e.out[2], e.out[1], e.in[0], e.in[2], e.in[1], true);
  assert(p && Math.abs(p[p.length - 1].y - e.in[2]) < 0.3, `entry ${e.name} not walkable`);
}
// basement to upstairs through the main stairwell
const up = Nav.findPath(-10, -3.4, 1.25, -10, 3.4, 1.25, true);
assert(up && Math.abs(up[up.length - 1].y - 3.4) < 0.3, 'basement -> upstairs path');
console.log('compound: 3 sites, all spots free, spawns reach every floor, entries walkable');

// a real bot walks from outside to the upstairs site and to the basement
game.settings.mode = 'secure'; game.startMatch(); game.startLive(); R.exit();
const bot = game.bots.find(b => b.team === 'atk');
for (const b of game.bots) if (b !== bot) { b.update = () => {}; b.pos.set(40, 0, 30); G.updateHitShapes(b); } // parked, round stays live
game.player.alive = false;
game.timer = 999;
const walk = (x, y, z, secs) => {
  bot.target = null; bot.visible = false; bot.breach = null; bot.delay = 0;
  bot.role = 'test';
  const t0 = G.time;
  for (let i = 0; i < secs * 60; i++) {
    bot.setGoal(x, z, 3.5, y); bot.followPath(1 / 60);
    tick();
    if (bot.breach) bot.doBreach(1 / 60);
    if (Math.hypot(bot.pos.x - x, bot.pos.z - z) < 0.8 && Math.abs(bot.pos.y - y) < 0.3) return G.time - t0;
  }
  return -1;
};
bot.spawn(-2, -27, Math.PI, 'test', {});
bot.think = () => {};
const tUp = walk(1, 3.4, -3, 90);
assert(tUp > 0 && tUp < 30, `bot never reached upstairs (at ${bot.pos.x.toFixed(1)},${bot.pos.y.toFixed(2)},${bot.pos.z.toFixed(1)})`);
const tDown = walk(-9, -3.4, -2.8, 90);
assert(tDown > 0 && tDown < 30, `bot never reached the basement (at ${bot.pos.x.toFixed(1)},${bot.pos.y.toFixed(2)},${bot.pos.z.toFixed(1)})`);
console.log(`bot: outside -> upstairs ${tUp.toFixed(1)}s, upstairs -> basement ${tDown.toFixed(1)}s`);

// the player climbs the main stairs by walking
const p = game.player; p.alive = true; p.spawn(-4.7, 1.8, 0, 'ar', 0); p.switchT = 0;
p.yaw = Math.PI; // face +z
I.keys.KeyW = true; tick(90); I.keys = {};
assert(p.pos.y > 1.5, `player did not climb (${p.pos.y.toFixed(2)})`);
p.yaw = 0; p.pos.x = -2.3; I.keys.KeyW = true; tick(150); I.keys = {};
assert(Math.abs(p.pos.y - 3.4) < 0.1, `player did not reach upstairs (${p.pos.y.toFixed(2)})`);
console.log('player walks up the switchback stairs to the upper floor');
