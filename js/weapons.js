'use strict';
// Weapon definitions, hitscan ballistics with wall penetration, grenades, hitboxes.
(function () {
  const G = window.G;
  const V = THREE.Vector3;

  G.WEAPONS = {
    ar: { key: 'ar', name: 'AR-7 CARBINE', model: 'rifle', sound: 'rifle', auto: true, rpm: 720, dmg: 40, pellets: 1, mag: 30, reserve: 150, reload: 2.3, reloadEmpty: 2.8,
      hip: 0.045, ads: 0.0025, move: 0.03, recoilV: 0.017, recoilH: 0.007, adsFov: 50, adsTime: 0.22, range: 150, wall: 14, fall: [30, 60, 0.75], hipPos: [0.2, -0.2, -0.52] },
    smg: { key: 'smg', name: 'K9 SMG', model: 'smg', sound: 'smg', auto: true, rpm: 900, dmg: 30, pellets: 1, mag: 32, reserve: 160, reload: 2.0, reloadEmpty: 2.4,
      hip: 0.032, ads: 0.004, move: 0.02, recoilV: 0.011, recoilH: 0.009, adsFov: 56, adsTime: 0.16, range: 100, wall: 11, fall: [14, 35, 0.6], hipPos: [0.18, -0.18, -0.46] },
    sg: { key: 'sg', name: 'M12 BREACHER', model: 'shotgun', sound: 'shotgun', auto: false, rpm: 72, dmg: 22, pellets: 8, mag: 7, reserve: 28, shell: 0.5,
      hip: 0.075, ads: 0.05, move: 0.02, recoilV: 0.075, recoilH: 0.02, adsFov: 60, adsTime: 0.24, range: 45, wall: 34, fall: [6, 18, 0.25], hipPos: [0.2, -0.2, -0.5] },
    pistol: { key: 'pistol', name: 'P-10 SIDEARM', model: 'pistol', sound: 'pistol', auto: false, rpm: 420, dmg: 42, pellets: 1, mag: 15, reserve: 60, reload: 1.6, reloadEmpty: 1.9,
      hip: 0.025, ads: 0.004, move: 0.015, recoilV: 0.028, recoilH: 0.01, adsFov: 62, adsTime: 0.15, range: 80, wall: 9, fall: [12, 30, 0.65], hipPos: [0.16, -0.16, -0.42] },
  };

  G.falloff = (def, d) => (d <= def.fall[0] ? 1 : d >= def.fall[1] ? def.fall[2] : G.lerp(1, def.fall[2], (d - def.fall[0]) / (def.fall[1] - def.fall[0])));

  // ---------------------------------------------------------------- HITBOXES
  // ent needs: pos, yaw, crouch(0..1), lean(-1..1) -> fills ent.head, chestA, chestB, legA, legB, eye
  const _r = new V();
  G.updateHitShapes = function (e) {
    const hipsY = G.lerp(0.95, 0.53, e.crouch);
    G.rightFrom(e.yaw, _r);
    const a = e.lean * 0.5, sa = Math.sin(a), ca = Math.cos(a);
    const p = e.pos;
    e.legA.set(p.x, p.y + 0.15, p.z);
    e.legB.set(p.x, p.y + hipsY - 0.05, p.z);
    e.chestA.set(p.x, p.y + hipsY + 0.05, p.z);
    e.chestB.set(p.x + _r.x * sa * 0.52, p.y + hipsY + 0.05 + ca * 0.52, p.z + _r.z * sa * 0.52);
    e.head.set(p.x + _r.x * sa * 0.77, p.y + hipsY + 0.05 + ca * 0.77, p.z + _r.z * sa * 0.77);
    e.eye.copy(e.head); e.eye.y += 0.03;
    const f = -Math.sin(e.yaw) * 0.07, fz = -Math.cos(e.yaw) * 0.07;
    e.eye.x += f; e.eye.z += fz;
  };

  // nearest character hit along a ray
  G.raycastEntities = function (ox, oy, oz, dx, dy, dz, maxT, shooter) {
    let best = maxT, hit = null;
    const headR = G.Mods && G.Mods.c.bigHeads ? 0.27 : 0.125;
    for (const e of G.Game.entities) {
      if (!e.alive || e === shooter) continue;
      // cheap reject
      const cx = e.pos.x - ox, cz = e.pos.z - oz;
      const along = cx * dx + cz * dz;
      if (along < -1 || along > best + 1) continue;
      let t = G.raySphere(ox, oy, oz, dx, dy, dz, e.head.x, e.head.y, e.head.z, e.isPlayer ? 0.125 : headR);
      if (t >= 0 && t < best) { best = t; hit = { e, t, part: 'head' }; }
      t = G.rayCapsule(ox, oy, oz, dx, dy, dz, e.chestA.x, e.chestA.y, e.chestA.z, e.chestB.x, e.chestB.y, e.chestB.z, 0.21);
      if (t >= 0 && t < best) { best = t; hit = { e, t, part: 'chest' }; }
      t = G.rayCapsule(ox, oy, oz, dx, dy, dz, e.legA.x, e.legA.y, e.legA.z, e.legB.x, e.legB.y, e.legB.z, 0.17);
      if (t >= 0 && t < best) { best = t; hit = { e, t, part: 'legs' }; }
    }
    return hit;
  };

  // ---------------------------------------------------------------- BULLETS
  // returns end point
  G.fireBullet = function (shooter, ox, oy, oz, dx, dy, dz, def, pelletIdx) {
    let dmg = def.dmg, wallDmg = def.wall, pens = 0, travelled = 0;
    let x = ox, y = oy, z = oz;
    const end = new V();
    const player = G.Game.player;
    for (let iter = 0; iter < 5; iter++) {
      const range = def.range - travelled;
      if (range <= 0) break;
      const wh = G.W.raycast(x, y, z, dx, dy, dz, range);
      const ch = G.raycastEntities(x, y, z, dx, dy, dz, wh ? wh.t : range, shooter);
      const gadget = G.Recon?.raycast(x, y, z, dx, dy, dz, Math.min(wh ? wh.t : range, ch ? ch.t : range));
      if (gadget) {
        end.set(x + dx * gadget.t, y + dy * gadget.t, z + dz * gadget.t);
        G.Recon.damage(gadget.device, dmg);
        break;
      }
      if (ch) {
        const hx = x + dx * ch.t, hy = y + dy * ch.t, hz = z + dz * ch.t;
        end.set(hx, hy, hz);
        const e = ch.e;
        const mine = shooter.isPlayer;
        if (mine && G.Mods.c.explosive) G.Grenades.miniBlast(end, shooter);
        if (G.Game.isEnemy(shooter, e) || G.Game.settings.ff) {
          const d = travelled + ch.t;
          let amt = dmg * G.falloff(def, d);
          if (ch.part === 'head') amt = 999;
          else if (ch.part === 'legs') amt *= 0.75;
          if (mine && G.Mods.c.oneShot) amt = 999;
          G.FX.blood(hx, hy, hz, dx, dy, dz);
          if (pelletIdx === 0 || pelletIdx === undefined) G.Audio.impact('flesh', end);
          e.takeDamage(amt, shooter, ch.part, dx, dz);
          if (shooter.isPlayer) G.Game.hitMarker(ch.part === 'head', !e.alive);
        } else {
          G.FX.dust.emit(hx, hy, hz, 0, 0.5, 0, 0.3, 0.6, 0.6, 0.6, 0.6, 3, 2);
        }
        break;
      }
      if (!wh) { end.set(x + dx * range, y + dy * range, z + dz * range); break; }
      end.set(wh.x, wh.y, wh.z);
      const s = wh.s, phys = s.phys;
      G.FX.impact(wh, phys, dx, dy, dz, (pelletIdx || 0) < 2 && Math.random() < 0.7);
      if (shooter.isPlayer && G.Mods.c.explosive && pens === 0) { G.Grenades.miniBlast(end, shooter); break; }
      if (s.type === 1) {
        if (s.kind === 'barricade') G.W.hitBarricade(s, wallDmg * 1.2, dx, dy, dz);
        else G.W.damageCell(s, wh.c, wallDmg, dx, dy, dz);
        if (!s.cells[wh.c]) G.Game.soundEvent(end, 18, shooter.team, 'break');
      }
      if (!s.pen || pens >= 2) break;
      // continue through: exit of the solid (or of the cell)
      let exitT;
      if (s.type === 1) {
        const b = G.W.cellBox(s, wh.c, [0, 0, 0, 0, 0, 0]);
        G.rayBox(x, y, z, dx, dy, dz, b[0], b[1], b[2], b[3], b[4], b[5], 1e9);
        exitT = G.hitExit;
      } else {
        G.rayBox(x, y, z, dx, dy, dz, s.x0, s.y0, s.z0, s.x1, s.y1, s.z1, 1e9);
        exitT = G.hitExit;
      }
      exitT = Math.max(exitT, wh.t) + 0.005;
      travelled += exitT;
      x += dx * exitT; y += dy * exitT; z += dz * exitT;
      dmg *= s.type === 1 ? 0.72 : 0.6;
      wallDmg *= 0.6;
      pens++;
      if (dmg < 5) break;
    }
    // near-miss whiz for the player
    if (player && player.alive && G.Game.isEnemy(shooter, player)) {
      const hp = player.head;
      const d = G.segPointDist(ox, oy, oz, end.x, end.y, end.z, hp.x, hp.y, hp.z);
      if (d < 1.4 && d > 0.15) {
        const toX = end.x - ox, toZ = end.z - oz;
        const r = G.rightFrom(player.yaw, new V());
        const side = Math.sign((hp.x - ox) * toZ - (hp.z - oz) * toX) * -1;
        G.Audio.whiz(side * Math.abs(r.x * toZ - r.z * toX) / Math.max(0.1, Math.hypot(toX, toZ)));
      }
    }
    return end;
  };

  // ---------------------------------------------------------------- GRENADES
  G.Grenades = {
    list: [],
    // remote = thrown by another player in multiplayer: we only show it; its owner applies damage/destruction
    throw(owner, pos, vel, remote) {
      const mesh = G.buildGrenade();
      mesh.position.copy(pos);
      G.scene.add(mesh);
      this.list.push({ owner, pos: pos.clone(), vel: vel.clone(), fuse: 2.2, mesh, spin: new V(G.randn() * 10, G.randn() * 10, G.randn() * 10), bounces: 0, remote: !!remote });
      if (!remote && G.Net && G.Net.inGame) G.Net.sendNade(owner, pos, vel);
    },
    clear() { for (const g of this.list) G.scene.remove(g.mesh); this.list = []; },
    update(dt) {
      for (let i = this.list.length - 1; i >= 0; i--) {
        const g = this.list[i];
        g.fuse -= dt;
        // sub-stepped movement with bouncing
        const steps = 3;
        for (let s = 0; s < steps; s++) {
          const h = dt / steps;
          g.vel.y -= 9.8 * h;
          const sp = g.vel.length();
          if (sp > 1e-3) {
            const d = sp * h;
            const hit = G.W.raycast(g.pos.x, g.pos.y, g.pos.z, g.vel.x / sp, g.vel.y / sp, g.vel.z / sp, d + 0.04);
            if (hit) {
              g.pos.set(hit.x + hit.nx * 0.04, hit.y + hit.ny * 0.04, hit.z + hit.nz * 0.04);
              const n = new V(hit.nx, hit.ny, hit.nz);
              const vn = g.vel.dot(n);
              g.vel.addScaledVector(n, -1.45 * vn).multiplyScalar(0.55);
              g.spin.multiplyScalar(0.6);
              if (Math.abs(vn) > 1.2 && g.bounces++ < 8) G.Audio.grenadeBounce(g.pos);
            } else g.pos.addScaledVector(g.vel, h);
          }
        }
        g.mesh.position.copy(g.pos);
        g.mesh.rotation.x += g.spin.x * dt; g.mesh.rotation.z += g.spin.z * dt;
        if (g.fuse <= 0) {
          this.explode(g);
          G.scene.remove(g.mesh);
          this.list.splice(i, 1);
        }
      }
    },
    // "explosive ammo" mod: small blast at the impact point
    lastSnd: 0,
    miniBlast(p, owner) {
      G.W.destroySphere(p.x, p.y, p.z, 0.6, null, 0, 0.2, 0);
      G.FX.miniBlast(p);
      const now = performance.now();
      if (now - this.lastSnd > 90) { this.lastSnd = now; G.Audio.blast(p); }
      G.Game.soundEvent(p, 40, owner.team, 'explosion');
      for (const e of G.Game.entities) {
        if (!e.alive || e === owner) continue;
        if (!G.Game.isEnemy(owner, e) && !G.Game.settings.ff) continue;
        const d = p.distanceTo(e.chestB);
        if (d > 1.8) continue;
        e.takeDamage(10 + 70 * (1 - d / 1.8), owner, 'blast', e.pos.x - p.x, e.pos.z - p.z);
        if (owner.isPlayer) G.Game.hitMarker(false, !e.alive);
      }
    },
    explode(g) {
      const p = g.pos;
      G.FX.explosion(p);
      G.Audio.explosion(p);
      if (g.remote) {
        const pl = G.Game.player;
        if (pl) { const d = pl.eye.distanceTo(p); if (d < 14) G.Game.shake(0.6 * (1 - d / 14)); }
        return;
      }
      G.W.destroySphere(p.x, p.y, p.z, 1.7, null, 0, 0.3, 0);
      G.Game.soundEvent(p, 70, g.owner.team, 'explosion');
      for (const e of G.Game.entities) {
        if (!e.alive) continue;
        const c = e.chestB, d = p.distanceTo(c);
        if (d > 5.5) continue;
        let k = 1 - d / 5.5;
        const blocked = !G.W.clear(p.x, p.y + 0.15, p.z, c.x, c.y, c.z);
        if (blocked) k *= 0.35;
        const dmg = 160 * k * k + (d < 1.2 ? 60 : 0);
        if (dmg > 3 && (G.Game.isEnemy(g.owner, e) || e === g.owner || G.Game.settings.ff)) e.takeDamage(dmg, g.owner, 'blast', c.x - p.x, c.z - p.z);
      }
      const pl = G.Game.player;
      if (pl) { const d = pl.eye.distanceTo(p); if (d < 14) G.Game.shake(0.6 * (1 - d / 14)); }
    },
  };
})();
