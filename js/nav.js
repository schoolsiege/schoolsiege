'use strict';
// Layered grid navigation with A*. The map is cut into 0.5 m columns; every column keeps up to L walkable
// surfaces (basement, ground floor, upstairs...). Neighbouring surfaces connect when the height change is a
// small step, so stairs link the floors. Rebuilt locally when walls/barricades are destroyed.
(function () {
  const G = window.G;
  const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];
  const L = 6;             // surfaces kept per column (lowest first)
  const STEP = 0.45;       // biggest height change between neighbouring nodes (stairs)
  const LO = 0.36, HI = 1.8; // obstacle band above a surface; matches the characters' step-over height

  const N = (G.Nav = {
    x0: -44, z0: -38, cs: 0.5, R: 0.3, L, _spans: [], _tops: [],
    build() {
      const bounds = G.MAP.bounds;
      this.x0 = bounds[0]; this.z0 = bounds[1];
      this.nx = Math.ceil((bounds[2] - bounds[0]) / this.cs);
      this.nz = Math.ceil((bounds[3] - bounds[1]) / this.cs);
      const n = this.nx * this.nz * L;
      this.h = new Float32Array(n);
      this.grid = new Uint8Array(n); // 0 free, 1 blocked / no surface, 2 barricade (passable but must be broken)
      this.g = new Float32Array(n);
      this.came = new Int32Array(n);
      this.stampG = new Uint32Array(n);
      this.closed = new Uint32Array(n);
      this.search = 0;
      this.heap = new Int32Array(n * 4);
      this.heapF = new Float32Array(n * 4);
      this.rebuildAll();
      this.budget = 4;
    },
    // walkable heights in the column at (x, z): tops of solid boxes that are not buried inside another solid
    surfaces(x, z) {
      const spans = this._spans, tops = this._tops;
      spans.length = 0; tops.length = 0;
      G.W.query(x - 0.01, z - 0.01, x + 0.01, z + 0.01, (s) => {
        if (s.type !== 0 || x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) return;
        spans.push(s.y0, s.y1);
      });
      for (let i = 1; i < spans.length; i += 2) {
        const t = spans[i];
        let buried = false, ceil = 1e9;
        for (let j = 0; j < spans.length; j += 2) {
          if (spans[j] < t + 0.05 && spans[j + 1] > t + 0.05) { buried = true; break; }
          if (spans[j] >= t + 0.05 && spans[j] < ceil) ceil = spans[j];
        }
        // no room to stand (shelf tops, the gap above a cupboard): not a floor
        if (!buried && ceil - t > 1.1) tops.push(t);
      }
      tops.sort((a, b) => a - b);
      // merge surfaces a few cm apart (a floor finish on a slab)
      const out = [];
      for (const t of tops) {
        if (out.length && t - out[out.length - 1] < 0.3) out[out.length - 1] = t;
        else out.push(t);
      }
      return out;
    },
    evalNode(x, z, h) {
      const r = this.R, lo = h + LO, hi = h + HI;
      let v = 0;
      G.W.query(x - r, z - r, x + r, z + r, (s) => {
        if (v === 1) return;
        if (s.y1 <= lo || s.y0 >= hi) return;
        if (s.type === 0) {
          const cx = G.clamp(x, s.x0, s.x1), cz = G.clamp(z, s.z0, s.z1);
          if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) v = 1;
        } else {
          let hit = false;
          G.W.panelCells(s, x - r, lo, z - r, x + r, hi, z + r, (a, b, c, d, e, f) => {
            const cx = G.clamp(x, a, d), cz = G.clamp(z, c, f);
            if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) { hit = true; return false; }
          });
          if (hit) v = s.kind === 'barricade' ? 2 : 1;
        }
      });
      return v;
    },
    evalColumn(ix, iz) {
      const x = this.x0 + (ix + 0.5) * this.cs, z = this.z0 + (iz + 0.5) * this.cs;
      const base = (iz * this.nx + ix) * L, surf = this.surfaces(x, z);
      for (let k = 0; k < L; k++) {
        const i = base + k;
        if (k < surf.length) { this.h[i] = surf[k]; this.grid[i] = this.evalNode(x, z, surf[k]); }
        else { this.h[i] = NaN; this.grid[i] = 1; }
      }
    },
    dirty(x0, z0, x1, z1) {
      const d = this.dirtyRect;
      if (!d) this.dirtyRect = [x0, z0, x1, z1];
      else { d[0] = Math.min(d[0], x0); d[1] = Math.min(d[1], z0); d[2] = Math.max(d[2], x1); d[3] = Math.max(d[3], z1); }
    },
    flush() {
      this.budget = 4;
      const d = this.dirtyRect;
      if (!d) return;
      this.dirtyRect = null;
      const m = this.R + this.cs;
      const ix0 = Math.max(0, Math.floor((d[0] - m - this.x0) / this.cs)), ix1 = Math.min(this.nx - 1, Math.floor((d[2] + m - this.x0) / this.cs));
      const iz0 = Math.max(0, Math.floor((d[1] - m - this.z0) / this.cs)), iz1 = Math.min(this.nz - 1, Math.floor((d[3] + m - this.z0) / this.cs));
      for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) this.evalColumn(ix, iz);
    },
    rebuildAll() { for (let iz = 0; iz < this.nz; iz++) for (let ix = 0; ix < this.nx; ix++) this.evalColumn(ix, iz); this.dirtyRect = null; },
    colOf(x, z) {
      const ix = Math.floor((x - this.x0) / this.cs), iz = Math.floor((z - this.z0) / this.cs);
      if (ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz) return -1;
      return iz * this.nx + ix;
    },
    // the surface in the column that a body with feet at height y is standing on (or nearest to)
    nodeIn(col, y) {
      if (col < 0) return -1;
      let best = -1, bd = 1e9;
      for (let k = 0; k < L; k++) {
        const i = col * L + k, h = this.h[i];
        if (h !== h) break;
        const d = h <= y + 0.5 ? y - h : (h - y) * 3 + 1;
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    },
    nodeAt(x, y, z) { return this.nodeIn(this.colOf(x, z), y); },
    center(i, out) {
      const c = (i / L) | 0;
      out.x = this.x0 + ((c % this.nx) + 0.5) * this.cs; out.z = this.z0 + (((c / this.nx) | 0) + 0.5) * this.cs; out.y = this.h[i];
      return out;
    },
    // walkable node in column col within a step of height h (closest), or -1
    stepNode(col, h) {
      let best = -1, bd = STEP + 1e-4;
      for (let k = 0; k < L; k++) {
        const i = col * L + k, hh = this.h[i];
        if (hh !== hh) break;
        const d = Math.abs(hh - h);
        if (d < bd && this.grid[i] !== 1) { bd = d; best = i; }
      }
      return best;
    },
    nearestFree(i, y) {
      if (i < 0) return -1;
      if (this.grid[i] !== 1) return i;
      const c = (i / L) | 0, cx = c % this.nx, cz = (c / this.nx) | 0;
      for (let r = 1; r < 8; r++) {
        let best = -1, bd = 1e9;
        for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          const x = cx + dx, z = cz + dz;
          if (x < 0 || z < 0 || x >= this.nx || z >= this.nz) continue;
          const col = z * this.nx + x;
          for (let k = 0; k < L; k++) {
            const j = col * L + k, h = this.h[j];
            if (h !== h) break;
            const d = Math.abs(h - y);
            if (this.grid[j] !== 1 && d < 1.2 && d < bd) { bd = d; best = j; }
          }
        }
        if (best >= 0) return best;
      }
      return -1;
    },
    free(x, z, y) { const i = this.nodeAt(x, y || 0, z); return i >= 0 && this.grid[i] !== 1; },

    // returns array of {x,y,z} or null. Consumes per-frame budget. (sy / gy are feet heights)
    findPath(sx, sy, sz, gx, gy, gz, force) {
      if (!force && this.budget <= 0) return undefined;
      this.budget--;
      const s = this.nearestFree(this.nodeAt(sx, sy, sz), sy), goal = this.nearestFree(this.nodeAt(gx, gy, gz), gy);
      if (s < 0 || goal < 0) return null;
      if (s === goal) return [{ x: gx, y: this.h[goal], z: gz }];
      const nx = this.nx, nz = this.nz, grid = this.grid, H0 = this.h;
      const st = ++this.search;
      const gc = (goal / L) | 0, gxC = gc % nx, gzC = (gc / nx) | 0, gh = H0[goal];
      const Hf = (i) => {
        const c = (i / L) | 0, dx = Math.abs((c % nx) - gxC), dz = Math.abs(((c / nx) | 0) - gzC);
        return Math.max((dx + dz) + (1.4142 - 2) * Math.min(dx, dz), Math.abs(H0[i] - gh) / STEP);
      };
      let hn = 0;
      const heap = this.heap, hf = this.heapF, cap = heap.length;
      const push = (i, f) => {
        if (hn >= cap) return;
        let k = hn++;
        heap[k] = i; hf[k] = f;
        while (k > 0) { const p = (k - 1) >> 1; if (hf[p] <= hf[k]) break; const ti = heap[p], tf = hf[p]; heap[p] = heap[k]; hf[p] = hf[k]; heap[k] = ti; hf[k] = tf; k = p; }
      };
      const pop = () => {
        const top = heap[0];
        hn--;
        if (hn > 0) {
          heap[0] = heap[hn]; hf[0] = hf[hn];
          let k = 0;
          for (;;) {
            const l = k * 2 + 1, r = l + 1;
            let m = k;
            if (l < hn && hf[l] < hf[m]) m = l;
            if (r < hn && hf[r] < hf[m]) m = r;
            if (m === k) break;
            const ti = heap[m], tf = hf[m]; heap[m] = heap[k]; hf[m] = hf[k]; heap[k] = ti; hf[k] = tf; k = m;
          }
        }
        return top;
      };
      this.g[s] = 0; this.stampG[s] = st; this.came[s] = -1;
      push(s, Hf(s));
      let found = false, iter = 0;
      while (hn > 0 && iter++ < 120000) {
        const cur = pop();
        if (this.closed[cur] === st) continue;
        this.closed[cur] = st;
        if (cur === goal) { found = true; break; }
        const cc = (cur / L) | 0, cx = cc % nx, cz = (cc / nx) | 0, ch = H0[cur];
        for (let k = 0; k < 8; k++) {
          const d = DIRS[k], x = cx + d[0], z = cz + d[1];
          if (x < 0 || z < 0 || x >= nx || z >= nz) continue;
          const ni = this.stepNode(z * nx + x, ch);
          if (ni < 0 || this.closed[ni] === st) continue;
          if (k >= 4 && (this.stepNode(cz * nx + x, ch) < 0 || this.stepNode(z * nx + cx, ch) < 0)) continue;
          const ng = this.g[cur] + d[2] * (grid[ni] === 2 ? 7 : 1);
          if (this.stampG[ni] !== st || ng < this.g[ni]) {
            this.stampG[ni] = st; this.g[ni] = ng; this.came[ni] = cur;
            push(ni, ng + Hf(ni));
          }
        }
      }
      if (!found) return null;
      const nodes = [];
      for (let i = goal; i >= 0; i = this.came[i]) { nodes.push(i); if (i === s) break; }
      nodes.reverse();
      // string-pull smoothing
      const pts = nodes.map((i) => this.center(i, { x: 0, y: 0, z: 0 }));
      const out = [];
      let a = 0;
      while (a < pts.length - 1) {
        let b = pts.length - 1;
        while (b > a + 1 && !this.lineFree(pts[a], pts[b])) b--;
        out.push(pts[b]);
        a = b;
      }
      if (out.length && this.free(gx, gz, gy)) out[out.length - 1] = { x: gx, y: out[out.length - 1].y, z: gz };
      return out;
    },
    // straight walk from a to b stays on connected, unblocked surfaces
    lineFree(a, b) {
      const d = Math.hypot(b.x - a.x, b.z - a.z), n = Math.ceil(d / 0.2);
      let sawBar = false, h = a.y;
      for (let i = 1; i < n; i++) {
        const t = i / n, c = this.colOf(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
        if (c < 0) return false;
        const j = this.stepNode(c, h);
        if (j < 0) return false;
        if (this.grid[j] === 2) sawBar = true;
        h = this.h[j];
      }
      if (Math.abs(h - b.y) > STEP) return false;
      // keep barricade crossings short so bots approach them head-on
      return !sawBar || d < 2.5;
    },
  });
})();
