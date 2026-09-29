'use strict';
// Bot AI: perception (sight + hearing), human-like aim, corner peeking with leans, barricade breaching.
(function () {
  const G = window.G;
  const V = THREE.Vector3;
  const _a = new V(), _b = new V(), _r = new V(), _u = new V(), _d = new V();

  G.DIFF = {
    recruit: { react: [0.55, 0.85], errStart: 1.0, errMin: 0.34, errAng: 0.012, tau: 0.85, turn: 7, head: 0.04, burst: [3, 5], spread: 1.6, pause: 1.4 },
    regular: { react: [0.34, 0.55], errStart: 0.8, errMin: 0.21, errAng: 0.007, tau: 0.6, turn: 10, head: 0.1, burst: [3, 7], spread: 1.2, pause: 1.0 },
    veteran: { react: [0.22, 0.38], errStart: 0.6, errMin: 0.14, errAng: 0.0045, tau: 0.45, turn: 13, head: 0.2, burst: [4, 9], spread: 1.0, pause: 0.8 },
  };

  G.surfaceAt = function (x, z) {
    if (G.MAP.indoors(x, z)) {
      for (const r of G.MAP.rooms) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return G.PHYS[r.floor] || 'concrete';
      return 'wood';
    }
    if (Math.abs(x) < 19 && Math.abs(z) < 19) return 'concrete';
    if (z > 19 || (z < -16 && Math.abs(x) < 22) || (x > 19 && x < 32 && z > -20)) return 'concrete';
    return 'dirt';
  };

  class Bot {
    constructor(team, name, wkey) {
      this.team = team; this.name = name; this.isBot = true;
      this.def = G.WEAPONS[wkey];
      this.pos = new V(); this.vel = new V(); this.want = new V();
      this.head = new V(); this.eye = new V(); this.chestA = new V(); this.chestB = new V(); this.legA = new V(); this.legB = new V();
      this.model = G.buildCharacter(team, this.def.model);
      G.scene.add(this.model.root);
      this.kills = 0; this.deaths = 0;
      this.goal = new V(); this.lastSeenPos = new V(); this.alertPos = new V(); this.perc = new V(); this.lookAt = new V(); this.spotLook = new V();
      this.stuckPos = new V(); this.fallDir = new V();
    }

    spawn(x, z, yaw, role, data) {
      this.pos.set(x, 0, z); this.vel.set(0, 0, 0); this.want.set(0, 0, 0);
      this.yaw = yaw; this.aimYaw = yaw; this.aimPitch = 0;
      this.hp = 100; this.alive = true;
      this.lean = 0; this.leanTarget = 0; this.leanUntil = 0; this.peekT = 0; this.leanMaxL = 1; this.leanMaxR = 1;
      this.crouch = 0; this.crouchTarget = 0;
      this.mag = this.def.mag; this.reserve = 999; this.reloadT = 0; this.fireCd = 0; this.burstLeft = 4; this.burstPause = 0; this.pumpT = 0;
      this.role = role; this.data = data || {}; this.phase = 0;
      this.D = G.DIFF[G.Game.settings.diff] || G.DIFF.regular;
      if (G.Game.hackerMode) this.D = { react: [0.08, 0.18], errStart: 0.08, errMin: 0.02, errAng: 0.0005, tau: 0.12, turn: 35, head: 0.8, burst: [12, 20], spread: 0, pause: 0.2 };
      this.deviceTarget = null; this.deviceWait = 0;
      this.target = null; this.visible = false; this.visMask = 0; this.lastSeenT = -99; this.alertT = -99; this.alertKind = '';
      this.reactT = 0; this.engT = 0; this.ex = 0; this.ey = 0; this.flinch = 0; this.errStart = 0; this.aimHead = false;
      this.path = null; this.pathI = 0; this.needPath = true; this.goalSpeed = 0; this.hasGoal = false;
      this.breach = null; this.stuckT = 0; this.stuckN = 0; this.unstuckT = 0; this.unstuck = new V();
      this.percT = Math.random() * 0.1; this.lastEv = G.Game.evId;
      this.strafe = 0; this.strafeT = 0; this.stepDist = 0; this.scan = Math.random() * 6;
      this.delay = this.team === 'atk' ? G.rand(0.2, 1.8) : 0;
      this.roamT = G.rand(15, 30); this.calloutT = 0; this.searchT = 0;
      this.deadT = 0;
      this.model.root.visible = true;
      this.model.melee = 0;
      G.updateHitShapes(this);
    }

    // eye position for a hypothetical lean value
    eyeAt(lean, out) {
      const hipsY = G.lerp(0.95, 0.53, this.crouch);
      G.rightFrom(this.aimYaw, _r);
      const a = lean * 0.5, s = Math.sin(a) * 0.77;
      return out.set(this.pos.x + _r.x * s, this.pos.y + hipsY + 0.08 + Math.cos(a) * 0.77, this.pos.z + _r.z * s);
    }
    visMaskFrom(eye, e) {
      let m = 0;
      if (G.W.clear(eye.x, eye.y, eye.z, e.head.x, e.head.y, e.head.z)) m |= 1;
      const cx = (e.chestA.x + e.chestB.x) / 2, cy = (e.chestA.y + e.chestB.y) / 2 + 0.05, cz = (e.chestA.z + e.chestB.z) / 2;
      if (G.W.clear(eye.x, eye.y, eye.z, cx, cy, cz)) m |= 2;
      if (!m) { if (G.W.clear(eye.x, eye.y, eye.z, e.legB.x, e.legB.y - 0.25, e.legB.z)) m |= 4; }
      return m;
    }

    takeDamage(amt, attacker, part, dx, dz) {
      // on a multiplayer client, bots are puppets owned by the host: report the hit instead of applying it
      if (this.puppet) { if (this.alive) G.Net.sendHit(this, amt, attacker, part, dx, dz); return; }
      if (!this.alive || G.Game.state !== 'live') return;
      this.hp -= amt;
      this.flinch = Math.min(1.2, this.flinch + 0.45);
      if (attacker && attacker.alive !== undefined) {
        this.alertPos.copy(attacker.pos); this.alertT = G.time; this.alertKind = 'hit';
        if (!this.target || !this.visible) {
          // snap attention toward the shooter
          const want = G.yawOf(attacker.pos.x - this.pos.x, attacker.pos.z - this.pos.z);
          this.aimYaw = G.lerp(this.aimYaw, this.aimYaw + G.wrap(want - this.aimYaw), 0.5);
        }
      }
      if (this.hp <= 0) {
        this.hp = 0; this.alive = false; this.deadT = 0; this.deaths++;
        const s = Math.random();
        this.fallDir.set(s < 0.55 ? 1 : s < 0.8 ? -1 : 0, 0, s >= 0.8 ? (Math.random() < 0.5 ? 1 : -1) : G.rand(-0.3, 0.3));
        G.Game.onKill(attacker, this, part === 'head');
      } else if (this.crouchTarget === 0 && Math.random() < 0.25) this.crouchTarget = 1;
    }

    // ------------------------------------------------ perception
    perceive() {
      const now = G.time;
      G.updateHitShapes(this);
      if (G.Game.hackerMode) {
        const enemies = G.Game.entities.filter((e) => e.alive && G.Game.isEnemy(this, e));
        enemies.sort((a, b) => this.pos.distanceToSquared(a.pos) - this.pos.distanceToSquared(b.pos));
        const e = enemies[0];
        if (e) {
          const m = this.visMaskFrom(this.eye, e);
          if (this.target !== e) this.acquire(e, m || 2);
          this.visMask = m; this.visible = !!m; this.lastSeenT = now; this.lastSeenPos.copy(e.pos);
        } else { this.target = null; this.visible = false; }
        return;
      }
      let best = null, bestScore = 1e9, bestMask = 0;
      for (const e of G.Game.entities) {
        if (!e.alive || !G.Game.isEnemy(this, e)) continue;
        const cx = e.chestB.x - this.eye.x, cy = e.chestB.y - this.eye.y, cz = e.chestB.z - this.eye.z;
        const d = Math.sqrt(cx * cx + cy * cy + cz * cz);
        if (d > 85) continue;
        const ang = Math.abs(G.wrap(G.yawOf(cx, cz) - this.aimYaw));
        const tracking = e === this.target && now - this.lastSeenT < 1.2;
        if (ang > 1.1 && d > 2.2 && !tracking) continue;
        const m = this.visMaskFrom(this.eye, e);
        if (!m) continue;
        // far + barely exposed targets are harder to notice
        if (!tracking && d > 30 && m === 4) continue;
        const score = d * (e === this.target ? 0.5 : 1) + ang * 4;
        if (score < bestScore) { bestScore = score; best = e; bestMask = m; }
      }
      if (best) {
        if (best !== this.target || now - this.lastSeenT > 1.5) this.acquire(best, bestMask);
        this.visible = true; this.visMask = bestMask; this.lastSeenT = now; this.lastSeenPos.copy(best.pos);
      } else this.visible = false;

      // wall clearance for leaning
      G.rightFrom(this.aimYaw, _r);
      const hy = this.pos.y + G.lerp(1.5, 1.0, this.crouch);
      const hl = G.W.raycast(this.pos.x, hy, this.pos.z, -_r.x, 0, -_r.z, 0.75);
      const hr = G.W.raycast(this.pos.x, hy, this.pos.z, _r.x, 0, _r.z, 0.75);
      this.leanMaxL = hl ? G.clamp((hl.t - 0.18) / 0.4, 0, 1) : 1;
      this.leanMaxR = hr ? G.clamp((hr.t - 0.18) / 0.4, 0, 1) : 1;

      // lean decisions
      const t = this.target;
      if (this.reloadT > 0 || this.breach) { this.leanTarget = 0; }
      else if (t && !this.visible && now - this.lastSeenT < 3.5) {
        if (now > this.peekT) {
          this.peekT = now + 0.3;
          const order = Math.random() < 0.5 ? [1, -1] : [-1, 1];
          let found = 0;
          for (const s of order) {
            const mx = s > 0 ? this.leanMaxR : this.leanMaxL;
            if (mx < 0.5) continue;
            if (this.visMaskFrom(this.eyeAt(s * mx, _a), t)) { found = s * mx; break; }
          }
          if (found) { this.leanTarget = found; this.leanUntil = now + G.rand(1.5, 3); }
          else if (now > this.leanUntil) this.leanTarget = 0;
        }
      } else if (t && this.visible) {
        if (now > this.leanUntil) {
          this.leanUntil = now + G.rand(1.2, 3);
          if (Math.random() < 0.4) {
            const s = Math.random() < 0.5 ? 1 : -1, mx = s > 0 ? this.leanMaxR : this.leanMaxL;
            if (mx > 0.5 && this.visMaskFrom(this.eyeAt(s * mx, _a), t)) this.leanTarget = s * mx;
          } else if (this.visMaskFrom(this.eyeAt(0, _a), t)) this.leanTarget = 0;
        }
      } else if (!t) {
        if (now > this.leanUntil) {
          this.leanUntil = now + G.rand(2, 5);
          const moving = this.want.lengthSq() > 0.2;
          if (moving) this.leanTarget = 0;
          else {
            const r = Math.random();
            this.leanTarget = r < 0.5 ? 0 : r < 0.75 ? this.leanMaxL * -0.9 : this.leanMaxR * 0.9;
          }
        }
      }
      if (this.leanTarget > this.leanMaxR) this.leanTarget = this.leanMaxR;
      if (this.leanTarget < -this.leanMaxL) this.leanTarget = -this.leanMaxL;
    }

    acquire(e, mask) {
      const now = G.time;
      const fresh = e !== this.target || now - this.lastSeenT > 3;
      this.target = e;
      if (!fresh) { this.reactT = Math.min(this.reactT, 0.15); return; }
      const D = this.D, d = this.pos.distanceTo(e.pos);
      let react = G.rand(D.react[0], D.react[1]);
      if (now - this.alertT < 3 && this.alertPos.distanceTo(e.pos) < 6) react *= 0.7;
      if (mask === 4 || mask === 1) react *= 1.25;
      if (d > 30) react *= 1.2;
      this.reactT = react;
      this.engT = 0;
      this.errStart = D.errStart * (0.8 + Math.random() * 0.4);
      this.ex = G.randn(); this.ey = G.randn();
      this.aimHead = Math.random() < D.head;
      this.perc.copy(e.pos);
      this.burstLeft = G.randInt(D.burst[0], D.burst[1]);
      if (Math.random() < 0.3) this.crouchTarget = 1;
      if (!G.Game.hackerMode && this.team === G.Game.player.team && G.time > this.calloutT) {
        this.calloutT = G.time + 6;
        G.Game.callout(this.name, `Contact — ${G.MAP.roomAt(e.pos.x, e.pos.z)}`);
      }
    }

    hear() {
      for (const ev of G.Game.events) {
        if (ev.id <= this.lastEv) continue;
        this.lastEv = Math.max(this.lastEv, ev.id);
        if (!G.Game.hackerMode && ev.team === this.team) continue;
        const d = ev.pos.distanceTo(this.pos);
        if (d > ev.radius) continue;
        const err = d * 0.08;
        this.alertPos.set(ev.pos.x + G.randn() * err, 0, ev.pos.z + G.randn() * err);
        this.alertT = G.time; this.alertKind = ev.kind;
      }
    }

    // ------------------------------------------------ navigation
    setGoal(x, z, speed) {
      if (!this.hasGoal || Math.hypot(x - this.goal.x, z - this.goal.z) > 0.8) { this.needPath = true; this.hasGoal = true; }
      this.goal.set(x, 0, z);
      this.goalSpeed = speed;
    }
    followPath(dt) {
      this.want.set(0, 0, 0);
      if (!this.hasGoal) return false;
      if (this.needPath) {
        const p = G.Nav.findPath(this.pos.x, this.pos.z, this.goal.x, this.goal.z);
        if (p === undefined) return true;
        this.path = p; this.pathI = 0; this.needPath = false;
      }
      if (this.unstuckT > 0) { this.unstuckT -= dt; this.want.copy(this.unstuck).multiplyScalar(this.goalSpeed); return true; }
      let tx, tz;
      if (this.path && this.pathI < this.path.length) {
        const p = this.path[this.pathI];
        tx = p.x; tz = p.z;
        if (Math.hypot(tx - this.pos.x, tz - this.pos.z) < (this.pathI === this.path.length - 1 ? 0.3 : 0.45)) { this.pathI++; return true; }
      } else if (!this.path) {
        tx = this.goal.x; tz = this.goal.z;
        if (Math.hypot(tx - this.pos.x, tz - this.pos.z) < 0.4) return false;
      } else return false;
      const dx = tx - this.pos.x, dz = tz - this.pos.z, d = Math.hypot(dx, dz) || 1;
      const fx = dx / d, fz = dz / d;
      // barricade in the way?
      if (!this.breach) {
        for (const h of [1.0, 0.45]) {
          const hit = G.W.raycast(this.pos.x, h, this.pos.z, fx, 0, fz, 0.95);
          if (hit && hit.s.type === 1 && hit.s.kind === 'barricade') { this.breach = { x: hit.x, z: hit.z, fx, fz, t: 0.25, step: 0, p: hit.s }; break; }
        }
      }
      if (this.breach) return true;
      const sp = Math.min(this.goalSpeed, d * 3 + 0.8);
      this.want.set(fx * sp, 0, fz * sp);
      return true;
    }
    doBreach(dt) {
      const b = this.breach;
      this.want.set(0, 0, 0);
      this.lookAt.set(b.x, 1.0, b.z);
      b.t -= dt;
      if (b.t <= 0) {
        b.t = 0.6;
        const ys = [1.45, 0.95, 0.4, 1.7];
        const y = ys[b.step % ys.length];
        b.step++;
        this.model.melee = 0.4;
        const n = G.W.hitBarricade(b.p, 34, b.fx, 0, b.fz) ? 1 : 0;
        const p = new V(b.x, y, b.z);
        G.Audio.swing(p, false);
        if (!n) G.Audio.breakWood(p);
        let blocked = false;
        for (const h of [1.3, 0.9, 0.45]) {
          const hit = G.W.raycast(this.pos.x, h, this.pos.z, b.fx, 0, b.fz, 1.3);
          if (hit && hit.s.type === 1 && hit.s.kind === 'barricade') { blocked = true; b.x = hit.x; b.z = hit.z; }
        }
        if (!blocked || b.step > 9) { this.breach = null; this.needPath = true; }
      }
    }

    // ------------------------------------------------ decision making
    think(dt) {
      const now = G.time;
      if (this.target && (!this.target.alive || now - this.lastSeenT > 7)) { this.target = null; this.visible = false; }
      if (this.delay > 0) { this.delay -= dt; this.want.set(0, 0, 0); return; }
      this.lookAt.set(NaN, 0, 0);
      if (this.breach && !(this.target && this.visible)) { this.doBreach(dt); return; }
      const t = this.target;
      if (G.Game.hackerMode) {
        if (t && this.visible) this.engage(dt);
        else {
          const goal = t ? t.pos : G.MAP.objective;
          this.setGoal(goal.x, goal.z, 4.2); this.followPath(dt);
          this.lookAt.set(goal.x, 1.3, goal.z);
        }
        return;
      }
      if (t && this.visible) this.engage(dt);
      else if (t && now - this.lastSeenT < 2.4) {
        // hold the angle where they vanished; peek with leans
        this.want.set(0, 0, 0);
        this.lookAt.set(this.lastSeenPos.x, this.lastSeenPos.y + 1.3, this.lastSeenPos.z);
        if (this.reloadT <= 0 && this.mag < this.def.mag * 0.35) this.startReload();
      } else if (t) {
        // search: push towards last known position
        const push = this.team === 'atk' || this.role === 'roam' || Math.random() < 0.004;
        if (push || this.searching) {
          this.searching = true;
          this.setGoal(this.lastSeenPos.x, this.lastSeenPos.z, 2.3);
          this.followPath(dt);
          this.lookAt.set(this.lastSeenPos.x, 1.3, this.lastSeenPos.z);
          if (this.pos.distanceTo(this.lastSeenPos) < 1.5) { this.target = null; this.searching = false; }
        } else {
          this.want.set(0, 0, 0);
          this.lookAt.set(this.lastSeenPos.x, 1.3, this.lastSeenPos.z);
        }
        if (this.reloadT <= 0 && this.mag < this.def.mag * 0.5) this.startReload();
      } else {
        this.searching = false;
        if (this.reloadT <= 0 && this.mag < this.def.mag * 0.6) this.startReload();
        this.roleLogic(dt);
        if (now - this.alertT < 5) {
          const d = this.alertPos.distanceTo(this.pos);
          if (d < 25) this.lookAt.set(this.alertPos.x, 1.3, this.alertPos.z);
          if (this.team === 'def' && this.role !== 'anchor' && d < 14 && d > 4 && this.alertKind !== 'step') {
            this.setGoal(this.alertPos.x, this.alertPos.z, 2.4);
            this.followPath(dt);
          }
        }
      }
    }

    roleLogic(dt) {
      const MAP = G.MAP, Gm = G.Game;
      if (this.team === 'def') {
        let spot = this.data.spot;
        if (Gm.zoneAtk > 0 && this.role !== 'anchor') {
          if (!this.data.retake) this.data.retake = G.pick(MAP.secure);
          spot = [this.data.retake[0], this.data.retake[1], MAP.objective.x, MAP.objective.z];
        } else if (this.role === 'roam') {
          this.roamT -= dt;
          if (this.roamT <= 0) { this.roamT = G.rand(14, 26); this.data.spot = G.pick(MAP.roam.concat(MAP.support)); spot = this.data.spot; }
        }
        const d = Math.hypot(spot[0] - this.pos.x, spot[1] - this.pos.z);
        if (d > 0.5) {
          this.setGoal(spot[0], spot[1], this.role === 'roam' ? 2.6 : 3.0);
          if (!this.followPath(dt)) this.want.set(0, 0, 0);
          if (d < 3) this.lookAt.set(spot[2], 1.3, spot[3]);
        } else {
          this.want.set(0, 0, 0);
          this.scan += dt * 0.4;
          const base = G.yawOf(spot[2] - this.pos.x, spot[3] - this.pos.z) + Math.sin(this.scan) * 0.35;
          this.lookAt.set(this.pos.x - Math.sin(base) * 5, 1.3, this.pos.z - Math.cos(base) * 5);
          if (this.data.crouch !== undefined) this.crouchTarget = this.data.crouch;
        }
      } else {
        const en = this.data.entry;
        if (this.phase === 0) {
          this.setGoal(en.out[0], en.out[1], 3.9);
          this.followPath(dt);
          if (Math.hypot(en.out[0] - this.pos.x, en.out[1] - this.pos.z) < 2.2) this.phase = 1;
        } else if (this.phase === 1) {
          this.setGoal(en.in[0], en.in[1], 2.6);
          this.followPath(dt);
          if (Math.hypot(en.in[0] - this.pos.x, en.in[1] - this.pos.z) < 1.6) this.phase = 2;
        } else {
          const s = this.data.secure;
          const d = Math.hypot(s[0] - this.pos.x, s[1] - this.pos.z);
          if (d > 0.5) { this.setGoal(s[0], s[1], 2.6); if (!this.followPath(dt)) this.want.set(0, 0, 0); }
          else {
            this.want.set(0, 0, 0);
            this.scan += dt * 0.5;
            const doors = MAP.zoneDoors;
            let bestD = null, bd = 1e9;
            for (const dd of doors) { const q = Math.hypot(dd[0] - this.pos.x, dd[1] - this.pos.z); if (q > 1.5 && q < bd) { bd = q; bestD = dd; } }
            const base = bestD ? G.yawOf(bestD[0] - this.pos.x, bestD[1] - this.pos.z) + Math.sin(this.scan) * 0.5 : this.aimYaw;
            this.lookAt.set(this.pos.x - Math.sin(base) * 5, 1.3, this.pos.z - Math.cos(base) * 5);
          }
        }
      }
    }

    engage(dt) {
      const t = this.target, now = G.time;
      this.searching = false;
      // movement while fighting: short strafes, occasional crouch
      this.strafeT -= dt;
      if (this.strafeT <= 0) {
        this.strafeT = G.rand(0.35, 1.1);
        const r = Math.random();
        this.strafe = r < 0.45 ? 0 : r < 0.72 ? 1 : -1;
        if (Math.random() < 0.15) this.crouchTarget = this.crouchTarget ? 0 : 1;
      }
      G.rightFrom(this.aimYaw, _r);
      const sp = this.reloadT > 0 ? 2.2 : 1.9;
      this.want.set(_r.x * this.strafe * sp, 0, _r.z * this.strafe * sp);
      if (this.reloadT > 0) {
        // back off while reloading
        const dx = this.pos.x - t.pos.x, dz = this.pos.z - t.pos.z, d = Math.hypot(dx, dz) || 1;
        this.want.x += dx / d * 1.5; this.want.z += dz / d * 1.5;
      }
      if (this.team === 'atk' && this.pos.distanceTo(t.pos) > 20 && this.reloadT <= 0) {
        const dx = t.pos.x - this.pos.x, dz = t.pos.z - this.pos.z, d = Math.hypot(dx, dz);
        this.want.x += dx / d * 1.2; this.want.z += dz / d * 1.2;
      }
    }

    startReload() {
      if (this.reloadT > 0 || this.mag >= this.def.mag) return;
      this.reloadT = this.def.shell ? this.def.shell * (this.def.mag - this.mag) + 0.4 : this.def.reload + 0.2;
      this.leanTarget = 0;
      if (this.pos.distanceTo(G.Audio.lp) < 12) G.Audio.reload('out', this.eye.clone(), false);
      G.Game.soundEvent(this.pos, 5, this.team, 'reload');
    }

    // ------------------------------------------------ aim + shoot
    aimPoint(out) {
      const t = this.target, m = this.visMask;
      if ((this.aimHead && (m & 1)) || !(m & 6)) {
        if (m & 1) return out.copy(t.head);
      }
      if (m & 2) return out.set((t.chestA.x + t.chestB.x) / 2, (t.chestA.y + t.chestB.y) / 2 + 0.05, (t.chestA.z + t.chestB.z) / 2);
      if (m & 1) return out.copy(t.head);
      return out.set(t.legB.x, t.legB.y - 0.25, t.legB.z);
    }
    aim(dt) {
      const D = this.D;
      let tx, ty, tz, k = 5;
      if (this.target && this.visible) {
        const t = this.target;
        this.engT += dt;
        this.perc.x = G.damp(this.perc.x, t.pos.x, 6.5, dt);
        this.perc.z = G.damp(this.perc.z, t.pos.z, 6.5, dt);
        this.aimPoint(_a);
        _a.x += this.perc.x - t.pos.x; _a.z += this.perc.z - t.pos.z;
        // Ornstein-Uhlenbeck aim wobble
        const th = 2.5, sq = Math.sqrt(dt);
        this.ex += -this.ex * th * dt + Math.sqrt(2 * th) * sq * G.randn();
        this.ey += -this.ey * th * dt + Math.sqrt(2 * th) * sq * G.randn();
        const dist = this.eye.distanceTo(_a);
        const lat = Math.hypot(t.vel.x, t.vel.z);
        const selfMove = Math.hypot(this.vel.x, this.vel.z) > 0.6 ? 0.1 : 0;
        const mag = D.errMin + (this.errStart - D.errMin) * Math.exp(-this.engT / D.tau) + D.errAng * dist + lat * 0.05 + selfMove + this.flinch * 0.35;
        _d.subVectors(_a, this.eye).normalize();
        _r.set(-_d.z, 0, _d.x).normalize();
        _u.crossVectors(_r, _d);
        tx = _a.x + (_r.x * this.ex + _u.x * this.ey * 0.8) * mag * 0.6;
        ty = _a.y + (_u.y * this.ey * 0.8) * mag * 0.6;
        tz = _a.z + (_r.z * this.ex + _u.z * this.ey * 0.8) * mag * 0.6;
        k = D.turn;
      } else if (!isNaN(this.lookAt.x)) {
        tx = this.lookAt.x; ty = this.lookAt.y; tz = this.lookAt.z; k = 4;
      } else if (this.want.lengthSq() > 0.1) {
        tx = this.pos.x + this.want.x * 3; ty = 1.4; tz = this.pos.z + this.want.z * 3; k = 5;
      }
      this.flinch = G.damp(this.flinch, 0, 2.5, dt);
      if (tx === undefined) return;
      const dx = tx - this.eye.x, dy = ty - this.eye.y, dz = tz - this.eye.z;
      const desYaw = G.yawOf(dx, dz), desPitch = Math.atan2(dy, Math.hypot(dx, dz));
      const maxRate = 7 * dt;
      const dyaw = G.wrap(desYaw - this.aimYaw) * (1 - Math.exp(-k * dt));
      this.aimYaw += G.clamp(dyaw, -maxRate, maxRate);
      this.aimPitch += G.clamp((desPitch - this.aimPitch) * (1 - Math.exp(-k * dt)), -maxRate, maxRate);
    }

    shootLogic(dt) {
      this.fireCd -= dt;
      if (this.pumpT > 0) this.pumpT -= dt;
      if (this.reloadT > 0) {
        this.reloadT -= dt;
        if (this.reloadT <= 0) { this.mag = this.def.mag; if (this.pos.distanceTo(G.Audio.lp) < 12) G.Audio.reload('in', this.eye.clone(), false); }
        return;
      }
      const t = this.target;
      if (!t || !this.visible || this.breach) return;
      this.reactT -= dt;
      if (this.reactT > 0) return;
      if (this.mag <= 0) { this.startReload(); return; }
      if (this.burstPause > 0) { this.burstPause -= dt; return; }
      if (this.fireCd > 0 || this.pumpT > 0) return;
      G.dirFrom(this.aimYaw, this.aimPitch, _d);
      this.aimPoint(_a);
      const toX = _a.x - this.eye.x, toY = _a.y - this.eye.y, toZ = _a.z - this.eye.z;
      const dist = Math.sqrt(toX * toX + toY * toY + toZ * toZ);
      const cos = (_d.x * toX + _d.y * toY + _d.z * toZ) / dist;
      if (cos < Math.cos(Math.max(0.1, 1.2 / dist))) return;
      // don't shoot through teammates
      const fh = G.raycastEntities(this.eye.x, this.eye.y, this.eye.z, _d.x, _d.y, _d.z, dist, this);
      if (fh && !G.Game.isEnemy(this, fh.e)) { this.fireCd = 0.2; return; }
      this.fire(_d, dist);
    }

    fire(dir, dist) {
      const def = this.def, D = this.D;
      if (!G.Game.hackerMode) this.mag--;
      this.fireCd = 60 / def.rpm * (def.auto ? 1 : G.rand(1.3, 2.0));
      if (G.Game.hackerMode) this.fireCd = Math.min(this.fireCd * 0.4, 0.06);
      if (def.shell) this.pumpT = 0.55;
      const moving = Math.hypot(this.vel.x, this.vel.z) > 0.6;
      const spread = (def.pellets > 1 ? def.hip * 0.8 : def.ads * 2.2) * D.spread * (moving ? 2.2 : 1) * (this.crouch > 0.5 ? 0.85 : 1);
      G.rightFrom(this.aimYaw, _r);
      _u.crossVectors(_r, dir).normalize();
      this.model.root.updateMatrixWorld(true);
      const mz = this.model.muzzle.getWorldPosition(new V());
      let end = null;
      for (let p = 0; p < def.pellets; p++) {
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
        _b.copy(dir).addScaledVector(_r, Math.cos(a) * r).addScaledVector(_u, Math.sin(a) * r).normalize();
        end = G.fireBullet(this, this.eye.x, this.eye.y, this.eye.z, _b.x, _b.y, _b.z, def, p);
        if (p === 0 || Math.random() < 0.3) G.FX.tracer(mz.x, mz.y, mz.z, end.x, end.y, end.z);
      }
      G.FX.muzzle3P(mz, dir);
      if (G.Net && G.Net.inGame && end) G.Net.sendShot(this, end, this.def.key);
      G.Audio.shot(def.sound, mz, false);
      G.Game.soundEvent(this.pos, def.sound === 'shotgun' ? 55 : 45, this.team, 'shot');
      if (!G.Game.hackerMode) {
        this.aimPitch += def.recoilV * 0.45 * G.rand(0.7, 1.3);
        this.aimYaw += G.randn() * def.recoilH * 0.4;
      }
      if (--this.burstLeft <= 0) {
        this.burstLeft = G.randInt(D.burst[0], D.burst[1]) + (dist < 8 ? 4 : 0);
        this.burstPause = G.rand(0.12, 0.35) * D.pause * (dist > 15 ? 1.5 : 0.7);
      }
    }

    // ------------------------------------------------ main update
    update(dt) {
      if (this.puppet) return this.puppetUpdate(dt);
      if (!this.alive) {
        this.deadT += dt;
        this.lean = G.damp(this.lean, 0, 5, dt);
        G.animateCharacter(this.model, { pos: this.pos, yaw: this.aimYaw, dead: true, deadT: this.deadT, fallDir: this.fallDir, lean: 0, crouch: 0, speed: 0, pitch: 0 }, dt);
        return;
      }
      const aiMode = G.Mods.c.bots;
      const frozen = G.Game.state !== 'live' || aiMode === 'frozen';
      this.percT -= dt;
      if (this.percT <= 0) { this.percT = 0.1; if (!frozen) this.perceive(); }
      this.hear();
      if (frozen) { this.want.set(0, 0, 0); if (this.team === 'def') this.roleLogicLook(); }
      else this.think(dt);
      this.aim(dt);
      const watchingDevice = ['prep', 'live'].includes(G.Game.state) && G.Recon.botWatch(this, dt);
      if (!watchingDevice && !frozen && aiMode === 'normal') this.shootLogic(dt);
      else if (!watchingDevice && this.reloadT > 0) { this.reloadT -= dt; if (this.reloadT <= 0) this.mag = this.def.mag; }

      // movement
      const acc = 9;
      this.vel.x = G.damp(this.vel.x, this.want.x, acc, dt);
      this.vel.z = G.damp(this.vel.z, this.want.z, acc, dt);
      if (this.crouch > 0.5) { this.vel.x *= 0.985; this.vel.z *= 0.985; }
      const ox = this.pos.x, oz = this.pos.z;
      this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
      G.W.collide(this.pos, 0.3, 0.36, 1.8);
      G.Game.pushEntities(this);
      const moved = Math.hypot(this.pos.x - ox, this.pos.z - oz);
      this.vel.x = (this.pos.x - ox) / dt * 0.5 + this.vel.x * 0.5;
      this.vel.z = (this.pos.z - oz) / dt * 0.5 + this.vel.z * 0.5;
      // stuck detection
      if (this.want.lengthSq() > 0.5 && !this.breach) {
        this.stuckT += dt;
        if (this.stuckT > 0.8) {
          if (this.pos.distanceTo(this.stuckPos) < 0.2) {
            this.stuckN++;
            this.needPath = true;
            const a = Math.random() * Math.PI * 2;
            this.unstuck.set(Math.cos(a), 0, Math.sin(a));
            this.unstuckT = 0.4;
          } else this.stuckN = 0;
          this.stuckPos.copy(this.pos); this.stuckT = 0;
        }
      } else { this.stuckT = 0; this.stuckPos.copy(this.pos); }
      // crouch: stand up when travelling
      if (this.want.lengthSq() > 4 && !this.target) this.crouchTarget = 0;
      this.crouch = G.damp(this.crouch, this.crouchTarget, 8, dt);
      this.lean = G.damp(this.lean, this.leanTarget, 9, dt);
      this.yaw = this.aimYaw;
      G.updateHitShapes(this);

      // footsteps
      if (moved > 0.001) {
        this.stepDist += moved;
        const sp = moved / dt;
        if (this.stepDist > (sp > 3 ? 1.0 : 0.75)) {
          this.stepDist = 0;
          const loud = sp > 3 ? 1 : this.crouch > 0.5 ? 0.3 : 0.6;
          if (this.pos.distanceTo(G.Audio.lp) < 28) G.Audio.step(this.pos.clone(), G.surfaceAt(this.pos.x, this.pos.z), loud, false);
          G.Game.soundEvent(this.pos, sp > 3 ? 14 : this.crouch > 0.5 ? 2 : 6, this.team, 'step');
        }
      }

      const fwd = (this.vel.x * -Math.sin(this.yaw) + this.vel.z * -Math.cos(this.yaw));
      G.animateCharacter(this.model, {
        pos: this.pos, yaw: this.aimYaw, speed: Math.hypot(this.vel.x, this.vel.z), fwd, crouch: this.crouch, lean: this.lean,
        pitch: this.aimPitch, dead: false,
      }, dt);
    }
    // ---------------------------------------------------------------- multiplayer puppet (client side)
    netState(a) {
      const n = (v, d) => (Number.isFinite(v) ? v : d);
      this.netTarget = { x: n(a[1], this.pos.x), z: n(a[2], this.pos.z), vx: n(a[3], 0), vz: n(a[4], 0), yaw: n(a[5], this.aimYaw), pitch: n(a[6], 0), lean: G.clamp(n(a[7], 0), -1, 1), crouch: G.clamp(n(a[8], 0), 0, 1) };
      if (this.alive) this.hp = G.clamp(n(a[9], this.hp), 0, 100);
      this.tRecv = G.time;
    }
    netDie() {
      this.alive = false; this.hp = 0; this.deadT = 0; this.deaths++;
      const s = Math.random();
      this.fallDir.set(s < 0.55 ? 1 : s < 0.8 ? -1 : 0, 0, s >= 0.8 ? (Math.random() < 0.5 ? 1 : -1) : G.rand(-0.3, 0.3));
    }
    puppetUpdate(dt) {
      if (!this.alive) {
        this.deadT += dt;
        G.animateCharacter(this.model, { pos: this.pos, yaw: this.aimYaw, dead: true, deadT: this.deadT, fallDir: this.fallDir, lean: 0, crouch: 0, speed: 0, pitch: 0 }, dt);
        return;
      }
      const t = this.netTarget;
      if (t) {
        const age = Math.min(0.25, G.time - (this.tRecv || 0));
        const tx = t.x + t.vx * age, tz = t.z + t.vz * age;
        if (Math.hypot(tx - this.pos.x, tz - this.pos.z) > 4) { this.pos.x = tx; this.pos.z = tz; }
        this.pos.x = G.damp(this.pos.x, tx, 14, dt); this.pos.z = G.damp(this.pos.z, tz, 14, dt);
        this.vel.set(t.vx, 0, t.vz);
        this.aimYaw = G.dampAngle(this.aimYaw, t.yaw, 18, dt);
        this.aimPitch = G.damp(this.aimPitch, t.pitch, 18, dt);
        this.lean = G.damp(this.lean, t.lean, 14, dt);
        this.crouch = G.damp(this.crouch, t.crouch, 12, dt);
      }
      this.yaw = this.aimYaw;
      G.updateHitShapes(this);
      const fwd = this.vel.x * -Math.sin(this.yaw) + this.vel.z * -Math.cos(this.yaw);
      G.animateCharacter(this.model, { pos: this.pos, yaw: this.aimYaw, speed: Math.hypot(this.vel.x, this.vel.z), fwd, crouch: this.crouch, lean: this.lean, pitch: this.aimPitch, dead: false }, dt);
    }
    roleLogicLook() {
      const s = this.data.spot;
      if (s) this.lookAt.set(s[2], 1.3, s[3]); else this.lookAt.set(NaN, 0, 0);
    }
  }
  G.Bot = Bot;
})();
