'use strict';
// Grid navigation (0.5 m cells) with A*, rebuilt locally when walls/barricades are destroyed.
(function () {
  const G = window.G;
  const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];

  const N = (G.Nav = {
    x0: -44, z0: -38, cs: 0.5, R: 0.3,
    build() {
      const bounds = G.MAP.bounds;
      this.x0 = bounds[0]; this.z0 = bounds[1];
      this.nx = Math.ceil((bounds[2] - bounds[0]) / this.cs);
      this.nz = Math.ceil((bounds[3] - bounds[1]) / this.cs);
      const n = this.nx * this.nz;
      this.grid = new Uint8Array(n);
      this.g = new Float32Array(n);
      this.came = new Int32Array(n);
      this.stampG = new Uint32Array(n);
      this.closed = new Uint32Array(n);
      this.search = 0;
      this.heap = new Int32Array(n * 4);
      this.heapF = new Float32Array(n * 4);
      for (let iz = 0; iz < this.nz; iz++) for (let ix = 0; ix < this.nx; ix++) this.grid[iz * this.nx + ix] = this.evalCell(ix, iz);
      this.dirtyRect = null;
      this.budget = 4;
    },
    // 0 free, 1 blocked, 2 barricade (passable but must be broken)
    evalCell(ix, iz) {
      const x = this.x0 + (ix + 0.5) * this.cs, z = this.z0 + (iz + 0.5) * this.cs, r = this.R;
      let v = 0;
      G.W.query(x - r, z - r, x + r, z + r, (s) => {
        if (v === 1) return;
        if (s.y1 <= 0.25 || s.y0 >= 1.85) return;
        if (s.type === 0) {
          const cx = G.clamp(x, s.x0, s.x1), cz = G.clamp(z, s.z0, s.z1);
          if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) v = 1;
        } else {
          let hit = false;
          G.W.panelCells(s, x - r, 0.25, z - r, x + r, 1.85, z + r, (a, b, c, d, e, f) => {
            const cx = G.clamp(x, a, d), cz = G.clamp(z, c, f);
            if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) { hit = true; return false; }
          });
          if (hit) v = s.kind === 'barricade' ? 2 : 1;
        }
      });
      return v;
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
      for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) this.grid[iz * this.nx + ix] = this.evalCell(ix, iz);
    },
    rebuildAll() { for (let iz = 0; iz < this.nz; iz++) for (let ix = 0; ix < this.nx; ix++) this.grid[iz * this.nx + ix] = this.evalCell(ix, iz); this.dirtyRect = null; },
    cellOf(x, z) {
      const ix = Math.floor((x - this.x0) / this.cs), iz = Math.floor((z - this.z0) / this.cs);
      if (ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz) return -1;
      return iz * this.nx + ix;
    },
    center(i, out) { out.x = this.x0 + ((i % this.nx) + 0.5) * this.cs; out.z = this.z0 + (((i / this.nx) | 0) + 0.5) * this.cs; return out; },
    nearestFree(i) {
      if (i < 0) return -1;
      if (this.grid[i] !== 1) return i;
      const cx = i % this.nx, cz = (i / this.nx) | 0;
      for (let r = 1; r < 8; r++) {
        for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          const x = cx + dx, z = cz + dz;
          if (x < 0 || z < 0 || x >= this.nx || z >= this.nz) continue;
          const j = z * this.nx + x;
          if (this.grid[j] !== 1) return j;
        }
      }
      return -1;
    },
    free(x, z) { const i = this.cellOf(x, z); return i >= 0 && this.grid[i] !== 1; },

    // returns array of {x,z} or null. Consumes per-frame budget.
    findPath(sx, sz, gx, gz, force) {
      if (!force && this.budget <= 0) return undefined;
      this.budget--;
      const s = this.nearestFree(this.cellOf(sx, sz)), goal = this.nearestFree(this.cellOf(gx, gz));
      if (s < 0 || goal < 0) return null;
      if (s === goal) return [{ x: gx, z: gz }];
      const nx = this.nx, nz = this.nz, grid = this.grid;
      const st = ++this.search;
      const gxC = goal % nx, gzC = (goal / nx) | 0;
      const H = (i) => { const dx = Math.abs((i % nx) - gxC), dz = Math.abs(((i / nx) | 0) - gzC); return (dx + dz) + (1.4142 - 2) * Math.min(dx, dz); };
      let hn = 0;
      const heap = this.heap, hf = this.heapF;
      const push = (i, f) => {
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
      push(s, H(s));
      let found = false, iter = 0;
      while (hn > 0 && iter++ < 60000) {
        const cur = pop();
        if (this.closed[cur] === st) continue;
        this.closed[cur] = st;
        if (cur === goal) { found = true; break; }
        const cx = cur % nx, cz = (cur / nx) | 0;
        for (let k = 0; k < 8; k++) {
          const d = DIRS[k], x = cx + d[0], z = cz + d[1];
          if (x < 0 || z < 0 || x >= nx || z >= nz) continue;
          const ni = z * nx + x, v = grid[ni];
          if (v === 1 || this.closed[ni] === st) continue;
          if (k >= 4 && (grid[cz * nx + x] === 1 || grid[z * nx + cx] === 1)) continue;
          const ng = this.g[cur] + d[2] * (v === 2 ? 7 : 1);
          if (this.stampG[ni] !== st || ng < this.g[ni]) {
            this.stampG[ni] = st; this.g[ni] = ng; this.came[ni] = cur;
            push(ni, ng + H(ni));
          }
        }
      }
      if (!found) return null;
      const cells = [];
      for (let i = goal; i >= 0; i = this.came[i]) { cells.push(i); if (i === s) break; }
      cells.reverse();
      // string-pull smoothing
      const pts = cells.map((i) => this.center(i, { x: 0, z: 0 }));
      const out = [];
      let a = 0;
      while (a < pts.length - 1) {
        let b = pts.length - 1;
        while (b > a + 1 && !this.lineFree(pts[a].x, pts[a].z, pts[b].x, pts[b].z)) b--;
        out.push(pts[b]);
        a = b;
      }
      if (this.free(gx, gz) && out.length) out[out.length - 1] = { x: gx, z: gz };
      return out;
    },
    lineFree(x0, z0, x1, z1) {
      const d = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(d / 0.2);
      let sawBar = false;
      for (let i = 1; i < n; i++) {
        const t = i / n, c = this.cellOf(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t);
        if (c < 0) return false;
        const v = this.grid[c];
        if (v === 1) return false;
        if (v === 2) sawBar = true;
      }
      // keep barricade crossings short so bots approach them head-on
      return !sawBar || d < 2.5;
    },
  });
})();
