'use strict';
// Map: "Harbor Street Office" — original layout. Built from world-UV boxes merged per material.
(function () {
  const G = window.G;
  const V = THREE.Vector3;

  let batches, decor, scene;

  function batch(key) {
    let b = batches.get(key);
    if (!b) { b = { p: [], n: [], u: [], i: [] }; batches.set(key, b); }
    return b;
  }

  // world-UV box geometry. faces bits: 1:+x 2:-x 4:+y 8:-y 16:+z 32:-z
  function pushBox(b, x0, y0, z0, x1, y1, z1, k, faces) {
    const P = b.p, N = b.n, U = b.u, I = b.i;
    const quad = (v, n, uv) => {
      const s = P.length / 3;
      for (let j = 0; j < 4; j++) { P.push(v[j * 3], v[j * 3 + 1], v[j * 3 + 2]); N.push(n[0], n[1], n[2]); U.push(uv[j * 2] * k, uv[j * 2 + 1] * k); }
      I.push(s, s + 1, s + 2, s, s + 2, s + 3);
    };
    if (faces & 1) quad([x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1], [1, 0, 0], [-z1, y0, -z0, y0, -z0, y1, -z1, y1]);
    if (faces & 2) quad([x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0], [-1, 0, 0], [z0, y0, z1, y0, z1, y1, z0, y1]);
    if (faces & 4) quad([x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0], [0, 1, 0], [x0, -z1, x1, -z1, x1, -z0, x0, -z0]);
    if (faces & 8) quad([x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1], [0, -1, 0], [x0, z0, x1, z0, x1, z1, x0, z1]);
    if (faces & 16) quad([x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1], [0, 0, 1], [x0, y0, x1, y0, x1, y1, x0, y1]);
    if (faces & 32) quad([x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0], [0, 0, -1], [-x1, y0, -x0, y0, -x0, y1, -x1, y1]);
  }

  // box(material, x0,y0,z0,x1,y1,z1, {solid, pen, phys, faces})
  function box(mat, x0, y0, z0, x1, y1, z1, o) {
    o = o || {};
    if (x0 > x1) { const t = x0; x0 = x1; x1 = t; }
    if (y0 > y1) { const t = y0; y0 = y1; y1 = t; }
    if (z0 > z1) { const t = z0; z0 = z1; z1 = t; }
    const m = G.M[mat];
    if (o.visible !== false) pushBox(batch(mat), x0, y0, z0, x1, y1, z1, 1 / (m.userData.s || 1), o.faces === undefined ? 63 : o.faces);
    if (o.solid !== false) {
      const phys = o.phys || m.userData.phys || 'concrete';
      const pen = o.pen !== undefined ? o.pen : (phys === 'wood' || phys === 'fabric' || phys === 'glass');
      G.W.addBox(x0, y0, z0, x1, y1, z1, phys, pen);
    }
  }
  const solidOnly = (x0, y0, z0, x1, y1, z1, phys) => G.W.addBox(Math.min(x0, x1), y0, Math.min(z0, z1), Math.max(x0, x1), y1, Math.max(z0, z1), phys || 'concrete', false);

  // Multi-floor maps build a floor at a time: BASE lifts walls/doors, OY lifts furniture (both 0 elsewhere).
  let BASE = 0, OY = 0;
  function onFloor(y, fn) { const b = BASE, o = OY; BASE = OY = y; try { fn(); } finally { BASE = b; OY = o; } }

  // Local frame with 90° rotations. rot: 0..3 quarter turns.
  function frame(ox, oz, rot) {
    const tr = (lx, lz) => {
      switch (rot & 3) {
        case 0: return [ox + lx, oz + lz];
        case 1: return [ox + lz, oz - lx];
        case 2: return [ox - lx, oz - lz];
        default: return [ox - lz, oz + lx];
      }
    };
    return {
      tr,
      rotY: (rot & 3) * Math.PI / 2,
      box(mat, lx0, y0, lz0, lx1, y1, lz1, o) {
        const a = tr(lx0, lz0), b = tr(lx1, lz1);
        box(mat, a[0], y0 + OY, a[1], b[0], y1 + OY, b[1], o);
      },
      mesh(geo, mat, lx, y, lz, rx, ry, rz, sx, sy, sz) {
        const p = tr(lx, lz);
        decor.add(geo, mat, p[0], y + OY, p[1], rx || 0, (ry || 0) + (rot & 3) * Math.PI / 2, rz || 0, sx, sy, sz);
      },
    };
  }

  // --------------------------------------------------------------- WALLS
  // axis 'x': wall runs along X from a..b at z=c. axis 'z': along Z at x=c.
  // ops: [{at, w, y0, y1, bar:true}]
  function pieces(a, b, H, ops) {
    const out = [];
    let cur = a;
    for (const o of ops.slice().sort((p, q) => p.at - q.at)) {
      const o0 = o.at - o.w / 2, o1 = o.at + o.w / 2;
      if (o0 > cur + 0.001) out.push({ u0: cur, u1: o0, y0: 0, y1: H });
      if (o.y0 > 0) out.push({ u0: o0, u1: o1, y0: 0, y1: o.y0 });
      if (o.y1 < H) out.push({ u0: o0, u1: o1, y0: o.y1, y1: H });
      cur = o1;
    }
    if (cur < b - 0.001) out.push({ u0: cur, u1: b, y0: 0, y1: H });
    return out;
  }
  function boxAlong(mat, axis, u0, u1, y0, y1, c0, c1, o) {
    if (axis === 'x') box(mat, u0, y0, c0, u1, y1, c1, o);
    else box(mat, c0, y0, u0, c1, y1, u1, o);
  }
  // Doorways get an optional barricade that defenders put up during prep. Interior doors always start
  // open (defenders choose which to barricade); exterior walls keep their fixed barricades.
  const doorLike = (o) => o.y0 === 0 && o.w <= 1.8 && o.y1 <= 2.6;
  function barricade(axis, c, o, opt) {
    const o0 = o.at - o.w / 2, o1 = o.at + o.w / 2;
    // A visible floor gap lets the small recon drone pass under door barricades.
    const p = G.W.addPanel({ axis, u0: o0 + 0.01, u1: o1 - 0.01, y0: BASE + (o.y0 > 0 ? o.y0 + 0.02 : 0.22), y1: BASE + o.y1 - 0.02, c0: c - 0.035, c1: c + 0.035, kind: 'barricade', cw: 0.34, ch: 0.26 });
    if (opt) p.optional = true;
  }
  function softWall(axis, c, a, b, ops, tint, t) {
    t = t || 0.16;
    const H = 3.2;
    for (const p of pieces(a, b, H, ops)) {
      G.W.addPanel({ axis, u0: p.u0, u1: p.u1, y0: BASE + p.y0, y1: BASE + p.y1, c0: c - t / 2, c1: c + t / 2, kind: 'soft', cw: 0.25, ch: 0.25, tint });
    }
    for (const o of ops) if (doorLike(o)) barricade(axis, c, o, true); else if (o.bar) barricade(axis, c, o);
  }
  // static wall made of layers [{mat, o0, o1, h}] (offsets along c)
  function staticWall(axis, c, a, b, ops, layers) {
    for (const L of layers) {
      for (const p of pieces(a, b, L.h, ops)) boxAlong(L.mat, axis, p.u0, p.u1, BASE + p.y0, BASE + p.y1, c + L.o0, c + L.o1);
    }
    for (const o of ops) {
      const o0 = o.at - o.w / 2, o1 = o.at + o.w / 2;
      const cMin = c + Math.min(...layers.map((l) => l.o0)), cMax = c + Math.max(...layers.map((l) => l.o1));
      // frame trims (visual)
      boxAlong('trim', axis, o0, o0 + 0.05, BASE + o.y0, BASE + o.y1, cMin - 0.02, cMax + 0.02, { solid: false });
      boxAlong('trim', axis, o1 - 0.05, o1, BASE + o.y0, BASE + o.y1, cMin - 0.02, cMax + 0.02, { solid: false });
      boxAlong('trim', axis, o0, o1, BASE + o.y1 - 0.05, BASE + o.y1, cMin - 0.02, cMax + 0.02, { solid: false });
      if (o.y0 > 0) {
        // sill (vaultable)
        boxAlong('concrete', axis, o0 - 0.08, o1 + 0.08, BASE + o.y0 - 0.05, BASE + o.y0, cMin - 0.06, cMax + 0.06);
      } else {
        boxAlong('concrete', axis, o0, o1, BASE, BASE + 0.025, cMin, cMax, { solid: false });
      }
      if (o.bar) barricade(axis, c, o); else if (doorLike(o)) barricade(axis, c, o, true);
    }
  }
  const DOOR = (at, w, bar) => ({ at, w: w || 1.3, y0: 0, y1: 2.3, bar: !!bar });
  const WIN = (at, w, bar) => ({ at, w: w || 1.4, y0: 0.95, y1: 2.2, bar: bar !== false });

  // exterior wall: outSign = which side (along c) is outside
  function extWall(axis, c, a, b, outSign, ops) {
    const layers = outSign < 0
      ? [{ mat: 'brick', o0: -0.2, o1: 0.1, h: 3.8 }, { mat: 'plasterExt', o0: 0.1, o1: 0.2, h: 3.2 }]
      : [{ mat: 'plasterExt', o0: -0.2, o1: -0.1, h: 3.2 }, { mat: 'brick', o0: -0.1, o1: 0.2, h: 3.8 }];
    staticWall(axis, c, a, b, ops, layers);
    // baseboard inside + brick plinth outside
    const inside = -outSign;
    const segs = pieces(a, b, 3.2, ops.filter((o) => o.y0 === 0).map((o) => ({ ...o, y0: 0, y1: 3.2 })));
    for (const p of segs) {
      if (p.y0 !== 0) continue;
      const ci = c + inside * 0.2, co = c - inside * 0.2;
      boxAlong('woodDark', axis, p.u0, p.u1, 0, 0.1, Math.min(ci, ci + inside * 0.015), Math.max(ci, ci + inside * 0.015), { solid: false });
      boxAlong('concreteDark', axis, p.u0, p.u1, 0, 0.35, Math.min(co, co - inside * 0.03), Math.max(co, co - inside * 0.03), { solid: false });
    }
  }

  // --------------------------------------------------------------- PROPS
  function crate(x, z, s, y) {
    y = (y || 0) + OY; s = s || 1;
    box('crate', x - s / 2, y, z - s / 2, x + s / 2, y + s, z + s / 2);
  }
  function table(f, x0, z0, x1, z1, h, mat) {
    f.box(mat, x0, h - 0.04, z0, x1, h, z1);
    const lx = [x0 + 0.06, x1 - 0.06], lz = [z0 + 0.06, z1 - 0.06];
    for (const a of lx) for (const b of lz) f.box(mat, a - 0.03, 0, b - 0.03, a + 0.03, h - 0.04, b + 0.03, { solid: false });
    f.box(mat, x0, 0.1, z0, x1, h - 0.04, z1, { visible: false });
  }
  function chair(x, z, rot, mat) {
    const f = frame(x, z, rot);
    mat = mat || 'woodDark';
    f.box(mat, -0.22, 0.44, -0.22, 0.22, 0.48, 0.22, { solid: false });
    f.box(mat, -0.22, 0.48, 0.18, 0.22, 0.95, 0.22, { solid: false });
    for (const a of [-0.19, 0.19]) for (const b of [-0.19, 0.19]) f.box(mat, a - 0.02, 0, b - 0.02, a + 0.02, 0.44, b + 0.02, { solid: false });
    f.box(mat, -0.22, 0.05, -0.22, 0.22, 0.9, 0.22, { visible: false, pen: true });
  }
  function officeChair(x, z, rot) {
    const f = frame(x, z, rot);
    f.mesh(G.geo.cyl8, G.M.plasticBlack, 0, 0.25, 0, 0, 0, 0, 0.03, 0.4, 0.03);
    f.mesh(G.geo.cyl8, G.M.plasticBlack, 0, 0.05, 0, 0, 0, 0, 0.28, 0.04, 0.28);
    f.box('fabricGray', -0.25, 0.45, -0.25, 0.25, 0.55, 0.25, { solid: false });
    f.box('fabricGray', -0.24, 0.55, 0.2, 0.24, 1.1, 0.27, { solid: false });
    f.box('fabricGray', -0.25, 0.05, -0.25, 0.25, 1.0, 0.27, { visible: false, pen: true });
  }
  function desk(x, z, rot) {
    const f = frame(x, z, rot);
    f.box('woodLight', -0.8, 0.72, -0.4, 0.8, 0.76, 0.4);
    f.box('cabinetGray', -0.78, 0, -0.38, -0.3, 0.72, 0.38);
    f.box('cabinetGray', 0.74, 0, -0.38, 0.78, 0.72, 0.38, { solid: false });
    f.box('cabinetGray', -0.3, 0.3, 0.34, 0.74, 0.72, 0.38, { solid: false });
    f.box('woodLight', -0.3, 0.1, -0.4, 0.78, 0.72, 0.4, { visible: false });
    // monitor + keyboard
    f.box('plasticBlack', -0.28, 0.76, 0.1, 0.28, 0.78, 0.25, { solid: false });
    f.box('plasticBlack', -0.03, 0.78, 0.18, 0.03, 0.95, 0.22, { solid: false });
    f.box('plasticBlack', -0.3, 0.92, 0.14, 0.3, 1.26, 0.18, { solid: false });
    const p = f.tr(0, 0.137);
    const scr = new THREE.Mesh(G.geo.plane, G.M.screen);
    scr.scale.set(0.56, 0.3, 1); scr.position.set(p[0], OY + 1.09, p[1]); scr.rotation.y = f.rotY + Math.PI;
    scene.add(scr);
    f.box('plasticGray', -0.24, 0.76, -0.2, 0.24, 0.785, -0.05, { solid: false });
    f.box('plasticWhite', 0.35, 0.76, -0.2, 0.43, 0.785, -0.08, { solid: false });
    f.mesh(G.geo.cyl, G.M.plasticWhite, -0.55, 0.81, -0.1, 0, 0, 0, 0.04, 0.1, 0.04);
  }
  function shelf(x, z, rot, w, h, fill) {
    const f = frame(x, z, rot);
    const d = 0.45;
    f.box('metalShelf', -w / 2, 0, -d / 2, -w / 2 + 0.04, h, d / 2, { solid: false });
    f.box('metalShelf', w / 2 - 0.04, 0, -d / 2, w / 2, h, d / 2, { solid: false });
    const n = Math.max(2, Math.round(h / 0.5));
    for (let i = 0; i <= n; i++) {
      const y = 0.08 + i * (h - 0.12) / n;
      f.box('metalShelf', -w / 2, y, -d / 2, w / 2, y + 0.03, d / 2, { solid: false });
      if (fill && i < n) {
        let cx = -w / 2 + 0.08;
        while (cx < w / 2 - 0.25) {
          const bw = 0.2 + Math.random() * 0.25, bh = 0.15 + Math.random() * ((h - 0.12) / n - 0.22);
          if (Math.random() < 0.8) f.box(Math.random() < 0.7 ? 'cardboard' : 'plasticGray', cx, y + 0.03, -d / 2 + 0.04, cx + bw, y + 0.03 + bh, d / 2 - 0.04, { solid: false });
          cx += bw + 0.04;
        }
      }
    }
    f.box('metalShelf', -w / 2, 0, -d / 2, w / 2, h, d / 2, { visible: false, phys: 'metal', pen: false });
  }
  function rack(x, z, rot) {
    const f = frame(x, z, rot);
    const p = f.tr(0, 0);
    const m = new THREE.Mesh(G.geo.box, G.M.rack);
    m.scale.set(0.62, 2.05, 0.9);
    m.position.set(p[0], OY + 1.025, p[1]);
    m.rotation.y = f.rotY;
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
    const a = f.tr(-0.31, -0.45), b = f.tr(0.31, 0.45);
    solidOnly(a[0], OY, a[1], b[0], OY + 2.05, b[1], 'metal');
  }
  function plant(x, z, big) {
    const s = big ? 1.3 : 1;
    decor.add(G.geo.cyl, G.M.pot, x, OY + 0.2 * s, z, 0, 0, 0, 0.2 * s, 0.4 * s, 0.2 * s);
    decor.add(G.geo.cyl, G.M.soil, x, OY + 0.4 * s, z, 0, 0, 0, 0.18 * s, 0.02, 0.18 * s);
    for (let i = 0; i < 4; i++) decor.add(G.geo.ico, G.M.foliage, x + G.randn() * 0.12, OY + (0.65 + i * 0.22) * s, z + G.randn() * 0.12, Math.random(), Math.random(), 0, 0.28 * s, 0.25 * s, 0.28 * s);
    solidOnly(x - 0.22 * s, OY, z - 0.22 * s, x + 0.22 * s, OY + 1.4 * s, z + 0.22 * s, 'fabric');
  }
  function couch(x, z, rot, len, mat) {
    const f = frame(x, z, rot);
    mat = mat || 'fabricGray';
    const L = len / 2;
    f.box(mat, -L, 0.1, -0.45, L, 0.45, 0.45, { solid: false });
    f.box(mat, -L, 0.45, 0.2, L, 0.9, 0.45, { solid: false });
    f.box(mat, -L, 0.1, -0.45, -L + 0.18, 0.65, 0.45, { solid: false });
    f.box(mat, L - 0.18, 0.1, -0.45, L, 0.65, 0.45, { solid: false });
    const seats = Math.round((len - 0.36) / 0.6);
    for (let i = 0; i < seats; i++) {
      const sx = -L + 0.18 + i * (len - 0.36) / seats;
      f.box(mat, sx + 0.01, 0.45, -0.42, sx + (len - 0.36) / seats - 0.01, 0.55, 0.2, { solid: false });
    }
    f.box('woodDark', -L, 0, -0.45, L, 0.1, 0.45, { solid: false });
    f.box(mat, -L, 0.05, -0.45, L, 0.9, 0.45, { visible: false, phys: 'fabric', pen: true });
  }
  function car(x, z, rot, mat) {
    const f = frame(x, z, rot);
    // length along local z (4.4), width x (1.84)
    f.box(mat, -0.92, 0.32, -2.2, 0.92, 0.95, 2.2, { solid: false });
    f.box(mat, -0.88, 0.95, -0.95, 0.88, 1.02, 1.3, { solid: false });
    f.box('glass', -0.8, 1.02, -0.85, 0.8, 1.42, 1.2, { solid: false });
    f.box(mat, -0.78, 1.42, -0.55, 0.78, 1.47, 0.95, { solid: false });
    f.box('plasticBlack', -0.95, 0.25, -2.25, 0.95, 0.5, -2.15, { solid: false });
    f.box('plasticBlack', -0.95, 0.25, 2.15, 0.95, 0.5, 2.25, { solid: false });
    f.box('plasticBlack', -0.94, 0.55, -1.0, 0.94, 0.62, 1.4, { solid: false });
    f.box('plasticBlack', -1.0, 0.95, -0.7, 0.92, 1.05, -0.62, { solid: false });
    f.mesh(G.geo.box, G.M.lightWhite, -0.62, 0.78, -2.205, 0, 0, 0, 0.36, 0.12, 0.02);
    f.mesh(G.geo.box, G.M.lightWhite, 0.62, 0.78, -2.205, 0, 0, 0, 0.36, 0.12, 0.02);
    f.mesh(G.geo.box, G.M.lightRed, -0.66, 0.82, 2.205, 0, 0, 0, 0.3, 0.12, 0.02);
    f.mesh(G.geo.box, G.M.lightRed, 0.66, 0.82, 2.205, 0, 0, 0, 0.3, 0.12, 0.02);
    f.mesh(G.geo.box, G.M.plasticBlack, 0, 0.5, -2.23, 0, 0, 0, 0.5, 0.12, 0.02);
    for (const wx of [-0.82, 0.82]) for (const wz of [-1.4, 1.4]) {
      f.mesh(G.geo.cyl, G.M.tire, wx, 0.33, wz, 0, 0, Math.PI / 2, 0.33, 0.24, 0.33);
      f.mesh(G.geo.cyl, G.M.rim, wx + Math.sign(wx) * 0.07, 0.33, wz, 0, 0, Math.PI / 2, 0.2, 0.12, 0.2);
    }
    const a = f.tr(-0.92, -2.2), b = f.tr(0.92, 2.2);
    solidOnly(a[0], 0.05, a[1], b[0], 0.95, b[1], 'metal');
    const c = f.tr(-0.85, -0.9), d = f.tr(0.85, 1.25);
    solidOnly(c[0], 0.95, c[1], d[0], 1.47, d[1], 'metal');
  }
  function van(x, z, rot, mat) {
    const f = frame(x, z, rot);
    f.box(mat, -1.0, 0.35, -2.7, 1.0, 2.3, 2.7, { solid: false });
    f.box('glass', -0.92, 1.3, -2.72, 0.92, 2.0, -2.2, { solid: false });
    f.box('glass', -1.01, 1.35, -2.2, 1.01, 1.95, -1.5, { solid: false });
    f.box('plasticBlack', -1.02, 0.25, -2.8, 1.02, 0.55, -2.7, { solid: false });
    f.box('plasticBlack', -1.02, 0.25, 2.7, 1.02, 0.55, 2.8, { solid: false });
    f.box('plasticBlack', -1.01, 1.05, -0.2, 1.01, 1.1, 2.0, { solid: false });
    for (const wx of [-0.88, 0.88]) for (const wz of [-1.8, 1.8]) {
      f.mesh(G.geo.cyl, G.M.tire, wx, 0.36, wz, 0, 0, Math.PI / 2, 0.36, 0.26, 0.36);
      f.mesh(G.geo.cyl, G.M.rim, wx + Math.sign(wx) * 0.08, 0.36, wz, 0, 0, Math.PI / 2, 0.2, 0.12, 0.2);
    }
    f.mesh(G.geo.box, G.M.lightWhite, -0.7, 0.9, -2.705, 0, 0, 0, 0.3, 0.15, 0.02);
    f.mesh(G.geo.box, G.M.lightWhite, 0.7, 0.9, -2.705, 0, 0, 0, 0.3, 0.15, 0.02);
    const a = f.tr(-1, -2.7), b = f.tr(1, 2.7);
    solidOnly(a[0], 0.05, a[1], b[0], 2.3, b[1], 'metal');
  }
  function tree(x, z, s) {
    s = s || 1;
    decor.add(G.geo.cyl8, G.M.bark, x, 1.5 * s, z, 0, 0, 0, 0.18 * s, 3 * s, 0.18 * s);
    decor.add(G.geo.cyl8, G.M.bark, x + 0.4 * s, 2.6 * s, z, 0, 0, -0.7, 0.07 * s, 1.2 * s, 0.07 * s);
    const k = 3 + ((Math.random() * 3) | 0);
    for (let i = 0; i < k; i++) {
      decor.add(G.geo.ico, G.M.foliage, x + G.randn() * 0.7 * s, (3.2 + Math.random() * 1.6) * s, z + G.randn() * 0.7 * s, Math.random(), Math.random(), 0, (1.1 + Math.random() * 0.6) * s, (0.9 + Math.random() * 0.5) * s, (1.1 + Math.random() * 0.6) * s);
    }
    solidOnly(x - 0.2 * s, 0, z - 0.2 * s, x + 0.2 * s, 3 * s, z + 0.2 * s, 'wood');
  }
  function jersey(x, z, rot) {
    const f = frame(x, z, rot);
    f.box('jersey', -1.5, 0, -0.3, 1.5, 0.3, 0.3);
    f.box('jersey', -1.5, 0.3, -0.18, 1.5, 0.65, 0.18);
    f.box('jersey', -1.5, 0.65, -0.1, 1.5, 0.82, 0.1);
  }
  function dumpster(x, z, rot) {
    const f = frame(x, z, rot);
    f.box('dumpster', -0.95, 0.12, -0.6, 0.95, 1.25, 0.6);
    f.box('dumpster', -1.0, 1.25, -0.65, 1.0, 1.3, 0.65, { solid: false });
    f.box('plasticBlack', -0.9, 0, -0.55, 0.9, 0.12, 0.55, { solid: false });
  }
  function streetLamp(x, z) {
    decor.add(G.geo.cyl8, G.M.darkMetal, x, 2.5, z, 0, 0, 0, 0.07, 5, 0.07);
    decor.add(G.geo.box, G.M.darkMetal, x, 5, z + 0.5, 0, 0, 0, 0.12, 0.08, 1.0);
    decor.add(G.geo.box, G.M.lightWhite, x, 4.94, z + 0.85, 0, 0, 0, 0.25, 0.04, 0.4);
    solidOnly(x - 0.1, 0, z - 0.1, x + 0.1, 5, z + 0.1, 'metal');
  }
  function fence(x0, z0, x1, z1, h) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const m = new THREE.Mesh(G.geo.plane, G.M.fence);
    const tex = G.M.fence.map;
    m.scale.set(len, h, 1);
    m.position.set((x0 + x1) / 2, h / 2, (z0 + z1) / 2);
    m.rotation.y = Math.atan2(-(z1 - z0), x1 - x0);
    // stretch UVs to keep chain-link scale
    const g = G.geo.plane.clone();
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len / 1.2, uv.getY(i) * h / 1.2);
    m.geometry = g;
    scene.add(m);
    tex.needsUpdate = true;
    const n = Math.ceil(len / 3);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      decor.add(G.geo.cyl8, G.M.darkMetal, x0 + (x1 - x0) * t, h / 2, z0 + (z1 - z0) * t, 0, 0, 0, 0.04, h, 0.04);
    }
    decor.add(G.geo.cyl8, G.M.darkMetal, (x0 + x1) / 2, h, (z0 + z1) / 2, 0, m.rotation.y, Math.PI / 2, 0.025, len, 0.025);
    solidOnly(Math.min(x0, x1) - 0.05, 0, Math.min(z0, z1) - 0.05, Math.max(x0, x1) + 0.05, h, Math.max(z0, z1) + 0.05, 'metal');
  }
  function building(x0, z0, x1, z1, h, mat) {
    box(mat, x0, 0, z0, x1, h, z1);
    box('roof', x0 - 0.2, h, z0 - 0.2, x1 + 0.2, h + 0.4, z1 + 0.2, { solid: false });
  }
  function lightFixture(x, z, w, d) {
    box('trim', x - w / 2 - 0.03, OY + 3.14, z - d / 2 - 0.03, x + w / 2 + 0.03, OY + 3.2, z + d / 2 + 0.03, { solid: false, faces: 8 | 1 | 2 | 16 | 32 });
    decor.add(G.geo.box, G.M.lightPanel, x, OY + 3.135, z, 0, 0, 0, w, 0.012, d);
  }
  function roomLight(x, z, color, intensity, dist, y) {
    const l = new THREE.PointLight(color || 0xffe2bc, (intensity || 1.0) * 1.35, (dist || 11) * 1.1, 1.3);
    l.position.set(x, y || OY + 2.95, z);
    scene.add(l);
    G.MAP.lights.push(l);
  }
  function sign(text, x, y, z, rotY, w, h, bg, fg) {
    const m = new THREE.Mesh(G.geo.plane, new THREE.MeshStandardMaterial({ map: G.T.sign(text, 512, 128, bg || '#1f3a5c', fg || '#ffffff'), roughness: 0.6 }));
    m.scale.set(w, h, 1); m.position.set(x, y, z); m.rotation.y = rotY;
    scene.add(m);
  }
  function painting(x, y, z, rotY, w, h) {
    const c = document.createElement('canvas'); c.width = 128; c.height = 96;
    const g = c.getContext('2d');
    const hue = (Math.random() * 360) | 0;
    const gr = g.createLinearGradient(0, 0, 0, 96); gr.addColorStop(0, `hsl(${hue},40%,60%)`); gr.addColorStop(1, `hsl(${(hue + 60) % 360},35%,35%)`);
    g.fillStyle = gr; g.fillRect(0, 0, 128, 96);
    g.fillStyle = `hsla(${(hue + 180) % 360},30%,30%,0.8)`; g.beginPath(); g.moveTo(0, 70); g.lineTo(40, 40); g.lineTo(70, 60); g.lineTo(128, 30); g.lineTo(128, 96); g.lineTo(0, 96); g.fill();
    const m = new THREE.Mesh(G.geo.plane, new THREE.MeshStandardMaterial({ map: G.T.toTex(c, true, true), roughness: 0.5 }));
    m.scale.set(w, h, 1); m.position.set(x, y, z); m.rotation.y = rotY;
    scene.add(m);
    const fr = new THREE.Mesh(G.geo.box, G.M.woodDark);
    fr.scale.set(w + 0.08, h + 0.08, 0.03); fr.position.set(x, y, z); fr.rotation.y = rotY; fr.translateZ(-0.017);
    scene.add(fr);
  }

  // =============================================================== MAP 1: HARBOR STREET OFFICES
  function buildHarbor(MAP) {
    MAP.bounds = [-44, -38, 44, 32];
    MAP.objName = 'SERVER ROOM';
    MAP.ground = 'dirt';
    MAP.menuCam = { r: 38, h: 13 };
    MAP.env = { sun: 0xfff0d8, sunI: 2.1, sunPos: [32, 55, 24], hemiSky: 0xd2e2ff, hemiGround: 0x5c4c3c, hemiI: 0.36, fog: 0xbcc9d6, fogNear: 70, fogFar: 280,
      sky: ['#3f78c0', '#7fb0e0', '#d9e4ec', '#c9c2b4', '#6f6a60'], exposure: 1.0 };
    MAP.zoneDoors = [[-4, 1.5], [-8, 5], [-2, 8], [0.5, 4.5]];

    // ---------------- ground & surroundings
    box('grass', -60, -1, -56, 60, 0, 56, { phys: 'dirt' });
    // apron / sidewalks around building
    box('sidewalk', -19, 0, -16, 19, 0.02, -12.2);
    box('sidewalk', -19, 0, 12.2, 19, 0.02, 19);
    box('sidewalk', -19, 0, -12.2, -16.2, 0.02, 12.2);
    box('sidewalk', 16.2, 0, -12.2, 19, 0.02, 12.2);
    // street (south)
    box('asphalt', -60, 0, 19, 60, 0.015, 28, { phys: 'concrete' });
    box('concrete', -60, 0, 18.8, 60, 0.12, 19.0);
    box('sidewalk', -60, 0, 28, 60, 0.12, 31);
    for (let x = -56; x < 56; x += 6) box('paintWhite', x, 0.015, 23.4, x + 3, 0.02, 23.6, { solid: false });
    // crosswalk at main entrance
    for (let i = 0; i < 7; i++) box('paintWhite', 1 + i * 0.9, 0.015, 19.2, 1.5 + i * 0.9, 0.02, 27.8, { solid: false });
    // north parking
    box('asphalt', -22, 0, -34, 22, 0.015, -16, { phys: 'concrete' });
    for (let x = -20; x <= 20; x += 3) box('paintWhite', x - 0.06, 0.015, -24.5, x + 0.06, 0.02, -19.5, { solid: false });
    for (let x = -20; x <= 20; x += 3) box('paintWhite', x - 0.06, 0.015, -31.5, x + 0.06, 0.02, -26.5, { solid: false });
    // east alley
    box('concrete', 19, 0, -20, 32, 0.02, 18.8);
    // west yard path
    box('dirt', -30, 0, -1.2, -19, 0.012, 1.2, { phys: 'dirt' });

    // ---------------- building shell
    extWall('x', -12, -16.2, 16.2, -1, [DOOR(-10, 1.4, true), WIN(-14), WIN(-3), WIN(7), WIN(13)]);
    extWall('x', 12, -16.2, 16.2, 1, [WIN(-12), WIN(-4), DOOR(4.5, 2.2, true), WIN(12.5)]);
    extWall('z', -16, -11.8, 11.8, -1, [DOOR(0, 1.3, true), WIN(-7), WIN(7)]);
    extWall('z', 16, -11.8, 11.8, 1, [DOOR(0, 1.3, true), WIN(-7), WIN(7)]);
    // roof + ceiling
    box('ceiling', -15.8, 3.2, -11.8, 15.8, 3.35, 11.8, { faces: 8 });
    box('roof', -16.25, 3.35, -12.25, 16.25, 3.5, 12.25, { faces: 4 });
    solidOnly(-16.2, 3.2, -12.2, 16.2, 3.5, 12.2, 'concrete');
    // parapet cap
    box('concreteDark', -16.3, 3.8, -12.3, 16.3, 3.9, -11.9, { solid: false });
    box('concreteDark', -16.3, 3.8, 11.9, 16.3, 3.9, 12.3, { solid: false });
    box('concreteDark', -16.3, 3.8, -11.9, -15.9, 3.9, 11.9, { solid: false });
    box('concreteDark', 15.9, 3.8, -11.9, 16.3, 3.9, 11.9, { solid: false });
    // entrance canopy
    box('darkMetal', 2.6, 2.7, 12.2, 6.4, 2.85, 13.8, { solid: false });
    for (const px of [2.75, 6.25]) decor.add(G.geo.cyl8, G.M.darkMetal, px, 1.35, 13.65, 0, 0, 0, 0.05, 2.7, 0.05);
    sign('HARBOR STREET OFFICES', 4.5, 3.25, 12.23, 0, 3.6, 0.5, '#1c2733', '#e9eef2');

    // ---------------- interior walls (soft = destructible)
    const cream = 0xd9cfbb, gray = 0xc2c6ca, sage = 0xb3c1a9, blue = 0xa9b8c9, warm = 0xd4bc9e;
    softWall('x', -1.5, -15.8, 15.8, [DOOR(-10, 1.3, true), DOOR(-1, 1.3), DOOR(10, 1.3)], cream);
    softWall('x', 1.5, -15.8, -8, [DOOR(-12, 1.3, true)], blue);
    staticWall('x', 1.5, -8, 0, [DOOR(-4, 1.3, true)], [{ mat: 'metalWall', o0: -0.1, o1: 0.1, h: 3.2 }]);
    softWall('x', 1.5, 0, 15.8, [{ at: 4.5, w: 3.0, y0: 0, y1: 2.6 }, DOOR(13, 1.3)], warm);
    softWall('z', -6, -11.8, -1.58, [DOOR(-7, 1.3, true)], gray);
    softWall('z', 4, -11.8, -1.58, [{ at: -6.5, w: 2.4, y0: 0, y1: 2.5 }], sage);
    softWall('z', -8, 1.6, 11.8, [DOOR(5, 1.3, true)], blue);
    softWall('x', 8, -7.92, -0.08, [DOOR(-2, 1.3)], gray);
    softWall('z', 0, 1.6, 11.8, [DOOR(10, 1.3)], gray);
    softWall('z', 9, 1.6, 11.8, [DOOR(6.5, 1.3)], warm);

    // ---------------- rooms: floors, lights
    const rooms = (MAP.rooms = [
      { name: 'Garage', x0: -16, x1: -6, z0: -12, z1: -1.5, floor: 'concrete' },
      { name: 'Kitchen', x0: -6, x1: 4, z0: -12, z1: -1.5, floor: 'tile' },
      { name: 'Dining', x0: 4, x1: 16, z0: -12, z1: -1.5, floor: 'woodFloor' },
      { name: 'Hallway', x0: -16, x1: 16, z0: -1.5, z1: 1.5, floor: 'woodFloor' },
      { name: 'Office', x0: -16, x1: -8, z0: 1.5, z1: 12, floor: 'carpetBlue' },
      { name: 'Server Room', x0: -8, x1: 0, z0: 1.5, z1: 8, floor: 'tileDark' },
      { name: 'Storage', x0: -8, x1: 0, z0: 8, z1: 12, floor: 'concrete' },
      { name: 'Lobby', x0: 0, x1: 9, z0: 1.5, z1: 12, floor: 'marble' },
      { name: 'Living Room', x0: 9, x1: 16, z0: 1.5, z1: 12, floor: 'carpetRed' },
    ]);
    for (const r of rooms) box(r.floor, r.x0, 0, r.z0, r.x1, 0.02, r.z1, { faces: 4 });
    solidOnly(-16, 0, -12, 16, 0.02, 12, 'wood');
    roomLight(-11, -7); lightFixture(-11, -7, 1.4, 0.3);
    roomLight(-1, -7); lightFixture(-1, -7, 1.2, 1.2);
    roomLight(10, -7, 0xffd9a8); lightFixture(10, -7, 0.6, 0.6);
    roomLight(-8, 0, 0xffe2bc, 0.9, 12); lightFixture(-8, 0, 1.2, 0.25); lightFixture(-13, 0, 1.2, 0.25);
    roomLight(8, 0, 0xffe2bc, 0.9, 12); lightFixture(8, 0, 1.2, 0.25); lightFixture(13, 0, 1.2, 0.25); lightFixture(2, 0, 1.2, 0.25);
    roomLight(-12, 7, 0xf2f4ff); lightFixture(-12, 5, 1.2, 0.6); lightFixture(-12, 9, 1.2, 0.6);
    roomLight(-3.8, 4.8, 0xa8c8ff, 1.2, 9); lightFixture(-4, 3.5, 1.2, 0.25); lightFixture(-4, 6.5, 1.2, 0.25);
    roomLight(4.5, 7, 0xfff0d8, 1.0, 12); lightFixture(4.5, 5, 1.6, 0.6); lightFixture(4.5, 9.5, 1.6, 0.6);
    roomLight(12.5, 7, 0xffd4a0); lightFixture(12.5, 7, 0.6, 0.6);

    // ---------------- GARAGE
    car(-13.3, -6.2, 0, 'carBlue');
    shelf(-7.3, -11.5, 0, 1.8, 2.0, true);
    shelf(-15.5, -3.6, 1, 1.8, 1.8, true);
    box('woodDark', -15.5, 0.85, -2.25, -12.8, 0.92, -1.62);
    box('metalShelf', -15.45, 0, -2.2, -12.85, 0.85, -1.66, { phys: 'metal' });
    box('plasticGray', -15.4, 0.92, -1.66, -13, 1.7, -1.62, { solid: false });
    decor.add(G.geo.cyl, G.M.dumpster, -7.2, 0.45, -3.0, 0, 0, 0, 0.3, 0.9, 0.3);
    decor.add(G.geo.cyl, G.M.carRed, -7.9, 0.45, -2.5, 0, 0, 0, 0.3, 0.9, 0.3);
    solidOnly(-8.2, 0, -3.3, -6.9, 0.9, -2.2, 'metal');
    crate(-8.6, -5.2, 1.0); crate(-8.6, -5.2, 0.8, 1.0); crate(-7.4, -5.6, 0.9);
    box('paintYellow', -11.5, 0.02, -11.6, -8.5, 0.025, -11.4, { solid: false });

    // ---------------- KITCHEN
    box('cabinet', -5.8, 0, -11.8, 1.6, 0.88, -11.2);
    box('counterTop', -5.82, 0.88, -11.8, 1.62, 0.93, -11.15);
    box('cabinet', -5.8, 1.6, -11.8, -4.0, 2.3, -11.45, { pen: true });
    box('cabinet', -2.0, 1.6, -11.8, 1.6, 2.3, -11.45, { pen: true });
    box('steel', -1.1, 0.93, -11.7, -0.3, 0.95, -11.3, { solid: false });
    decor.add(G.geo.cyl, G.M.plasticBlack, 0.4, 0.95, -11.5, 0, 0, 0, 0.1, 0.01, 0.1);
    decor.add(G.geo.cyl, G.M.plasticBlack, 0.75, 0.95, -11.5, 0, 0, 0, 0.1, 0.01, 0.1);
    box('steel', 2.4, 0, -11.8, 3.6, 2.0, -11.05);
    box('darkMetal', 3.45, 0.9, -11.06, 3.5, 1.7, -11.02, { solid: false });
    box('cabinet', -2.6, 0, -7.8, 0.6, 0.88, -6.6);
    box('counterTop', -2.65, 0.88, -7.85, 0.65, 0.93, -6.55);
    const ft = frame(-4, -4, 0);
    table(ft, -0.6, -0.5, 0.6, 0.5, 0.76, 'woodLight');
    chair(-4, -4.8, 2); chair(-4, -3.2, 0);
    decor.add(G.geo.cyl, G.M.plasticWhite, -0.8, 0.93 + 0.12, -11.5, 0, 0, 0, 0.08, 0.24, 0.08);

    // ---------------- DINING
    const fd = frame(10.25, -6.5, 0);
    table(fd, -2.3, -0.7, 2.3, 0.7, 0.76, 'woodDark');
    for (const cx of [8.6, 10.25, 11.9]) { chair(cx, -7.6, 2); chair(cx, -5.4, 0); }
    box('woodDark', 15.3, 0, -5, 15.8, 0.9, -3, { pen: true });
    box('woodDark', 9.4, 0, -11.8, 11.4, 2.0, -11.35, { pen: true });
    box('glass', 9.5, 1.0, -11.36, 11.3, 1.9, -11.34, { solid: false });
    plant(4.7, -11.2); plant(15.2, -11.2, true);
    painting(15.78, 1.7, -9.5, -Math.PI / 2, 1.2, 0.8);
    decor.add(G.geo.cyl, G.M.plasticWhite, 10.25, 0.86, -6.5, 0, 0, 0, 0.12, 0.2, 0.12);

    // ---------------- HALLWAY
    box('woodDark', 6.5, 0, 1.0, 8.0, 0.82, 1.42, { pen: true });
    plant(-6.8, 1.05); plant(-15.2, -1.0, true);
    decor.add(G.geo.cyl, G.M.plasticWhite, 7.2, 0.95, 1.2, 0, 0, 0, 0.08, 0.26, 0.08);

    // ---------------- OFFICE
    desk(-13.7, 5.4, 0); officeChair(-13.7, 4.5, 2);
    desk(-10.6, 8.9, 0); officeChair(-10.6, 8.0, 2);
    box('cabinetGray', -15.8, 0, 2.5, -15.3, 1.3, 4.0, { phys: 'metal', pen: false });
    for (let i = 0; i < 3; i++) box('plasticBlack', -15.31, 0.25 + i * 0.4, 2.7, -15.29, 0.28 + i * 0.4, 3.8, { solid: false });
    shelf(-9.1, 11.5, 0, 1.6, 2.0, true);
    plant(-15.3, 11.3, true);
    painting(-15.78, 1.7, 9.5, Math.PI / 2, 1.0, 0.7);

    // ---------------- SERVER ROOM (objective)
    rack(-7.5, 2.2, 1); rack(-7.5, 3.0, 1); rack(-7.5, 3.8, 1);
    rack(-7.5, 6.3, 1); rack(-7.5, 7.1, 1);
    rack(-5.1, 3.6, 3); rack(-5.1, 4.4, 3);
    const tb = frame(-2.5, 4.5, 0);
    table(tb, -0.7, -0.5, 0.7, 0.5, 0.8, 'darkMetal');
    // data core device
    decor.add(G.geo.box, G.M.plasticBlack, -2.5, 0.95, 4.5, 0, 0.3, 0, 0.7, 0.3, 0.5);
    decor.add(G.geo.box, G.M.gunTan, -2.5, 0.95, 4.5, 0, 0.3, 0, 0.72, 0.08, 0.52);
    decor.add(G.geo.cyl, G.M.glowBlue, -2.5, 1.18, 4.5, 0, 0, 0, 0.09, 0.18, 0.09);
    decor.add(G.geo.torus, G.M.darkMetal, -2.5, 1.18, 4.5, Math.PI / 2, 0, 0, 0.11, 0.11, 0.3);
    decor.add(G.geo.box, G.M.plasticGray, -2.0, 0.83, 4.2, 0, -0.4, 0, 0.35, 0.02, 0.25);
    decor.add(G.geo.box, G.M.screen, -1.95, 0.95, 4.33, -0.4, -0.4, 0, 0.35, 0.22, 0.01);
    MAP.objective = new V(-2.5, 1.2, 4.5);
    MAP.zone = { x0: -7.9, x1: -0.1, z0: 1.6, z1: 7.9 };
    const core = new THREE.PointLight(0x3cc8ff, 0.6, 3.5, 2);
    core.position.set(-2.5, 1.4, 4.5); scene.add(core);
    sign('SERVER ROOM', -4, 2.55, 1.39, Math.PI, 1.2, 0.3, '#2b2b2b', '#ffd54a');
    box('plasticGray', -7.9, 2.95, 2.0, -5.0, 3.05, 2.3, { solid: false });

    // ---------------- STORAGE
    shelf(-6.3, 11.5, 0, 2.4, 2.2, true);
    shelf(-7.6, 9.4, 1, 1.4, 2.2, true);
    crate(-1.2, 11.2, 0.9); crate(-2.2, 11.3, 0.7); crate(-1.2, 11.2, 0.6, 0.9);
    box('cardboard', -3.2, 0, 11.3, -2.7, 0.4, 11.75, { pen: true });

    // ---------------- LOBBY
    box('woodDark', 5.8, 0, 4.2, 8.2, 1.05, 5.0, { pen: true });
    box('marble', 5.75, 1.05, 4.15, 8.25, 1.1, 5.05);
    officeChair(7, 3.55, 2);
    box('plasticBlack', 6.5, 1.1, 4.3, 7.1, 1.45, 4.36, { solid: false });
    box('plasticGray', 6.7, 1.1, 4.36, 6.9, 1.2, 4.5, { solid: false });
    couch(7.3, 11.2, 0, 2.2, 'leather');
    box('woodLight', 6.6, 0.35, 9.6, 8.0, 0.42, 10.2, { pen: true });
    box('woodLight', 6.7, 0, 9.7, 7.9, 0.35, 10.1, { solid: false });
    couch(1.0, 4.0, 3, 2.0, 'fabricBeige');
    plant(0.6, 2.1, true); plant(8.4, 2.1); plant(8.4, 7.8);
    sign('RECEPTION', 7.0, 2.2, 1.59, 0, 1.4, 0.35, '#e9eef2', '#1c2733');
    painting(4.5, 1.9, 11.79, Math.PI, 1.6, 0.9);

    // ---------------- LIVING ROOM
    box('rug', 10.8, 0.02, 5.0, 14.4, 0.03, 8.0, { solid: false });
    couch(12.5, 7.9, 0, 2.6, 'fabricGreen');
    box('woodDark', 11.2, 0, 4.2, 13.8, 0.5, 4.7, { pen: true });
    box('plasticBlack', 11.6, 0.5, 4.4, 13.4, 1.25, 4.46, { solid: false });
    const tv = new THREE.Mesh(G.geo.plane, G.M.screen); tv.scale.set(1.7, 0.66, 1); tv.position.set(12.5, 0.875, 4.47); scene.add(tv);
    box('woodLight', 11.8, 0.38, 5.8, 13.2, 0.44, 6.6, { pen: true });
    box('woodLight', 11.9, 0, 5.9, 13.1, 0.38, 6.5, { solid: false });
    shelf(9.35, 10, 1, 2.0, 2.0, true);
    couch(15.1, 10.2, 1, 1.0, 'fabricGreen');
    plant(15.3, 2.2);

    // ---------------- OUTDOORS
    car(-8, -21.5, 0, 'carRed'); car(1, -22, 0, 'carSilver'); car(10, -29, 2, 'carWhite'); van(-14, -29, 2, 'carWhite');
    car(-2, -29, 2, 'carBlack');
    jersey(0, -17.5, 0); jersey(-6, -17.5, 0); jersey(12, -18, 0);
    car(-10, 21.2, 1, 'carGreen'); car(12, 25.5, 3, 'carSilver'); van(-22, 25, 1, 'carBlue');
    jersey(-2, 16.5, 0); jersey(10, 16.8, 0);
    streetLamp(-12, 18.2); streetLamp(8, 18.2); streetLamp(24, 18.2); streetLamp(-28, 18.2);
    dumpster(24, -8, 1); dumpster(24, 6, 1);
    crate(21, -14, 1.1); crate(22.2, -14.2, 0.9); crate(21, -14, 0.8, 1.1);
    crate(27, 12, 1.0); crate(27.5, 10.8, 1.0);
    jersey(29, -2, 1); jersey(22, 2, 1);
    van(28.5, -12, 0, 'carBlack');
    tree(-24, -10); tree(-27, 8, 1.2); tree(-34, -4, 0.9); tree(-22, 12); tree(-35, 12, 1.1); tree(-30, -16);
    tree(34, 24, 1.1); tree(-40, 22); tree(40, -22, 1.2);
    // picnic table in yard
    const pt = frame(-27, 2.5, 1);
    table(pt, -1, -0.4, 1, 0.4, 0.75, 'woodLight');
    pt.box('woodLight', -1, 0.42, -0.8, 1, 0.47, -0.55); pt.box('woodLight', -1, 0.42, 0.55, 1, 0.47, 0.8);
    // shed
    box('woodLight', -38, 0, 3, -34, 2.6, 7, { pen: false });
    box('roof', -38.3, 2.6, 2.7, -33.7, 2.8, 7.3, { solid: false });
    // hedges along yard edge
    box('hedge', -44, 0, -20, -43, 1.3, 20);
    // perimeter fences and backdrop
    fence(-44, -38, 44, -38, 2.6); fence(44, -38, 44, 18, 2.6); fence(-44, -38, -44, 18, 2.6);
    building(-60, 31.5, -30, 44, 14, 'facadeA'); building(-28, 31.5, -4, 42, 18, 'facadeB'); building(-2, 31.5, 22, 46, 11, 'facadeC'); building(24, 31.5, 60, 42, 16, 'facadeA');
    building(-60, -56, -10, -44, 20, 'facadeC'); building(-8, -56, 30, -42, 12, 'facadeB'); building(32, -56, 60, -44, 22, 'facadeA');
    building(46, -40, 60, 30, 9, 'facadeB'); building(-60, -40, -46, 30, 10, 'facadeC');
    // invisible bounds
    solidOnly(-44.5, 0, -38.5, 44.5, 6, -38.1); solidOnly(44.1, 0, -38.5, 44.5, 6, 31.5); solidOnly(-44.5, 0, -38.5, -44.1, 6, 31.5); solidOnly(-44.5, 0, 31.1, 44.5, 6, 31.5);

    // ---------------- gameplay data
    MAP.spawns = [
      { name: 'Main Street', x: 4.5, z: 24.5, yaw: 0 },
      { name: 'North Parking', x: 0, z: -26, yaw: Math.PI },
      { name: 'West Yard', x: -32, z: 0, yaw: -Math.PI / 2 },
      { name: 'East Alley', x: 32, z: 0, yaw: Math.PI / 2 },
    ];
    MAP.entries = [
      { name: 'Main Entrance', out: [4.5, 14], in: [4.5, 9.5] },
      { name: 'West Door', out: [-18, 0], in: [-13.5, 0] },
      { name: 'East Door', out: [18, 0], in: [13.5, 0] },
      { name: 'Garage Door', out: [-10, -14], in: [-10, -9] },
    ];
    // defender positions [x, z, lookX, lookZ]
    MAP.anchors = [
      [-6.3, 6.2, -4, 1.5], [-1.0, 7.0, -4.5, 2.0], [-3.8, 2.6, -2, 8], [-1.0, 2.4, -8, 5], [-6.3, 5.0, -2, 8],
    ];
    MAP.support = [
      [-6.6, 10.6, 0, 10], [-9.4, 10.6, -12, 1.5], [7.2, 3.3, 4.5, 12], [1.6, 7.5, 4.5, 12], [-9.4, 2.4, -12, 11],
    ];
    MAP.roam = [
      [-4.8, -10.3, -6, -7], [14.6, 0.9, 5, 0], [-14.6, -0.9, -5, 0], [15.1, 11.0, 13, 1.5], [15.0, -2.4, 5, -6],
      [-7.2, -10.6, -10, -12], [2.8, -3.0, -1, -1.5], [10.3, 2.4, 13, 12], [-12.0, -2.8, -10, -12],
    ];
    MAP.secure = [[-3.6, 6.8], [-1.2, 3.0], [-6.2, 5.3], [-1.3, 5.8], [-3.4, 2.6]];
    MAP.roomAt = (x, z) => {
      for (const r of rooms) if (r.name !== 'Hallway' && x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return r.name;
      if (x >= -16 && x <= 16 && z >= -1.5 && z <= 1.5) return 'Hallway';
      if (z > 12) return z > 19 ? 'Street' : 'Front';
      if (z < -12) return 'Parking';
      if (x < -16) return 'Yard';
      return 'Alley';
    };
    MAP.indoors = (x, z) => x > -16 && x < 16 && z > -12 && z < 12;
  }

  // --------------------------------------------------------------- shared props for the new maps
  function container(mat, x0, z0, x1, z1, y0) {
    y0 = y0 || 0;
    box(mat, x0, y0, z0, x1, y0 + 2.6, z1, { phys: 'metal', pen: false });
    // corner posts + door bars on the short ends
    const alongX = x1 - x0 > z1 - z0;
    const ends = alongX ? [[x0 - 0.02, (z0 + z1) / 2], [x1 + 0.02, (z0 + z1) / 2]] : [[(x0 + x1) / 2, z0 - 0.02], [(x0 + x1) / 2, z1 + 0.02]];
    const w = alongX ? z1 - z0 : x1 - x0;
    for (const [ex, ez] of ends) {
      for (const o of [-0.3, 0.3]) {
        const px = alongX ? ex : ex + o * w * 0.6, pz = alongX ? ez + o * w * 0.6 : ez;
        decor.add(G.geo.cyl8, G.M.darkMetal, px, y0 + 1.3, pz, 0, 0, 0, 0.025, 2.4, 0.025);
      }
    }
  }
  function palletRack(x0, z0, x1, z1, h) {
    const along = x1 - x0 > z1 - z0, len = along ? x1 - x0 : z1 - z0;
    const bays = Math.max(1, Math.round(len / 2.7));
    for (let i = 0; i <= bays; i++) {
      const t = i / bays;
      const px = along ? x0 + (x1 - x0) * t : null, pz = along ? null : z0 + (z1 - z0) * t;
      if (along) { box('paintYellow', px - 0.05, 0, z0, px + 0.05, h, z0 + 0.08, { solid: false }); box('paintYellow', px - 0.05, 0, z1 - 0.08, px + 0.05, h, z1, { solid: false }); }
      else { box('paintYellow', x0, 0, pz - 0.05, x0 + 0.08, h, pz + 0.05, { solid: false }); box('paintYellow', x1 - 0.08, 0, pz - 0.05, x1, h, pz + 0.05, { solid: false }); }
    }
    for (const y of [0.15, h * 0.5, h - 0.1]) {
      box('contOrange', x0, y - 0.06, z0, x1, y + 0.06, z0 + 0.08, { solid: false });
      box('contOrange', x0, y - 0.06, z1 - 0.08, x1, y + 0.06, z1, { solid: false });
      if (y < h - 0.2) {
        for (let i = 0; i < bays; i++) {
          if (Math.random() < 0.2) continue;
          const t0 = (i + 0.12) / bays, t1 = (i + 0.88) / bays;
          const a = along ? [x0 + (x1 - x0) * t0, z0 + 0.1, x0 + (x1 - x0) * t1, z1 - 0.1] : [x0 + 0.1, z0 + (z1 - z0) * t0, x1 - 0.1, z0 + (z1 - z0) * t1];
          box('crate', a[0], y + 0.06, a[1], a[2], y + 0.18, a[3], { solid: false });
          box(Math.random() < 0.5 ? 'cardboard' : 'plasticGray', a[0] + 0.05, y + 0.18, a[1] + 0.05, a[2] - 0.05, y + 0.18 + Math.min(1.2, h * 0.5 - 0.35), a[3] - 0.05, { solid: false });
        }
      }
    }
    solidOnly(x0, 0, z0, x1, h, z1, 'metal');
  }
  function forklift(x, z, rot) {
    const f = frame(x, z, rot);
    f.box('forklift', -0.6, 0.25, -0.9, 0.6, 1.2, 1.0);
    f.box('plasticBlack', -0.55, 1.2, 0.2, 0.55, 1.35, 1.0, { solid: false });
    for (const sx of [-0.55, 0.55]) f.box('darkMetal', sx - 0.04, 1.35, 0.2, sx + 0.04, 2.2, 0.28, { solid: false });
    f.box('darkMetal', -0.6, 2.15, 0.1, 0.6, 2.25, 1.0, { solid: false });
    f.box('darkMetal', -0.5, 0.1, -1.05, 0.5, 2.4, -0.95, { solid: false });
    f.box('darkMetal', -0.4, 0.08, -2.1, -0.28, 0.14, -1.05, { solid: false });
    f.box('darkMetal', 0.28, 0.08, -2.1, 0.4, 0.14, -1.05, { solid: false });
    for (const wx of [-0.6, 0.6]) for (const wz of [-0.6, 0.7]) f.mesh(G.geo.cyl, G.M.tire, wx, 0.28, wz, 0, 0, Math.PI / 2, 0.28, 0.2, 0.28);
  }
  function dataCore(x, z, y) {
    y += OY;
    decor.add(G.geo.box, G.M.plasticBlack, x, y + 0.15, z, 0, 0.3, 0, 0.7, 0.3, 0.5);
    decor.add(G.geo.box, G.M.gunTan, x, y + 0.15, z, 0, 0.3, 0, 0.72, 0.08, 0.52);
    decor.add(G.geo.cyl, G.M.glowBlue, x, y + 0.38, z, 0, 0, 0, 0.09, 0.18, 0.09);
    decor.add(G.geo.torus, G.M.darkMetal, x, y + 0.38, z, Math.PI / 2, 0, 0, 0.11, 0.11, 0.3);
    const core = new THREE.PointLight(0x3cc8ff, 0.6, 3.5, 2);
    core.position.set(x, y + 0.6, z); scene.add(core);
  }
  function pine(x, z, s) {
    s = s || 1;
    decor.add(G.geo.cyl8, G.M.bark, x, 1.0 * s, z, 0, 0, 0, 0.16 * s, 2.0 * s, 0.16 * s);
    const tiers = [[1.6, 2.1, 1.9], [2.8, 1.7, 1.7], [3.9, 1.25, 1.5], [4.9, 0.8, 1.3]];
    for (const [y, r, h] of tiers) {
      decor.add(G.geo.cone, G.M.pine, x, y * s, z, 0, Math.random() * 3, 0, r * s, h * s, r * s);
      decor.add(G.geo.cone, G.M.snow, x, (y + h * 0.28) * s, z, 0, 0, 0, r * 0.55 * s, h * 0.45 * s, r * 0.55 * s);
    }
    solidOnly(x - 0.2 * s, 0, z - 0.2 * s, x + 0.2 * s, 3 * s, z + 0.2 * s, 'wood');
  }
  function rock(x, z, s) {
    decor.add(G.geo.ico, G.M.stone, x, s * 0.35, z, Math.random(), Math.random(), 0, s, s * 0.7, s * 0.9);
    decor.add(G.geo.ico, G.M.snow, x, s * 0.62, z, 0, Math.random(), 0, s * 0.8, s * 0.35, s * 0.7);
    solidOnly(x - s * 0.8, 0, z - s * 0.7, x + s * 0.8, s * 0.9, z + s * 0.7, 'concrete');
  }
  function bigCrateStack(x, z) { crate(x, z, 1.2); crate(x + 1.25, z, 1.2); crate(x + 0.6, z, 1.0, 1.2); }

  // =============================================================== MAP 2: CANAL WAREHOUSE
  function buildWarehouse(MAP) {
    MAP.bounds = [-44, -38, 44, 26];
    MAP.objName = 'CONTROL ROOM';
    MAP.ground = 'concrete';
    MAP.menuCam = { r: 42, h: 17 };
    MAP.env = { sun: 0xffe2c0, sunI: 1.7, sunPos: [-30, 48, 28], hemiSky: 0xc8d4e4, hemiGround: 0x4a4a48, hemiI: 0.42, fog: 0xaab4be, fogNear: 60, fogFar: 240,
      sky: ['#56708e', '#8da6bf', '#cfd6dc', '#9a9a94', '#55554f'], exposure: 1.0 };
    MAP.zoneDoors = [[-6.5, -6], [-11, -10], [-2, -9.5], [-3.6, -6]];

    // ground, road, canal
    box('concrete', -60, -1, -56, 60, 0, 24, { phys: 'concrete' });
    box('concreteDark', -60, -1.6, 24, 60, 0, 24.4);
    box('water', -60, -1.45, 24.4, 60, -1.35, 44, { solid: false });
    box('concrete', -60, -1, 44, 60, 0, 56, { solid: false });
    box('asphalt', -60, 0, -34, 60, 0.015, -24);
    for (let x = -56; x < 56; x += 6) box('paintWhite', x, 0.015, -29.1, x + 3, 0.02, -28.9, { solid: false });
    for (let x = -18; x <= 18; x += 3) box('paintWhite', x - 0.06, 0.005, -22, x + 0.06, 0.012, -17, { solid: false });
    for (let x = -40; x <= 40; x += 5) { decor.add(G.geo.cyl8, G.M.darkMetal, x, 0.3, 23.5, 0, 0, 0, 0.18, 0.6, 0.18); solidOnly(x - 0.2, 0, 23.3, x + 0.2, 0.6, 23.7, 'metal'); }
    box('paintYellow', -60, 0.0, 22.9, 60, 0.012, 23.1, { solid: false });

    // shell (corrugated metal, 6 m tall)
    const WH = 6;
    const shell = (axis, c, a, b, ops) => staticWall(axis, c, a, b, ops, [{ mat: 'corrugated', o0: -0.15, o1: 0.15, h: WH }]);
    shell('x', -14, -20.15, 20.15, [WIN(-15.5), WIN(-6.5), DOOR(3.5, 1.3, true), WIN(13)]);
    shell('x', 14, -20.15, 20.15, [{ at: -8, w: 4, y0: 0, y1: 4, bar: true }, DOOR(0, 1.3, true), { at: 8, w: 4, y0: 0, y1: 4, bar: true }]);
    shell('z', -20, -13.85, 13.85, [DOOR(-10, 1.3, true), DOOR(4, 1.3, true)]);
    shell('z', 20, -13.85, 13.85, [DOOR(-10, 1.3, true), WIN(-1), DOOR(6, 1.3, true)]);
    box('corrugated', -19.85, WH, -13.85, 19.85, WH + 0.15, 13.85, { faces: 8 });
    box('roof', -20.4, WH + 0.15, -14.4, 20.4, WH + 0.3, 14.4);
    for (let x = -16; x <= 16; x += 4) box('darkMetal', x - 0.1, WH - 0.5, -13.85, x + 0.1, WH - 0.1, 13.85, { solid: false });
    for (const px of [-10, 0, 10]) for (const pz of [0, 7]) { box('darkMetal', px - 0.15, 0, pz - 0.15, px + 0.15, WH, pz + 0.15); }
    // painted plinth outside + dock signs
    box('concreteDark', -20.3, 0, 14.15, 20.3, 0.9, 14.3, { solid: false, faces: 16 | 4 });
    sign('DOCK 1', -8, 4.4, 14.2, 0, 1.6, 0.45, '#1c2733', '#ffd54a');
    sign('DOCK 2', 8, 4.4, 14.2, 0, 1.6, 0.45, '#1c2733', '#ffd54a');
    sign('KESSLER FREIGHT', 0, 5.2, 14.2, 0, 5, 0.7, '#9a3324', '#ffffff');

    // interior soft walls (offices along the north side)
    const off = 0xc6c9c2, blue = 0xa9b8c9, warm = 0xd0bea2;
    softWall('x', -6, -19.85, 19.85, [DOOR(-15.5, 1.3, true), DOOR(-6.5, 1.3, true), { at: -3.6, w: 1.4, y0: 1.0, y1: 2.1, bar: true }, DOOR(2, 1.3), { at: 13, w: 3, y0: 0, y1: 2.8 }], off);
    softWall('z', -11, -13.85, -6.08, [DOOR(-10, 1.3, true)], warm);
    softWall('z', -2, -13.85, -6.08, [DOOR(-9.5, 1.3, true)], blue);
    softWall('z', 6, -13.85, -6.08, [DOOR(-10, 1.3)], off);
    box('ceiling', -19.85, 3.2, -13.85, 19.85, 3.45, -6.0, { faces: 8 });
    box('metalShelf', -19.85, 3.2, -13.85, 19.85, 3.45, -6.0, { faces: 4 | 16, solid: false });
    for (let x = -19.5; x <= 19.5; x += 1.5) decor.add(G.geo.cyl8, G.M.paintYellow, x, 3.95, -6.05, 0, 0, 0, 0.025, 1.0, 0.025);
    decor.add(G.geo.cyl8, G.M.paintYellow, 0, 4.45, -6.05, 0, 0, Math.PI / 2, 0.03, 39.7, 0.03);

    const rooms = (MAP.rooms = [
      { name: 'Break Room', x0: -20, x1: -11, z0: -14, z1: -6, floor: 'tile' },
      { name: 'Control Room', x0: -11, x1: -2, z0: -14, z1: -6, floor: 'carpetBlue' },
      { name: 'Records', x0: -2, x1: 6, z0: -14, z1: -6, floor: 'carpetRed' },
      { name: 'Workshop', x0: 6, x1: 20, z0: -14, z1: -6, floor: 'concrete' },
      { name: 'Main Hall', x0: -20, x1: 20, z0: -6, z1: 14, floor: 'concreteDark' },
    ]);
    for (const r of rooms) box(r.floor, r.x0, 0, r.z0, r.x1, 0.02, r.z1, { faces: 4 });
    solidOnly(-20, 0, -14, 20, 0.02, 14, 'concrete');
    box('paintYellow', -19.8, 0.02, -5.2, 19.8, 0.028, -5.0, { solid: false });
    // lights
    for (const [lx, lz] of [[-10, 3], [10, 3], [-10, 11], [10, 11]]) {
      roomLight(lx, lz, 0xfff0d8, 1.4, 20, 5.3);
      decor.add(G.geo.cone, G.M.darkMetal, lx, 5.55, lz, Math.PI, 0, 0, 0.45, 0.35, 0.45);
      decor.add(G.geo.circle, G.M.lightPanel, lx, 5.37, lz, Math.PI / 2, 0, 0, 0.4, 0.4, 0.4);
    }
    roomLight(-15.5, -10, 0xffe8c8); lightFixture(-15.5, -10, 1.2, 0.3);
    roomLight(-6.5, -10, 0xb8d0ff, 1.2); lightFixture(-6.5, -11, 1.2, 0.3); lightFixture(-6.5, -8, 1.2, 0.3);
    roomLight(2, -10, 0xffe8c8); lightFixture(2, -10, 1.2, 0.3);
    roomLight(13, -10, 0xfff4e0, 1.1, 13); lightFixture(13, -10, 1.6, 0.3);

    // --- main hall
    container('contRed', -17, 0, -11, 2.44);
    container('contBlue', -16.5, 0, -10.5, 2.44, 2.6);
    container('contGreen', -4.2, 3, -1.76, 9.06);
    container('contOrange', 4, 9, 10.06, 11.44);
    container('contBlue', 13, -1, 15.44, 5.06);
    container('contGray', 13, -0.8, 15.44, 5.26, 2.6);
    container('contGray', -12, 8.5, -5.94, 10.94);
    palletRack(2, 1, 10, 2.2, 4.2);
    palletRack(-18.6, 5.5, -13, 6.7, 4.2);
    crate(-7, -2.5, 1.2); crate(-7, -2.5, 1.0, 1.2); crate(1, -3, 1.0); crate(8, -3.2, 1.1); crate(9.2, -3.2, 0.9);
    crate(17, 11, 1.2); crate(-18.5, 13, 1.1); crate(18, 12.8, 1.0);
    forklift(6, 5.8, 1);
    box('darkMetal', -9.5, 0.02, 12.6, -6.5, 0.08, 13.85, { solid: false });
    box('darkMetal', 6.5, 0.02, 12.6, 9.5, 0.08, 13.85, { solid: false });
    // --- break room
    const tb = frame(-15.5, -9.3, 0);
    table(tb, -0.8, -0.5, 0.8, 0.5, 0.76, 'woodLight');
    chair(-16.3, -9.3, 1); chair(-14.7, -9.3, 3); chair(-15.5, -10.1, 2);
    couch(-18.9, -7.4, 1, 1.8, 'fabricGray');
    box('cabinet', -19.8, 0, -13.85, -16.4, 0.88, -13.2);
    box('counterTop', -19.82, 0.88, -13.85, -16.38, 0.93, -13.15);
    box('steel', -12.9, 0, -13.85, -11.9, 1.9, -13.1);
    box('carRed', -13.8, 0, -7.2, -13.0, 1.9, -6.5);
    decor.add(G.geo.box, G.M.screen, -13.4, 1.25, -7.21, 0, Math.PI, 0, 0.6, 0.9, 1);
    // --- control room (objective)
    desk(-8.5, -12.5, 0); officeChair(-8.5, -13.35, 0);
    desk(-4.8, -12.5, 0); officeChair(-4.8, -13.35, 0);
    rack(-10.4, -7.2, 1); rack(-10.4, -8.0, 1);
    table(frame(-6, -9.2, 0), -0.7, -0.5, 0.7, 0.5, 0.8, 'darkMetal');
    dataCore(-6, -9.2, 0.8);
    const scr = new THREE.Mesh(G.geo.plane, G.M.screen); scr.scale.set(1.8, 1.0, 1); scr.position.set(-9.5, 2.0, -13.83); scene.add(scr);
    box('plasticBlack', -10.45, 1.45, -13.85, -8.55, 2.55, -13.84, { solid: false });
    MAP.objective = new V(-6, 1.2, -9.2);
    MAP.zone = { x0: -10.9, x1: -2.1, z0: -13.9, z1: -6.1 };
    sign('CONTROL', -6.5, 2.6, -5.9, 0, 1.0, 0.25, '#2b2b2b', '#ffd54a');
    // --- records
    shelf(0, -12, 0, 3, 2.2, true); shelf(0, -8, 0, 2.6, 2.0, true);
    desk(4.3, -12.6, 0); officeChair(4.3, -13.4, 0);
    // --- workshop
    box('woodDark', 8, 0, -13.85, 12, 0.9, -13.1);
    box('metalShelf', 8.05, 0.9, -13.85, 11.95, 1.7, -13.8, { solid: false });
    shelf(17.5, -13.5, 0, 3, 2.2, true);
    decor.add(G.geo.cyl, G.M.dumpster, 18.8, 0.45, -7.4, 0, 0, 0, 0.3, 0.9, 0.3);
    decor.add(G.geo.cyl, G.M.carBlue, 18.2, 0.45, -6.9, 0, 0, 0, 0.3, 0.9, 0.3);
    solidOnly(17.8, 0, -7.8, 19.2, 0.9, -6.5, 'metal');
    crate(9, -8, 1.0);

    // --- outdoors
    van(-12.5, 19, 0, 'carBlue');
    container('contRed', 6, 18, 12.06, 20.44);
    container('contGreen', -20, 16, -17.56, 22.06);
    container('contOrange', -32, -6, -26, -3.56); container('contBlue', -31.5, -6, -25.5, -3.56, 2.6);
    container('contBlue', -30, 4, -27.56, 10.06);
    container('contGray', 26, -10, 32.06, -7.56);
    container('contRed', 27, 2, 29.44, 8.06);
    bigCrateStack(-26, 14); bigCrateStack(24, 14);
    forklift(24, -3, 2);
    car(-12, -20, 1, 'carRed'); car(8, -19.5, 1, 'carSilver'); van(-3, -21.5, 1, 'carWhite');
    jersey(-6, -16.5, 0); jersey(6, -16.5, 0); jersey(-24, 18, 1); jersey(24, 18, 1);
    streetLamp(-16, -23); streetLamp(16, -23); streetLamp(-30, 22); streetLamp(30, 22);
    dumpster(-24, -12, 1); dumpster(24, 10, 1);
    fence(-44, -37, 44, -37, 2.6); fence(-44, -37, -44, 23.6, 2.6); fence(44, -37, 44, 23.6, 2.6);
    building(-60, -56, -20, -40, 16, 'facadeB'); building(-18, -56, 20, -41, 10, 'facadeC'); building(22, -56, 60, -40, 20, 'facadeA');
    building(-60, 46, -25, 58, 12, 'facadeC'); building(-22, 46, 8, 60, 18, 'facadeA'); building(10, 46, 60, 58, 9, 'facadeB');
    building(46, -40, 60, 30, 8, 'facadeC'); building(-60, -40, -46, 30, 11, 'facadeB');
    solidOnly(-44.5, 0, -38.5, 44.5, 6, -38.1); solidOnly(44.1, 0, -38.5, 44.5, 6, 24); solidOnly(-44.5, 0, -38.5, -44.1, 6, 24); solidOnly(-44.5, -2, 23.6, 44.5, 6, 24);

    // --- gameplay data
    MAP.spawns = [
      { name: 'Canal Dock', x: 0, z: 20.5, yaw: 0 },
      { name: 'North Lot', x: 0, z: -28, yaw: Math.PI },
      { name: 'West Yard', x: -34, z: 0, yaw: -Math.PI / 2 },
      { name: 'East Yard', x: 34, z: 0, yaw: Math.PI / 2 },
    ];
    MAP.entries = [
      { name: 'Dock 1', out: [-8, 16.5], in: [-8, 11.5] },
      { name: 'Dock 2', out: [8, 16], in: [8, 12.8] },
      { name: 'West Door', out: [-22.5, 4], in: [-17, 4] },
      { name: 'East Door', out: [22.5, 6], in: [17, 6] },
      { name: 'Records Door', out: [3.5, -16.5], in: [3.5, -11] },
      { name: 'Workshop Door', out: [22.5, -10], in: [16, -10] },
      { name: 'Break Room Door', out: [-22.5, -10], in: [-17.5, -10] },
    ];
    MAP.anchors = [[-9.4, -11.2, -6.5, -6], [-3.0, -12.9, -6.5, -6], [-3.0, -7.0, -11, -10], [-9.3, -6.9, -2, -9.5], [-6.6, -11.4, -6.5, -6]];
    MAP.support = [[-15.5, -12.6, -15.5, -6], [2.5, -10.2, 2, -6], [-8, -3.2, -8, 14], [12, -9, 13, -6], [-17.5, -8.5, -20, -10]];
    MAP.roam = [[-16, 11.5, -8, 14], [18.5, 12, 8, 14], [0, 12.8, 0, 14], [-6, 5, -18, 4], [18, -2.5, 20, 6], [-1, -3.5, 8, 14], [10, -11.5, 20, -10], [-18.5, -4, -20, 4], [11.5, 6.5, 20, 6]];
    MAP.secure = [[-6.5, -7.2], [-3.2, -11], [-9, -10.3], [-4.5, -7.4], [-7.6, -11.2]];
    MAP.roomAt = (x, z) => {
      for (const r of rooms) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return r.name;
      if (z > 14) return 'Canal Dock';
      if (z < -14) return 'North Lot';
      return x < 0 ? 'West Yard' : 'East Yard';
    };
    MAP.indoors = (x, z) => x > -20 && x < 20 && z > -14 && z < 14;
  }

  // =============================================================== MAP 3: SNOWPINE CHALET
  function buildChalet(MAP) {
    MAP.bounds = [-44, -38, 44, 34];
    MAP.objName = 'TROPHY ROOM';
    MAP.ground = 'dirt';
    MAP.menuCam = { r: 34, h: 12 };
    MAP.env = { sun: 0xe8eeff, sunI: 1.5, sunPos: [25, 45, -30], hemiSky: 0xdfe8f5, hemiGround: 0x8f98a2, hemiI: 0.5, fog: 0xd6dee8, fogNear: 35, fogFar: 170,
      sky: ['#8ea6be', '#b9c8d6', '#e2e8ee', '#dde3e8', '#c8d0d8'], exposure: 0.95, snow: true };
    MAP.zoneDoors = [[-2, -1], [-6, 4], [2, 7], [-2, 10]];

    box('snow', -60, -1, -56, 60, 0, 56, { phys: 'dirt' });
    // ploughed drive + road
    box('dirt', -8, 0, -28, -4, 0.012, -10.2, { solid: false });
    box('asphalt', -60, 0, -34, 60, 0.015, -28);
    box('snow', -60, 0.015, -34, 60, 0.03, -33.2, { solid: false });
    // frozen creek
    const ice = new THREE.MeshStandardMaterial({ color: 0xbfd6e2, roughness: 0.08, metalness: 0.25 });
    const icem = new THREE.Mesh(G.geo.box, ice); icem.scale.set(4, 0.02, 64); icem.position.set(-32, 0.01, 0); icem.receiveShadow = true; scene.add(icem);

    // log shell
    const shell = (axis, c, a, b, ops) => staticWall(axis, c, a, b, ops, [{ mat: 'logs', o0: -0.2, o1: 0.2, h: 3.4 }]);
    shell('x', -10, -14.2, 14.2, [DOOR(-6, 1.4, true), WIN(-11), WIN(-1.5), WIN(6), WIN(11)]);
    shell('x', 10, -14.2, 14.2, [WIN(-10), WIN(-2), WIN(4, 1.0), { at: 10, w: 3.4, y0: 0, y1: 2.8, bar: true }]);
    shell('z', -14, -9.8, 9.8, [DOOR(-6, 1.3, true), WIN(5)]);
    shell('z', 14, -9.8, 9.8, [DOOR(-6, 1.3, true), WIN(5)]);
    box('woodCeiling', -13.8, 3.2, -9.8, 13.8, 3.35, 9.8, { faces: 8 });
    solidOnly(-14.2, 3.2, -10.2, 14.2, 3.5, 10.2, 'wood');
    // pitched, snow-covered roof (visual)
    const ang = 0.36, half = 10.9, slope = half / Math.cos(ang), rise = half * Math.tan(ang);
    for (const s of [-1, 1]) {
      decor.add(G.geo.box, G.M.woodDark, 0, 3.4 + rise / 2, s * half / 2, s * ang, 0, 0, 29.6, 0.22, slope);
      decor.add(G.geo.box, G.M.snow, 0, 3.4 + rise / 2 + 0.16, s * half / 2, s * ang, 0, 0, 29.8, 0.12, slope + 0.1);
    }
    // stepped log gables
    for (const gx of [-14, 14]) {
      for (let k = 0; k < 8; k++) {
        const y0 = 3.4 + k * 0.5, hw = half - (k * 0.5 + 0.5) / Math.tan(ang);
        if (hw < 0.3) break;
        box('logs', gx - 0.2, y0, -hw, gx + 0.2, y0 + 0.5, hw, { solid: false });
      }
    }
    // chimney + porch
    box('stone', -14.4, 0, -4.2, -13.8, 7.6, -1.2, { solid: false });
    box('stone', -14.2, 3.4, -3.9, -13.2, 7.8, -1.5, { solid: false });
    box('woodLight', -9, 0, -12.2, -3, 0.12, -10.2);
    for (const px of [-8.8, -3.2]) decor.add(G.geo.cyl8, G.M.woodDark, px, 1.4, -12.05, 0, 0, 0, 0.08, 2.8, 0.08);
    decor.add(G.geo.box, G.M.woodDark, -6, 2.85, -11.2, 0.25, 0, 0, 6.4, 0.12, 2.3);
    decor.add(G.geo.box, G.M.snow, -6, 2.95, -11.2, 0.25, 0, 0, 6.5, 0.08, 2.4);

    // interior walls
    const cream = 0xd9cfbb, warm = 0xcdb592, gray = 0xc2c6ca;
    softWall('x', -1, -13.8, 13.8, [DOOR(-10, 1.3, true), DOOR(-2, 1.3, true), DOOR(4, 1.2), DOOR(10, 1.3, true)], cream);
    softWall('z', 2, -9.8, -1.08, [{ at: -5.5, w: 3, y0: 0, y1: 2.5 }], cream);
    softWall('z', -6, -0.92, 9.8, [DOOR(4, 1.3, true)], warm);
    softWall('z', 2, -0.92, 9.8, [DOOR(7, 1.2, true)], gray);
    softWall('z', 6, -0.92, 9.8, [], gray);

    const rooms = (MAP.rooms = [
      { name: 'Great Room', x0: -14, x1: 2, z0: -10, z1: -1, floor: 'woodFloor' },
      { name: 'Kitchen', x0: 2, x1: 14, z0: -10, z1: -1, floor: 'tile' },
      { name: 'Bedroom', x0: -14, x1: -6, z0: -1, z1: 10, floor: 'carpetRed' },
      { name: 'Trophy Room', x0: -6, x1: 2, z0: -1, z1: 10, floor: 'woodFloor' },
      { name: 'Bathroom', x0: 2, x1: 6, z0: -1, z1: 10, floor: 'tile' },
      { name: 'Garage', x0: 6, x1: 14, z0: -1, z1: 10, floor: 'concrete' },
    ]);
    for (const r of rooms) box(r.floor, r.x0, 0, r.z0, r.x1, 0.02, r.z1, { faces: 4 });
    solidOnly(-14, 0, -10, 14, 0.02, 10, 'wood');
    // ceiling beams
    for (let x = -12; x <= 12; x += 3) box('woodDark', x - 0.12, 2.95, -9.8, x + 0.12, 3.2, 9.8, { solid: false });
    // lights
    roomLight(-9, -5.5, 0xffd7a0); roomLight(-3, -5.5, 0xffd7a0);
    roomLight(8, -5.5, 0xffe8c8); lightFixture(8, -5.5, 1.2, 0.3);
    roomLight(-10, 4.5, 0xffcf98, 0.9); roomLight(-2, 4.5, 0xffd9a8, 1.1); roomLight(4, 4.5, 0xf0f4ff, 0.8, 8); roomLight(10, 4.5, 0xfff4e0, 0.9);
    for (const [lx, lz] of [[-9, -5.5], [-3, -5.5], [-10, 4.5], [-2, 4.5], [4, 4.5], [10, 4.5]]) {
      decor.add(G.geo.cyl8, G.M.darkMetal, lx, 2.95, lz, 0, 0, 0, 0.01, 0.5, 0.01);
      decor.add(G.geo.cone, G.M.fabricBeige, lx, 2.62, lz, 0, 0, 0, 0.28, 0.25, 0.28);
      decor.add(G.geo.sphLow, G.M.lightWhite, lx, 2.52, lz, 0, 0, 0, 0.08, 0.08, 0.08);
    }

    // --- great room
    box('stone', -13.8, 0, -3.9, -12.9, 1.4, -1.5);
    box('stone', -13.8, 1.4, -3.6, -13.3, 3.2, -1.8, { solid: false });
    box('woodDark', -13.0, 1.4, -4.0, -12.7, 1.5, -1.4, { solid: false });
    box('concreteDark', -13.0, 0.02, -3.4, -12.6, 0.1, -2.0, { solid: false });
    decor.add(G.geo.box, G.M.fire, -13.1, 0.35, -2.7, 0, 0, 0, 0.12, 0.35, 0.9);
    const fire = new THREE.PointLight(0xff8a3a, 1.4, 7, 1.6); fire.position.set(-12.4, 0.7, -2.7); scene.add(fire);
    MAP.flicker = [fire];
    couch(-10, -2.8, 1, 2.4, 'leather');
    box('woodLight', -12.1, 0.35, -3.3, -11.1, 0.42, -2.3, { pen: true });
    box('rug', -12.6, 0.02, -4.4, -9.2, 0.03, -1.4, { solid: false });
    couch(-11.8, -5.2, 0, 1.0, 'fabricGreen');
    const dt = frame(-3, -6.5, 0);
    table(dt, -1.2, -0.55, 1.2, 0.55, 0.76, 'woodDark');
    for (const cx of [-3.8, -2.2]) { chair(cx, -7.4, 2); chair(cx, -5.6, 0); }
    shelf(-8.8, -9.5, 0, 2.2, 2.2, true);
    box('woodDark', 0.2, 0, -9.75, 1.8, 1.2, -9.0);
    box('plasticWhite', 0.25, 0.75, -9.05, 1.75, 0.8, -8.85, { solid: false });
    painting(-13.78, 1.9, -7.5, Math.PI / 2, 1.2, 0.8);
    // --- kitchen
    box('cabinet', 3, 0, -9.8, 9.5, 0.88, -9.2);
    box('counterTop', 2.98, 0.88, -9.82, 9.52, 0.93, -9.15);
    box('steel', 12.8, 0, -9.8, 13.8, 2.0, -9.0);
    box('cabinet', 6, 0, -6, 9, 0.88, -5);
    box('counterTop', 5.95, 0.88, -6.05, 9.05, 0.93, -4.95);
    table(frame(11.5, -3.5, 0), -0.6, -0.5, 0.6, 0.5, 0.76, 'woodLight');
    chair(11.5, -4.3, 2); chair(11.5, -2.7, 0);
    // --- bedroom
    box('woodDark', -13.8, 0, 6.4, -11.4, 0.5, 8.2);
    box('sheets', -13.6, 0.5, 6.5, -11.5, 0.68, 8.1, { solid: false });
    box('sheets', -13.7, 0.68, 6.7, -13.2, 0.85, 7.9, { solid: false });
    box('woodDark', -13.85, 0, 6.3, -13.7, 1.2, 8.3, { solid: false });
    box('woodDark', -9.1, 0, 9.2, -7.3, 2.1, 9.8, { pen: true });
    box('woodDark', -13.8, 0, 8.4, -13.2, 0.6, 9.0, { pen: true });
    box('rug', -11.5, 0.02, 2.5, -8, 0.03, 5.5, { solid: false });
    // --- trophy room (objective)
    const cases = [[-5.9, 0.2, -5.1, 1.8], [-5.9, 6.2, -5.1, 7.8], [1.1, 2.5, 1.9, 4.0]];
    for (const [a, b, c, d] of cases) {
      box('woodDark', a, 0, b, c, 0.9, d);
      box('glass', a + 0.05, 0.9, b + 0.05, c - 0.05, 1.7, d - 0.05, { solid: false });
      solidOnly(a, 0.9, b, c, 1.7, d, 'glass');
      decor.add(G.geo.cyl, G.M.gold, (a + c) / 2, 1.1, (b + d) / 2, 0, 0, 0, 0.08, 0.3, 0.08);
      decor.add(G.geo.sphLow, G.M.gold, (a + c) / 2, 1.33, (b + d) / 2, 0, 0, 0, 0.1, 0.08, 0.1);
    }
    box('woodDark', -5.6, 0, 9.3, -3.2, 1.8, 9.8, { pen: true });
    for (let i = 0; i < 4; i++) decor.add(G.geo.cyl, G.M.gold, -5.3 + i * 0.6, 1.95, 9.55, 0, 0, 0, 0.06, 0.3, 0.06);
    box('woodDark', -2.5, 0, 4, -1.5, 0.9, 5);
    dataCore(-2, 4.5, 0.9);
    MAP.objective = new V(-2, 1.3, 4.5);
    MAP.zone = { x0: -5.9, x1: 1.9, z0: -0.9, z1: 9.8 };
    for (const [ax, az, ry] of [[-5.9, 4.0, Math.PI / 2], [1.9, 5.3, -Math.PI / 2], [-2, 9.79, Math.PI]]) {
      decor.add(G.geo.box, G.M.woodDark, ax, 2.2, az, 0, ry, 0, 0.35, 0.45, 0.06);
      decor.add(G.geo.cyl8, G.M.plasticWhite, ax, 2.5, az, 0, ry, 0.9, 0.025, 0.5, 0.025);
      decor.add(G.geo.cyl8, G.M.plasticWhite, ax, 2.5, az, 0, ry, -0.9, 0.025, 0.5, 0.025);
    }
    // --- bathroom
    box('plasticWhite', 4.6, 0, 7.8, 5.9, 0.6, 9.8);
    box('plasticWhite', 5.4, 0, 2, 5.9, 0.85, 3.2, { pen: true });
    box('plasticWhite', 5.3, 0, 4.7, 5.9, 0.45, 5.3, { pen: true });
    // --- garage
    car(11.5, 4.5, 0, 'carBlack');
    box('carRed', 7.3, 0.15, 1.2, 8.3, 0.75, 3.2);
    box('plasticBlack', 7.5, 0.75, 1.9, 8.1, 1.05, 2.6, { solid: false });
    box('darkMetal', 7.2, 0, 0.9, 8.4, 0.12, 3.5, { solid: false });
    shelf(13.5, 1, 1, 1.8, 2, true);
    box('woodDark', 6.1, 0, 5.6, 6.7, 0.9, 8.4);

    // --- outdoors
    const pines = [[-20, -14], [-24, -6], [-22, 6], [-26, 14], [-20, 20], [-38, -20], [-37, -8], [-38, 6], [-36, 18], [-28, -24],
      [20, -16], [24, 18], [18, 24], [36, -20], [38, 8], [34, 24], [-8, 24], [8, 28], [-16, 29], [28, -28], [-14, -20], [14, -22],
      [-40, 28], [40, -30], [-42, -30], [0, 31], [22, 30], [-30, 30]];
    for (const [px, pz] of pines) pine(px, pz, 0.9 + Math.random() * 0.6);
    rock(-18, 2, 0.9); rock(18, -2, 1.1); rock(-5, 18, 1.0); rock(9, 17, 0.8); rock(-25, -17, 1.2); rock(27, 12, 1.0);
    // woodshed
    box('logs', 24, 0, -10, 28, 2.4, -7);
    box('woodDark', 23.7, 2.4, -10.3, 28.3, 2.6, -6.7, { solid: false });
    box('snow', 23.6, 2.6, -10.4, 28.4, 2.75, -6.6, { solid: false });
    for (let i = 0; i < 5; i++) for (let j = 0; j < 3 - (i % 2); j++) decor.add(G.geo.cyl8, G.M.bark, 24.6 + j * 0.35 + (i % 2) * 0.17, 0.18 + i * 0.3, -5.8, Math.PI / 2, 0, 0, 0.15, 1.6, 0.15);
    solidOnly(24.3, 0, -6.6, 25.6, 1.5, -5.0, 'wood');
    car(6, -20, 1, 'carBlack'); car(-18, -23, 1, 'carGreen');
    box('carRed', 16, 0.15, 8, 17, 0.75, 10); box('plasticBlack', 16.2, 0.75, 8.7, 16.8, 1.05, 9.4, { solid: false });
    const pt = frame(18, -14, 0);
    table(pt, -1, -0.4, 1, 0.4, 0.75, 'woodLight');
    pt.box('snow', -1, 0.75, -0.4, 1, 0.82, 0.4, { solid: false });
    // log rail fence along the road
    for (let x = -40; x < 40; x += 4) {
      decor.add(G.geo.cyl8, G.M.woodDark, x, 0.6, -26.5, 0, 0, 0, 0.07, 1.2, 0.07);
      decor.add(G.geo.cyl8, G.M.bark, x + 2, 0.9, -26.5, 0, 0, Math.PI / 2, 0.06, 4, 0.06);
    }
    // distant mountains
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + 0.2, r = 150 + (i % 3) * 20, h = 45 + (i * 37) % 35;
      decor.add(G.geo.cone, G.M.stone, Math.cos(a) * r, h / 2 - 2, Math.sin(a) * r, 0, a, 0, 45, h, 45);
      decor.add(G.geo.cone, G.M.snow, Math.cos(a) * r, h - h * 0.2 - 2, Math.sin(a) * r, 0, a, 0, 18.5, h * 0.42, 18.5);
    }
    solidOnly(-44.5, 0, -38.5, 44.5, 6, -38.1); solidOnly(44.1, 0, -38.5, 44.5, 6, 34); solidOnly(-44.5, 0, -38.5, -44.1, 6, 34); solidOnly(-44.5, 0, 33.6, 44.5, 6, 34);

    // falling snow around the camera + fire flicker
    const N = 1600, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { pos[i * 3] = G.rand(-20, 20); pos[i * 3 + 1] = G.rand(0, 14); pos[i * 3 + 2] = G.rand(-20, 20); }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const snowPts = new THREE.Points(sg, new THREE.PointsMaterial({ size: 0.07, map: G.T.dot, transparent: true, depthWrite: false, color: 0xffffff, opacity: 0.85 }));
    snowPts.frustumCulled = false;
    scene.add(snowPts);
    MAP.update = (dt, cam) => {
      const p = sg.attributes.position.array, t = G.time;
      for (let i = 0; i < N; i++) {
        p[i * 3 + 1] -= dt * (0.9 + (i % 5) * 0.12);
        p[i * 3] += Math.sin(t * 0.7 + i) * dt * 0.25;
        if (p[i * 3 + 1] < 0) p[i * 3 + 1] += 14;
      }
      sg.attributes.position.needsUpdate = true;
      // keep the snow volume centred on the camera (snapped so flakes don't slide with you)
      snowPts.position.set(Math.round(cam.position.x / 40) * 40, 0, Math.round(cam.position.z / 40) * 40);
      snowPts.visible = !MAP.indoors(cam.position.x, cam.position.z);
      fire.intensity = 1.2 + Math.sin(t * 13) * 0.15 + Math.sin(t * 7.3) * 0.2 + Math.random() * 0.1;
    };

    // --- gameplay data
    MAP.spawns = [
      { name: 'Front Drive', x: -6, z: -27, yaw: Math.PI },
      { name: 'Pine Ridge', x: 0, z: 26, yaw: 0 },
      { name: 'Frozen Creek', x: -32, z: 0, yaw: -Math.PI / 2 },
      { name: 'Woodshed', x: 32, z: 0, yaw: Math.PI / 2 },
    ];
    MAP.entries = [
      { name: 'Front Door', out: [-6, -13.5], in: [-6, -7.5] },
      { name: 'West Door', out: [-16.5, -6], in: [-12, -7] },
      { name: 'East Door', out: [16.5, -6], in: [11.5, -6] },
      { name: 'Garage Door', out: [10, 12.5], in: [8.2, 7.5] },
    ];
    MAP.anchors = [[-4.9, 8.7, -2, -1], [1.2, 9.2, -6, 4], [-4.6, 0.3, 1, 4], [1.2, 0.4, -6, 4], [-2, 7.6, -2, -1]];
    MAP.support = [[-7.2, 8.8, -10, -1], [-4.5, -3, -6, -10], [3.0, 1.0, 4, -1], [7.3, 8.8, 10, 10], [3, -3, 2, -5.5]];
    MAP.roam = [[-12.5, -8.8, -6, -10], [12.5, -8, 14, -6], [-12.8, 1, -14, 5], [12.8, 8.8, 10, 10], [-8, -4, -14, -6], [8, -2.5, 4, -1], [-1, -8.3, -6, -10]];
    MAP.secure = [[-2, 2.2], [-4, 6.5], [0, 6], [-3.8, 3], [-0.3, 2.4]];
    MAP.roomAt = (x, z) => {
      for (const r of rooms) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return r.name;
      if (z < -10) return 'Front Drive';
      if (z > 10) return 'Pine Ridge';
      return x < 0 ? 'Frozen Creek' : 'Woodshed';
    };
    MAP.indoors = (x, z) => x > -14 && x < 14 && z > -10 && z < 10;
  }

  // =============================================================== MAP 4: CEDAR CREEK COMPOUND (basement, ground floor, upstairs)
  const RISE = 0.17, TREAD = 0.3;
  // a flight of n steps climbing along z (dir +1/-1) from height y0; solidTo fills underneath, otherwise a sloped underside
  function flightZ(mat, x0, x1, zStart, dir, y0, n, solidTo) {
    for (let i = 0; i < n; i++) {
      const top = y0 + RISE * (i + 1), za = zStart + dir * TREAD * i, zb = zStart + dir * TREAD * (i + 1);
      box(mat, x0, solidTo === undefined ? top - 0.32 : solidTo, Math.min(za, zb), x1, top, Math.max(za, zb));
    }
  }
  function flightX(mat, z0, z1, xStart, dir, y0, n, solidTo) {
    for (let i = 0; i < n; i++) {
      const top = y0 + RISE * (i + 1), xa = xStart + dir * TREAD * i, xb = xStart + dir * TREAD * (i + 1);
      box(mat, Math.min(xa, xb), solidTo === undefined ? top - 0.32 : solidTo, z0, Math.max(xa, xb), top, z1);
    }
  }
  // rectangle minus rectangular holes [x0, z0, x1, z1], as merged strips
  function slab(mat, x0, z0, x1, z1, y0, y1, holes, o) {
    const xs = [x0, x1], zs = [z0, z1];
    for (const h of holes) {
      if (h[0] > x0 && h[0] < x1) xs.push(h[0]); if (h[2] > x0 && h[2] < x1) xs.push(h[2]);
      if (h[1] > z0 && h[1] < z1) zs.push(h[1]); if (h[3] > z0 && h[3] < z1) zs.push(h[3]);
    }
    const uniq = (a) => [...new Set(a)].sort((p, q) => p - q);
    const X = uniq(xs), Z = uniq(zs);
    const inHole = (x, z) => holes.some((h) => x > h[0] && x < h[2] && z > h[1] && z < h[3]);
    for (let j = 0; j < Z.length - 1; j++) {
      const cz = (Z[j] + Z[j + 1]) / 2;
      let start = null;
      for (let i = 0; i <= X.length - 1; i++) {
        const open = i < X.length - 1 && !inHole((X[i] + X[i + 1]) / 2, cz);
        if (open && start === null) start = X[i];
        if (!open && start !== null) { box(mat, start, y0, Z[j], X[i], y1, Z[j + 1], o); start = null; }
      }
    }
  }
  function bunk(x, z) {
    const f = frame(x, z, 0);
    for (const [a, b] of [[-0.95, -0.4], [0.95, -0.4], [-0.95, 0.4], [0.95, 0.4]]) f.box('woodDark', a - 0.04, 0, b - 0.04, a + 0.04, 1.9, b + 0.04, { solid: false });
    f.box('woodDark', -1, 0.3, -0.45, 1, 0.4, 0.45, { solid: false });
    f.box('sheets', -0.95, 0.4, -0.4, 0.95, 0.55, 0.4, { solid: false });
    f.box('woodDark', -1, 1.35, -0.45, 1, 1.45, 0.45, { solid: false });
    f.box('sheets', -0.95, 1.45, -0.4, 0.95, 1.6, 0.4, { solid: false });
    f.box('woodDark', -1, 0.05, -0.45, 1, 1.9, 0.45, { visible: false, pen: true, phys: 'wood' });
  }

  function buildCompound(MAP) {
    MAP.bounds = [-44, -38, 44, 34];
    MAP.ground = 'dirt';
    MAP.menuCam = { r: 36, h: 14 };
    MAP.env = { sun: 0xffe3c2, sunI: 2.0, sunPos: [-30, 42, -26], hemiSky: 0xd0e0f4, hemiGround: 0x6b5a45, hemiI: 0.4, fog: 0xcbd4db, fogNear: 60, fogFar: 240,
      sky: ['#4a7fc0', '#86b3e0', '#dde6ec', '#d8c9ad', '#77705f'], exposure: 1.0 };
    const LB = -3.4, L1 = 0, L2 = 3.4, TOP = 6.8;
    const SHAFT = [-5.92, 3.0, -1.08, 9.8], GSTAIR = [12.2, 3.6, 13.8, 9.8], PIT = [14.2, 5.3, 20.8, 7.1];

    // ---------------- ground (with holes for the basement and the bulkhead stairs)
    slab('grass', -60, -56, 60, 56, -1, 0, [[-14.2, -10.2, 14.2, 10.2], PIT], { phys: 'dirt' });
    box('dirt', -9.2, 0, -30, -6.8, 0.012, -11.6, { solid: false });
    box('dirt', -30, 0, -1, -16.8, 0.012, 3.5, { solid: false });
    box('dirt', 21, 0, 5.3, 34, 0.012, 7.1, { solid: false });
    box('asphalt', -60, 0, -36, 60, 0.015, -30);

    // ---------------- rooms (floor finishes, names, footsteps)
    const rooms = (MAP.rooms = [
      { name: 'Bunker', y: LB, x0: -13.8, x1: -4, z0: -9.8, z1: 0, floor: 'concreteDark' },
      { name: 'Boiler Room', y: LB, x0: -4, x1: 6, z0: -9.8, z1: 0, floor: 'concrete' },
      { name: 'Cellar', y: LB, x0: 6, x1: 13.8, z0: -9.8, z1: 0, floor: 'concrete' },
      { name: 'Basement Hall', y: LB, x0: -13.8, x1: 13.8, z0: 0, z1: 2.5, floor: 'concrete' },
      { name: 'Workshop', y: LB, x0: -13.8, x1: -6, z0: 2.5, z1: 9.8, floor: 'concreteDark' },
      { name: 'Basement Stairs', y: LB, x0: -6, x1: -1, z0: 2.5, z1: 9.8, floor: 'concrete' },
      { name: 'Storage', y: LB, x0: -1, x1: 13.8, z0: 2.5, z1: 9.8, floor: 'concrete' },
      { name: 'Meeting Hall', y: L1, x0: -13.8, x1: -2, z0: -9.8, z1: 0, floor: 'woodFloor' },
      { name: 'Kitchen', y: L1, x0: -2, x1: 6, z0: -9.8, z1: 0, floor: 'tile' },
      { name: 'Dining Room', y: L1, x0: 6, x1: 13.8, z0: -9.8, z1: 0, floor: 'woodFloor' },
      { name: 'Main Hall', y: L1, x0: -13.8, x1: 13.8, z0: 0, z1: 2.5, floor: 'marble' },
      { name: 'Office', y: L1, x0: -13.8, x1: -6, z0: 2.5, z1: 9.8, floor: 'carpetBlue' },
      { name: 'Main Stairs', y: L1, x0: -6, x1: -1, z0: 2.5, z1: 9.8, floor: 'woodFloor' },
      { name: 'Laundry', y: L1, x0: -1, x1: 5, z0: 2.5, z1: 9.8, floor: 'tile' },
      { name: 'Garage', y: L1, x0: 5, x1: 13.8, z0: 2.5, z1: 9.8, floor: 'concrete' },
      { name: 'Dormitory', y: L2, x0: -13.8, x1: -4, z0: -9.8, z1: 0, floor: 'woodFloor' },
      { name: 'Master Bedroom', y: L2, x0: -4, x1: 6, z0: -9.8, z1: 0, floor: 'carpetRed' },
      { name: 'Bathroom', y: L2, x0: 6, x1: 9, z0: -9.8, z1: 0, floor: 'tile' },
      { name: 'Kids Room', y: L2, x0: 9, x1: 13.8, z0: -9.8, z1: 0, floor: 'carpetBlue' },
      { name: 'Upper Hall', y: L2, x0: -13.8, x1: 13.8, z0: 0, z1: 2.5, floor: 'woodFloor' },
      { name: 'Armory', y: L2, x0: -13.8, x1: -6, z0: 2.5, z1: 9.8, floor: 'concreteDark' },
      { name: 'Upper Stairs', y: L2, x0: -6, x1: -1, z0: 2.5, z1: 9.8, floor: 'woodFloor' },
      { name: 'Attic', y: L2, x0: -1, x1: 5, z0: 2.5, z1: 9.8, floor: 'woodFloor' },
      { name: 'Study', y: L2, x0: 5, x1: 13.8, z0: 2.5, z1: 9.8, floor: 'woodFloor' },
    ]);
    const holesAt = (y) => (y === L1 ? [SHAFT] : y === L2 ? [SHAFT, GSTAIR] : []);
    for (const y of [LB, L1, L2]) {
      const holes = holesAt(y);
      // structure: ceiling of the floor below on the underside, trimmed edges round stair openings
      if (y > LB) {
        slab('ceiling', -13.8, -9.8, 13.8, 9.8, y - 0.2, y - 0.02, holes, { faces: 8 });
        slab('trim', -13.8, -9.8, 13.8, 9.8, y - 0.2, y - 0.02, holes, { faces: 1 | 2 | 16 | 32, solid: false });
      } else box('concrete', -14.2, y - 0.4, -10.2, 14.2, y - 0.02, 10.2, { faces: 4 });
      for (const r of rooms) if (r.y === y) slab(r.floor, r.x0, r.z0, r.x1, r.z1, y - 0.02, y, holes, { faces: 4 });
    }
    slab('ceiling', -13.8, -9.8, 13.8, 9.8, TOP - 0.2, TOP, [], { faces: 8 });

    // ---------------- exterior walls, per floor
    const ext = (base, axis, c, a, b, out, ops, basement) => onFloor(base, () => {
      const L = basement ? [{ mat: 'concrete', o0: -0.2, o1: 0.2, h: 3.4 }]
        : out < 0 ? [{ mat: 'siding', o0: -0.2, o1: -0.06, h: 3.4 }, { mat: 'plasterExt', o0: -0.06, o1: 0.2, h: 3.4 }]
          : [{ mat: 'plasterExt', o0: -0.2, o1: 0.06, h: 3.4 }, { mat: 'siding', o0: 0.06, o1: 0.2, h: 3.4 }];
      staticWall(axis, c, a, b, ops, L);
    });
    // basement
    ext(LB, 'x', -10, -14.2, 14.2, -1, [], true);
    ext(LB, 'x', 10, -14.2, 14.2, 1, [], true);
    ext(LB, 'z', -14, -9.8, 9.8, -1, [], true);
    ext(LB, 'z', 14, -9.8, 9.8, 1, [DOOR(6.2, 1.3)], true);
    // ground floor
    ext(L1, 'x', -10, -14.2, 14.2, -1, [WIN(-12), DOOR(-8, 1.3), WIN(-4.5), WIN(2), DOOR(7, 1.3), WIN(11.5)]);
    ext(L1, 'x', 10, -14.2, 14.2, 1, [WIN(-10), WIN(2), { at: 9, w: 3.4, y0: 0, y1: 2.8, bar: true }]);
    ext(L1, 'z', -14, -9.8, 9.8, -1, [WIN(-7), DOOR(1.25, 1.3), WIN(6)]);
    ext(L1, 'z', 14, -9.8, 9.8, 1, [WIN(-5), DOOR(1.25, 1.3)]);
    // upstairs
    ext(L2, 'x', -10, -14.2, 14.2, -1, [WIN(-11), WIN(-7), WIN(-1), WIN(3), WIN(11.5)]);
    ext(L2, 'x', 10, -14.2, 14.2, 1, [WIN(-10), WIN(2), WIN(8.5)]);
    ext(L2, 'z', -14, -9.8, 9.8, -1, [WIN(-7), DOOR(1.25, 1.3), WIN(6)]);
    ext(L2, 'z', 14, -9.8, 9.8, 1, [WIN(-5), WIN(1.25)]);

    // ---------------- interior soft walls
    const gray = 0xb9b6ae, cream = 0xdcd2bd, sage = 0xc3ccb8, warm = 0xd4bf9c, blue = 0xbcc6d0;
    onFloor(LB, () => {
      softWall('x', 0, -13.8, 13.8, [DOOR(-9), DOOR(1), DOOR(10)], gray);
      softWall('x', 2.5, -13.8, -6, [DOOR(-10)], gray);
      softWall('x', 2.5, -1, 13.8, [DOOR(2), DOOR(10)], gray);
      softWall('z', -4, -9.8, 0, [DOOR(-5)], gray);
      softWall('z', 6, -9.8, 0, [DOOR(-6)], gray);
      softWall('z', -6, 2.5, 9.8, [], gray);
      softWall('z', -1, 2.5, 9.8, [], gray);
    });
    onFloor(L1, () => {
      softWall('x', 0, -13.8, 13.8, [DOOR(-10), DOOR(-4), DOOR(2), DOOR(10)], cream);
      softWall('x', 2.5, -13.8, -6, [DOOR(-9.5)], cream);
      softWall('x', 2.5, -1, 13.8, [DOOR(2), DOOR(8)], cream);
      softWall('z', -2, -9.8, 0, [DOOR(-6)], warm);
      softWall('z', 6, -9.8, 0, [DOOR(-4, 1.6)], sage);
      softWall('z', 5, 2.5, 9.8, [DOOR(6)], cream);
      softWall('z', -6, 2.5, 9.8, [], cream);
      softWall('z', -1, 2.5, 9.8, [], cream);
    });
    onFloor(L2, () => {
      softWall('x', 0, -13.8, 13.8, [DOOR(-9), DOOR(1), DOOR(7.5), DOOR(11.5)], warm);
      softWall('x', 2.5, -13.8, -6, [DOOR(-9)], warm);
      softWall('x', 2.5, -1, 13.8, [DOOR(2), DOOR(8)], warm);
      softWall('z', -4, -9.8, 0, [DOOR(-3)], blue);
      softWall('z', 6, -9.8, 0, [], cream);
      softWall('z', 9, -9.8, 0, [], cream);
      softWall('z', 5, 2.5, 9.8, [DOOR(7)], warm);
      softWall('z', -6, 2.5, 9.8, [], warm);
      softWall('z', -1, 2.5, 9.8, [], warm);
    });

    // ---------------- main stairwell: basement -> ground floor -> upstairs (switchback with a central wall)
    flightZ('concrete', -5.92, -3.55, 3.0, 1, LB, 10, LB);
    box('concrete', -5.92, LB, 6.0, -1.08, LB + 1.7, 9.8);
    flightZ('concrete', -3.45, -1.08, 6.0, -1, LB + 1.7, 10, LB);
    flightZ('woodLight', -5.92, -3.55, 3.0, 1, L1, 10);
    box('woodLight', -5.92, L1 + 1.4, 6.0, -1.08, L1 + 1.7, 9.8);
    flightZ('woodLight', -3.45, -1.08, 6.0, -1, L1 + 1.7, 10);
    box('plasterExt', -3.55, LB, 3.0, -3.45, TOP - 0.2, 6.0);
    box('woodDark', -5.92, L2, 2.96, -3.55, L2 + 1.0, 3.04); // upstairs railing over the drop
    // garage stairs up to the study
    flightZ('woodDark', 12.2, 13.8, 9.6, -1, L1, 20, L1);
    box('woodDark', 12.1, L2, 3.6, 12.2, L2 + 1.0, 9.8);
    // west balcony + outside stairs to the upstairs hall
    box('woodDark', -16.6, L2 - 0.3, -1.2, -14.2, L2, 3.7);
    flightZ('woodDark', -16.4, -15.0, 9.7, -1, 0, 20);
    box('woodDark', -16.6, L2, -1.2, -16.5, L2 + 1.0, 3.7);
    box('woodDark', -16.6, L2, -1.2, -14.2, L2 + 1.0, -1.1);
    box('woodDark', -15.0, L2, 3.6, -14.2, L2 + 1.0, 3.7);
    for (const [px, pz] of [[-16.5, -1.1], [-16.5, 3.6], [-15.1, 9.6], [-15.1, 6.6]]) decor.add(G.geo.cyl8, G.M.woodDark, px, L2 / 2 - 0.15, pz, 0, 0, 0, 0.07, L2 - 0.3, 0.07);
    // basement bulkhead: outside stairs down to the storage door
    box('concrete', 14.2, LB - 0.4, 5.3, 14.8, LB, 7.1);
    flightX('concrete', 5.3, 7.1, 14.8, 1, LB, 20, LB);
    box('concrete', 14.2, LB - 0.2, 4.9, 21.2, 0.3, 5.3);
    box('concrete', 14.2, LB - 0.2, 7.1, 21.2, 0.3, 7.5);
    decor.add(G.geo.box, G.M.sidingDark, 20.9, 0.55, 4.7, 0, 0, 0.35, 0.08, 1.1, 0.9);
    decor.add(G.geo.box, G.M.sidingDark, 20.9, 0.55, 7.7, 0, 0, -0.35, 0.08, 1.1, 0.9);

    // ---------------- roof
    const ang = 0.4, half = 10.9, sl = half / Math.cos(ang), rise = half * Math.tan(ang);
    for (const s of [-1, 1]) decor.add(G.geo.box, G.M.roof, 0, TOP + rise / 2 + 0.1, s * half / 2, s * ang, 0, 0, 29.4, 0.2, sl);
    for (const gx of [-14, 14]) {
      for (let k = 0; k < 10; k++) {
        const y0 = TOP + k * 0.5, hw = half - (k * 0.5 + 0.5) / Math.tan(ang);
        if (hw < 0.3) break;
        box('siding', gx - 0.2, y0, -hw, gx + 0.2, y0 + 0.5, hw, { solid: false });
      }
    }
    box('trim', -14.35, TOP - 0.1, -10.35, 14.35, TOP + 0.1, 10.35, { solid: false });
    // front porch
    box('woodDark', -10.2, 0, -11.8, -5.8, 0.12, -10.2);
    for (const px of [-10, -6]) decor.add(G.geo.cyl8, G.M.woodDark, px, 1.4, -11.65, 0, 0, 0, 0.08, 2.8, 0.08);
    decor.add(G.geo.box, G.M.roof, -8, 2.85, -11.1, 0.25, 0, 0, 4.8, 0.12, 2.1);
    sign('CEDAR CREEK', -8, 2.55, -10.23, Math.PI, 2.4, 0.5, '#3b2a1a', '#e8dcc0');

    // ---------------- lights
    const lamp = (x, z, c, i) => { roomLight(x, z, c, i, 7.5); lightFixture(x, z, 1.1, 0.3); };
    onFloor(LB, () => {
      for (const [x, z] of [[-9, -5], [1, -5], [10, -5], [-6, 1.25], [7, 1.25], [-10, 6], [6, 6], [11, 6]]) lamp(x, z, 0xdfe6ff, 0.85);
    });
    onFloor(L1, () => {
      for (const [x, z] of [[-11, -5], [-5, -5], [2, -5], [10, -5], [-8, 1.25], [6, 1.25], [-10, 6], [2, 6], [9, 6]]) lamp(x, z, 0xffdcb0, 0.95);
    });
    onFloor(L2, () => {
      for (const [x, z] of [[-9, -5], [1, -5], [7.5, -5], [11.5, -5], [-8, 1.25], [7, 1.25], [-10, 6], [2, 6], [8.5, 6]]) lamp(x, z, 0xffe4c4, 0.9);
    });
    roomLight(-3.5, 7.8, 0xffe8cc, 0.9, 9, 5.5);
    roomLight(-3.5, 7.8, 0xdfe6ff, 0.8, 8, -1.2);

    // ---------------- furniture
    onFloor(LB, () => {
      // bunker (objective)
      shelf(-13.3, -6.5, 1, 2.4, 2.2, true);
      rack(-13.2, -2.2, 1);
      crate(-9, -5, 0.9); dataCore(-9, -5, 0.9);
      box('fabricBeige', -7.8, LB, -2.8, -6.2, LB + 0.9, -2.2);
      box('fabricBeige', -12.4, LB, -8.4, -11.8, LB + 0.9, -6.8);
      bigCrateStack(-6.6, -8.9);
      // boiler room
      for (const bx of [0, 3.4]) {
        decor.add(G.geo.cyl, G.M.steel, bx, LB + 1.2, -8.4, 0, 0, 0, 0.75, 2.4, 0.75);
        decor.add(G.geo.cyl8, G.M.darkMetal, bx, LB + 2.7, -8.4, 0, 0, 0, 0.12, 0.9, 0.12);
        solidOnly(bx - 0.75, LB, -9.15, bx + 0.75, LB + 2.4, -7.65, 'metal');
      }
      decor.add(G.geo.cyl8, G.M.darkMetal, 1.7, LB + 2.9, -4, Math.PI / 2, 0, 0, 0.08, 11, 0.08);
      crate(4.8, -1.2, 0.9);
      // cellar
      shelf(9.5, -9.3, 0, 3, 2.2, true);
      for (const [bx, bz] of [[12.6, -3], [12.6, -4.2], [11.4, -3.6]]) {
        decor.add(G.geo.cyl, G.M.woodDark, bx, LB + 0.5, bz, 0, 0, 0, 0.42, 1.0, 0.42);
        solidOnly(bx - 0.42, LB, bz - 0.42, bx + 0.42, LB + 1.0, bz + 0.42, 'wood');
      }
      // workshop
      table(frame(-10, 7.8, 0), -1.3, -0.5, 1.3, 0.5, 0.9, 'woodDark');
      shelf(-13.3, 5.2, 1, 2, 2, true);
      crate(-7, 9, 1);
      // storage
      bigCrateStack(1, 8.6);
      crate(6.5, 9, 1.1); crate(7.7, 9, 1.0);
      shelf(11, 9.4, 0, 3, 2.2, true);
      crate(4.5, 4, 0.8);
    });
    onFloor(L1, () => {
      // meeting hall (objective)
      table(frame(-8, -5, 0), -1.1, -0.5, 1.1, 0.5, 0.76, 'woodDark');
      dataCore(-8, -5, 0.76);
      for (const cx of [-12.2, -11.4, -10.6, -5.4, -4.6, -3.8]) chair(cx, -8.6, 2);
      for (const cx of [-12.2, -11.4, -4.6, -3.8]) chair(cx, -2.2, 0);
      shelf(-13.35, -5, 1, 2.2, 2, true);
      plant(-3, -1.1);
      // kitchen
      box('cabinet', -1.8, 0, -9.8, 4.2, 0.88, -9.2);
      box('counterTop', -1.82, 0.88, -9.82, 4.22, 0.93, -9.15);
      box('cabinet', 0.6, 0, -5.6, 3.4, 0.88, -4.4);
      box('counterTop', 0.55, 0.88, -5.65, 3.45, 0.93, -4.35);
      box('steel', 4.8, 0, -9.8, 5.8, 2.0, -9.1);
      // dining room
      table(frame(10.2, -5, 0), -2.2, -0.6, 2.2, 0.6, 0.76, 'woodLight');
      for (const cx of [8.6, 9.7, 10.8, 11.9]) { chair(cx, -5.9, 2); chair(cx, -4.1, 0); }
      box('woodDark', 13.2, 0, -8.5, 13.8, 1.9, -6.5);
      // office
      desk(-11, 8.6, 2); officeChair(-11, 7.6, 0);
      shelf(-13.35, 5, 1, 2, 2, true);
      couch(-7.8, 9.2, 2, 2.0, 'leather');
      // laundry
      box('plasticWhite', -0.8, 0, 9.0, 0.0, 0.9, 9.8); box('plasticWhite', 0.1, 0, 9.0, 0.9, 0.9, 9.8);
      shelf(3.8, 9.35, 0, 2.0, 2, true);
      // garage
      car(8.2, 6.6, 0, 'carBlue');
      shelf(5.5, 8.6, 1, 1.6, 2, true);
      crate(6.2, 3.3, 0.9);
      // main hall
      plant(-13.2, 2.1); plant(13.2, 2.1);
    });
    onFloor(L2, () => {
      // dormitory
      for (const bx of [-12.4, -9.9, -7.4]) bunk(bx, -9.2);
      bunk(-12.4, -1.1);
      box('steel', -5.2, L2, -9.8, -4.3, L2 + 1.9, -8.4);
      // master bedroom (objective)
      box('woodDark', 3.0, L2, -9.7, 5.4, L2 + 0.5, -7.4);
      box('sheets', 3.05, L2 + 0.5, -9.65, 5.35, L2 + 0.66, -7.45, { solid: false });
      box('woodDark', 0.2, L2, -9.8, 1.8, L2 + 0.9, -9.0);
      dataCore(1, -9.4, 0.9);
      box('woodDark', -3.8, L2, -9.8, -2.6, L2 + 2.1, -9.1);
      box('rug', -1.5, L2, -6.5, 2.5, L2 + 0.01, -3.5, { solid: false });
      couch(-2.5, -1.2, 0, 1.6, 'fabricGreen');
      // bathroom
      box('plasticWhite', 6.2, L2, -9.8, 8.8, L2 + 0.6, -8.9);
      box('plasticWhite', 8.3, L2, -4.6, 8.9, L2 + 0.45, -4.0);
      // kids room
      box('woodLight', 12.1, L2, -9.7, 13.7, L2 + 0.5, -7.7);
      box('sheets', 12.15, L2 + 0.5, -9.65, 13.65, L2 + 0.64, -7.75, { solid: false });
      crate(10, -9.2, 0.5); crate(10.7, -9.2, 0.4);
      // armory
      rack(-13.2, 4.6, 1); rack(-13.2, 6.2, 1); rack(-13.2, 7.8, 1);
      table(frame(-9.5, 8.8, 0), -1.2, -0.45, 1.2, 0.45, 0.9, 'darkMetal');
      crate(-7, 4, 0.9);
      // attic
      for (const [cx, cz, cs] of [[0, 9, 0.8], [1, 9.1, 0.7], [0.4, 8.2, 0.6], [4, 9, 0.9], [4, 4, 0.7]]) {
        box('cardboard', cx - cs / 2, L2, cz - cs / 2, cx + cs / 2, L2 + cs, cz + cs / 2);
      }
      // study
      desk(8.5, 9, 2); officeChair(8.5, 8, 0);
      shelf(5.5, 8.8, 1, 1.6, 2, true);
      plant(11.6, 3.2);
    });

    // ---------------- outdoors
    const trees = [[-24, -20], [-30, -12], [-26, 12], [-20, 22], [-34, 24], [24, 20], [30, 26], [18, 26], [-8, 26], [10, 28], [-38, -26],
      [38, -26], [36, 14], [-40, 4], [40, -6], [-16, -24], [16, -26], [28, -4]];
    for (const [tx, tz] of trees) tree(tx, tz, 0.9 + Math.random() * 0.5);
    building(24, -18, 34, -9, 5, 'corrugated');
    car(-3, -20, 1, 'carRed'); van(6, -22, 1, 'carWhite'); car(22, 12, 0, 'carSilver');
    dumpster(18, -6, 1);
    // water tower
    for (const [lx, lz] of [[-29, 18], [-27, 18], [-29, 20], [-27, 20]]) decor.add(G.geo.cyl8, G.M.darkMetal, lx, 3, lz, 0, 0, 0, 0.1, 6, 0.1);
    decor.add(G.geo.cyl, G.M.woodDark, -28, 7.2, 19, 0, 0, 0, 1.8, 2.6, 1.8);
    decor.add(G.geo.cone, G.M.roof, -28, 9.0, 19, 0, 0, 0, 2.0, 1.0, 2.0);
    solidOnly(-29.2, 0, 17.8, -26.8, 6, 20.2, 'metal');
    // rail fence
    for (let x = -40; x < 40; x += 4) for (const fz of [-29, 30]) {
      decor.add(G.geo.cyl8, G.M.woodDark, x, 0.6, fz, 0, 0, 0, 0.07, 1.2, 0.07);
      decor.add(G.geo.cyl8, G.M.bark, x + 2, 0.9, fz, 0, 0, Math.PI / 2, 0.06, 4, 0.06);
    }
    // distant hills
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + 0.3, r = 165 + (i % 3) * 20, h = 18 + (i * 37) % 16;
      decor.add(G.geo.sphLow, G.M.hedge, Math.cos(a) * r, -4, Math.sin(a) * r, 0, a, 0, 70, h, 55);
    }
    solidOnly(-44.5, -4, -38.5, 44.5, 8, -38.1); solidOnly(44.1, -4, -38.5, 44.5, 8, 34); solidOnly(-44.5, -4, -38.5, -44.1, 8, 34); solidOnly(-44.5, -4, 33.6, 44.5, 8, 34);

    // ---------------- gameplay data: three objective sites, one per floor
    MAP.sites = [
      {
        name: 'BUNKER', floor: 'BASEMENT', objective: new V(-9, LB + 1.3, -5), zone: { x0: -13.8, x1: -4, z0: -9.8, z1: 0, y0: LB, y1: LB + 3.2 },
        zoneDoors: [[-9, 0, LB], [-4, -5, LB]],
        anchors: [[-12.6, -8.8, -9, 0, LB], [-5, -1, -4, -5, LB], [-12.8, -1.2, -4, -5, LB], [-5.2, -6.2, -9, 0, LB]],
        support: [[1, -4, -4, -5, LB], [-10, 5.5, -10, 2.5, LB], [9, 1.25, 14, 6.2, LB], [-3.3, 1.3, -3.3, 6, LB], [3, 6, 14, 6.2, LB]],
        secure: [[-9, -2.8, LB], [-11, -6.5, LB], [-7, -7, LB], [-5.5, -3.8, LB], [-12, -3.8, LB]],
      },
      {
        name: 'MEETING HALL', floor: 'GROUND FLOOR', objective: new V(-8, L1 + 1.3, -5), zone: { x0: -13.8, x1: -2, z0: -9.8, z1: 0, y0: L1, y1: L1 + 3.2 },
        zoneDoors: [[-10, 0, L1], [-4, 0, L1], [-2, -6, L1], [-8, -10, L1]],
        anchors: [[-12.8, -1.2, -8, -10, L1], [-3, -8.8, -8, -10, L1], [-12.8, -7.4, -10, 0, L1], [-3.2, -3.2, -12, -6, L1]],
        support: [[2, -3, -2, -6, L1], [-9.5, 5.5, -9.5, 2.5, L1], [-3.3, 1.3, -3.3, 7, L1], [9, -2.5, 7, -10, L1], [11, 1.25, 14, 1.25, L1]],
        secure: [[-8, -2.6, L1], [-11, -6, L1], [-5, -6.5, L1], [-6, -3, L1], [-10.5, -3.4, L1]],
      },
      {
        name: 'MASTER BEDROOM', floor: 'UPSTAIRS', objective: new V(1, L2 + 1.3, -9.4), zone: { x0: -4, x1: 6, z0: -9.8, z1: 0, y0: L2, y1: L2 + 3.2 },
        zoneDoors: [[1, 0, L2], [-4, -3, L2]],
        anchors: [[5.2, -6.4, 1, 0, L2], [-3.2, -8.2, -4, -3, L2], [5.2, -1, -4, -3, L2], [-3.2, -4.8, 1, -10, L2]],
        support: [[-9, -5, -4, -3, L2], [7.5, -6, 7.5, 0, L2], [-3.3, 1.3, -3.3, 6, L2], [2, 5.5, 2, 2.5, L2], [11.5, -5.5, 11.5, 0, L2]],
        secure: [[1, -3, L2], [-2, -6, L2], [3, -6.8, L2], [4, -3, L2], [-1, -2.6, L2]],
      },
    ];
    MAP.setSite = (i) => {
      const s = MAP.sites[i];
      MAP.site = i; MAP.objName = s.name; MAP.siteFloor = s.floor;
      MAP.objective = s.objective; MAP.zone = s.zone; MAP.zoneDoors = s.zoneDoors;
      MAP.anchors = s.anchors; MAP.support = s.support; MAP.secure = s.secure;
    };
    MAP.setSite(1);
    MAP.roam = [[-12, 1.25, -14, 1.25, L1], [12, 1.25, 14, 1.25, L1], [10.5, 4, 9, 10, L1], [-9, 5, -10, 10, L1], [-12, 1.25, -14, 1.25, L2],
      [9, 5, 9, 10, L2], [10, 6, 14, 6.2, LB], [-9.5, 5, -10, 2.5, LB], [2, 6, 2, 10, L1], [-9, -5, -9, 0, L2]];
    MAP.spawns = [
      { name: 'Front Lot', x: -2, z: -27, yaw: Math.PI },
      { name: 'Back Field', x: 2, z: 25, yaw: 0 },
      { name: 'West Road', x: -32, z: -2, yaw: -Math.PI / 2 },
      { name: 'East Barn', x: 32, z: 2, yaw: Math.PI / 2 },
    ];
    MAP.entries = [
      { name: 'Front Door', out: [-8, -13.5, 0], in: [-8, -7.2, 0] },
      { name: 'Dining Door', out: [7, -13.5, 0], in: [7.5, -7.5, 0] },
      { name: 'West Door', out: [-18, 1.25, 0], in: [-11, 1.25, 0] },
      { name: 'East Door', out: [17.5, 1.25, 0], in: [11, 1.25, 0] },
      { name: 'Balcony', out: [-15.4, 1.2, L2], in: [-11, 1.25, L2] },
      { name: 'Bulkhead', out: [23, 6.2, 0], in: [10, 6.2, LB] },
      { name: 'Garage Door', out: [9, 13.5, 0], in: [10.5, 4, 0] },
    ];
    MAP.camRooms = ['Bunker', 'Meeting Hall', 'Main Hall', 'Master Bedroom'];
    MAP.roomAt = (x, z, y) => {
      for (const r of rooms) if (G.roomIn(r, x, z, y)) return r.name;
      if (y > 1.5 && x < -14) return 'West Balcony';
      if (y < -0.5) return 'Bulkhead';
      if (z < -10) return 'Front Yard';
      if (z > 10) return 'Back Field';
      return x < 0 ? 'West Side' : 'East Side';
    };
    MAP.indoors = (x, z) => x > -14 && x < 14 && z > -10 && z < 10;
    MAP.surface = (x, z, y) => {
      if (MAP.indoors(x, z)) { for (const r of rooms) if (G.roomIn(r, x, z, y)) return G.PHYS[r.floor] || 'concrete'; return 'wood'; }
      if (y > 0.5) return 'wood';
      if (y < -0.5) return 'concrete';
      return 'dirt';
    };
  }

  // =============================================================== MAP REGISTRY / BUILD
  G.MAPS = [
    { id: 'harbor', name: 'HARBOR STREET OFFICES', desc: 'Office block · Server Room objective', build: buildHarbor },
    { id: 'warehouse', name: 'CANAL WAREHOUSE', desc: 'Container hall · Control Room objective', build: buildWarehouse },
    { id: 'chalet', name: 'SNOWPINE CHALET', desc: 'Mountain lodge · Trophy Room objective', build: buildChalet },
    { id: 'compound', name: 'CEDAR CREEK COMPOUND', desc: 'Three floors · Basement, ground floor and upstairs objectives', build: buildCompound },
  ];

  const sharedGeo = () => new Set(Object.values(G.geo));
  function disposeGroup(g) {
    const keep = sharedGeo();
    const sharedMat = new Set(Object.values(G.M).flat());
    const sharedTex = new Set(Object.values(G.T));
    g.traverse((o) => {
      if (o.geometry && !keep.has(o.geometry) && !o.geometry.userData.shared) o.geometry.dispose();
      for (const mat of (Array.isArray(o.material) ? o.material : o.material ? [o.material] : [])) {
        if (!sharedMat.has(mat)) {
          if (mat.map && !sharedTex.has(mat.map)) mat.map.dispose();
          mat.dispose();
        }
      }
    });
  }

  G.buildMap = function (parent, id) {
    const def = G.MAPS.find((m) => m.id === id) || G.MAPS[0];
    if (G.mapGroup) { parent.remove(G.mapGroup); disposeGroup(G.mapGroup); }
    scene = new THREE.Group();
    parent.add(scene);
    G.mapGroup = scene;
    batches = new Map();
    decor = new G.Parts();
    G.W.resetWorld();
    const MAP = (G.MAP = { lights: [], id: def.id, name: def.name });
    def.build(MAP);

    // ---------------- finalize static geometry
    const noShadow = ['grass', 'asphalt', 'sidewalk', 'rug', 'paintWhite', 'paintYellow', 'dirt', 'tile', 'tileDark', 'marble', 'woodFloor', 'carpetBlue', 'carpetRed', 'snow', 'water'];
    for (const [key, b] of batches) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.u, 2));
      g.setIndex(b.p.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(b.i, 1) : new THREE.Uint16BufferAttribute(b.i, 1));
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, G.M[key]);
      mesh.castShadow = !noShadow.includes(key);
      mesh.receiveShadow = true;
      scene.add(mesh);
    }
    scene.add(decor.build(true, true));
    G.W.buildPanelMeshes(scene);

    // sky dome
    const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 24, 16), new THREE.MeshBasicMaterial({ map: G.T.makeSky(MAP.env.sky), side: THREE.BackSide, fog: false, depthWrite: false }));
    sky.renderOrder = -1;
    scene.add(sky);
    MAP.rooms = MAP.rooms || [];
    return MAP;
  };
})();
