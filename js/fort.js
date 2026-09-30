'use strict';
// Fortification: defenders reinforce soft walls (steel plating: bulletproof, can't be smashed) and
// barricade open doorways. Hold T (controller: hold X, touch: FORTIFY). Defender bots fortify
// the walls and doors around the objective during the preparation phase.
(function () {
  const G = window.G;
  const V = THREE.Vector3;
  const $ = (id) => document.getElementById(id);
  const REACH = 2.3;      // how far away you can fortify from
  const SECTION = 1.75;   // width of one reinforcement (m)
  const T_REINF = 2.2, T_BAR = 1.0; // hold times (s)
  const _d = new V();

  const F = (G.Fort = {
    group: null, target: null, holdT: 0, tickT: 0, roundT: 0, plans: [], ui: {},

    init(scene) {
      this.group = new THREE.Group();
      scene.add(this.group);
      this.plate = new THREE.MeshStandardMaterial({ map: G.T.brushed, color: 0x8b949c, roughness: 0.5, metalness: 0.55 });
      this.rib = G.M.darkMetal;
    },

    // ---------------------------------------------------------------- rounds
    reset() {
      if (this.group) for (let i = this.group.children.length - 1; i >= 0; i--) this.group.remove(this.group.children[i]);
      this.plans = []; this.target = null; this.holdT = 0; this.roundT = 0;
    },
    startRound() {
      const Gm = G.Game;
      this.roundT = 0; this.plans = [];
      const defs = Gm.entities.filter((e) => e.team === 'def').length || 1;
      for (const e of Gm.entities) {
        e.fortR = G.clamp(Math.ceil(8 / defs), 2, 8);
        e.fortB = Math.max(2, Math.ceil(4 / defs));
      }
      this.planBots();
    },

    // reinforceable wall sections: full-height soft wall pieces, cut into ~1.75 m strips
    sectionsOf(p) {
      if (p.kind !== 'soft' || p.y1 - p.y0 < 2.4 || p.u1 - p.u0 < 0.9) return [];
      const n = Math.max(1, Math.round((p.u1 - p.u0) / SECTION)), per = p.cols / n, out = [];
      for (let s = 0; s < n; s++) out.push({ k: 'r', p, c0: Math.round(s * per), c1: Math.round((s + 1) * per) - 1 });
      return out;
    },
    sectionAt(p, ci) {
      const col = ci % p.cols;
      const sec = this.sectionsOf(p).find((s) => col >= s.c0 && col <= s.c1);
      if (!sec) return null;
      for (let r = 0; r < p.rows && !sec.bad; r++) for (let c = sec.c0; c <= sec.c1; c++) {
        const i = r * p.cols + c;
        if (p.rf && p.rf[i]) { sec.bad = 'ALREADY REINFORCED'; break; }
        if (!p.cells[i]) { sec.bad = 'WALL TOO DAMAGED TO REINFORCE'; break; }
      }
      return sec;
    },
    center(t) {
      const p = t.p;
      if (t.k === 'b') return new V((p.x0 + p.x1) / 2, p.y0 + 1.0, (p.z0 + p.z1) / 2);
      const u = p.u0 + ((t.c0 + t.c1 + 1) / 2) * p.cw, c = (p.c0 + p.c1) / 2;
      return p.axis === 'x' ? new V(u, p.y0 + 1.4, c) : new V(c, p.y0 + 1.4, u);
    },

    // ---------------------------------------------------------------- actions
    reinforce(p, c0, c1, net) {
      if (!p || p.kind !== 'soft') return false;
      c0 = G.clamp(c0 | 0, 0, p.cols - 1); c1 = G.clamp(c1 | 0, c0, p.cols - 1);
      if (!p.rf) p.rf = new Uint8Array(p.cells.length);
      if (!net) {
        const sec = this.sectionAt(p, c0);
        if (!sec || sec.bad) return false;
      }
      for (let r = 0; r < p.rows; r++) for (let c = c0; c <= c1; c++) {
        const i = r * p.cols + c;
        if (!p.cells[i]) G.W.restoreCell(p, i);
        p.rf[i] = 1;
      }
      this.buildPlates(p, c0, c1);
      const at = this.center({ k: 'r', p, c0, c1 });
      G.Audio.impact('metal', at); setTimeout(() => G.Audio.impact('metal', at), 90);
      if (G.Perf) G.Perf.shadowDirty = true;
      if (!net) this.send('r', p, c0, c1);
      return true;
    },
    placeBar(p, net) {
      if (!p || !p.optional || p.placed) return false;
      if (!net && this.blocked(p)) return false;
      G.W.placeOptional(p);
      const at = this.center({ k: 'b', p });
      G.Audio.impact('wood', at); setTimeout(() => G.Audio.impact('wood', at), 120);
      if (!net) this.send('b', p, 0, 0);
      return true;
    },
    blocked(p) {
      for (const e of G.Game.entities) {
        if (!e.alive) continue;
        if (e.pos.x > p.x0 - 0.34 && e.pos.x < p.x1 + 0.34 && e.pos.z > p.z0 - 0.34 && e.pos.z < p.z1 + 0.34) return true;
      }
      return false;
    },
    send(k, p, a, b) {
      const Gm = G.Game;
      if (Gm.mp && G.Net && G.Net.inGame) G.Net.emit({ t: 'fort', rn: Gm.round, k, p: p.id, a, b });
    },
    applyNet(d) {
      const p = G.W.panels[d.p | 0];
      if (!p) return;
      if (d.k === 'b') this.placeBar(p, true);
      else if (d.k === 'r') this.reinforce(p, Number(d.a) || 0, Number(d.b) || 0, true);
    },

    // steel plates on both faces, with ribs
    buildPlates(p, c0, c1) {
      const u0 = p.u0 + c0 * p.cw, u1 = p.u0 + (c1 + 1) * p.cw, um = (u0 + u1) / 2, len = u1 - u0 - 0.01;
      const y0 = p.y0, y1 = p.y1, h = y1 - y0 - 0.01, ym = (y0 + y1) / 2;
      const g = new THREE.Group();
      const add = (mat, u, y, c, su, sy, sc) => {
        const m = new THREE.Mesh(G.geo.box, mat);
        if (p.axis === 'x') { m.position.set(u, y, c); m.scale.set(su, sy, sc); }
        else { m.position.set(c, y, u); m.scale.set(sc, sy, su); }
        m.receiveShadow = true;
        g.add(m);
      };
      for (const side of [-1, 1]) {
        const face = side < 0 ? p.c0 : p.c1;
        add(this.plate, um, ym, face + side * 0.012, len, h, 0.022);
        for (const ry of [0.45, 1.35, 2.25]) if (y0 + ry < y1 - 0.2) add(this.rib, um, y0 + ry, face + side * 0.03, len, 0.09, 0.03);
        for (const k of [0.02, 0.5, 0.98]) add(this.rib, u0 + (u1 - u0) * k, ym, face + side * 0.03, 0.06, h, 0.03);
      }
      this.group.add(g);
    },

    // ---------------------------------------------------------------- defender bots
    planBots() {
      const Gm = G.Game;
      if (Gm.hackerMode || (Gm.mp && !G.Net.isHost)) return;
      const bots = Gm.bots.filter((b) => b.team === 'def' && !b.puppet);
      if (!bots.length) return;
      const z = G.MAP.zone, cx = (z.x0 + z.x1) / 2, cz = (z.z0 + z.z1) / 2, zy = (z.y0 || 0) + 1.4;
      const walls = [];
      for (const p of G.W.panels) for (const s of this.sectionsOf(p)) {
        const c = this.center(s), d = Math.hypot(c.x - cx, c.z - cz) + Math.abs(c.y - zy) * 2.5;
        if (d < 11) walls.push({ s, d: d + Math.random() * 3 });
      }
      walls.sort((a, b) => a.d - b.d);
      const doors = [];
      for (const p of G.W.panels) {
        if (!p.optional) continue;
        const c = this.center({ k: 'b', p });
        // objective-room doors first, then other doors nearby
        const dz = Math.min(...(G.MAP.zoneDoors || []).map((q) => Math.hypot(c.x - q[0], c.z - q[1])), 99);
        if (Math.abs(c.y - (zy - 0.4)) > 1.5) continue; // same floor as the objective
        const dc = Math.hypot(c.x - cx, c.z - cz);
        if (dz < 2.6 || dc < 9) doors.push({ p, d: (dz < 2.6 ? dz : 3 + dc) + Math.random() });
      }
      doors.sort((a, b) => a.d - b.d);
      const prep = Gm.mp ? 13 : 26;
      let wi = 0, di = 0;
      for (const b of bots) {
        for (let k = 0; k < b.fortR && wi < walls.length; k++) this.plans.push({ t: G.rand(1.5, prep), bot: b, k: 'r', s: walls[wi++].s });
        for (let k = 0; k < b.fortB && di < doors.length; k++) this.plans.push({ t: G.rand(1, prep * 0.6), bot: b, k: 'b', p: doors[di++].p });
      }
    },
    runPlans() {
      for (const pl of this.plans) {
        if (pl.done || this.roundT < pl.t) continue;
        pl.done = true;
        if (!pl.bot.alive) continue;
        if (pl.k === 'r') { const sec = this.sectionAt(pl.s.p, pl.s.c0); if (sec && !sec.bad) this.reinforce(sec.p, sec.c0, sec.c1); }
        else if (this.blocked(pl.p)) { pl.done = false; pl.t += 2; }
        else this.placeBar(pl.p);
      }
    },

    // ---------------------------------------------------------------- local player
    findTarget(p) {
      const dir = G.dirFrom(p.yaw, p.pitch, _d), e = p.eye;
      const h = G.W.raycast(e.x, e.y, e.z, dir.x, dir.y, dir.z, REACH);
      let best = null, bd = h ? h.t + 0.05 : REACH;
      for (const q of G.W.panels) {
        if (!q.optional || q.placed) continue;
        const t = G.rayBox(e.x, e.y, e.z, dir.x, dir.y, dir.z, q.x0 - 0.06, q.y0 - 0.2, q.z0 - 0.06, q.x1 + 0.06, q.y1, q.z1 + 0.06, bd);
        if (t >= 0 && t < bd) { bd = t; best = { k: 'b', p: q }; }
      }
      if (!best && h && h.s.type === 1 && h.s.kind === 'soft') best = this.sectionAt(h.s, h.c);
      return best;
    },
    update(dt) {
      const Gm = G.Game, p = Gm.player, I = G.Input;
      const active = Gm.state === 'prep' || Gm.state === 'live';
      if (active) { this.roundT += dt; this.runPlans(); }
      let tg = null;
      if (active && p.alive && p.team === 'def' && !Gm.hackerMode && !G.Recon.active && !(Gm.mp && Gm.paused)) tg = this.findTarget(p);
      if (tg && !tg.bad) {
        if (tg.k === 'r' && !(p.fortR > 0)) tg.bad = 'NO REINFORCEMENTS LEFT';
        if (tg.k === 'b' && !(p.fortB > 0)) tg.bad = 'NO BARRICADES LEFT';
        if (tg.k === 'b' && !tg.bad && this.blocked(tg.p)) tg.bad = 'DOORWAY BLOCKED';
      }
      const prev = this.target;
      const same = tg && prev && tg.k === prev.k && tg.p === prev.p && tg.c0 === prev.c0;
      this.target = tg && !tg.bad ? tg : null;
      const need = tg && tg.k === 'r' ? T_REINF : T_BAR;
      const hold = this.target && I.keys.KeyT && !p.busy;
      if (!hold || !same) this.holdT = 0;
      if (hold) {
        this.holdT += dt;
        this.tickT -= dt;
        if (this.tickT <= 0) { this.tickT = tg.k === 'r' ? 0.32 : 0.25; G.Audio.impact(tg.k === 'r' ? 'metal' : 'wood', this.center(tg)); }
        if (this.holdT >= need) {
          const ok = tg.k === 'r' ? this.reinforce(tg.p, tg.c0, tg.c1) : this.placeBar(tg.p);
          if (ok) { if (tg.k === 'r') p.fortR--; else p.fortB--; if (G.Pad) G.Pad.rumble(0.15, 0.4, 0.3); }
          this.holdT = 0;
        }
      }
      this.draw(tg, need);
    },
    draw(tg, need) {
      const ui = this.ui, p = G.Game.player;
      const pad = G.Pad && G.Pad.active, touch = G.Touch.enabled && !pad;
      const key = pad ? 'HOLD X' : touch ? 'HOLD FORTIFY' : 'HOLD T';
      let txt = '';
      if (tg) txt = tg.bad ? tg.bad : tg.k === 'r' ? `${key} · REINFORCE WALL · ${p.fortR} LEFT` : `${key} · BARRICADE DOOR · ${p.fortB} LEFT`;
      if (ui.txt !== txt) {
        ui.txt = txt;
        $('fortText').textContent = txt;
        $('fortPrompt').classList.toggle('show', !!txt);
        $('fortPrompt').classList.toggle('bad', !!(tg && tg.bad));
      }
      const f = Math.round(Math.min(1, this.holdT / need) * 50) / 50;
      if (ui.f !== f) { ui.f = f; $('fortFill').style.transform = `scaleX(${f})`; }
      const ok = !!this.target;
      if (ui.ok !== ok) { ui.ok = ok; const b = $('tFort'); if (b) b.classList.toggle('show', ok); }
    },
    hideUI() { this.target = null; this.holdT = 0; this.draw(null, 1); },
  });
})();
