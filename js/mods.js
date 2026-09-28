'use strict';
// Single-player "mods" menu: aimbot, triggerbot, ESP, chams and sandbox toggles.
(function () {
  const G = window.G;
  const V = THREE.Vector3;
  const _f = new V(), _p = new V(), _q = new V();

  const DEF = {
    aimbot: 'off', aimBone: 'head', aimFov: 30, aimSmooth: 0.3, aimVisible: true, trigger: false,
    esp: false, espNames: true, espHealth: true, espLines: false, espTeam: false, chams: false, bigHeads: false,
    god: false, infAmmo: false, noRecoil: false, noSpread: false, rapid: false, infNades: false, explosive: false, oneShot: false,
    speed: 1, noclip: false,
    timeScale: 1, bots: 'normal', noTimer: false,
  };

  const SCHEMA = [
    { group: 'AIM' },
    { k: 'aimbot', label: 'Aimbot', type: 'choice', opts: [['off', 'OFF'], ['ads', 'WHEN AIMING'], ['always', 'ALWAYS']] },
    { k: 'aimBone', label: 'Aim at', type: 'choice', opts: [['head', 'HEAD'], ['chest', 'CHEST']] },
    { k: 'aimFov', label: 'Aimbot FOV', type: 'range', min: 5, max: 180, step: 1, fmt: (v) => v + '°' },
    { k: 'aimSmooth', label: 'Smoothing', type: 'range', min: 0, max: 0.95, step: 0.05, fmt: (v) => Math.round(v * 100) + '%' },
    { k: 'aimVisible', label: 'Visible targets only', type: 'toggle' },
    { k: 'trigger', label: 'Triggerbot', type: 'toggle' },
    { group: 'VISUALS' },
    { k: 'esp', label: 'ESP boxes', type: 'toggle' },
    { k: 'espNames', label: 'ESP names + distance', type: 'toggle' },
    { k: 'espHealth', label: 'ESP health bars', type: 'toggle' },
    { k: 'espLines', label: 'Snaplines', type: 'toggle' },
    { k: 'espTeam', label: 'Show teammates too', type: 'toggle' },
    { k: 'chams', label: 'Chams (see through walls)', type: 'toggle' },
    { k: 'bigHeads', label: 'Big heads', type: 'toggle' },
    { group: 'PLAYER' },
    { k: 'god', label: 'God mode', type: 'toggle' },
    { k: 'infAmmo', label: 'Infinite ammo', type: 'toggle' },
    { k: 'noRecoil', label: 'No recoil', type: 'toggle' },
    { k: 'noSpread', label: 'No spread', type: 'toggle' },
    { k: 'rapid', label: 'Rapid fire', type: 'toggle' },
    { k: 'oneShot', label: 'One-shot kills', type: 'toggle' },
    { k: 'explosive', label: 'Explosive ammo', type: 'toggle' },
    { k: 'infNades', label: 'Unlimited grenades', type: 'toggle' },
    { k: 'speed', label: 'Move speed', type: 'range', min: 0.5, max: 3, step: 0.1, fmt: (v) => v.toFixed(1) + 'x' },
    { k: 'noclip', label: 'Noclip / fly', type: 'toggle', hint: 'Space up · C down' },
    { group: 'WORLD' },
    { k: 'ff', label: 'Friendly fire (team kill)', type: 'toggle', src: 'settings' },
    { k: 'timeScale', label: 'Game speed', type: 'range', min: 0.2, max: 1.5, step: 0.05, fmt: (v) => Math.round(v * 100) + '%' },
    { k: 'bots', label: 'Bot AI', type: 'choice', opts: [['normal', 'NORMAL'], ['passive', 'NO SHOOT'], ['frozen', 'FROZEN']] },
    { k: 'noTimer', label: 'Freeze round timer', type: 'toggle' },
  ];

  const TAGS = {
    aimbot: 'AIMBOT', trigger: 'TRIGGER', esp: 'ESP', chams: 'CHAMS', bigHeads: 'BIG HEADS', god: 'GOD', infAmmo: 'INF AMMO',
    noRecoil: 'NO RECOIL', noSpread: 'NO SPREAD', rapid: 'RAPID', oneShot: '1-SHOT', explosive: 'EXPLOSIVE', infNades: 'INF NADES', noclip: 'NOCLIP', noTimer: 'NO TIMER',
  };

  const ALLOWED = new Set(['aimbot', 'aimBone', 'aimFov', 'aimSmooth', 'aimVisible', 'trigger', 'esp', 'espNames', 'espHealth', 'espLines', 'chams', 'infAmmo', 'noRecoil', 'noSpread', 'rapid', 'speed']);
  const HACKER = { ...DEF, aimbot: 'always', aimFov: 180, aimSmooth: 0.05, trigger: true, esp: true, chams: true, infAmmo: true, noRecoil: true, noSpread: true, rapid: true, speed: 1.5 };
  function profile(saved = {}) {
    const c = { ...HACKER };
    for (const row of SCHEMA) {
      if (!ALLOWED.has(row.k)) continue;
      const v = saved[row.k];
      if (row.type === 'toggle' && typeof v === 'boolean') c[row.k] = v;
      if (row.type === 'choice' && row.opts.some(([key]) => key === v)) c[row.k] = v;
      if (row.type === 'range' && Number.isFinite(v)) c[row.k] = G.clamp(v, row.min, row.k === 'speed' ? 1.5 : row.max);
    }
    // These rules cannot be enabled by an old saved sandbox profile or by the menu.
    for (const key of Object.keys(DEF)) if (!ALLOWED.has(key)) Object.defineProperty(c, key, { value: DEF[key], writable: false });
    return c;
  }

  const Mods = (G.Mods = {
    normal: Object.freeze({ ...DEF }),
    hacker: profile(),
    get c() { return G.Game?.hackerMode ? this.hacker : this.normal; },
    load() {
      try { this.hacker = profile(JSON.parse(localStorage.getItem('breachpoint.hacker') || '{}')); } catch (e) { this.hacker = profile(); }
    },
    save() { try { localStorage.setItem('breachpoint.hacker', JSON.stringify(this.hacker)); } catch (e) { /* storage unavailable */ } },
    reset() { this.hacker = profile(); this.save(); this.buildUI(); },

    activeList() {
      const c = this.c, out = [];
      for (const k in TAGS) {
        if (k === 'aimbot') { if (c.aimbot !== 'off') out.push(TAGS[k]); }
        else if (c[k]) out.push(TAGS[k]);
      }
      if (c.speed !== 1) out.push('SPEED ' + c.speed.toFixed(1) + 'x');
      if (c.timeScale !== 1) out.push('TIME ' + Math.round(c.timeScale * 100) + '%');
      if (c.bots !== 'normal') out.push(c.bots === 'passive' ? 'BOTS NO-SHOOT' : 'BOTS FROZEN');
      if (G.Game.settings && G.Game.settings.ff) out.push('FRIENDLY FIRE');
      return out;
    },

    // ------------------------------------------------ UI
    buildUI() {
      const box = document.getElementById('modsBody');
      box.innerHTML = '';
      if (!G.Game.hackerMode) { box.textContent = 'Cheats are disabled in Secure Area. Select Hacker Arena in the main menu to configure your cheats.'; return; }
      let col = null;
      for (const row of SCHEMA) {
        if (row.group) {
          if (row.group === 'WORLD') continue;
          col = document.createElement('div');
          col.className = 'mgroup';
          col.innerHTML = `<h3>${row.group}</h3>`;
          box.appendChild(col);
          continue;
        }
        if (!ALLOWED.has(row.k)) continue;
        const src = row.src === 'settings' ? G.Game.settings : this.c;
        const el = document.createElement('div');
        el.className = 'mrow';
        const lab = document.createElement('span');
        lab.className = 'mlabel';
        lab.innerHTML = row.label + (row.hint ? ` <small>${row.hint}</small>` : '');
        el.appendChild(lab);
        const commit = () => { if (row.src === 'settings') G.Game.saveSettings(); else this.save(); this.onChange(row.k); G.Audio.click(); };
        if (row.type === 'toggle') {
          const b = document.createElement('button');
          b.className = 'mtoggle' + (src[row.k] ? ' on' : '');
          b.textContent = src[row.k] ? 'ON' : 'OFF';
          b.addEventListener('click', () => { src[row.k] = !src[row.k]; b.classList.toggle('on', !!src[row.k]); b.textContent = src[row.k] ? 'ON' : 'OFF'; commit(); });
          el.appendChild(b);
        } else if (row.type === 'choice') {
          const w = document.createElement('div');
          w.className = 'mchoice';
          for (const [v, t] of row.opts) {
            const b = document.createElement('button');
            b.textContent = t;
            b.className = src[row.k] === v ? 'sel' : '';
            b.addEventListener('click', () => { src[row.k] = v; for (const x of w.children) x.classList.toggle('sel', x === b); commit(); });
            w.appendChild(b);
          }
          el.appendChild(w);
        } else {
          const w = document.createElement('div');
          w.className = 'mrange';
          const val = document.createElement('b');
          val.textContent = row.fmt(src[row.k]);
          const inp = document.createElement('input');
          inp.type = 'range'; inp.min = row.min; inp.max = row.k === 'speed' ? 1.5 : row.max; inp.step = row.step; inp.value = src[row.k];
          inp.addEventListener('input', () => { src[row.k] = parseFloat(inp.value); val.textContent = row.fmt(src[row.k]); if (row.src === 'settings') G.Game.saveSettings(); else this.save(); this.onChange(row.k); });
          w.appendChild(inp); w.appendChild(val);
          el.appendChild(w);
        }
        col.appendChild(el);
      }
    },
    onChange(k) {
      if (k === 'ff' && G.Game.settings) {
        const ffBtns = document.getElementById('ffChoices');
        if (ffBtns) for (const b of ffBtns.children) b.classList.toggle('sel', b.dataset.f === (G.Game.settings.ff ? 'on' : 'off'));
      }
      G.Game.hc = {};
    },

    // ------------------------------------------------ aimbot
    chestMid(e, out) { return out.set((e.chestA.x + e.chestB.x) / 2, (e.chestA.y + e.chestB.y) / 2 + 0.05, (e.chestA.z + e.chestB.z) / 2); },
    aim(p, dt) {
      const c = this.c;
      this.target = null;
      if (c.aimbot === 'off' || !p.alive) return;
      if (c.aimbot === 'ads' && !G.Input.rmb) return;
      G.dirFrom(p.yaw, p.pitch, _f);
      const maxAng = (c.aimFov * Math.PI) / 360;
      let best = null, bestAng = maxAng, bx = 0, by = 0, bz = 0;
      for (const e of G.Game.entities) {
        if (!e.alive || !G.Game.isEnemy(p, e)) continue;
        const pt = c.aimBone === 'head' ? e.head : this.chestMid(e, _p);
        const dx = pt.x - p.eye.x, dy = pt.y - p.eye.y, dz = pt.z - p.eye.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const ang = Math.acos(G.clamp((dx * _f.x + dy * _f.y + dz * _f.z) / d, -1, 1));
        if (ang > bestAng) continue;
        if (c.aimVisible && !G.W.clear(p.eye.x, p.eye.y, p.eye.z, pt.x, pt.y, pt.z)) continue;
        best = e; bestAng = ang; bx = dx; by = dy; bz = dz;
      }
      if (!best) return;
      this.target = best;
      const desYaw = G.yawOf(bx, bz), desPitch = Math.atan2(by, Math.hypot(bx, bz));
      if (c.aimSmooth <= 0.01) { p.yaw += G.wrap(desYaw - p.yaw); p.pitch = desPitch; }
      else {
        const k = G.lerp(35, 2.5, c.aimSmooth);
        p.yaw = G.dampAngle(p.yaw, desYaw, k, dt);
        p.pitch = G.damp(p.pitch, desPitch, k, dt);
      }
    },
    // triggerbot: is an enemy under the crosshair (and not behind a wall)?
    onTarget(p) {
      G.dirFrom(p.yaw, p.pitch, _f);
      const e = p.eye;
      const wh = G.W.raycast(e.x, e.y, e.z, _f.x, _f.y, _f.z, 150);
      const ch = G.raycastEntities(e.x, e.y, e.z, _f.x, _f.y, _f.z, wh ? wh.t : 150, p);
      return !!(ch && G.Game.isEnemy(p, ch.e));
    },

    // ------------------------------------------------ ESP overlay
    initESP() {
      this.cv = document.getElementById('esp');
      this.ctx = this.cv.getContext('2d');
      this.chamsE = new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false, fog: false });
      this.chamsT = new THREE.MeshBasicMaterial({ color: 0x2a9dff, transparent: true, opacity: 0.45, depthTest: false, depthWrite: false, fog: false });
    },
    drawESP(cam) {
      const c = this.c, ctx = this.ctx, cv = this.cv, Gm = G.Game;
      const inGame = ['prep', 'live', 'roundEnd'].includes(Gm.state);
      const fovCircle = c.aimbot !== 'off' && c.aimFov < 170 && Gm.player.alive;
      if (!inGame || (!c.esp && !fovCircle)) {
        if (this.drawn) { ctx.clearRect(0, 0, cv.width, cv.height); this.drawn = false; }
        return;
      }
      const dpr = Math.min(devicePixelRatio, 2), W = innerWidth, H = innerHeight;
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      this.drawn = true;
      const p = Gm.player;
      if (c.esp) {
        ctx.font = '600 12px Rajdhani, sans-serif';
        ctx.textAlign = 'center';
        for (const e of Gm.entities) {
          if (e === p || !e.alive || e === Gm.spec) continue;
          const enemy = G.Game.isEnemy(p, e);
          if (!enemy && !c.espTeam) continue;
          _p.set(e.pos.x, e.head.y + 0.2, e.pos.z).project(cam);
          _q.set(e.pos.x, e.pos.y, e.pos.z).project(cam);
          if (_p.z > 1 || _q.z > 1) continue;
          const tx = (_p.x * 0.5 + 0.5) * W, ty = (-_p.y * 0.5 + 0.5) * H;
          const bx = (_q.x * 0.5 + 0.5) * W, by = (-_q.y * 0.5 + 0.5) * H;
          const h = Math.max(6, by - ty), w = h * 0.48, cx = (tx + bx) / 2;
          const m = this.chestMid(e, _f);
          const vis = G.W.clear(cam.position.x, cam.position.y, cam.position.z, m.x, m.y, m.z);
          const col = enemy ? (vis ? '#ff3b3b' : '#ffa23b') : '#3fa7ff';
          if (c.espLines) {
            ctx.strokeStyle = col; ctx.globalAlpha = 0.6; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(W / 2, H); ctx.lineTo(cx, by); ctx.stroke();
            ctx.globalAlpha = 1;
          }
          ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
          ctx.strokeRect(cx - w / 2, ty, w, h);
          ctx.lineWidth = 1.5; ctx.strokeStyle = col;
          ctx.strokeRect(cx - w / 2, ty, w, h);
          if (c.espHealth) {
            const f = G.clamp(e.hp / 100, 0, 1);
            ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(cx - w / 2 - 6, ty, 4, h);
            ctx.fillStyle = f > 0.5 ? '#4cff6a' : f > 0.25 ? '#ffd23b' : '#ff3b3b';
            ctx.fillRect(cx - w / 2 - 5, ty + h * (1 - f), 2, h * f);
          }
          if (c.espNames) {
            const d = Math.round(cam.position.distanceTo(e.pos));
            ctx.fillStyle = '#000'; ctx.fillText(e.name, cx + 1, ty - 4); ctx.fillStyle = col; ctx.fillText(e.name, cx, ty - 5);
            ctx.fillStyle = '#000'; ctx.fillText(d + 'm', cx + 1, by + 13); ctx.fillStyle = '#e9eef2'; ctx.fillText(d + 'm', cx, by + 12);
          }
        }
      }
      if (fovCircle) {
        const r = (Math.tan((c.aimFov * Math.PI) / 360) / Math.tan((cam.fov * Math.PI) / 360)) * (H / 2);
        if (r < Math.max(W, H)) {
          ctx.strokeStyle = this.target ? 'rgba(255,80,80,0.7)' : 'rgba(255,255,255,0.35)';
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2); ctx.stroke();
        }
      }
    },

    // chams: second pass of character meshes with depth test off
    renderChams(r, scene, cam) {
      const c = this.c, Gm = G.Game;
      if (!c.chams || !['prep', 'live', 'roundEnd'].includes(Gm.state)) return;
      const hidden = [];
      for (const e of Gm.entities) if ((!e.alive || e === Gm.spec || e === Gm.player) && e.model.root.visible) { e.model.root.visible = false; hidden.push(e); }
      const bg = scene.background, fog = scene.fog, au = r.shadowMap.autoUpdate;
      scene.background = null; scene.fog = null; r.shadowMap.autoUpdate = false;
      const enemyLayer = Gm.player.team === 'atk' ? 1 : 2;
      scene.overrideMaterial = this.chamsE; cam.layers.set(enemyLayer); r.render(scene, cam);
      if (Gm.hackerMode) { cam.layers.set(3 - enemyLayer); r.render(scene, cam); }
      if (c.espTeam) { scene.overrideMaterial = this.chamsT; cam.layers.set(3 - enemyLayer); r.render(scene, cam); }
      cam.layers.set(0);
      scene.overrideMaterial = null; scene.background = bg; scene.fog = fog; r.shadowMap.autoUpdate = au;
      for (const e of hidden) e.model.root.visible = true;
    },

    update() {
      const big = this.c.bigHeads ? 2.2 : 1;
      for (const b of G.Game.bots) b.model.head.scale.setScalar(big);
      const tag = document.getElementById('modsTag');
      const list = this.activeList().join(' · ');
      if (this._tag !== list) { this._tag = list; tag.textContent = list ? 'MODS: ' + list : ''; }
    },
  });
})();
