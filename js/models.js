'use strict';
// Procedural models: weapons (first & third person), operators, grenade.
(function () {
  const G = window.G;
  const V = THREE.Vector3;

  // ---------------------------------------------------------------- WEAPONS
  // Local space: forward = -Z, origin at rear of receiver.
  G.buildGun = function (kind, vm) {
    const M = G.M, P = new G.Parts();
    const group = new THREE.Group();
    const out = { group, kind, mag: null, pump: null, muzzle: new THREE.Object3D() };
    const B = (m, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) => P.box(m, x, y, z, sx, sy, sz, rx, ry, rz);

    const redDot = (y, z) => {
      B(M.gunDark, 0, y - 0.035, z, 0.026, 0.022, 0.05);
      P.add(G.geo.cylOpen, M.sightTube, 0, y, z, Math.PI / 2, 0, 0, 0.022, 0.075, 0.022);
      P.add(G.geo.torus, M.sightTube, 0, y, z + 0.037, 0, 0, 0, 0.0225, 0.0225, 0.03);
      P.add(G.geo.torus, M.sightTube, 0, y, z - 0.037, 0, 0, 0, 0.0225, 0.0225, 0.03);
      P.cyl(M.sightTube, 0.025, y, z, 0.007, 0.012, 'x');
      P.cyl(M.sightTube, 0, y + 0.025, z, 0.007, 0.01);
      if (vm) {
        const lens = new THREE.Mesh(G.geo.circle, M.sightGlass);
        lens.scale.setScalar(0.021); lens.position.set(0, y, z - 0.03);
        group.add(lens);
        const dot = new THREE.Mesh(G.geo.circle, M.redDot);
        dot.scale.setScalar(0.0011); dot.position.set(0, y, z - 0.034);
        dot.renderOrder = 10;
        group.add(dot);
      }
      out.sight = { y, z: z - 0.034 };
    };

    if (kind === 'rifle') {
      B(M.gunMetal, 0, -0.005, -0.12, 0.048, 0.06, 0.22);
      B(M.gunMetal, 0, 0.045, -0.15, 0.054, 0.05, 0.3);
      B(M.gunPoly, 0, 0.076, -0.22, 0.03, 0.012, 0.44);
      if (vm) for (let i = 0; i < 19; i++) B(M.gunPoly, 0, 0.084, -0.01 - i * 0.022, 0.034, 0.006, 0.008);
      B(M.gunTan, 0, 0.042, -0.44, 0.064, 0.064, 0.28);
      for (let i = 0; i < 4; i++) { B(M.gunDark, 0.032, 0.04, -0.35 - i * 0.055, 0.003, 0.02, 0.032); B(M.gunDark, -0.032, 0.04, -0.35 - i * 0.055, 0.003, 0.02, 0.032); }
      P.cyl(M.gunMetal, 0, 0.042, -0.67, 0.011, 0.2, 'z');
      B(M.gunMetal, 0, 0.052, -0.605, 0.026, 0.032, 0.026);
      P.cyl(M.gunDark, 0, 0.042, -0.79, 0.017, 0.065, 'z');
      if (vm) for (let i = 0; i < 3; i++) B(M.gunMetal, 0, 0.055, -0.77 - i * 0.015, 0.02, 0.006, 0.006);
      B(M.gunMetal, 0, -0.045, -0.19, 0.05, 0.04, 0.09);
      B(M.gunPoly, 0, -0.085, -0.055, 0.034, 0.1, 0.045, -0.35);
      B(M.gunMetal, 0, -0.058, -0.12, 0.012, 0.006, 0.07);
      B(M.gunMetal, 0, -0.045, -0.115, 0.004, 0.024, 0.004);
      P.cyl(M.gunMetal, 0, 0.035, 0.07, 0.016, 0.16, 'z');
      B(M.gunTan, 0, 0.02, 0.14, 0.044, 0.075, 0.14);
      B(M.gunDark, 0, 0.005, 0.215, 0.048, 0.13, 0.022);
      B(M.gunMetal, 0, 0.066, 0.005, 0.03, 0.012, 0.022);
      B(M.gunDark, 0.028, 0.045, -0.13, 0.002, 0.022, 0.06);
      P.cyl(M.gunPoly, 0, -0.012, -0.46, 0.015, 0.075);
      P.cyl(M.gunDark, 0.046, 0.04, -0.5, 0.012, 0.09, 'z');
      redDot(0.13, -0.12);
      // magazine
      const mag = new THREE.Group(); mag.position.set(0, -0.06, -0.19);
      const mp = new G.Parts();
      mp.box(M.gunPoly, 0, -0.05, 0.0, 0.03, 0.11, 0.07, 0.1);
      mp.box(M.gunPoly, 0, -0.13, -0.018, 0.03, 0.07, 0.068, 0.32);
      mp.box(M.gunDark, 0, -0.168, -0.03, 0.034, 0.012, 0.075, 0.32);
      if (vm) mp.box(M.gunBrass, 0, 0.004, 0.005, 0.012, 0.01, 0.05);
      mag.add(mp.build(!vm, !vm)); group.add(mag); out.mag = mag;
      out.muzzle.position.set(0, 0.042, -0.83);
      out.rightHand = new V(0, -0.08, -0.05); out.leftHand = new V(0, -0.035, -0.46);
      out.eject = new V(0.03, 0.045, -0.13);
    } else if (kind === 'smg') {
      B(M.gunPoly, 0, 0.02, -0.14, 0.052, 0.09, 0.3);
      B(M.gunDark, 0, 0.071, -0.16, 0.028, 0.01, 0.3);
      B(M.gunMetal, 0, 0.035, -0.33, 0.044, 0.05, 0.1);
      P.cyl(M.gunMetal, 0, 0.035, -0.41, 0.01, 0.08, 'z');
      P.cyl(M.gunDark, 0, 0.035, -0.455, 0.015, 0.035, 'z');
      B(M.gunPoly, 0, -0.08, -0.04, 0.034, 0.1, 0.045, -0.3);
      B(M.gunMetal, 0, -0.035, -0.1, 0.012, 0.006, 0.06);
      B(M.gunPoly, 0, -0.03, -0.33, 0.028, 0.07, 0.035, 0.15);
      P.cyl(M.gunMetal, 0.018, 0.03, 0.09, 0.005, 0.2, 'z');
      P.cyl(M.gunMetal, -0.018, 0.03, 0.09, 0.005, 0.2, 'z');
      B(M.gunPoly, 0, 0.0, 0.19, 0.05, 0.11, 0.014);
      B(M.gunDark, 0.027, 0.04, -0.12, 0.002, 0.02, 0.05);
      // holo sight
      const y = 0.113, z = -0.12;
      B(M.gunDark, 0, 0.085, z, 0.036, 0.018, 0.08);
      B(M.sightTube, 0.021, y, z, 0.004, 0.042, 0.07);
      B(M.sightTube, -0.021, y, z, 0.004, 0.042, 0.07);
      B(M.sightTube, 0, y + 0.023, z, 0.046, 0.005, 0.07);
      if (vm) {
        const glass = new THREE.Mesh(G.geo.plane, M.sightGlass);
        glass.scale.set(0.038, 0.036, 1); glass.position.set(0, y, z - 0.03); group.add(glass);
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.0034, 0.0042, 24), M.redDot);
        ring.position.set(0, y, z - 0.032); ring.renderOrder = 10; group.add(ring);
        const dot = new THREE.Mesh(G.geo.circle, M.redDot);
        dot.scale.setScalar(0.0008); dot.position.set(0, y, z - 0.032); dot.renderOrder = 10; group.add(dot);
      }
      out.sight = { y, z: z - 0.032 };
      const mag = new THREE.Group(); mag.position.set(0, -0.025, -0.2);
      const mp = new G.Parts();
      mp.box(M.gunPoly, 0, -0.095, 0, 0.028, 0.19, 0.042, 0.05);
      mp.box(M.gunDark, 0, -0.19, 0.004, 0.032, 0.012, 0.046, 0.05);
      mag.add(mp.build(!vm, !vm)); group.add(mag); out.mag = mag;
      out.muzzle.position.set(0, 0.035, -0.48);
      out.rightHand = new V(0, -0.075, -0.035); out.leftHand = new V(0, -0.04, -0.33);
      out.eject = new V(0.03, 0.04, -0.12);
    } else if (kind === 'shotgun') {
      B(M.gunMetal, 0, 0.02, -0.1, 0.05, 0.08, 0.24);
      P.cyl(M.gunMetal, 0, 0.05, -0.48, 0.013, 0.52, 'z');
      P.cyl(M.gunDark, 0, 0.016, -0.41, 0.012, 0.42, 'z');
      B(M.gunMetal, 0, 0.034, -0.63, 0.02, 0.04, 0.02);
      B(M.gunWood, 0, -0.01, 0.13, 0.046, 0.075, 0.28, 0.1);
      B(M.gunWood, 0, -0.065, 0.0, 0.036, 0.09, 0.06, -0.4);
      B(M.gunDark, 0, -0.03, 0.275, 0.05, 0.12, 0.022, 0.1);
      B(M.gunMetal, 0, -0.03, -0.06, 0.012, 0.006, 0.06);
      B(M.gunPoly, -0.03, 0.02, -0.1, 0.008, 0.05, 0.12);
      for (let i = 0; i < 4; i++) P.cyl(M.shell, -0.037, 0.02, -0.14 + i * 0.026, 0.009, 0.05);
      B(M.gunPoly, 0, 0.066, -0.1, 0.028, 0.01, 0.2);
      redDot(0.105, -0.08);
      const pump = new THREE.Group(); pump.position.set(0, 0.017, -0.36);
      const pp = new G.Parts();
      pp.cyl(M.gunPoly, 0, 0, 0, 0.025, 0.16, 'z');
      for (let i = 0; i < 5; i++) pp.add(G.geo.torus, M.gunDark, 0, 0, -0.06 + i * 0.03, 0, 0, 0, 0.025, 0.025, 0.04);
      pump.add(pp.build(!vm, !vm)); group.add(pump); out.pump = pump;
      out.muzzle.position.set(0, 0.05, -0.75);
      out.rightHand = new V(0, -0.06, 0.0); out.leftHand = new V(0, -0.012, -0.36);
      out.eject = new V(0.03, 0.03, -0.1);
    } else { // pistol
      B(M.gunMetal, 0, 0.035, -0.08, 0.03, 0.034, 0.19);
      for (let i = 0; i < 5; i++) { B(M.gunDark, 0.0152, 0.035, 0.0 - i * 0.008, 0.001, 0.026, 0.003); B(M.gunDark, -0.0152, 0.035, 0.0 - i * 0.008, 0.001, 0.026, 0.003); }
      B(M.gunPoly, 0, 0.008, -0.07, 0.028, 0.022, 0.16);
      B(M.gunPoly, 0, -0.05, 0.005, 0.031, 0.1, 0.048, -0.22);
      B(M.gunPoly, 0, -0.012, -0.075, 0.01, 0.006, 0.06);
      P.cyl(M.gunDark, 0, 0.035, -0.176, 0.007, 0.004, 'z');
      B(M.gunDark, 0.007, 0.056, 0.004, 0.006, 0.01, 0.008);
      B(M.gunDark, -0.007, 0.056, 0.004, 0.006, 0.01, 0.008);
      B(M.gunDark, 0, 0.055, -0.165, 0.004, 0.009, 0.006);
      if (vm) {
        const d1 = new THREE.Mesh(G.geo.circle, M.redDot); d1.scale.setScalar(0.0012); d1.position.set(0, 0.057, -0.1686); group.add(d1);
      }
      out.sight = { y: 0.058, z: -0.165 };
      const mag = new THREE.Group(); mag.position.set(0, -0.01, 0.005);
      const mp = new G.Parts();
      mp.box(M.gunDark, 0, -0.1, 0.022, 0.033, 0.012, 0.052, -0.22);
      mag.add(mp.build(!vm, !vm)); group.add(mag); out.mag = mag;
      out.muzzle.position.set(0, 0.035, -0.19);
      out.rightHand = new V(0, -0.045, 0.012); out.leftHand = new V(-0.022, -0.06, 0.02);
      out.eject = new V(0.02, 0.045, -0.06);
    }
    const body = P.build(!vm, !vm);
    group.add(body);
    group.add(out.muzzle);
    return out;
  };

  // first-person arms attached to a gun
  G.buildVMArms = function (gun, team) {
    const M = G.M, P = new G.Parts();
    const sleeve = team === 'atk' ? M.uniAtk : M.uniDef;
    const glove = M.glove;
    const rh = gun.rightHand, lh = gun.leftHand;
    const pistol = gun.kind === 'pistol';
    // right arm
    const rw = [rh.x + 0.012, rh.y - 0.035, rh.z + 0.075];
    const re = [0.13, -0.27, rh.z + 0.33];
    const rs = [0.2, -0.44, rh.z + 0.62];
    P.limb(sleeve, rs, re, 0.052); P.limb(sleeve, re, [rw[0] + 0.01, rw[1] - 0.01, rw[2] + 0.04], 0.042);
    P.limb(glove, [rw[0] + 0.01, rw[1] - 0.01, rw[2] + 0.04], rw, 0.036);
    P.box(glove, rh.x + 0.004, rh.y - 0.005, rh.z + 0.012, 0.05, 0.085, 0.06, -0.3);
    P.box(glove, rh.x - 0.002, rh.y - 0.002, rh.z - 0.03, 0.046, 0.075, 0.024, -0.3);
    P.limb(glove, [rh.x + 0.022, rh.y + 0.03, rh.z + 0.0], [rh.x + 0.02, rh.y + 0.04, rh.z - 0.05], 0.011); // thumb
    P.limb(glove, [rh.x + 0.02, rh.y + 0.005, rh.z - 0.05], [rh.x + 0.02, rh.y + 0.03, rh.z - 0.07], 0.009); // trigger finger
    // left arm
    const lw = [lh.x - 0.035, lh.y - 0.045, lh.z + 0.06];
    const le = pistol ? [-0.1, -0.26, lh.z + 0.28] : [lh.x - 0.17, -0.25, lh.z + 0.28];
    const ls = [-0.24, -0.46, Math.max(lh.z + 0.55, 0.35)];
    P.limb(sleeve, ls, le, 0.052); P.limb(sleeve, le, [lw[0] - 0.01, lw[1] - 0.01, lw[2] + 0.04], 0.042);
    P.limb(glove, [lw[0] - 0.01, lw[1] - 0.01, lw[2] + 0.04], lw, 0.036);
    P.cyl(M.gunDark, lw[0] + 0.004, lw[1] + 0.012, lw[2] + 0.05, 0.03, 0.022, 'z');
    if (pistol) {
      P.box(glove, lh.x, lh.y, lh.z, 0.045, 0.08, 0.06, -0.2);
    } else {
      P.box(glove, lh.x - 0.004, lh.y - 0.012, lh.z + 0.01, 0.05, 0.05, 0.085);
      P.box(glove, lh.x + 0.028, lh.y + 0.02, lh.z - 0.005, 0.018, 0.045, 0.08);
      P.box(glove, lh.x - 0.03, lh.y + 0.018, lh.z + 0.0, 0.016, 0.035, 0.07);
    }
    const g = P.build(false, false);
    gun.group.add(g);
    return g;
  };

  // ---------------------------------------------------------------- OPERATORS
  G.buildCharacter = function (team, gunKind) {
    const M = G.M, isAtk = team === 'atk';
    const uni = isAtk ? M.uniAtk : M.uniDef, vest = isAtk ? M.vestAtk : M.vestDef;
    const skin = G.pick([M.skin1, M.skin2, M.skin3]);
    const helm = isAtk ? M.helmAtk : M.helmDef, band = isAtk ? M.bandAtk : M.bandDef;
    const dark = M.plasticBlack, glove = isAtk ? M.gloveTan : M.glove, boot = M.boot;
    const face = Math.random() < 0.5 ? M.balaclava : skin;

    const root = new THREE.Group();
    const body = new THREE.Group(); root.add(body);
    const hips = new THREE.Group(); hips.position.y = 0.95; body.add(hips);

    let P = new G.Parts();
    P.box(uni, 0, 0.02, 0, 0.34, 0.2, 0.23);
    P.box(dark, 0, 0.1, 0, 0.36, 0.05, 0.245);
    P.box(M.gunPoly, 0.2, -0.08, 0.0, 0.05, 0.17, 0.12);
    P.box(vest, -0.19, -0.02, -0.04, 0.05, 0.12, 0.1);
    hips.add(P.build());

    const legs = [];
    for (const s of [-1, 1]) {
      const hip = new THREE.Group(); hip.position.set(0.1 * s, -0.03, 0); hips.add(hip);
      P = new G.Parts();
      P.limb(uni, [0, 0.02, 0], [0, -0.44, 0], 0.088);
      P.box(vest, 0.06 * s, -0.18, -0.01, 0.03, 0.1, 0.12);
      hip.add(P.build());
      const knee = new THREE.Group(); knee.position.y = -0.44; hip.add(knee);
      P = new G.Parts();
      P.limb(uni, [0, 0, 0], [0, -0.38, 0], 0.072);
      P.box(dark, 0, -0.02, -0.075, 0.12, 0.13, 0.05);
      P.box(boot, 0, -0.43, -0.04, 0.12, 0.1, 0.27);
      P.box(boot, 0, -0.36, 0.0, 0.13, 0.1, 0.15);
      P.box(dark, 0, -0.475, -0.04, 0.125, 0.02, 0.28);
      knee.add(P.build());
      legs.push({ hip, knee });
    }

    const spine = new THREE.Group(); spine.position.y = 0.05; hips.add(spine);
    P = new G.Parts();
    P.box(uni, 0, 0.28, 0, 0.36, 0.48, 0.22);
    P.box(vest, 0, 0.31, 0, 0.41, 0.36, 0.29);
    for (let i = -1; i <= 1; i++) P.box(vest, i * 0.105, 0.2, -0.165, 0.088, 0.13, 0.055);
    P.box(vest, 0.11, 0.39, -0.162, 0.1, 0.08, 0.04);
    P.box(vest, -0.11, 0.4, -0.16, 0.08, 0.06, 0.035);
    P.box(vest, -0.235, 0.3, 0, 0.06, 0.14, 0.12);
    P.box(dark, -0.235, 0.46, 0.04, 0.012, 0.2, 0.012);
    P.box(vest, 0, 0.3, 0.19, 0.3, 0.32, 0.09);
    P.box(vest, 0.15, 0.52, 0, 0.1, 0.05, 0.27);
    P.box(vest, -0.15, 0.52, 0, 0.1, 0.05, 0.27);
    P.box(band, 0, 0.44, 0.24, 0.12, 0.05, 0.01);
    P.cyl(face === skin ? skin : M.balaclava, 0, 0.61, 0, 0.058, 0.12);
    spine.add(P.build());

    const head = new THREE.Group(); head.position.y = 0.72; spine.add(head);
    P = new G.Parts();
    P.add(G.geo.sph, face, 0, 0, -0.005, 0, 0, 0, 0.098, 0.118, 0.108);
    if (face === skin) {
      P.box(skin, 0, -0.005, -0.105, 0.028, 0.035, 0.03); // nose
      // lower-face respirator / shemagh
      P.box(isAtk ? M.vestAtk : M.plasticBlack, 0, -0.065, -0.055, 0.17, 0.085, 0.11);
      P.cyl(M.plasticBlack, 0, -0.065, -0.115, 0.028, 0.03, 'z');
    }
    P.add(G.geo.dome, helm, 0, 0.02, 0.005, 0, 0, 0, 0.128, 0.13, 0.135);
    P.box(helm, 0, 0.04, -0.118, 0.2, 0.03, 0.03);
    P.box(dark, 0.125, 0.04, 0, 0.012, 0.025, 0.14);
    P.box(dark, -0.125, 0.04, 0, 0.012, 0.025, 0.14);
    P.box(dark, 0, 0.11, -0.1, 0.05, 0.04, 0.04, 0.3);
    P.box(M.lens, 0, 0.01, -0.1, 0.17, 0.05, 0.05);
    P.box(dark, 0, 0.01, -0.07, 0.19, 0.02, 0.1);
    P.cyl(dark, 0.108, -0.015, 0, 0.042, 0.035, 'x');
    P.cyl(dark, -0.108, -0.015, 0, 0.042, 0.035, 'x');
    P.box(dark, 0.07, -0.06, -0.085, 0.01, 0.01, 0.06, 0, 0.6, 0);
    head.add(P.build());

    const aim = new THREE.Group(); aim.position.y = 0.5; spine.add(aim);
    const gun = G.buildGun(gunKind, false);
    const go = new V(0.1, -0.07, -0.1);
    gun.group.position.copy(go);
    aim.add(gun.group);
    const rh = gun.rightHand.clone().add(go), lh = gun.leftHand.clone().add(go);
    P = new G.Parts();
    const rs = [0.2, 0, 0.02], ls = [-0.2, 0, 0.02];
    const re = [(rs[0] + rh.x) / 2 + 0.11, (rs[1] + rh.y) / 2 - 0.1, (rs[2] + rh.z) / 2 + 0.03];
    const le = [(ls[0] + lh.x) / 2 - 0.1, (ls[1] + lh.y) / 2 - 0.12, (ls[2] + lh.z) / 2 + 0.02];
    P.limb(uni, rs, re, 0.06); P.limb(uni, re, [rh.x, rh.y, rh.z + 0.04], 0.05);
    P.limb(uni, ls, le, 0.06); P.limb(uni, le, [lh.x, lh.y, lh.z + 0.04], 0.05);
    const bandAt = (a, b) => [a[0] + (b[0] - a[0]) * 0.35, a[1] + (b[1] - a[1]) * 0.35, a[2] + (b[2] - a[2]) * 0.35];
    P.limb(band, bandAt(rs, re), bandAt(bandAt(rs, re), re), 0.064);
    P.limb(band, bandAt(ls, le), bandAt(bandAt(ls, le), le), 0.064);
    P.box(glove, rh.x, rh.y, rh.z, 0.07, 0.09, 0.1);
    P.box(glove, lh.x, lh.y, lh.z, 0.07, 0.08, 0.1);
    P.box(vest, 0.2, 0.0, 0.02, 0.14, 0.08, 0.16); // shoulder pad
    P.box(vest, -0.2, 0.0, 0.02, 0.14, 0.08, 0.16);
    aim.add(P.build());

    // layer 1 = defenders, layer 2 = attackers (used by the chams render pass)
    const layer = isAtk ? 2 : 1;
    root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.layers.enable(layer); } });
    return { root, body, hips, legs, spine, head, aim, gun, muzzle: gun.muzzle, phase: Math.random() * 6, melee: 0 };
  };

  // Procedural animation. st: {speed, fwd, crouch, lean, pitch, yaw, dead, deadT, fallDir}
  G.animateCharacter = function (ch, st, dt) {
    ch.root.position.copy(st.pos);
    ch.root.rotation.y = st.yaw;
    if (st.dead) {
      const t = G.clamp(st.deadT / 0.75, 0, 1);
      const e = t * t;
      const fd = st.fallDir;
      ch.body.rotation.set(fd.x * 1.52 * e, 0, fd.z * 1.5 * e);
      ch.body.position.y = -0.05 * e;
      ch.hips.position.y = G.lerp(ch.hips.position.y, 0.9, 0.2);
      ch.legs[0].knee.rotation.x = G.lerp(0, -0.6, e); ch.legs[1].knee.rotation.x = G.lerp(0, -0.2, e);
      ch.legs[0].hip.rotation.x = 0.3 * e; ch.legs[1].hip.rotation.x = -0.1 * e;
      ch.aim.rotation.x = G.lerp(ch.aim.rotation.x, -0.9, 0.1);
      ch.spine.rotation.z = G.lerp(ch.spine.rotation.z, 0, 0.1);
      ch.head.rotation.x = 0.3 * e;
      return;
    }
    ch.body.rotation.set(0, 0, 0); ch.body.position.y = 0;
    const c = st.crouch, sp = st.speed;
    const moving = Math.min(1, sp / 3);
    ch.phase += dt * sp * 4.1;
    const sw = Math.sin(ch.phase), cw = Math.cos(ch.phase);
    const dir = st.fwd >= -0.2 ? 1 : -1;
    const amp = moving * (0.55 - 0.25 * c);
    const hipBase = 1.2 * c, kneeBase = -2.05 * c;
    ch.legs[0].hip.rotation.x = hipBase + sw * amp * dir;
    ch.legs[1].hip.rotation.x = hipBase - sw * amp * dir;
    ch.legs[0].knee.rotation.x = kneeBase - Math.max(0, -sw * dir) * 0.8 * moving - 0.1 * moving;
    ch.legs[1].knee.rotation.x = kneeBase - Math.max(0, sw * dir) * 0.8 * moving - 0.1 * moving;
    ch.hips.position.y = G.lerp(0.95, 0.53, c) - Math.abs(cw) * 0.035 * moving;
    ch.hips.rotation.y = sw * 0.08 * moving;
    ch.spine.rotation.z = -st.lean * 0.5;
    ch.spine.rotation.x = -c * 0.12 + moving * 0.06;
    ch.spine.rotation.y = -sw * 0.06 * moving;
    ch.aim.rotation.x = st.pitch + c * 0.12 - moving * 0.06;
    ch.head.rotation.x = st.pitch * 0.5;
    // melee swing
    if (ch.melee > 0) {
      ch.melee -= dt;
      const k = Math.sin(G.clamp(1 - ch.melee / 0.4, 0, 1) * Math.PI);
      ch.aim.rotation.y = k * 0.6; ch.aim.position.z = -k * 0.15;
    } else { ch.aim.rotation.y = 0; ch.aim.position.z = 0; }
  };

  G.buildGrenade = function () {
    const P = new G.Parts(), M = G.M;
    P.add(G.geo.sphLow, M.grenade, 0, 0, 0, 0, 0, 0, 0.035, 0.042, 0.035);
    P.cyl(M.gunMetal, 0, 0.045, 0, 0.012, 0.02);
    P.box(M.gunMetal, 0.012, 0.03, 0, 0.006, 0.05, 0.012, 0, 0, -0.3);
    P.add(G.geo.torus, M.gunMetal, -0.015, 0.058, 0, Math.PI / 2, 0, 0, 0.01, 0.01, 0.01);
    return P.build(true, false);
  };
})();
