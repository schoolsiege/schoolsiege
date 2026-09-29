'use strict';
// Collision world: static AABBs + destructible grid panels (soft walls, barricades).
(function () {
  const G = window.G;
  const HS = 2; // spatial hash cell (m)
  const key = (ix, iz) => (ix + 2000) * 8192 + (iz + 2000);

  const W = (G.W = {
    solids: [],
    panels: [],
    hash: new Map(),
    stamp: 1,
    _pn: [0, 0, 0],
    _pc: -1,

    // Map teardown; clear(a, b) below is the line-of-sight query.
    resetWorld() {
      this.solids = [];
      this.panels = [];
      this.hash = new Map();
      this.meshes = {};
      this.stamp = 1;
      this._pc = -1;
      this._pn = [0, 0, 0];
    },

    insert(s) {
      const ix0 = Math.floor(s.x0 / HS), ix1 = Math.floor(s.x1 / HS);
      const iz0 = Math.floor(s.z0 / HS), iz1 = Math.floor(s.z1 / HS);
      for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
        const k = key(ix, iz);
        let a = this.hash.get(k);
        if (!a) { a = []; this.hash.set(k, a); }
        a.push(s);
      }
    },

    addBox(x0, y0, z0, x1, y1, z1, phys, pen) {
      const s = { type: 0, x0, y0, z0, x1, y1, z1, phys: phys || 'concrete', pen: !!pen, alive: true, st: 0 };
      this.solids.push(s);
      this.insert(s);
      return s;
    },

    // o: {axis:'x'|'z', u0,u1,y0,y1,c0,c1, kind:'soft'|'barricade', cw, ch, tint}
    addPanel(o) {
      const len = o.u1 - o.u0, h = o.y1 - o.y0;
      const cols = Math.max(1, Math.round(len / (o.cw || 0.25)));
      const rows = Math.max(1, Math.round(h / (o.ch || 0.25)));
      const p = {
        type: 1, id: this.panels.length, axis: o.axis, kind: o.kind,
        u0: o.u0, u1: o.u1, y0: o.y0, y1: o.y1, c0: o.c0, c1: o.c1,
        cols, rows, cw: len / cols, ch: h / rows,
        cells: new Uint8Array(cols * rows).fill(1),
        hp: new Float32Array(cols * rows),
        maxHp: o.kind === 'barricade' ? 34 : 55,
        phys: o.kind === 'barricade' ? 'wood' : 'plaster',
        pen: true, alive: true, st: 0, tint: o.tint || 0xeeeeee, inst: 0, mesh: null,
      };
      p.hp.fill(p.maxHp);
      p.integ = 100; p.broken = false;
      if (o.axis === 'x') { p.x0 = o.u0; p.x1 = o.u1; p.z0 = o.c0; p.z1 = o.c1; }
      else { p.z0 = o.u0; p.z1 = o.u1; p.x0 = o.c0; p.x1 = o.c1; }
      p.y0 = o.y0; p.y1 = o.y1;
      this.panels.push(p);
      this.solids.push(p);
      this.insert(p);
      return p;
    },

    cellBox(p, ci, out) {
      const c = ci % p.cols, r = (ci / p.cols) | 0;
      const u0 = p.u0 + c * p.cw, u1 = u0 + p.cw, y0 = p.y0 + r * p.ch, y1 = y0 + p.ch;
      if (p.axis === 'x') { out[0] = u0; out[2] = p.c0; out[3] = u1; out[5] = p.c1; }
      else { out[0] = p.c0; out[2] = u0; out[3] = p.c1; out[5] = u1; }
      out[1] = y0; out[4] = y1;
      return out;
    },

    // ---------- instanced rendering of panel cells
    buildPanelMeshes(scene) {
      const kinds = { soft: [], barricade: [] };
      for (const p of this.panels) kinds[p.kind].push(p);
      const M = G.M;
      const softMat = G.worldUVMaterial(new THREE.MeshStandardMaterial({ map: G.T.plaster, bumpMap: G.T.plasterBump, bumpScale: 0.004, roughness: 0.95 }), 2, 'vec3(0.62,0.58,0.52)');
      const barMat = G.worldUVMaterial(new THREE.MeshStandardMaterial({ map: G.T.plank, roughness: 0.85 }), 1.1, 'vec3(0.55,0.45,0.35)');
      this.meshes = {};
      const b = [0, 0, 0, 0, 0, 0];
      const m4 = new THREE.Matrix4(), col = new THREE.Color();
      for (const kind of ['soft', 'barricade']) {
        let count = 0;
        for (const p of kinds[kind]) count += p.cells.length;
        if (!count) continue;
        const mesh = new THREE.InstancedMesh(G.geo.box, kind === 'soft' ? softMat : barMat, count);
        mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        let i = 0;
        for (const p of kinds[kind]) {
          p.inst = i; p.mesh = mesh;
          for (let ci = 0; ci < p.cells.length; ci++, i++) {
            this.cellBox(p, ci, b);
            let sx = b[3] - b[0], sy = b[4] - b[1], sz = b[5] - b[2];
            let cx = (b[0] + b[3]) / 2, cy = (b[1] + b[4]) / 2, cz = (b[2] + b[5]) / 2;
            if (kind === 'barricade') {
              // planks: gaps between rows, slight offset
              const r = (ci / p.cols) | 0;
              sy *= 0.8;
              const off = (G.hash2(p.id, r) - 0.5) * 0.02;
              if (p.axis === 'x') cz += off; else cx += off;
              col.setHex(0xffffff).multiplyScalar(0.8 + G.hash2(r, p.id * 7) * 0.35);
            } else {
              const row = (ci / p.cols) | 0;
              // bottom row reads as a painted skirting board
              if (p.y0 === 0 && row === 0) col.setHex(0x5b4a3a);
              else col.setHex(p.tint).multiplyScalar(0.985 + G.hash2(ci, p.id) * 0.03);
            }
            m4.makeScale(sx, sy, sz).setPosition(cx, cy, cz);
            mesh.setMatrixAt(i, m4);
            mesh.setColorAt(i, col);
          }
        }
        mesh.userData.baseM = Float32Array.from(mesh.instanceMatrix.array);
        mesh.userData.baseC = Float32Array.from(mesh.instanceColor.array);
        scene.add(mesh);
        this.meshes[kind] = mesh;
      }
    },

    resetPanels() {
      for (const p of this.panels) { p.cells.fill(1); p.hp.fill(p.maxHp); p.integ = 100; p.broken = false; }
      for (const k in this.meshes) {
        const m = this.meshes[k];
        m.instanceMatrix.array.set(m.userData.baseM);
        m.instanceColor.array.set(m.userData.baseC);
        m.instanceMatrix.needsUpdate = true;
        m.instanceColor.needsUpdate = true;
      }
    },

    // ---------- raycast
    raycast(ox, oy, oz, dx, dy, dz, maxT, filter) {
      const st = ++this.stamp;
      let best = maxT, bs = null, bc = -1, nx = 0, ny = 0, nz = 0;
      let ix = Math.floor(ox / HS), iz = Math.floor(oz / HS);
      const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
      const tdx = Math.abs(dx) > 1e-9 ? Math.abs(HS / dx) : Infinity;
      const tdz = Math.abs(dz) > 1e-9 ? Math.abs(HS / dz) : Infinity;
      let tmx = Math.abs(dx) > 1e-9 ? ((ix + (dx > 0 ? 1 : 0)) * HS - ox) / dx : Infinity;
      let tmz = Math.abs(dz) > 1e-9 ? ((iz + (dz > 0 ? 1 : 0)) * HS - oz) / dz : Infinity;
      let tc = 0;
      for (let guard = 0; guard < 400; guard++) {
        const a = this.hash.get(key(ix, iz));
        if (a) {
          for (let i = 0; i < a.length; i++) {
            const s = a[i];
            if (s.st === st) continue;
            s.st = st;
            if (!s.alive) continue;
            if (filter && !filter(s)) continue;
            if (s.type === 0) {
              const t = G.rayBox(ox, oy, oz, dx, dy, dz, s.x0, s.y0, s.z0, s.x1, s.y1, s.z1, best);
              if (t >= 0 && t < best) { best = t; bs = s; bc = -1; nx = G.hitN[0]; ny = G.hitN[1]; nz = G.hitN[2]; }
            } else {
              const t = this.rayPanel(s, ox, oy, oz, dx, dy, dz, best);
              if (t >= 0 && t < best) { best = t; bs = s; bc = this._pc; nx = this._pn[0]; ny = this._pn[1]; nz = this._pn[2]; }
            }
          }
        }
        if (tmx < tmz) { tc = tmx; tmx += tdx; ix += stepX; }
        else { tc = tmz; tmz += tdz; iz += stepZ; }
        if (tc > best || tc > maxT) break;
      }
      if (!bs) return null;
      return { t: best, s: bs, c: bc, nx, ny, nz, x: ox + dx * best, y: oy + dy * best, z: oz + dz * best };
    },

    rayPanel(p, ox, oy, oz, dx, dy, dz, tmax) {
      const tE = G.rayBox(ox, oy, oz, dx, dy, dz, p.x0, p.y0, p.z0, p.x1, p.y1, p.z1, tmax);
      if (tE < 0) return -1;
      const tX = G.hitExit;
      const en0 = G.hitN[0], en1 = G.hitN[1], en2 = G.hitN[2];
      const ou = p.axis === 'x' ? ox : oz, du = p.axis === 'x' ? dx : dz;
      let t = tE;
      const pu = ou + du * t, py = oy + dy * t;
      let c = Math.floor((pu - p.u0) / p.cw), r = Math.floor((py - p.y0) / p.ch);
      if (c < 0) c = 0; if (c >= p.cols) c = p.cols - 1;
      if (r < 0) r = 0; if (r >= p.rows) r = p.rows - 1;
      const su = du > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
      const tdu = Math.abs(du) > 1e-9 ? Math.abs(p.cw / du) : Infinity;
      const tdy = Math.abs(dy) > 1e-9 ? Math.abs(p.ch / dy) : Infinity;
      let tnu = Math.abs(du) > 1e-9 ? (p.u0 + (c + (du > 0 ? 1 : 0)) * p.cw - ou) / du : Infinity;
      let tny = Math.abs(dy) > 1e-9 ? (p.y0 + (r + (dy > 0 ? 1 : 0)) * p.ch - oy) / dy : Infinity;
      let mode = 0; // 0 entry face, 1 u-crossing, 2 y-crossing
      for (let k = 0; k < 400; k++) {
        if (p.cells[r * p.cols + c]) {
          this._pc = r * p.cols + c;
          const n = this._pn;
          if (mode === 0) { n[0] = en0; n[1] = en1; n[2] = en2; }
          else if (mode === 1) { n[0] = n[1] = n[2] = 0; if (p.axis === 'x') n[0] = -su; else n[2] = -su; }
          else { n[0] = n[2] = 0; n[1] = -sy; }
          return t;
        }
        if (tnu < tny) { t = tnu; tnu += tdu; c += su; mode = 1; }
        else { t = tny; tny += tdy; r += sy; mode = 2; }
        if (t > tX || t > tmax) return -1;
        if (c < 0 || c >= p.cols || r < 0 || r >= p.rows) return -1;
      }
      return -1;
    },

    // true if the segment a->b is unobstructed
    clear(ax, ay, az, bx, by, bz) {
      const dx = bx - ax, dy = by - ay, dz = bz - az;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 1e-4) return true;
      return !this.raycast(ax, ay, az, dx / d, dy / d, dz / d, d - 0.05);
    },

    // iterate solids overlapping XZ rect (deduplicated)
    query(x0, z0, x1, z1, cb) {
      const st = ++this.stamp;
      const ix0 = Math.floor(x0 / HS), ix1 = Math.floor(x1 / HS), iz0 = Math.floor(z0 / HS), iz1 = Math.floor(z1 / HS);
      for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
        const a = this.hash.get(key(ix, iz));
        if (!a) continue;
        for (let i = 0; i < a.length; i++) {
          const s = a[i];
          if (s.st === st || !s.alive) continue;
          s.st = st;
          if (s.x1 < x0 || s.x0 > x1 || s.z1 < z0 || s.z0 > z1) continue;
          cb(s);
        }
      }
    },

    // iterate alive cells of panel p overlapping box
    panelCells(p, x0, y0, z0, x1, y1, z1, cb) {
      const ua = p.axis === 'x' ? x0 : z0, ub = p.axis === 'x' ? x1 : z1;
      const ca = p.axis === 'x' ? z0 : x0, cb2 = p.axis === 'x' ? z1 : x1;
      if (cb2 < p.c0 || ca > p.c1) return;
      let c0 = Math.floor((ua - p.u0) / p.cw), c1 = Math.floor((ub - p.u0) / p.cw);
      let r0 = Math.floor((y0 - p.y0) / p.ch), r1 = Math.floor((y1 - p.y0) / p.ch);
      if (c0 < 0) c0 = 0; if (c1 >= p.cols) c1 = p.cols - 1;
      if (r0 < 0) r0 = 0; if (r1 >= p.rows) r1 = p.rows - 1;
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const ci = r * p.cols + c;
        if (!p.cells[ci]) continue;
        const u0 = p.u0 + c * p.cw, cy0 = p.y0 + r * p.ch;
        if (p.axis === 'x') { if (cb(u0, cy0, p.c0, u0 + p.cw, cy0 + p.ch, p.c1, ci) === false) return; }
        else { if (cb(p.c0, cy0, u0, p.c1, cy0 + p.ch, u0 + p.cw, ci) === false) return; }
      }
    },

    // ---------- character movement collision (circle in XZ, vertical span yb..yt)
    collide(pos, r, yb, yt) {
      let hit = false;
      for (let iter = 0; iter < 3; iter++) {
        let moved = false;
        const x = pos.x, z = pos.z;
        const resolve = (bx0, bz0, bx1, bz1) => {
          const cx = pos.x < bx0 ? bx0 : pos.x > bx1 ? bx1 : pos.x;
          const cz = pos.z < bz0 ? bz0 : pos.z > bz1 ? bz1 : pos.z;
          let dx = pos.x - cx, dz = pos.z - cz;
          const d2 = dx * dx + dz * dz;
          if (d2 >= r * r) return;
          if (d2 > 1e-10) {
            const d = Math.sqrt(d2), push = (r - d) / d;
            pos.x += dx * push; pos.z += dz * push;
          } else {
            // centre inside: push out along smallest axis
            const l = pos.x - bx0 + r, rr = bx1 - pos.x + r, f = pos.z - bz0 + r, b = bz1 - pos.z + r;
            const m = Math.min(l, rr, f, b);
            if (m === l) pos.x = bx0 - r; else if (m === rr) pos.x = bx1 + r; else if (m === f) pos.z = bz0 - r; else pos.z = bz1 + r;
          }
          moved = true;
        };
        this.query(x - r, z - r, x + r, z + r, (s) => {
          if (s.y1 <= yb || s.y0 >= yt) return;
          if (s.type === 0) resolve(s.x0, s.z0, s.x1, s.z1);
          else this.panelCells(s, x - r, yb, z - r, x + r, yt, z + r, (a, _, c, d, __, f) => { resolve(a, c, d, f); });
        });
        if (!moved) break;
        hit = true;
      }
      return hit;
    },

    // is the vertical capsule volume free?
    free(x, z, r, yb, yt) {
      let ok = true;
      this.query(x - r, z - r, x + r, z + r, (s) => {
        if (!ok || s.y1 <= yb || s.y0 >= yt) return;
        const test = (bx0, bz0, bx1, bz1) => {
          const cx = G.clamp(x, bx0, bx1), cz = G.clamp(z, bz0, bz1);
          if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) { ok = false; return false; }
        };
        if (s.type === 0) test(s.x0, s.z0, s.x1, s.z1);
        else this.panelCells(s, x - r, yb, z - r, x + r, yt, z + r, (a, _, c, d, __, f) => test(a, c, d, f));
      });
      return ok;
    },

    // highest surface under footprint with top <= maxY
    ground(x, z, r, maxY) {
      let g = -10;
      this.query(x - r, z - r, x + r, z + r, (s) => {
        if (s.type === 0) { if (s.y1 <= maxY && s.y1 > g) g = s.y1; }
        else this.panelCells(s, x - r, -10, z - r, x + r, maxY, z + r, (a, b, c, d, top) => { if (top <= maxY && top > g) g = top; });
      });
      return g;
    },
    // lowest surface above minY
    ceil(x, z, r, minY) {
      let c = 100;
      this.query(x - r, z - r, x + r, z + r, (s) => {
        if (s.type === 0) { if (s.y0 >= minY && s.y0 < c) c = s.y0; }
        else this.panelCells(s, x - r, minY, z - r, x + r, 100, z + r, (a, bot) => { if (bot >= minY && bot < c) c = bot; });
      });
      return c;
    },

    // ---------- destruction
    damageCell(p, ci, dmg, dx, dy, dz) {
      if (!p.cells[ci]) return;
      p.hp[ci] -= dmg;
      if (p.hp[ci] <= 0) { this.destroyCell(p, ci, dx, dy, dz, true); return; }
      // darken damaged cells
      const m = p.mesh, idx = p.inst + ci, k = 0.55 + 0.45 * (p.hp[ci] / p.maxHp);
      const base = m.userData.baseC;
      m.instanceColor.setXYZ(idx, base[idx * 3] * k, base[idx * 3 + 1] * k, base[idx * 3 + 2] * k);
      m.instanceColor.needsUpdate = true;
    },

    destroyCell(p, ci, dx, dy, dz, fx) {
      if (!p.cells[ci]) return;
      p.cells[ci] = 0;
      const m = p.mesh, idx = p.inst + ci, arr = m.instanceMatrix.array;
      for (let k = 0; k < 16; k++) arr[idx * 16 + k] = 0;
      m.instanceMatrix.needsUpdate = true;
      const b = this.cellBox(p, ci, [0, 0, 0, 0, 0, 0]);
      if (G.FX) G.FX.removeDecalsOf(p.id, ci);
      if (fx && G.FX) G.FX.cellDebris(b, p.kind, dx || 0, dy || 0, dz || 0);
      if (G.Nav) G.Nav.dirty(b[0], b[2], b[3], b[5]);
      if (G.Net) G.Net.queueCell(p.id, ci);
    },

    // Barricades have an overall health pool: ~3 melee hits or ~6 rifle rounds knocks the whole thing down.
    hitBarricade(p, amount, dx, dy, dz) {
      if (!p || p.kind !== 'barricade' || p.broken) return false;
      if (G.Net) G.Net.queueBar(p.id, amount);
      p.integ -= amount;
      if (p.integ > 0) return false;
      p.broken = true;
      let n = 0;
      for (let ci = 0; ci < p.cells.length; ci++) {
        if (p.cells[ci]) { this.destroyCell(p, ci, dx || 0, dy || 0, dz || 0, n % 3 === 0); n++; }
      }
      const c = new THREE.Vector3((p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2, (p.z0 + p.z1) / 2);
      if (G.Audio) G.Audio.breakWood(c);
      if (G.Game) G.Game.soundEvent(c, 25, null, 'break');
      return true;
    },

    // destroy cells within a sphere; returns number destroyed
    destroySphere(cx, cy, cz, rad, kinds, dx, dy, dz) {
      let n = 0;
      const touched = [];
      this.query(cx - rad, cz - rad, cx + rad, cz + rad, (s) => {
        if (s.type !== 1 || (kinds && kinds.indexOf(s.kind) < 0)) return;
        this.panelCells(s, cx - rad, cy - rad, cz - rad, cx + rad, cy + rad, cz + rad, (a, b, c, d, e, f, ci) => {
          const mx = (a + d) / 2 - cx, my = (b + e) / 2 - cy, mz = (c + f) / 2 - cz;
          const dist = Math.sqrt(mx * mx + my * my + mz * mz);
          if (dist < rad * (0.85 + Math.random() * 0.3)) { touched.push([s, ci]); }
        });
      });
      for (const [p, ci] of touched) { if (p.cells[ci]) { this.destroyCell(p, ci, dx, dy, dz, n < 40); n++; } }
      return n;
    },
  });
})();
