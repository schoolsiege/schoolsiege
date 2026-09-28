'use strict';
// Visual effects: decals, particles, debris, tracers, muzzle flashes, flash light.
(function () {
  const G = window.G;
  const V = THREE.Vector3;

  class PSys {
    constructor(scene, max, size, tex, additive, opacity) {
      this.max = max; this.i = 0;
      this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4);
      this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.ml = new Float32Array(max);
      this.grav = new Float32Array(max); this.drag = new Float32Array(max); this.a0 = new Float32Array(max);
      for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -9999;
      this.geo = new THREE.BufferGeometry();
      this.pa = new THREE.BufferAttribute(this.pos, 3); this.pa.setUsage(THREE.DynamicDrawUsage);
      this.ca = new THREE.BufferAttribute(this.col, 4); this.ca.setUsage(THREE.DynamicDrawUsage);
      this.geo.setAttribute('position', this.pa); this.geo.setAttribute('color', this.ca);
      this.mat = new THREE.PointsMaterial({ size, map: tex, vertexColors: true, transparent: true, depthWrite: false, opacity: opacity || 1,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, sizeAttenuation: true });
      this.pts = new THREE.Points(this.geo, this.mat);
      this.pts.frustumCulled = false;
      this.pts.renderOrder = 5;
      scene.add(this.pts);
      this.alive = 0;
    }
    emit(x, y, z, vx, vy, vz, life, r, g, b, a, grav, drag) {
      const i = this.i; this.i = (i + 1) % this.max;
      this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
      this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
      this.life[i] = life; this.ml[i] = life; this.grav[i] = grav; this.drag[i] = drag; this.a0[i] = a;
      this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = a;
    }
    update(dt) {
      const P = this.pos, Vv = this.vel, L = this.life;
      for (let i = 0; i < this.max; i++) {
        if (L[i] <= 0) continue;
        L[i] -= dt;
        if (L[i] <= 0) { P[i * 3 + 1] = -9999; this.col[i * 4 + 3] = 0; continue; }
        const d = Math.exp(-this.drag[i] * dt);
        Vv[i * 3] *= d; Vv[i * 3 + 1] = Vv[i * 3 + 1] * d - this.grav[i] * dt; Vv[i * 3 + 2] *= d;
        P[i * 3] += Vv[i * 3] * dt; P[i * 3 + 1] += Vv[i * 3 + 1] * dt; P[i * 3 + 2] += Vv[i * 3 + 2] * dt;
        if (P[i * 3 + 1] < 0.02 && this.grav[i] > 0) { P[i * 3 + 1] = 0.02; Vv[i * 3 + 1] *= -0.25; Vv[i * 3] *= 0.4; Vv[i * 3 + 2] *= 0.4; }
        const f = L[i] / this.ml[i];
        this.col[i * 4 + 3] = this.a0[i] * Math.min(1, f * 1.6);
      }
      this.pa.needsUpdate = true; this.ca.needsUpdate = true;
    }
    clear() { this.life.fill(0); for (let i = 0; i < this.max; i++) { this.pos[i * 3 + 1] = -9999; this.col[i * 4 + 3] = 0; } this.pa.needsUpdate = true; this.ca.needsUpdate = true; }
  }

  const COL = {
    plaster: [0.85, 0.83, 0.78], concrete: [0.62, 0.62, 0.6], brick: [0.62, 0.36, 0.26], wood: [0.5, 0.36, 0.2],
    metal: [1, 0.8, 0.4], flesh: [0.5, 0.02, 0.02], dirt: [0.4, 0.33, 0.22], fabric: [0.5, 0.5, 0.5], glass: [0.7, 0.8, 0.9],
  };

  const FX = (G.FX = {
    init(scene) {
      this.scene = scene;
      // decals
      const dm = new THREE.MeshStandardMaterial({ map: G.T.hole, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, roughness: 1 });
      this.DN = 500;
      this.decals = new THREE.InstancedMesh(G.geo.plane, dm, this.DN);
      this.decals.frustumCulled = false;
      this.decals.renderOrder = 2;
      const z = new THREE.Matrix4().makeScale(0, 0, 0), c = new THREE.Color(1, 1, 1);
      for (let i = 0; i < this.DN; i++) { this.decals.setMatrixAt(i, z); this.decals.setColorAt(i, c); }
      this.decalOwner = new Int32Array(this.DN).fill(-1);
      this.di = 0;
      scene.add(this.decals);
      // particles
      this.dust = new PSys(scene, 1600, 0.045, G.T.dot, false);
      this.sparks = new PSys(scene, 400, 0.035, G.T.dot, true);
      this.smoke = new PSys(scene, 400, 0.7, G.T.smoke, false, 0.55);
      // debris
      this.DB = 260;
      this.debris = new THREE.InstancedMesh(G.geo.box, new THREE.MeshStandardMaterial({ roughness: 0.9 }), this.DB);
      this.debris.castShadow = true;
      this.debris.frustumCulled = false;
      this.db = [];
      for (let i = 0; i < this.DB; i++) { this.debris.setMatrixAt(i, z); this.debris.setColorAt(i, c); this.db.push({ life: 0, p: new V(), v: new V(), r: new THREE.Euler(), w: new V(), s: new V() }); }
      this.dbi = 0;
      scene.add(this.debris);
      // tracers
      this.tracers = [];
      for (let i = 0; i < 40; i++) {
        const m = new THREE.Mesh(G.geo.box, new THREE.MeshBasicMaterial({ color: 0xffdf9a, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
        m.visible = false; scene.add(m);
        this.tracers.push({ m, a: new V(), b: new V(), dist: 0, len: 0, pos: 0, on: false });
      }
      this.ti = 0;
      // 3rd-person muzzle flashes
      this.flashes = [];
      for (let i = 0; i < 14; i++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: G.T.flash, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
        s.visible = false; s.scale.set(0.45, 0.45, 1); scene.add(s);
        this.flashes.push({ s, t: 0 });
      }
      this.fi = 0;
      // dynamic light for muzzle flashes / explosions
      this.light = new THREE.PointLight(0xffb060, 0, 7, 1.6);
      scene.add(this.light);
      this.lightT = 0;
      this.bigFlash = new THREE.Sprite(new THREE.SpriteMaterial({ map: G.T.flash, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
      this.bigFlash.visible = false; scene.add(this.bigFlash);
      this.bigT = 0;
    },

    clear() {
      const z = new THREE.Matrix4().makeScale(0, 0, 0);
      for (let i = 0; i < this.DN; i++) this.decals.setMatrixAt(i, z);
      this.decals.instanceMatrix.needsUpdate = true;
      this.decalOwner.fill(-1);
      this.dust.clear(); this.sparks.clear(); this.smoke.clear();
      for (let i = 0; i < this.DB; i++) { this.db[i].life = 0; this.debris.setMatrixAt(i, z); }
      this.debris.instanceMatrix.needsUpdate = true;
      for (const t of this.tracers) { t.on = false; t.m.visible = false; }
    },

    decal(x, y, z, nx, ny, nz, size, tint, pid, ci) {
      const i = this.di; this.di = (i + 1) % this.DN;
      const n = new V(nx, ny, nz);
      const q = new THREE.Quaternion().setFromUnitVectors(new V(0, 0, 1), n);
      const q2 = new THREE.Quaternion().setFromAxisAngle(n, Math.random() * 6.28);
      q.premultiply(q2);
      const m = new THREE.Matrix4().compose(new V(x + nx * 0.004, y + ny * 0.004, z + nz * 0.004), q, new V(size, size, 1));
      this.decals.setMatrixAt(i, m);
      this.decals.setColorAt(i, new THREE.Color(tint, tint, tint));
      this.decals.instanceMatrix.needsUpdate = true;
      this.decals.instanceColor.needsUpdate = true;
      this.decalOwner[i] = pid >= 0 ? pid * 100000 + ci : -1;
    },
    removeDecalsOf(pid, ci) {
      const k = pid * 100000 + ci;
      let any = false;
      for (let i = 0; i < this.DN; i++) {
        if (this.decalOwner[i] === k) {
          this.decals.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
          this.decalOwner[i] = -1; any = true;
        }
      }
      if (any) this.decals.instanceMatrix.needsUpdate = true;
    },

    // bullet impact
    impact(h, phys, dx, dy, dz, sound) {
      const c = COL[phys] || COL.concrete;
      const x = h.x, y = h.y, z = h.z, nx = h.nx, ny = h.ny, nz = h.nz;
      if (phys !== 'flesh') {
        const tint = phys === 'metal' ? 0.55 : phys === 'wood' ? 0.45 : 0.6;
        this.decal(x, y, z, nx, ny, nz, phys === 'metal' ? 0.06 : 0.1 + Math.random() * 0.05, tint, h.s.type === 1 ? h.s.id : -1, h.c);
      }
      if (phys === 'metal') {
        for (let i = 0; i < 7; i++) this.sparks.emit(x, y, z, nx * 3 + G.randn() * 2, ny * 3 + Math.random() * 2, nz * 3 + G.randn() * 2, 0.25 + Math.random() * 0.2, 1, 0.8, 0.4, 1, 9, 1);
      } else {
        const cnt = phys === 'flesh' ? 10 : 8;
        for (let i = 0; i < cnt; i++) {
          const s = 1.2 + Math.random() * 2.5;
          this.dust.emit(x + nx * 0.02, y + ny * 0.02, z + nz * 0.02, nx * s + G.randn() * 0.9, ny * s + Math.random() * 1.5, nz * s + G.randn() * 0.9, 0.5 + Math.random() * 0.6, c[0], c[1], c[2], 1, 9, 1.5);
        }
      }
      if (phys !== 'flesh') this.smoke.emit(x + nx * 0.1, y + ny * 0.1, z + nz * 0.1, nx * 0.5, 0.15, nz * 0.5, 0.8 + Math.random() * 0.5, c[0], c[1], c[2], phys === 'metal' ? 0.15 : 0.35, -0.1, 1.2);
      if (sound && G.Audio) G.Audio.impact(phys, new V(x, y, z));
    },

    blood(x, y, z, dx, dy, dz) {
      for (let i = 0; i < 12; i++) this.dust.emit(x, y, z, dx * 1.5 + G.randn() * 0.8, dy * 1.5 + G.randn() * 0.8 + 0.5, dz * 1.5 + G.randn() * 0.8, 0.4 + Math.random() * 0.3, 0.45, 0.02, 0.02, 1, 9, 2);
      this.smoke.emit(x, y, z, dx * 0.5, 0.1, dz * 0.5, 0.35, 0.5, 0.05, 0.05, 0.5, 0, 2);
    },

    cellDebris(b, kind, dx, dy, dz) {
      const cx = (b[0] + b[3]) / 2, cy = (b[1] + b[4]) / 2, cz = (b[2] + b[5]) / 2;
      const wood = kind === 'barricade';
      const col = wood ? new THREE.Color(0.45, 0.32, 0.2) : new THREE.Color(0.85, 0.83, 0.78);
      const n = wood ? 2 : 3;
      for (let i = 0; i < n; i++) {
        const d = this.db[this.dbi]; const idx = this.dbi; this.dbi = (this.dbi + 1) % this.DB;
        d.life = 3 + Math.random() * 2;
        d.p.set(cx + G.randn() * 0.05, cy + G.randn() * 0.05, cz + G.randn() * 0.05);
        d.v.set(dx * 2.5 + G.randn() * 1.2, dy * 2 + Math.random() * 2, dz * 2.5 + G.randn() * 1.2);
        d.w.set(G.randn() * 8, G.randn() * 8, G.randn() * 8);
        d.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
        if (wood) d.s.set(0.05 + Math.random() * 0.15, 0.03 + Math.random() * 0.05, 0.02 + Math.random() * 0.02);
        else d.s.set(0.05 + Math.random() * 0.08, 0.04 + Math.random() * 0.07, 0.03 + Math.random() * 0.06);
        this.debris.setColorAt(idx, col);
      }
      this.debris.instanceColor.needsUpdate = true;
      const c = wood ? COL.wood : COL.plaster;
      for (let i = 0; i < 6; i++) this.dust.emit(cx, cy, cz, dx * 2 + G.randn(), dy * 2 + Math.random() * 1.5, dz * 2 + G.randn(), 0.6 + Math.random() * 0.5, c[0], c[1], c[2], 1, 9, 1.5);
      this.smoke.emit(cx, cy, cz, dx * 0.6 + G.randn() * 0.2, 0.2, dz * 0.6 + G.randn() * 0.2, 1.4 + Math.random(), c[0], c[1], c[2], wood ? 0.25 : 0.5, -0.05, 0.8);
    },

    tracer(ax, ay, az, bx, by, bz) {
      const t = this.tracers[this.ti]; this.ti = (this.ti + 1) % this.tracers.length;
      t.a.set(ax, ay, az); t.b.set(bx, by, bz);
      t.dist = t.a.distanceTo(t.b);
      if (t.dist < 1.5) return;
      t.pos = 0; t.on = true; t.m.visible = true;
      t.m.lookAt(t.b);
      t.m.position.copy(t.a);
      t.m.lookAt(t.b);
    },

    muzzle3P(pos, dir) {
      const f = this.flashes[this.fi]; this.fi = (this.fi + 1) % this.flashes.length;
      f.s.position.copy(pos).addScaledVector(dir, 0.05);
      f.s.material.rotation = Math.random() * 6.28;
      const sc = 0.35 + Math.random() * 0.2;
      f.s.scale.set(sc, sc, 1);
      f.s.visible = true; f.t = 0.05;
      this.flashLight(pos, 2.2);
    },
    flashLight(pos, intensity, dist) {
      this.light.position.copy(pos);
      this.light.intensity = intensity;
      this.light.distance = dist || 7;
      this.lightT = 0.06;
    },

    explosion(p) {
      this.bigFlash.position.copy(p); this.bigFlash.position.y += 0.3;
      this.bigFlash.scale.set(4, 4, 1); this.bigFlash.visible = true; this.bigT = 0.12;
      this.flashLight(p, 9, 16); this.lightT = 0.18;
      for (let i = 0; i < 60; i++) {
        const v = new V(G.randn(), Math.random() * 1.2, G.randn()).normalize().multiplyScalar(4 + Math.random() * 9);
        this.sparks.emit(p.x, p.y + 0.2, p.z, v.x, v.y, v.z, 0.3 + Math.random() * 0.5, 1, 0.7, 0.3, 1, 9, 1.2);
      }
      for (let i = 0; i < 40; i++) {
        const v = new V(G.randn(), Math.random() * 1.5, G.randn()).normalize().multiplyScalar(2 + Math.random() * 5);
        this.dust.emit(p.x, p.y + 0.2, p.z, v.x, v.y, v.z, 0.8 + Math.random() * 0.6, 0.3, 0.28, 0.25, 1, 9, 1.2);
      }
      for (let i = 0; i < 14; i++) {
        this.smoke.emit(p.x + G.randn() * 0.5, p.y + 0.3 + Math.random() * 0.8, p.z + G.randn() * 0.5, G.randn() * 1.8, 0.5 + Math.random() * 1.2, G.randn() * 1.8, 1.8 + Math.random() * 1.5, 0.35, 0.33, 0.3, 0.45, -0.2, 0.9);
      }
    },

    miniBlast(p) {
      this.flashLight(p, 4, 7);
      for (let i = 0; i < 14; i++) {
        const v = new V(G.randn(), Math.random(), G.randn()).normalize().multiplyScalar(3 + Math.random() * 5);
        this.sparks.emit(p.x, p.y, p.z, v.x, v.y, v.z, 0.2 + Math.random() * 0.3, 1, 0.7, 0.3, 1, 9, 1.5);
      }
      for (let i = 0; i < 3; i++) this.smoke.emit(p.x + G.randn() * 0.2, p.y + 0.1, p.z + G.randn() * 0.2, G.randn() * 0.8, 0.5, G.randn() * 0.8, 1 + Math.random(), 0.3, 0.28, 0.25, 0.4, -0.1, 1);
      const f = this.flashes[this.fi]; this.fi = (this.fi + 1) % this.flashes.length;
      f.s.position.copy(p); f.s.scale.set(1.3, 1.3, 1); f.s.material.rotation = Math.random() * 6.28; f.s.visible = true; f.t = 0.07;
    },

    update(dt) {
      this.dust.update(dt); this.sparks.update(dt); this.smoke.update(dt);
      // debris
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), z = new THREE.Matrix4().makeScale(0, 0, 0);
      let any = false;
      for (let i = 0; i < this.DB; i++) {
        const d = this.db[i];
        if (d.life <= 0) continue;
        any = true;
        d.life -= dt;
        if (d.life <= 0) { this.debris.setMatrixAt(i, z); continue; }
        d.v.y -= 9.8 * dt;
        d.p.addScaledVector(d.v, dt);
        if (d.p.y < d.s.y * 0.5 + 0.02) {
          d.p.y = d.s.y * 0.5 + 0.02;
          d.v.y *= -0.3; d.v.x *= 0.6; d.v.z *= 0.6; d.w.multiplyScalar(0.6);
        } else {
          d.r.x += d.w.x * dt; d.r.y += d.w.y * dt; d.r.z += d.w.z * dt;
        }
        const s = d.life < 0.5 ? d.life * 2 : 1;
        q.setFromEuler(d.r);
        m4.compose(d.p, q, new V(d.s.x * s, d.s.y * s, d.s.z * s));
        this.debris.setMatrixAt(i, m4);
      }
      if (any) this.debris.instanceMatrix.needsUpdate = true;
      // tracers
      for (const t of this.tracers) {
        if (!t.on) continue;
        t.pos += dt * 320;
        // the tail keeps travelling after the head reaches the impact point, so the streak always ends
        const head = Math.min(t.dist, t.pos), tail = Math.min(t.dist, Math.max(0, t.pos - 5));
        if (tail >= t.dist - 0.01 || t.pos > t.dist + 6) { t.on = false; t.m.visible = false; continue; }
        const len = head - tail;
        const dir = new V().subVectors(t.b, t.a).normalize();
        t.m.position.copy(t.a).addScaledVector(dir, (head + tail) / 2);
        t.m.scale.set(0.012, 0.012, Math.max(0.01, len));
      }
      for (const f of this.flashes) { if (f.t > 0) { f.t -= dt; if (f.t <= 0) f.s.visible = false; } }
      if (this.lightT > 0) { this.lightT -= dt; if (this.lightT <= 0) this.light.intensity = 0; else this.light.intensity *= 0.8; }
      if (this.bigT > 0) { this.bigT -= dt; const s = 4 + (0.12 - this.bigT) * 20; this.bigFlash.scale.set(s, s, 1); if (this.bigT <= 0) this.bigFlash.visible = false; }
    },
  });
})();
