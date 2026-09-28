'use strict';
(function () {
  const G = window.G, V = THREE.Vector3;
  const ROOMS = {
    harbor: ['Lobby', 'Hallway', 'Garage', 'Server Room'],
    warehouse: ['Main Hall', 'Workshop', 'Records', 'Control Room'],
    chalet: ['Great Room', 'Kitchen', 'Garage', 'Trophy Room'],
  };
  const $ = (id) => document.getElementById(id);
  const R = (G.Recon = {
    devices: [], cameras: [], active: null, cameraIndex: 0, scanCd: 0,
    clear() {
      this.exit();
      if (this.group) this.group.removeFromParent();
      this.group = null; this.devices = []; this.cameras = []; this.drone = null;
    },
    reset() {
      this.clear();
      this.group = new THREE.Group(); G.scene.add(this.group);
      this.scanCd = 0;
      for (const name of ROOMS[G.MAP.id]) {
        const r = G.MAP.rooms.find((r) => r.name === name);
        const corners = [[r.x0 + 0.45, r.z0 + 0.45], [r.x1 - 0.45, r.z1 - 0.45], [r.x0 + 0.45, r.z1 - 0.45], [r.x1 - 0.45, r.z0 + 0.45]];
        const aim = new V((r.x0 + r.x1) / 2, 1.2, (r.z0 + r.z1) / 2);
        let spot = null;
        for (const [x, z] of corners) {
          if (G.W.free(x, z, 0.2, 2.45, 2.95) && G.W.clear(x, 2.7, z, aim.x, aim.y, aim.z)) { spot = new V(x, 2.7, z); break; }
        }
        // In a cluttered room, prefer a clear corner even if cover obscures its centre.
        if (!spot) for (const [x, z] of corners) if (G.W.free(x, z, 0.2, 2.45, 2.95)) { spot = new V(x, 2.7, z); break; }
        if (!spot) continue;
        const cam = this.makeDevice('camera', spot, name);
        const d = aim.sub(spot);
        cam.baseYaw = cam.yaw = G.yawOf(d.x, d.z); cam.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
        cam.root.rotation.y = cam.yaw;
        this.cameras.push(cam);
      }
      const p = G.Game.player;
      const pos = p.pos.clone(); pos.y = G.W.ground(pos.x, pos.z, 0.12, pos.y + 0.15);
      this.drone = this.makeDevice('drone', pos, 'RECON DRONE');
      this.drone.yaw = p.yaw; this.drone.owner = p;
      this.cameraIndex = 0;
    },
    makeDevice(kind, pos, name) {
      const root = new THREE.Group(); root.position.copy(pos); this.group.add(root);
      const body = new THREE.Mesh(G.geo.box, G.M.plasticBlack);
      if (kind === 'drone') { body.scale.set(0.25, 0.08, 0.18); body.position.y = 0.09; }
      else body.scale.set(0.28, 0.2, 0.24);
      root.add(body);
      const lens = new THREE.Mesh(G.geo.sphLow, G.M.glowBlue);
      lens.scale.setScalar(0.055); lens.position.set(0, kind === 'drone' ? 0.1 : 0, -0.13); root.add(lens);
      if (kind === 'drone') for (const x of [-0.15, 0.15]) {
        const wheel = new THREE.Mesh(G.geo.cyl8, G.M.tire);
        wheel.rotation.z = Math.PI / 2; wheel.scale.set(0.075, 0.065, 0.075); wheel.position.set(x, 0.075, 0); root.add(wheel);
      } else {
        const mount = new THREE.Mesh(G.geo.box, G.M.steel);
        mount.scale.set(0.07, 0.3, 0.07); mount.position.y = 0.16; root.add(mount);
      }
      const device = { kind, name, root, lens, pos: pos.clone(), alive: true, hp: 20, yaw: 0, pitch: 0, vy: 0, grounded: true, boost: 0, boostCd: 0, jumpCd: 0, compromised: false };
      this.devices.push(device); return device;
    },
    current() { return this.active === 'drone' ? this.drone : this.active === 'camera' ? this.cameras[this.cameraIndex] : null; },
    exit() {
      for (const d of this.devices) d.root.visible = d.alive;
      this.active = null;
      document.body.classList.remove('recon');
      if ($('reconFeed')) $('reconFeed').style.display = 'none';
      if (G.Input) { G.Input.lmb = G.Input.rmb = false; delete G.Input.pressed.mouse0; }
    },
    enter(kind) {
      const p = G.Game.player;
      if (!p.alive || !['prep', 'live'].includes(G.Game.state)) return;
      if (!p.grounded || p.vault) return this.message('LAND BEFORE USING RECON');
      if (kind === 'camera') {
        const i = this.cameras.findIndex((c) => c.alive);
        if (i < 0) return this.message('ALL CAMERAS DESTROYED');
        if (!this.cameras[this.cameraIndex]?.alive) this.cameraIndex = i;
      } else if (!this.drone?.alive) return this.message('DRONE DESTROYED · NEW DRONE NEXT ROUND');
      this.active = kind;
      if (kind === 'camera') this.current().compromised = true;
      G.Input.lmb = G.Input.rmb = false; delete G.Input.pressed.mouse0;
      p.vel.set(0, 0, 0); p.ads = 0;
      document.body.classList.add('recon');
    },
    message(text) { G.Game.big(text, '', 'atk'); },
    cycle(step) {
      if (!this.cameras.some((c) => c.alive)) { this.exit(); return; }
      do { this.cameraIndex = (this.cameraIndex + step + this.cameras.length) % this.cameras.length; } while (!this.current().alive);
      this.current().compromised = true;
    },
    update(dt) {
      const I = G.Input, p = G.Game.player;
      this.scanCd = Math.max(0, this.scanCd - dt);
      if (!p.alive || !['prep', 'live'].includes(G.Game.state)) { if (this.active) this.exit(); return; }
      if (I.pressed.Digit5) { if (this.active === 'camera') this.exit(); else this.enter('camera'); }
      if (I.pressed.Digit6) { if (this.active === 'drone') this.exit(); else this.enter('drone'); }
      if (this.active && (I.pressed.Digit1 || I.pressed.Digit2)) this.exit();
      const d = this.drone;
      if (d?.alive) {
        d.boostCd = Math.max(0, d.boostCd - dt); d.jumpCd = Math.max(0, d.jumpCd - dt);
        if (d.boost > 0) { d.boost = Math.max(0, d.boost - dt); if (!d.boost) d.boostCd = 6; }
        if (this.active === 'drone') this.drive(dt);
        else this.physics(d, dt, 0, 0);
      }
      const c = this.current();
      if (!c) return;
      if (this.active === 'camera') {
        if (I.pressed.KeyQ) this.cycle(-1);
        if (I.pressed.KeyE) this.cycle(1);
      }
      const viewed = this.current(); if (!viewed) return;
      viewed.yaw -= I.mdx * 0.0022 * G.Game.settings.sens;
      viewed.pitch = G.clamp(viewed.pitch - I.mdy * 0.0022 * G.Game.settings.sens, -1.2, 0.85);
      if (viewed.kind === 'camera') viewed.yaw = viewed.baseYaw + G.clamp(G.wrap(viewed.yaw - viewed.baseYaw), -1.4, 1.4);
      if ((I.pressed.mouse0 || I.pressed.KeyX) && this.scanCd <= 0) this.scan();
    },
    drive(dt) {
      const d = this.drone, I = G.Input;
      let f = (I.keys.KeyW ? 1 : 0) - (I.keys.KeyS ? 1 : 0) + (I.joyY || 0);
      let s = (I.keys.KeyD ? 1 : 0) - (I.keys.KeyA ? 1 : 0) + (I.joyX || 0);
      const norm = Math.max(1, Math.hypot(f, s)); f /= norm; s /= norm;
      if ((I.keys.ShiftLeft || I.joySprint) && Math.hypot(f, s) > 0.1 && d.boostCd <= 0 && d.boost <= 0) d.boost = 2;
      if (I.pressed.Space && d.grounded && d.jumpCd <= 0) { d.vy = 3.8; d.grounded = false; d.jumpCd = 1.2; }
      const speed = d.boost > 0 ? 7 : 3.4;
      this.physics(d, dt, (-Math.sin(d.yaw) * f + Math.cos(d.yaw) * s) * speed, (-Math.cos(d.yaw) * f - Math.sin(d.yaw) * s) * speed);
    },
    physics(d, dt, vx, vz) {
      const steps = Math.max(1, Math.ceil(dt / 0.015)), h = dt / steps;
      for (let i = 0; i < steps; i++) {
        d.pos.x += vx * h; d.pos.z += vz * h;
        G.W.collide(d.pos, 0.14, d.pos.y + 0.025, d.pos.y + 0.17);
        const oldY = d.pos.y;
        d.vy -= 12 * h; d.pos.y += d.vy * h;
        const floor = G.W.ground(d.pos.x, d.pos.z, 0.11, oldY + 0.06);
        if (d.pos.y <= floor) { d.pos.y = floor; d.vy = 0; d.grounded = true; } else d.grounded = false;
        const ceiling = G.W.ceil(d.pos.x, d.pos.z, 0.11, oldY + 0.17);
        if (d.pos.y + 0.17 > ceiling) { d.pos.y = ceiling - 0.17; d.vy = Math.min(d.vy, 0); }
      }
      d.root.position.copy(d.pos); d.root.rotation.y = d.yaw;
    },
    eye(d) { return d.pos.clone().add(new V(0, d.kind === 'drone' ? 0.12 : 0, 0)); },
    scan() {
      const c = this.current(); if (!c?.alive) return;
      const eye = this.eye(c), forward = G.dirFrom(c.yaw, c.pitch, new V());
      let count = 0;
      for (const e of G.Game.entities) {
        if (!e.alive || !G.Game.isEnemy(G.Game.player, e)) continue;
        const delta = e.chestB.clone().sub(eye), dist = delta.length();
        if (dist < 40 && delta.normalize().dot(forward) > 0.72 && G.W.clear(eye.x, eye.y, eye.z, e.chestB.x, e.chestB.y, e.chestB.z)) {
          G.Operators.mark(e, 5); count++;
        }
      }
      this.scanCd = 3; G.Audio.beep(count ? 1100 : 420, 0.08);
    },
    applyView(camera) {
      const c = this.current(); if (!c?.alive) return false;
      camera.position.copy(this.eye(c)); camera.rotation.set(c.pitch, c.yaw, 0, 'YXZ');
      if (camera.fov !== 85) { camera.fov = 85; camera.updateProjectionMatrix(); }
      for (const d of this.devices) d.root.visible = d.alive && d !== c;
      $('reconFeed').style.display = 'block';
      $('reconTitle').textContent = c.kind === 'drone' ? 'RECON DRONE' : `CAM ${this.cameraIndex + 1} · ${c.name.toUpperCase()}`;
      $('reconStatus').textContent = c.kind === 'drone'
        ? `BOOST ${c.boost > 0 ? c.boost.toFixed(1) + 's' : c.boostCd > 0 ? Math.ceil(c.boostCd) + 's COOLDOWN' : 'READY'} · JUMP ${c.jumpCd > 0 ? Math.ceil(c.jumpCd) + 's' : 'READY'} · SCAN ${this.scanCd > 0 ? Math.ceil(this.scanCd) + 's' : 'READY'}`
        : `Q / E: SWITCH · ${this.cameras.filter((c) => c.alive).length} CAMERAS ONLINE`;
      return true;
    },
    raycast(ox, oy, oz, dx, dy, dz, max) {
      let best = max, hit = null;
      for (const d of this.devices) {
        if (!d.alive) continue;
        const c = this.eye(d), t = G.raySphere(ox, oy, oz, dx, dy, dz, c.x, c.y, c.z, 0.16);
        if (t >= 0 && t < best) { best = t; hit = { device: d, t }; }
      }
      return hit;
    },
    damage(d, amount) {
      if (!d.alive) return;
      d.hp -= amount;
      if (d.hp > 0) return;
      d.alive = false; d.root.visible = false;
      G.Audio.impact('metal', this.eye(d));
      if (d === this.current()) { this.exit(); this.message(d.kind === 'drone' ? 'DRONE DESTROYED' : 'CAMERA SIGNAL LOST'); }
    },
    // Bots react to visible electronics, aim with spread, then fire actual bullets.
    botWatch(bot, dt) {
      if (!bot.alive || (!G.Game.hackerMode && bot.team === 'atk') || (bot.target && bot.visible && G.Game.state === 'live')) return false;
      bot.deviceWait = Math.max(0, (bot.deviceWait || 0) - dt);
      let target = bot.deviceTarget;
      const sees = (d) => {
        if (!d.alive || (d.kind === 'camera' && !d.compromised)) return false;
        const eye = this.eye(d), delta = eye.clone().sub(bot.eye), range = delta.length();
        return range < 22 && Math.abs(G.wrap(G.yawOf(delta.x, delta.z) - bot.aimYaw)) < 1.35 && G.W.clear(bot.eye.x, bot.eye.y, bot.eye.z, eye.x, eye.y, eye.z);
      };
      if (!target || !sees(target)) {
        bot.deviceTarget = this.devices.find(sees) || null;
        bot.deviceWait = G.rand(0.6, 1.2); return !!bot.deviceTarget;
      }
      const eye = this.eye(target), delta = eye.clone().sub(bot.eye), dist = delta.length();
      bot.aimYaw = G.dampAngle(bot.aimYaw, G.yawOf(delta.x, delta.z), 5, dt);
      bot.aimPitch = G.damp(bot.aimPitch, Math.atan2(delta.y, Math.hypot(delta.x, delta.z)), 5, dt);
      if (bot.reloadT > 0) { bot.reloadT -= dt; if (bot.reloadT <= 0) bot.mag = bot.def.mag; return true; }
      if (bot.mag <= 0) { bot.startReload(); return true; }
      if (bot.deviceWait > 0) return true;
      bot.deviceWait = G.rand(0.25, 0.45); bot.mag--;
      const miss = 0.1 + dist * 0.014;
      delta.x += G.randn() * miss; delta.y += G.randn() * miss; delta.z += G.randn() * miss;
      delta.normalize();
      const end = G.fireBullet(bot, bot.eye.x, bot.eye.y, bot.eye.z, delta.x, delta.y, delta.z, bot.def);
      G.FX.tracer(bot.eye.x, bot.eye.y, bot.eye.z, end.x, end.y, end.z);
      G.FX.muzzle3P(bot.eye, delta); G.Audio.shot(bot.def.sound, bot.eye, false);
      return true;
    },
  });
})();
