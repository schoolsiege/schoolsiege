'use strict';
// Shared helpers: math, ray intersection, geometry merging.
(function () {
  const G = (window.G = window.G || {});

  G.rand = (a, b) => a + Math.random() * (b - a);
  G.randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
  G.pick = (arr) => arr[(Math.random() * arr.length) | 0];
  G.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  G.lerp = (a, b, t) => a + (b - a) * t;
  G.damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
  G.wrap = (a) => {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
  };
  G.dampAngle = (a, b, k, dt) => a + G.wrap(b - a) * (1 - Math.exp(-k * dt));
  G.smooth = (t) => t * t * (3 - 2 * t);
  G.randn = () => {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  G.time = 0;

  // Camera convention: yaw 0 looks down -Z.
  G.dirFrom = (yaw, pitch, out) => {
    const c = Math.cos(pitch);
    return out.set(-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c);
  };
  G.rightFrom = (yaw, out) => out.set(Math.cos(yaw), 0, -Math.sin(yaw));
  G.yawOf = (dx, dz) => Math.atan2(-dx, -dz);

  G.mulberry32 = (a) => () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  G.hash2 = (x, y) => {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };

  // ---------- ray / box (slab). Returns entry t or -1. Normal -> G.hitN, exit -> G.hitExit
  G.hitN = [0, 0, 0];
  G.hitExit = 0;
  G.rayBox = function (ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1, tmax) {
    let tn = -Infinity, tf = Infinity, ax = -1, sg = 0, t1, t2, s, inv, q;
    if (dx > -1e-12 && dx < 1e-12) { if (ox < x0 || ox > x1) return -1; }
    else {
      inv = 1 / dx; t1 = (x0 - ox) * inv; t2 = (x1 - ox) * inv; s = -1;
      if (t1 > t2) { q = t1; t1 = t2; t2 = q; s = 1; }
      if (t1 > tn) { tn = t1; ax = 0; sg = s; }
      if (t2 < tf) tf = t2;
    }
    if (dy > -1e-12 && dy < 1e-12) { if (oy < y0 || oy > y1) return -1; }
    else {
      inv = 1 / dy; t1 = (y0 - oy) * inv; t2 = (y1 - oy) * inv; s = -1;
      if (t1 > t2) { q = t1; t1 = t2; t2 = q; s = 1; }
      if (t1 > tn) { tn = t1; ax = 1; sg = s; }
      if (t2 < tf) tf = t2;
    }
    if (dz > -1e-12 && dz < 1e-12) { if (oz < z0 || oz > z1) return -1; }
    else {
      inv = 1 / dz; t1 = (z0 - oz) * inv; t2 = (z1 - oz) * inv; s = -1;
      if (t1 > t2) { q = t1; t1 = t2; t2 = q; s = 1; }
      if (t1 > tn) { tn = t1; ax = 2; sg = s; }
      if (t2 < tf) tf = t2;
    }
    if (tn > tf || tf < 0 || tn > tmax) return -1;
    G.hitExit = tf;
    const n = G.hitN;
    n[0] = n[1] = n[2] = 0;
    if (tn < 0) {
      // origin inside the box
      const adx = Math.abs(dx), ady = Math.abs(dy), adz = Math.abs(dz);
      if (adx >= ady && adx >= adz) n[0] = -Math.sign(dx);
      else if (ady >= adz) n[1] = -Math.sign(dy);
      else n[2] = -Math.sign(dz);
      return 0;
    }
    if (ax >= 0) n[ax] = sg;
    return tn;
  };

  G.raySphere = function (ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
    const lx = ox - cx, ly = oy - cy, lz = oz - cz;
    const b = lx * dx + ly * dy + lz * dz;
    const c = lx * lx + ly * ly + lz * lz - r * r;
    const h = b * b - c;
    if (h < 0) return -1;
    const t = -b - Math.sqrt(h);
    return t >= 0 ? t : (c < 0 ? 0 : -1);
  };

  // capsule (segment a-b, radius r); direction must be normalized
  G.rayCapsule = function (ox, oy, oz, dx, dy, dz, ax, ay, az, bx, by, bz, r) {
    const bax = bx - ax, bay = by - ay, baz = bz - az;
    const oax = ox - ax, oay = oy - ay, oaz = oz - az;
    const baba = bax * bax + bay * bay + baz * baz;
    const bard = bax * dx + bay * dy + baz * dz;
    const baoa = bax * oax + bay * oay + baz * oaz;
    const rdoa = dx * oax + dy * oay + dz * oaz;
    const oaoa = oax * oax + oay * oay + oaz * oaz;
    const a = baba - bard * bard;
    if (a < 1e-9) {
      const t1 = G.raySphere(ox, oy, oz, dx, dy, dz, ax, ay, az, r);
      const t2 = G.raySphere(ox, oy, oz, dx, dy, dz, bx, by, bz, r);
      if (t1 < 0) return t2;
      if (t2 < 0) return t1;
      return Math.min(t1, t2);
    }
    let b = baba * rdoa - baoa * bard;
    let c = baba * oaoa - baoa * baoa - r * r * baba;
    let h = b * b - a * c;
    if (h >= 0) {
      const t = (-b - Math.sqrt(h)) / a;
      const y = baoa + t * bard;
      if (y > 0 && y < baba) return t;
      let ocx, ocy, ocz;
      if (y <= 0) { ocx = oax; ocy = oay; ocz = oaz; } else { ocx = ox - bx; ocy = oy - by; ocz = oz - bz; }
      b = dx * ocx + dy * ocy + dz * ocz;
      c = ocx * ocx + ocy * ocy + ocz * ocz - r * r;
      h = b * b - c;
      if (h > 0) return -b - Math.sqrt(h);
    }
    return -1;
  };

  // closest distance from point p to segment a->b
  G.segPointDist = function (ax, ay, az, bx, by, bz, px, py, pz) {
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const l2 = abx * abx + aby * aby + abz * abz;
    let t = l2 > 0 ? ((px - ax) * abx + (py - ay) * aby + (pz - az) * abz) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = ax + abx * t - px, cy = ay + aby * t - py, cz = az + abz * t - pz;
    return Math.sqrt(cx * cx + cy * cy + cz * cz);
  };

  // ---------- geometry merging (position/normal/uv, indexed)
  G.mergeGeos = function (items) {
    let nv = 0, ni = 0;
    for (const it of items) {
      const g = it.geo;
      nv += g.attributes.position.count;
      ni += g.index ? g.index.count : g.attributes.position.count;
    }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
    const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let vo = 0, io = 0;
    const v = new THREE.Vector3(), nm = new THREE.Matrix3();
    for (const it of items) {
      const g = it.geo, P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
      nm.getNormalMatrix(it.m);
      for (let i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i).applyMatrix4(it.m);
        pos[(vo + i) * 3] = v.x; pos[(vo + i) * 3 + 1] = v.y; pos[(vo + i) * 3 + 2] = v.z;
        v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
        nor[(vo + i) * 3] = v.x; nor[(vo + i) * 3 + 1] = v.y; nor[(vo + i) * 3 + 2] = v.z;
        if (U) { uv[(vo + i) * 2] = U.getX(i) * (it.us || 1); uv[(vo + i) * 2 + 1] = U.getY(i) * (it.vs || 1); }
      }
      if (g.index) { for (let j = 0; j < g.index.count; j++) idx[io + j] = g.index.getX(j) + vo; io += g.index.count; }
      else { for (let j = 0; j < P.count; j++) idx[io + j] = vo + j; io += P.count; }
      vo += P.count;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    out.computeBoundingSphere();
    out.computeBoundingBox();
    return out;
  };

  // shared unit geometries
  G.geo = {};
  G.initGeo = function () {
    G.geo.box = new THREE.BoxGeometry(1, 1, 1);
    G.geo.cyl = new THREE.CylinderGeometry(1, 1, 1, 14);
    G.geo.cyl8 = new THREE.CylinderGeometry(1, 1, 1, 8);
    G.geo.cylOpen = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true);
    G.geo.sph = new THREE.SphereGeometry(1, 16, 12);
    G.geo.sphLow = new THREE.SphereGeometry(1, 10, 8);
    G.geo.dome = new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.56);
    G.geo.ico = new THREE.IcosahedronGeometry(1, 1);
    G.geo.cone = new THREE.ConeGeometry(1, 1, 12);
    G.geo.torus = new THREE.TorusGeometry(1, 0.15, 8, 20);
    G.geo.plane = new THREE.PlaneGeometry(1, 1);
    G.geo.circle = new THREE.CircleGeometry(1, 16);
  };
  const capCache = new Map();
  G.capsuleGeo = function (r, len) {
    const k = Math.round(r * 1000) + '_' + Math.round(len * 1000);
    let g = capCache.get(k);
    if (!g) { g = new THREE.CapsuleGeometry(r, len, 4, 10); capCache.set(k, g); }
    return g;
  };

  // Builds rigid multi-part models, merged per material (few draw calls).
  const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _Y = new THREE.Vector3(0, 1, 0);
  G.Parts = class {
    constructor() { this.map = new Map(); }
    add(geo, mat, px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
      const m = new THREE.Matrix4().compose(_p.set(px, py, pz), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
      return this.addM(geo, mat, m);
    }
    box(mat, px, py, pz, sx, sy, sz, rx = 0, ry = 0, rz = 0) { return this.add(G.geo.box, mat, px, py, pz, rx, ry, rz, sx, sy, sz); }
    // cylinder along axis: 'y' default, 'z' or 'x'
    cyl(mat, px, py, pz, r, len, axis = 'y', geo) {
      const rx = axis === 'z' ? Math.PI / 2 : 0, rz = axis === 'x' ? Math.PI / 2 : 0;
      return this.add(geo || G.geo.cyl, mat, px, py, pz, rx, 0, rz, r, len, r);
    }
    addM(geo, mat, m, us, vs) {
      if (!this.map.has(mat)) this.map.set(mat, []);
      this.map.get(mat).push({ geo, m, us, vs });
      return this;
    }
    limb(mat, a, b, r) {
      const va = new THREE.Vector3(a[0], a[1], a[2]), vb = new THREE.Vector3(b[0], b[1], b[2]);
      const d = vb.clone().sub(va);
      const len = d.length();
      const q = new THREE.Quaternion().setFromUnitVectors(_Y, d.normalize());
      const m = new THREE.Matrix4().compose(va.add(vb).multiplyScalar(0.5), q, _s.set(1, 1, 1));
      return this.addM(G.capsuleGeo(r, Math.max(0.001, len)), mat, m);
    }
    build(shadow = true, receive = true) {
      const g = new THREE.Group();
      for (const [mat, items] of this.map) {
        const mesh = new THREE.Mesh(G.mergeGeos(items), mat);
        mesh.castShadow = shadow;
        mesh.receiveShadow = receive;
        g.add(mesh);
      }
      return g;
    }
  };
})();
