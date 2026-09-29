'use strict';
// Player controller + first-person viewmodel.
(function () {
  const G = window.G;
  const V = THREE.Vector3;
  const _f = new V(), _r = new V(), _u = new V(), _d = new V(), _t = new V();

  // ============================================================ VIEWMODEL
  const VM = (G.VM = {
    init() {
      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.01, 10);
      this.hemi = new THREE.HemisphereLight(0xdfe8ff, 0x3a3228, 0.9);
      this.sun = new THREE.DirectionalLight(0xfff0dc, 1.2);
      this.sun.position.set(0.6, 1, 0.4);
      this.fill = new THREE.DirectionalLight(0x9fb4d8, 0.35);
      this.fill.position.set(-1, 0.2, 0.6);
      this.flashL = new THREE.PointLight(0xffb060, 0, 1.5, 2);
      this.flashL.position.set(0.1, -0.05, -0.8);
      this.scene.add(this.hemi, this.sun, this.fill, this.flashL);
      this.root = new THREE.Group();
      this.scene.add(this.root);
      this.guns = {};
      this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: G.T.flash, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
      this.flash.visible = false;
      this.scene.add(this.flash);
      this.flashT = 0;
      // brass casings
      this.casings = [];
      for (let i = 0; i < 10; i++) {
        const m = new THREE.Mesh(G.geo.cyl8, G.M.gunBrass);
        m.scale.set(0.0045, 0.022, 0.0045); m.visible = false;
        this.scene.add(m);
        this.casings.push({ m, v: new V(), w: new V(), life: 0 });
      }
      this.ci = 0;
    },
    get(key, team) {
      const k = key + team;
      if (!this.guns[k]) {
        const def = G.WEAPONS[key];
        const gun = G.buildGun(def.model, true);
        G.buildVMArms(gun, team);
        gun.group.visible = false;
        gun.magBase = gun.mag ? gun.mag.position.clone() : null;
        gun.pumpBase = gun.pump ? gun.pump.position.clone() : null;
        const adsDist = { rifle: 0.31, smg: 0.3, shotgun: 0.32, pistol: 0.38 }[def.model];
        gun.hip = new V(...def.hipPos);
        gun.ads = new V(0, -gun.sight.y, -adsDist - gun.sight.z);
        this.root.add(gun.group);
        this.guns[k] = gun;
      }
      return this.guns[k];
    },
    show(gun) {
      for (const k in this.guns) this.guns[k].group.visible = this.guns[k] === gun;
      this.cur = gun;
    },
    muzzleFlash() {
      const g = this.cur;
      if (!g) return;
      g.group.updateMatrixWorld(true);
      g.muzzle.getWorldPosition(this.flash.position);
      const s = (g.kind === 'shotgun' ? 0.22 : g.kind === 'pistol' ? 0.1 : 0.15) * (0.8 + Math.random() * 0.4);
      this.flash.scale.set(s, s, 1);
      this.flash.material.rotation = Math.random() * 6.28;
      this.flash.visible = true;
      this.flashT = 0.035;
      this.flashL.intensity = 3;
      this.flashL.position.copy(this.flash.position);
    },
    eject() {
      const g = this.cur;
      if (!g || g.kind === 'shotgun') return;
      const c = this.casings[this.ci]; this.ci = (this.ci + 1) % this.casings.length;
      g.group.updateMatrixWorld(true);
      c.m.position.copy(g.eject).applyMatrix4(g.group.matrixWorld);
      c.v.set(1.2 + Math.random() * 0.6, 0.9 + Math.random() * 0.5, 0.2 + Math.random() * 0.3);
      c.w.set(G.randn() * 20, G.randn() * 20, G.randn() * 20);
      c.life = 0.55; c.m.visible = true;
    },
    ejectShell() {
      const g = this.cur;
      const c = this.casings[this.ci]; this.ci = (this.ci + 1) % this.casings.length;
      g.group.updateMatrixWorld(true);
      c.m.position.copy(g.eject).applyMatrix4(g.group.matrixWorld);
      c.m.scale.set(0.009, 0.03, 0.009);
      c.v.set(1.0, 0.6, 0.3); c.w.set(G.randn() * 12, G.randn() * 12, G.randn() * 12);
      c.life = 0.6; c.m.visible = true;
      c.m.userData.shell = true;
    },
    update(dt) {
      if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) { this.flash.visible = false; this.flashL.intensity = 0; } }
      for (const c of this.casings) {
        if (c.life <= 0) continue;
        c.life -= dt;
        c.v.y -= 6 * dt;
        c.m.position.addScaledVector(c.v, dt);
        c.m.rotation.x += c.w.x * dt; c.m.rotation.y += c.w.y * dt; c.m.rotation.z += c.w.z * dt;
        if (c.life <= 0) { c.m.visible = false; if (c.m.userData.shell) { c.m.scale.set(0.0045, 0.022, 0.0045); c.m.userData.shell = false; } }
      }
    },
  });

  // ============================================================ PLAYER
  class Player {
    constructor() {
      this.isPlayer = true; this.team = 'atk'; this.name = 'YOU';
      this.pos = new V(); this.vel = new V(); this.yaw = 0; this.pitch = 0;
      this.head = new V(); this.eye = new V(); this.chestA = new V(); this.chestB = new V(); this.legA = new V(); this.legB = new V();
      this.kills = 0; this.deaths = 0;
      this.model = G.buildCharacter('atk', 'rifle');
      this.model.root.visible = false;
      G.scene.add(this.model.root);
    }
    spawn(x, z, yaw, primary) {
      this.pos.set(x, 0.02, z); this.vel.set(0, 0, 0);
      this.yaw = yaw; this.pitch = 0;
      this.hp = 100; this.alive = true;
      this.lean = 0; this.leanTarget = 0; this.leanToggle = 0;
      this.crouch = 0; this.crouchOn = false; this.height = 1.85;
      this.grounded = true; this.vy = 0;
      this.ads = 0; this.sprint = 0;
      this.weapons = [
        { def: G.WEAPONS[primary], mag: G.WEAPONS[primary].mag, reserve: G.WEAPONS[primary].reserve },
        { def: G.WEAPONS.pistol, mag: G.WEAPONS.pistol.mag, reserve: G.WEAPONS.pistol.reserve },
      ];
      this.cur = 0;
      this.fireCd = 0; this.reloadT = 0; this.reloadDur = 0; this.reloadEmpty = false; this.reloadStage = 0;
      this.switchT = 0; this.meleeT = 0; this.meleeDone = false; this.throwT = 0; this.thrown = false;
      this.pumpT = 0; this.bloom = 0; this.drift = 0;
      this.grenades = 2;
      this.vault = null;
      this.punch = 0; this.punchYaw = 0; this.kick = 0;
      this.swayX = 0; this.swayY = 0; this.bobPhase = 0; this.stepDist = 0; this.stepOff = 0;
      this.deadT = 0; this.fallDir = new V();
      this.hurtT = 0;
      this.model.root.visible = false;
      this.gun = VM.get(this.weapons[0].def.key, this.team);
      VM.show(this.gun);
      this.switchT = 0.45; this.switchTo = 0; this.swapped = true;
      G.updateHitShapes(this);
    }
    get w() { return this.weapons[this.cur]; }
    get busy() { return this.reloadT > 0 || this.switchT > 0 || this.meleeT > 0 || this.throwT > 0 || !!this.vault; }

    takeDamage(amt, attacker, part, dx, dz) {
      if (!this.alive || G.Game.state !== 'live') return;
      if (G.Mods.c.god) { G.Game.onPlayerHurt(0, attacker, dx, dz); return; }
      this.hp -= amt;
      this.hurtT = 1;
      G.Audio.hurt();
      if (G.Pad) G.Pad.rumble(0.18, 0.4, 0.8);
      G.Game.onPlayerHurt(amt, attacker, dx, dz);
      this.punch += 0.02; this.punchYaw += G.randn() * 0.01;
      if (this.hp <= 0) {
        this.hp = 0; this.alive = false; this.deadT = 0;
        this.deaths++;
        this.fallDir.set(G.rand(-1, 1) > 0 ? 1 : -1, 0, G.rand(-0.4, 0.4));
        this.model.root.visible = true;
        VM.root.visible = false;
        G.Game.onKill(attacker, this, part === 'head');
      }
    }

    startReload() {
      const w = this.w, def = w.def;
      if (this.reloadT > 0 || w.reserve <= 0 || this.switchT > 0 || this.meleeT > 0 || this.throwT > 0) return;
      if (w.mag >= def.mag + (def.shell ? 0 : 1)) return;
      if (!def.shell && w.mag >= def.mag && w.mag > 0) return;
      this.reloadEmpty = w.mag === 0;
      if (def.shell) { this.reloadDur = 0.35 + def.shell * Math.min(def.mag - w.mag, w.reserve) + (this.reloadEmpty ? 0.45 : 0); }
      else this.reloadDur = this.reloadEmpty ? def.reloadEmpty : def.reload;
      this.reloadT = this.reloadDur; this.reloadStage = 0;
      G.Game.soundEvent(this.pos, 5, this.team, 'reload');
    }
    finishReload() {
      const w = this.w, def = w.def;
      if (!def.shell) {
        const cap = def.mag + (this.reloadEmpty ? 0 : 1);
        const take = Math.min(cap - w.mag, w.reserve);
        w.mag += take; w.reserve -= take;
      }
      this.reloadT = 0;
    }

    update(dt) {
      const I = G.Input, S = G.Game.settings;
      if (!this.alive) { this.deadT += dt; this.animateBody(dt); return; }
      if (G.Recon.active) {
        this.vel.set(0, 0, 0); this.ads = 0; this.sprint = 0;
        G.updateHitShapes(this); this.animateBody(dt); return;
      }
      const def = this.w.def;
      const frozen = G.Game.state !== 'live';

      // ---------------- look
      const adsSens = G.lerp(1, S.adsSens * (def.adsFov / S.fov), this.ads);
      const sens = 0.0022 * S.sens * adsSens;
      this.yaw -= I.mdx * sens; this.pitch -= I.mdy * sens;
      if (!frozen) G.Mods.aim(this, dt);
      this.pitch = G.clamp(this.pitch, -1.45, 1.45);
      this.swayX = G.damp(this.swayX, G.clamp(-I.mdx * 0.0006, -0.04, 0.04), 10, dt);
      this.swayY = G.damp(this.swayY, G.clamp(I.mdy * 0.0006, -0.04, 0.04), 10, dt);

      // ---------------- stance
      if (I.pressed.KeyC) this.crouchOn = !this.crouchOn;
      let wantCrouch = this.crouchOn || !!this.vault;
      if (!wantCrouch && this.crouch > 0.05 && !G.W.free(this.pos.x, this.pos.z, 0.3, this.pos.y + 1.2, this.pos.y + 1.85)) wantCrouch = true;
      this.crouch = G.damp(this.crouch, wantCrouch ? 1 : 0, 11, dt);
      this.height = G.lerp(1.85, 1.15, this.crouch);

      // ---------------- lean (Q / E)
      let lt;
      if (S.leanMode === 'toggle' || G.Touch.enabled) {
        if (I.pressed.KeyQ) this.leanToggle = this.leanToggle === -1 ? 0 : -1;
        if (I.pressed.KeyE) this.leanToggle = this.leanToggle === 1 ? 0 : 1;
        lt = this.leanToggle;
      } else lt = (I.keys.KeyE ? 1 : 0) - (I.keys.KeyQ ? 1 : 0);
      // controller: hold LT, click left/right stick to lean
      if (G.Pad && G.Pad.lean) lt = G.Pad.lean;
      if (this.sprint > 0.5 || this.vault) lt = 0;
      if (lt !== 0) {
        G.rightFrom(this.yaw, _r);
        const hy = this.pos.y + G.lerp(1.55, 1.0, this.crouch);
        const h = G.W.raycast(this.pos.x, hy, this.pos.z, _r.x * lt, 0, _r.z * lt, 0.75);
        const mx = h ? G.clamp((h.t - 0.18) / 0.4, 0, 1) : 1;
        lt *= mx;
      }
      this.leanTarget = lt;
      this.lean = G.damp(this.lean, lt, 13, dt);

      // ---------------- movement
      // keyboard + analog stick (touch)
      const fwd = G.clamp((I.keys.KeyW ? 1 : 0) - (I.keys.KeyS ? 1 : 0) + (I.joyY || 0), -1, 1);
      const str = G.clamp((I.keys.KeyD ? 1 : 0) - (I.keys.KeyA ? 1 : 0) + (I.joyX || 0), -1, 1);
      _f.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      G.rightFrom(this.yaw, _r);
      _d.set(0, 0, 0).addScaledVector(_f, fwd).addScaledVector(_r, str);
      if (_d.lengthSq() > 1) _d.normalize();
      if (frozen) _d.set(0, 0, 0);
      const sprintKey = I.keys.ShiftLeft || I.joySprint;
      const touchFiring = G.Touch.enabled && I.lmb;
      const wantSprint = sprintKey && fwd > 0.5 && this.crouch < 0.5 && !I.rmb && this.meleeT <= 0 && !(I.lmb && this.reloadT <= 0) && !touchFiring;
      this.sprint = G.damp(this.sprint, wantSprint ? 1 : 0, 8, dt);
      if (wantSprint && this.crouchOn) this.crouchOn = false;
      let speed = wantSprint ? 5.4 : 3.4;
      speed = G.lerp(speed, 1.7, this.crouch);
      speed *= G.lerp(1, 0.62, this.ads);
      speed *= 1 - Math.abs(this.lean) * 0.15;
      speed *= G.Mods.c.speed;

      if (G.Mods.c.noclip && !frozen) {
        // free flight through everything
        G.dirFrom(this.yaw, this.pitch, _t);
        const up = (I.keys.Space ? 1 : 0) - (I.keys.KeyC ? 1 : 0);
        const fs = speed * 2.2;
        this.vel.set(0, 0, 0).addScaledVector(_t, fwd * fs).addScaledVector(_r, str * fs);
        this.vel.y += up * fs;
        this.pos.addScaledVector(this.vel, dt);
        this.vy = 0; this.grounded = false; this.vault = null;
        this.crouchOn = false;
      } else if (this.vault) {
        this.updateVault(dt);
      } else {
        const acc = this.grounded ? 13 : 2.5;
        this.vel.x = G.damp(this.vel.x, _d.x * speed, acc, dt);
        this.vel.z = G.damp(this.vel.z, _d.z * speed, acc, dt);
        if (I.pressed.Space && this.grounded && !frozen) {
          if (!this.tryVault()) { this.vy = 5.2; this.grounded = false; }
        }
        this.vy -= 18 * dt;
        this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
        G.W.collide(this.pos, 0.32, this.pos.y + 0.36, this.pos.y + this.height);
        G.Game.pushEntities(this);
        if (this.grounded) {
          const g = G.W.ground(this.pos.x, this.pos.z, 0.22, this.pos.y + 0.36);
          if (g > this.pos.y + 0.001) { this.stepOff -= g - this.pos.y; this.pos.y = g; }
        }
        const prevY = this.pos.y;
        this.pos.y += this.vy * dt;
        const g = G.W.ground(this.pos.x, this.pos.z, 0.22, prevY + 0.05);
        if (this.pos.y <= g) {
          if (!this.grounded && this.vy < -4) { G.Audio.step(this.pos, this.surface(), 1.2, true); this.stepOff -= 0.06; }
          this.pos.y = g; this.vy = 0; this.grounded = true;
        } else if (this.pos.y > g + 0.05) this.grounded = false;
        if (this.vy > 0) {
          const c = G.W.ceil(this.pos.x, this.pos.z, 0.22, prevY + this.height - 0.05);
          if (this.pos.y + this.height > c) { this.pos.y = c - this.height; this.vy = 0; }
        }
      }
      this.stepOff = G.damp(this.stepOff, 0, 12, dt);

      // footsteps
      const hs = Math.hypot(this.vel.x, this.vel.z);
      if (this.grounded && hs > 0.5) {
        this.stepDist += hs * dt;
        this.bobPhase += hs * dt * 3.6;
        const stride = wantSprint ? 1.05 : 0.78;
        if (this.stepDist > stride) {
          this.stepDist = 0;
          const loud = wantSprint ? 1 : this.crouch > 0.5 ? 0.35 : 0.65;
          G.Audio.step(this.pos, this.surface(), loud, true);
          G.Game.soundEvent(this.pos, wantSprint ? 15 : this.crouch > 0.5 ? 2.5 : 7, this.team, 'step');
        }
      }

      // ---------------- weapon logic
      this.weaponLogic(dt, def, wantSprint, frozen);
      this.animateBody(dt);
      G.updateHitShapes(this);
    }

    surface() {
      const x = this.pos.x, z = this.pos.z;
      if (G.MAP.indoors(x, z)) {
        for (const r of G.MAP.rooms) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return G.PHYS[r.floor] || 'concrete';
        return 'wood';
      }
      if (z > 19 || (z < -16 && Math.abs(x) < 22) || (Math.abs(x) < 19 && Math.abs(z) < 19)) return 'concrete';
      if (x > 19 && x < 32 && z > -20 && z < 19) return 'concrete';
      return 'dirt';
    }

    // ---------------- vaulting over windows, counters, barriers
    tryVault() {
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      const feet = this.pos.y;
      let obs = null;
      for (const d of [0.38, 0.55, 0.75, 0.95]) {
        const px = this.pos.x + fx * d, pz = this.pos.z + fz * d;
        let top = -1;
        G.W.query(px - 0.06, pz - 0.06, px + 0.06, pz + 0.06, (s) => {
          if (s.type === 0) { if (s.y1 > feet + 0.3 && s.y1 <= feet + 1.3 && s.y0 < feet + 1.0) top = Math.max(top, s.y1); }
          else G.W.panelCells(s, px - 0.06, feet + 0.3, pz - 0.06, px + 0.06, feet + 1.3, pz + 0.06, (a, b, c, dd, e) => { if (e <= feet + 1.3) top = Math.max(top, e); });
        });
        if (top > 0) { obs = { d, top }; break; }
      }
      if (!obs) return false;
      if (!G.W.free(this.pos.x + fx * obs.d, this.pos.z + fz * obs.d, 0.2, obs.top + 0.05, obs.top + 1.05)) return false;
      for (let k = obs.d + 1.5; k >= obs.d + 0.3; k -= 0.15) {
        const lx = this.pos.x + fx * k, lz = this.pos.z + fz * k;
        const gy = G.W.ground(lx, lz, 0.2, obs.top + 0.05);
        if (gy < -5) continue;
        if (!G.W.free(lx, lz, 0.3, gy + 0.25, gy + 1.15)) continue;
        // clearance along the path above the obstacle
        let ok = true;
        for (let s = obs.d; s < k; s += 0.2) {
          if (!G.W.free(this.pos.x + fx * s, this.pos.z + fz * s, 0.22, obs.top + 0.04, obs.top + 1.0)) { ok = false; break; }
        }
        if (!ok) continue;
        this.vault = { t: 0, dur: 0.6, sx: this.pos.x, sy: this.pos.y, sz: this.pos.z, ex: lx, ey: gy, ez: lz, top: obs.top + 0.06 };
        this.vel.set(0, 0, 0);
        G.Audio.step(this.pos, 'fabric', 1.2, true);
        G.Game.soundEvent(this.pos, 8, this.team, 'step');
        return true;
      }
      return false;
    }
    updateVault(dt) {
      const v = this.vault;
      v.t += dt / v.dur;
      const t = Math.min(1, v.t), e = G.smooth(t);
      this.pos.x = G.lerp(v.sx, v.ex, e); this.pos.z = G.lerp(v.sz, v.ez, e);
      this.pos.y = t < 0.45 ? G.lerp(v.sy, v.top, G.smooth(t / 0.45)) : G.lerp(v.top, v.ey, G.smooth((t - 0.45) / 0.55));
      if (v.t >= 1) {
        this.vault = null; this.vy = 0; this.grounded = true;
        G.Audio.step(this.pos, this.surface(), 1, true);
        G.W.collide(this.pos, 0.32, this.pos.y + 0.36, this.pos.y + this.height);
      }
    }

    weaponLogic(dt, def, sprinting, frozen) {
      const I = G.Input, w = this.w;
      this.fireCd -= dt;
      this.bloom = G.damp(this.bloom, 0, 5, dt);
      this.punch = G.damp(this.punch, 0, 12, dt);
      this.punchYaw = G.damp(this.punchYaw, 0, 12, dt);
      this.kick = G.damp(this.kick, 0, 16, dt);
      if (!I.lmb) this.drift = G.damp(this.drift, 0, 4, dt);

      // weapon switch
      let want = -1;
      if (I.pressed.Digit1) want = 0;
      if (I.pressed.Digit2) want = 1;
      if (I.wheel) want = 1 - this.cur;
      if (want >= 0 && want !== this.cur && this.meleeT <= 0 && this.throwT <= 0 && !this.vault) {
        this.reloadT = 0; this.switchT = 0.5; this.switchTo = want; this.swapped = false;
        G.Audio.reload('draw', null, true);
      }
      if (this.switchT > 0) {
        this.switchT -= dt;
        if (!this.swapped && this.switchT < 0.25) {
          this.swapped = true; this.cur = this.switchTo;
          this.gun = VM.get(this.w.def.key, this.team);
          VM.show(this.gun);
        }
      }

      // reload
      if (I.pressed.KeyR && !frozen) this.startReload();
      if (this.reloadT > 0) {
        this.reloadT -= dt;
        const p = 1 - this.reloadT / this.reloadDur;
        if (def.shell) {
          // shell-by-shell
          const n = Math.floor((this.reloadDur - this.reloadT - 0.35) / def.shell);
          while (this.reloadStage <= n && this.reloadStage >= 0 && w.mag < def.mag && w.reserve > 0 && this.reloadDur - this.reloadT > 0.35) {
            w.mag++; w.reserve--; this.reloadStage++;
            G.Audio.reload('shell', null, true);
          }
          if (I.pressed.mouse0 && w.mag > 0 && this.reloadStage > 0) { this.reloadT = 0; }
          if (this.reloadT <= 0 && this.reloadEmpty) { this.pumpT = 0.45; G.Audio.reload('pump', null, true); this.reloadEmpty = false; }
          if (w.mag >= def.mag || w.reserve <= 0) { if (this.reloadEmpty) { this.pumpT = 0.45; G.Audio.reload('pump', null, true); } this.reloadT = Math.min(this.reloadT, 0.0001); this.reloadEmpty = false; }
          if (this.reloadT <= 0) this.reloadT = 0;
        } else {
          if (this.reloadStage === 0 && p > 0.18) { this.reloadStage = 1; G.Audio.reload('out', null, true); }
          if (this.reloadStage === 1 && p > 0.62) { this.reloadStage = 2; G.Audio.reload('in', null, true); }
          if (this.reloadStage === 2 && this.reloadEmpty && p > 0.8) { this.reloadStage = 3; G.Audio.reload('bolt', null, true); }
          if (this.reloadT <= 0) this.finishReload();
        }
      }
      if (this.pumpT > 0) this.pumpT -= dt;

      // melee
      if (I.pressed.KeyV && this.meleeT <= 0 && this.switchT <= 0 && this.throwT <= 0 && !this.vault && !frozen) {
        this.meleeT = 0.55; this.meleeDone = false; this.reloadT = 0;
        G.Audio.swing(null, true);
      }
      if (this.meleeT > 0) {
        this.meleeT -= dt;
        if (!this.meleeDone && this.meleeT < 0.42) { this.meleeDone = true; this.doMelee(); }
      }
      // grenade
      if (I.pressed.KeyG && this.grenades > 0 && this.throwT <= 0 && this.meleeT <= 0 && this.switchT <= 0 && !this.vault && !frozen) {
        this.throwT = 0.65; this.thrown = false; this.reloadT = 0;
        G.Audio.reload('dry', null, true);
      }
      if (this.throwT > 0) {
        this.throwT -= dt;
        if (!this.thrown && this.throwT < 0.35) {
          this.thrown = true;
          if (!G.Mods.c.infNades) this.grenades--;
          G.dirFrom(this.yaw, this.pitch + 0.12, _t);
          const p = this.eye.clone().addScaledVector(_t, 0.4);
          const v = _t.clone().multiplyScalar(14).add(new V(this.vel.x * 0.5, 1.5, this.vel.z * 0.5));
          G.Grenades.throw(this, p, v);
          G.Audio.swing(null, true);
        }
      }

      // ADS
      const canAds = I.rmb && this.sprint < 0.3 && this.reloadT <= 0 && this.switchT <= 0 && this.meleeT <= 0 && this.throwT <= 0 && !this.vault;
      this.ads = G.clamp(this.ads + (canAds ? 1 : -1) * dt / def.adsTime, 0, 1);

      // fire
      const M = G.Mods.c;
      let trigger = def.auto || M.rapid ? I.lmb : I.pressed.mouse0;
      if (!trigger && M.trigger && !frozen && this.fireCd <= 0 && !this.busy && this.sprint < 0.4 && G.Mods.onTarget(this)) trigger = true;
      if (trigger && !frozen) {
        if (this.busy && !(def.shell && this.reloadT > 0)) { /* blocked */ }
        else if (this.sprint > 0.4) { this.sprint = 0; }
        else if (this.fireCd <= 0 && this.pumpT <= 0) {
          if (w.mag > 0) this.shoot(def);
          else if (I.pressed.mouse0) { G.Audio.reload('dry', null, true); this.fireCd = 0.25; if (w.reserve > 0) this.startReload(); }
        }
      }
      if (w.mag === 0 && w.reserve > 0 && this.reloadT <= 0 && !this.busy && this.fireCd < -0.25 && !I.lmb) this.startReload();
    }

    shoot(def) {
      const w = this.w, M = G.Mods.c;
      if (!M.infAmmo) w.mag--;
      this.fireCd = 60 / def.rpm;
      if (M.rapid) this.fireCd = Math.min(this.fireCd * 0.4, 0.06);
      G.dirFrom(this.yaw + this.punchYaw, this.pitch + this.punch * 0.4, _f);
      G.rightFrom(this.yaw, _r);
      _u.crossVectors(_r, _f).normalize();
      const hs = Math.hypot(this.vel.x, this.vel.z);
      let spread = G.lerp(def.hip + this.bloom, def.ads, this.ads) + (hs / 5) * def.move * (1 - this.ads * 0.7);
      if (!this.grounded) spread += 0.05;
      if (this.crouch > 0.5) spread *= 0.85;
      for (let p = 0; p < def.pellets; p++) {
        let r = Math.sqrt(Math.random()) * (def.pellets > 1 ? def.hip * G.lerp(1, 0.7, this.ads) : spread);
        if (M.noSpread) r = def.pellets > 1 ? r * 0.25 : 0;
        const a = Math.random() * Math.PI * 2;
        _d.copy(_f).addScaledVector(_r, Math.cos(a) * r).addScaledVector(_u, Math.sin(a) * r).normalize();
        const end = G.fireBullet(this, this.eye.x, this.eye.y, this.eye.z, _d.x, _d.y, _d.z, def, p);
        if (p === 0) { G.KillCam.shot(this, end); if (G.Net && G.Net.inGame) G.Net.sendShot(this, end, def.key); }
      }
      // recoil
      const k = (1 - 0.3 * this.ads) * (M.noRecoil ? 0 : 1);
      this.pitch += def.recoilV * (0.75 + Math.random() * 0.5) * k * 0.7;
      this.drift += (Math.random() - 0.45) * 0.6;
      this.drift = G.clamp(this.drift, -1.5, 1.5);
      this.yaw += (G.randn() * 0.5 + this.drift * 0.6) * def.recoilH * k;
      this.punch += def.recoilV * 0.5 * (M.noRecoil ? 0.15 : 1);
      this.kick = Math.min(1, this.kick + (def.pellets > 1 ? 1 : 0.55));
      this.bloom = Math.min(0.06, this.bloom + (def.pellets > 1 ? 0 : 0.006));
      VM.muzzleFlash();
      VM.eject();
      G.dirFrom(this.yaw, this.pitch, _t);
      G.FX.flashLight(this.eye.clone().addScaledVector(_t, 0.9), 2.2);
      G.Audio.shot(def.sound, null, true);
      G.Game.soundEvent(this.eye, def.sound === 'shotgun' ? 55 : 45, this.team, 'shot');
      if (def.shell) { this.pumpT = 0.55; setTimeout(() => { if (this.alive) { G.Audio.reload('pump', null, true); VM.ejectShell(); } }, 140); }
      G.Game.shake(def.pellets > 1 ? 0.12 : 0.02);
      if (G.Pad) G.Pad.rumble(def.pellets > 1 ? 0.14 : 0.05, 0.25, def.pellets > 1 ? 0.9 : 0.35);
    }

    doMelee() {
      G.dirFrom(this.yaw, this.pitch, _f);
      const e = this.eye;
      const ch = G.raycastEntities(e.x, e.y, e.z, _f.x, _f.y, _f.z, 1.7, this);
      const wh = G.W.raycast(e.x, e.y, e.z, _f.x, _f.y, _f.z, 1.7);
      if (ch && (!wh || ch.t < wh.t)) {
        if (G.Game.isEnemy(this, ch.e) || G.Game.settings.ff) {
          ch.e.takeDamage(G.Mods.c.oneShot ? 999 : 55, this, 'chest', _f.x, _f.z);
          G.Game.hitMarker(false, !ch.e.alive);
        }
        G.Audio.impact('flesh', ch.e.chestB);
        return;
      }
      if (!wh) return;
      const s = wh.s;
      G.Game.shake(0.08);
      if (s.type === 1) {
        const n = s.kind === 'barricade'
          ? (G.W.hitBarricade(s, 34, _f.x, _f.y, _f.z) ? 1 : 0)
          : G.W.destroySphere(wh.x, wh.y, wh.z, 0.33, [s.kind], _f.x, _f.y, _f.z);
        if (s.kind === 'barricade') { if (!n) G.Audio.breakWood(new V(wh.x, wh.y, wh.z)); }
        else G.Audio.breakWall(new V(wh.x, wh.y, wh.z));
        if (n && s.kind !== 'barricade') G.Game.soundEvent(new V(wh.x, wh.y, wh.z), 20, this.team, 'break');
      } else {
        G.Audio.impact(s.phys, new V(wh.x, wh.y, wh.z));
        G.FX.impact(wh, s.phys, _f.x, _f.y, _f.z, false);
      }
    }

    animateBody(dt) {
      G.animateCharacter(this.model, {
        pos: this.pos, yaw: this.yaw, speed: 0, fwd: 1, crouch: this.crouch, lean: this.lean, pitch: 0,
        dead: !this.alive, deadT: this.deadT, fallDir: this.fallDir,
      }, dt);
    }

    // camera & viewmodel
    updateView(cam, dt) {
      const S = G.Game.settings;
      if (!this.alive) {
        const t = Math.min(1, this.deadT / 1.0), e = t * t;
        cam.position.set(this.eye.x, G.lerp(this.eye.y, this.pos.y + 0.35, e), this.eye.z);
        cam.rotation.set(G.lerp(this.pitch, -0.3, e), this.yaw, G.lerp(-this.lean * 0.2, 0.6 * this.fallDir.x, e), 'YXZ');
        return;
      }
      const def = this.w.def;
      const hs = Math.hypot(this.vel.x, this.vel.z);
      const bobAmt = this.grounded ? Math.min(1, hs / 4) * (1 - this.ads * 0.8) : 0;
      const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.035 * bobAmt, bobX = Math.cos(this.bobPhase) * 0.02 * bobAmt;
      G.rightFrom(this.yaw, _r);
      cam.position.set(this.eye.x + _r.x * bobX, this.eye.y - bobY + this.stepOff, this.eye.z + _r.z * bobX);
      const sh = G.Game.shakeAmt;
      cam.rotation.set(this.pitch + this.punch + G.randn() * sh * 0.01, this.yaw + this.punchYaw + G.randn() * sh * 0.01, -this.lean * 0.2, 'YXZ');
      const fov = G.lerp(S.fov, def.adsFov * (S.fov / 80), G.smooth(this.ads)) + this.sprint * 4;
      if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
      const vfov = G.lerp(62, 46, G.smooth(this.ads));
      if (Math.abs(VM.camera.fov - vfov) > 0.01) { VM.camera.fov = vfov; VM.camera.updateProjectionMatrix(); }

      // ---- viewmodel pose
      const g = this.gun;
      const a = G.smooth(this.ads);
      const p = _t.copy(g.hip).lerp(g.ads, a);
      let rx = 0, ry = 0, rz = 0;
      // sway & bob (reduced when aiming)
      const na = 1 - a * 0.85;
      p.x += (this.swayX + Math.cos(this.bobPhase) * 0.012 * bobAmt) * na;
      p.y += (this.swayY - Math.abs(Math.sin(this.bobPhase)) * 0.012 * bobAmt) * na + Math.sin(G.time * 1.6) * 0.002 * na;
      ry += this.swayX * 2 * na; rx += this.swayY * 1.5 * na;
      // sprint
      const s = G.smooth(this.sprint);
      p.x += 0.03 * s; p.y -= 0.05 * s; p.z += 0.03 * s;
      rx -= 0.28 * s; ry += 0.55 * s; rz += 0.3 * s;
      // crouch / lean flavour
      rz += this.lean * 0.05 * (1 - a);
      // recoil kick
      p.z += this.kick * (def.pellets > 1 ? 0.09 : 0.03);
      rx += this.kick * (def.pellets > 1 ? 0.14 : 0.04) * (1 - a * 0.5);
      // reload
      if (g.mag) g.mag.position.copy(g.magBase);
      if (this.reloadT > 0) {
        const t = 1 - this.reloadT / this.reloadDur;
        if (def.shell) {
          const k = Math.min(1, Math.min(t, 1 - t) * 8);
          rz += 0.35 * k; rx += 0.18 * k; p.y -= 0.03 * k;
          const cyc = ((this.reloadDur - this.reloadT) % def.shell) / def.shell;
          p.y += Math.sin(cyc * Math.PI) * 0.012 * k;
        } else {
          const k = Math.min(1, Math.min(t, 1 - t) * 7);
          rz += 0.5 * k; rx += 0.2 * k; p.y -= 0.035 * k; p.x -= 0.02 * k;
          if (g.mag) {
            let off = 0;
            if (t > 0.18 && t < 0.62) off = G.smooth(Math.min(1, (t - 0.18) / 0.14)) * 0.4;
            if (t >= 0.45 && t < 0.62) off = G.lerp(0.4, 0, G.smooth((t - 0.45) / 0.17));
            g.mag.position.y -= off;
            g.mag.visible = off < 0.35;
          }
          if (this.reloadEmpty && t > 0.8 && t < 0.92) { const b = Math.sin((t - 0.8) / 0.12 * Math.PI); rx += 0.08 * b; p.z += 0.02 * b; }
        }
      } else if (g.mag) g.mag.visible = true;
      // pump
      if (g.pump) {
        g.pump.position.copy(g.pumpBase);
        if (this.pumpT > 0) { const t = 1 - this.pumpT / 0.5; g.pump.position.z += Math.sin(G.clamp(t, 0, 1) * Math.PI) * 0.09; rx += Math.sin(G.clamp(t, 0, 1) * Math.PI) * 0.05; }
      }
      // switch
      if (this.switchT > 0) { const k = Math.sin(G.clamp(this.switchT / 0.5, 0, 1) * Math.PI); p.y -= 0.25 * k; rx -= 0.6 * k; }
      // melee (butt stroke)
      if (this.meleeT > 0) {
        const t = 1 - this.meleeT / 0.55, k = Math.sin(G.clamp(t, 0, 1) * Math.PI);
        p.x -= 0.12 * k; p.z -= 0.14 * k; p.y += 0.03 * k; ry -= 0.9 * k; rz -= 0.4 * k;
      }
      // grenade throw: lower weapon
      if (this.throwT > 0) { const k = Math.sin(G.clamp(this.throwT / 0.65, 0, 1) * Math.PI); p.y -= 0.3 * k; rx -= 0.5 * k; }
      if (this.vault) { p.y -= 0.12; rx -= 0.3; }
      g.group.position.copy(p);
      g.group.rotation.set(rx, ry, rz);
      VM.root.visible = true;
      // indoor lighting on the viewmodel
      const indoor = G.MAP.indoors(this.pos.x, this.pos.z);
      VM.hemi.intensity = G.damp(VM.hemi.intensity, indoor ? 0.55 : 0.95, 3, dt);
      VM.sun.intensity = G.damp(VM.sun.intensity, indoor ? 0.45 : 1.25, 3, dt);
    }
  }
  G.Player = Player;
})();
