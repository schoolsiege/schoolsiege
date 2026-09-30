// Production game logic with real Three.js; only DOM, audio and GPU output stubbed.
// node tests/gameplay.mjs /path/to/three/build/three.module.js
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
for (const id of ['harbor', 'warehouse', 'chalet', 'compound']) {
  game.selectMap(id); game.startMatch();
  assert.equal(game.state, 'prep'); assert.equal(R.active, 'drone');
  assert.equal(R.cameras.length, 4, id + ' camera coverage');
  for (const c of R.cameras) assert(G.W.free(c.pos.x,c.pos.z,.2,c.pos.y-.25,c.pos.y+.25), id + ' camera embedded in wall');
  const pos = game.player.pos.clone(); I.keys.KeyW = true; tick(20);
  assert(game.player.pos.distanceTo(pos) < .001, 'body moved while droning');
  assert(R.drone.pos.distanceTo(pos) > .5, 'drone did not move');
  I.keys.ShiftLeft = true; tick(); assert(R.drone.boost > 0);
  tick(125); assert(R.drone.boostCd > 5, 'boost cooldown missing');
  I.keys = {}; I.pressed.Space = true; tick(); assert(R.drone.pos.y > .02, 'drone did not jump'); tick(80);
  I.pressed.Digit5 = true; tick(); assert.equal(R.active, 'camera');
  const camera = R.current(); I.pressed.KeyE = true; tick(); assert.notEqual(R.current(), camera);
  assert.equal(R.current().root.visible, false, 'camera housing obscures its own feed');
  R.damage(R.current(), 100); assert.equal(R.active, null);
  I.pressed.Enter = true; tick(); assert.equal(game.state, 'live');
  tick(180);
  assert(game.entities.every(e => Number.isFinite(e.pos.x + e.hp)), 'invalid entity state');
  game.quitToMenu(); assert.equal(R.devices.length, 0);
  console.log(id + ': cameras, drone, boost, jump, prep/action and game loop pass');
}
// The two chalet roof halves must rise toward z=0, measured from actual instance matrices.
for (const m of roof) {
    const a = new THREE.Vector3(0,0,-.5).applyMatrix4(m), b = new THREE.Vector3(0,0,.5).applyMatrix4(m);
    const [inner,outer] = Math.abs(a.z) < Math.abs(b.z) ? [a,b] : [b,a];
    assert(inner.y > outer.y + 2, 'chalet roof is an inverted V');
}
assert.equal(roof.length,2);
// Abilities use production destruction, cooldown and healing.
game.startMatch(); game.startLive(); R.exit();
const p = game.player;
p.switchT = 0;
p.operator = 'doc'; p.abilityCharges = 3; p.abilityCd = 0; p.hp = 30;
assert(O.use(p)); assert.equal(p.hp,90); assert.equal(p.abilityCharges,2); assert(!O.use(p));
p.abilityCd = 0; assert(O.use(p)); assert.equal(p.hp,100);
p.operator = 'pulse'; p.abilityCharges = Infinity; p.abilityCd = 0;
const enemy = game.bots.find(b => b.team === 'def'); enemy.pos.copy(p.pos).add(new THREE.Vector3(3,0,0)); G.updateHitShapes(enemy);
assert(O.use(p)); O.update(.1); assert(O.marks.has(enemy));
// Isolate a real barricade for hammer, breaching projectile, drone aperture and bullet checks.
G.W.resetWorld();
G.W.addBox(-20,-.2,-20,20,0,20,'concrete',false);
const wall = G.W.addPanel({kind:'barricade', axis:'x', c0:-.06, c1:.06, u0:-1, u1:1, y0:.22, y1:2.5});
G.W.buildPanelMeshes(G.scene);
p.pos.set(0,0,1.5); p.yaw=0; p.pitch=0; G.updateHitShapes(p);
p.operator='sledge'; p.abilityCharges=12; p.abilityCd=0; p.meleeT=0; p.switchT=0;
assert(O.use(p)); assert(wall.broken); assert.equal(p.abilityCharges,11);
G.W.resetPanels(); p.meleeT=0; p.operator='ash'; p.abilityCharges=2; p.abilityCd=0;
assert(O.use(p)); assert.equal(O.rounds.length,1); O.update(.2); assert(wall.broken); assert.equal(O.rounds.length,0);
G.W.resetPanels();
R.drone.pos.set(0,0,1); R.drone.vy=0; R.physics(R.drone,.5,0,-3.4);
assert(R.drone.pos.z < -.2, 'drone cannot fit beneath barricade');
assert(!G.W.free(0,0,.3,.3,1.8), 'intact barricade does not block player');
G.W.addBox(-1,0,-2,1,3,-1.8,'concrete',false);
R.physics(R.drone,1,0,-7); assert(R.drone.pos.z > -1.7, 'drone tunneled through solid wall');
// Rifle damage still takes six shots for the entire barricade.
for (let i=0;i<5;i++) G.fireBullet(p,0,1.5,1.5,0,0,-1,G.WEAPONS.ar);
assert(!wall.broken); G.fireBullet(p,0,1.5,1.5,0,0,-1,G.WEAPONS.ar); assert(wall.broken);
// Electronics receive real bullets; bot aiming has both reaction delay and misses.
R.clear(); R.group=new THREE.Group(); G.scene.add(R.group);
const device=R.makeDevice('camera',new THREE.Vector3(5,1.5,0),'TEST'); device.compromised=true;
const bot=game.bots.find(b=>b.team==='def');
bot.pos.set(5,0,6); bot.aimYaw=0; bot.yaw=0; bot.target=null; bot.visible=false; bot.mag=30; bot.reloadT=0; bot.deviceTarget=null; G.updateHitShapes(bot);
const realBullet=G.fireBullet, shots=[];
G.fireBullet=(...args)=> { shots.push(args.slice(4,7)); return realBullet(...args); };
R.botWatch(bot,.01); assert.equal(shots.length,0,'bot reacted instantly');
for(let i=0;i<600 && device.alive;i++) R.botWatch(bot,1/60);
assert(shots.length>0); assert(!device.alive,'bot failed to destroy visible camera');
device.alive=true; device.hp=100000;
for(let i=0;i<600;i++) R.botWatch(bot,1/60);
assert(new Set(shots.map(s=>s.join(','))).size>5,'camera aim has no spread');
assert(device.hp>100000-(shots.length-1)*bot.def.dmg,'camera shots never miss');
G.fireBullet=realBullet;
// Saved cheats can never activate in Secure Area or turn on god mode in Hacker Arena.
saved.set('breachpoint.hacker', JSON.stringify({ god:true, noclip:true, oneShot:true, speed:99 })); G.Mods.load();
assert.equal(G.Mods.c.aimbot,'off'); assert.equal(G.Mods.c.god,false);
game.quitToMenu(); game.selectMap('harbor'); game.settings.mode = 'hacker'; game.startMatch();
assert.equal(G.Mods.c.aimbot,'always'); assert.equal(G.Mods.c.god,false); assert.equal(G.Mods.c.noclip,false); assert.equal(G.Mods.c.oneShot,false); assert.equal(G.Mods.c.speed,1.5);
assert(game.isEnemy(game.bots[0],game.bots[1]));
game.startLive(); const hp = p.hp; p.takeDamage(15,game.bots[0],false,0,1); assert(p.hp < hp, 'hacker player invulnerable');
tick(300);
for (const b of game.bots) assert(b.D.errMin <= .02);
game.finishHackerRound(p); assert.equal(p.wins,1);
game.quitToMenu(); game.settings.mode = 'secure'; game.startMatch(); assert.equal(G.Mods.c.aimbot,'off'); assert.equal(G.Mods.c.speed,1); assert(!game.isEnemy(game.bots[0],game.bots[1]));
I.pressed.mouse0 = true; p.alive = false; R.exit(); I.pressed.mouse0 = true; R.update(.01); assert(I.pressed.mouse0, 'recon swallowed spectator click');
console.log('roof, abilities, hacker isolation, mortality, FFA and spectator checks pass');
// Exercise actual touch event handlers and match progression in each arena.
document.documentElement.style.setProperty = noop;
context.getComputedStyle = () => ({getPropertyValue: () => '1'});
G.Touch.setEnabled(true);
const touch = (act, down=true) => {
  const btn=element(); btn.dataset.act=act;
  const ev={preventDefault:noop, changedTouches:[{identifier:act, clientX:800,clientY:400,target:{closest:()=>btn}}]};
  G.Touch[down?'start':'end'](ev);
};
game.startMatch(); touch('cams'); tick(); assert.equal(R.active,'camera'); touch('cams',false);
touch('nextCam'); tick(); assert.equal(R.cameraIndex,1); touch('nextCam',false);
touch('drone'); tick(); assert.equal(R.active,'drone'); touch('drone',false);
I.joyY=1; touch('boost'); tick(); assert(R.drone.boost>0); touch('boost',false); assert(!I.keys.ShiftLeft);
touch('jump'); tick(); assert(R.drone.pos.y>.02); touch('jump',false);
touch('exitRecon'); tick(); assert.equal(R.active,null); touch('exitRecon',false); I.joyY=0;
game.prepT=.01; tick(); assert.equal(game.state,'live');
p.operator='doc'; p.hp=30; p.abilityCd=0; p.abilityCharges=3; p.switchT=0;
touch('ability'); tick(); assert.equal(p.hp,90); touch('ability',false);
for (const id of ['harbor','warehouse','chalet','compound']) {
  game.quitToMenu(); game.selectMap(id); game.settings.mode='hacker'; game.startMatch();
  for(const e of game.entities) assert(G.W.free(e.pos.x,e.pos.z,.3,e.pos.y+.36,e.pos.y+1.8),id+' blocked hacker spawn '+e.name);
  for(let win=1;win<=3;win++) {
    game.startLive(); game.finishHackerRound(p); assert.equal(p.wins,win); game.endT=.01; tick();
    assert.equal(game.state,win===3?'matchEnd':'prep');
  }
}
console.log('touch buttons, auto prep transition, all arena spawns and first-to-three matches pass');
