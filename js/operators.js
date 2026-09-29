'use strict';
(function () {
  const G = window.G, V = THREE.Vector3;
  const O = (G.Operators = {
    roster: {
      sledge: { name: 'MAUL', ability: 'BREACHING HAMMER', charges: 12, cooldown: 1.1 },
      ash: { name: 'CINDER', ability: 'BREACHING ROUND', charges: 2, cooldown: 2.5 },
      doc: { name: 'MENDER', ability: 'STIM PISTOL', charges: 3, cooldown: 4 },
      pulse: { name: 'SONAR', ability: 'HEARTBEAT SENSOR', charges: Infinity, cooldown: 12 },
    },
    marks: new Map(), rounds: [],
    clear() {
      for (const r of this.rounds) r.mesh.removeFromParent();
      this.rounds = []; this.marks.clear();
      const el = document.getElementById('intelMarkers'); if (el) el.replaceChildren();
    },
    reset() {
      this.clear();
      for (const e of G.Game.entities) {
        const id = e.isPlayer ? G.Game.settings.operator : (e.team === 'atk' ? ['sledge', 'ash'] : ['doc', 'pulse'])[G.Game.bots.indexOf(e) % 2];
        e.operator = this.roster[id] ? id : 'sledge';
        e.abilityCharges = this.roster[e.operator].charges; e.abilityCd = 0; e.sensorT = 0; e.gadgetThink = 1;
      }
      document.getElementById('opName').textContent = this.roster[G.Game.player.operator].name;
    },
    mark(e, duration) {
      this.marks.set(e, { pos: e.chestB.clone(), until: G.time + duration });
      if (!G.Game.hackerMode) for (const b of G.Game.bots) {
        if (b.alive && b.team === G.Game.player.team) { b.alertPos.copy(e.pos); b.alertT = G.time; b.alertKind = 'scan'; }
      }
    },
    use(e) {
      if (!e.alive || G.Game.state !== 'live' || e.abilityCd > 0 || e.abilityCharges <= 0 || (e.isPlayer && (G.Recon.active || e.busy))) return false;
      const spec = this.roster[e.operator];
      const dir = G.dirFrom(e.isPlayer ? e.yaw : e.aimYaw, e.isPlayer ? e.pitch : e.aimPitch, new V());
      const eye = e.eye;
      if (e.operator === 'sledge') {
        const h = G.W.raycast(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, 2.3);
        if (!h || h.s.type !== 1) { if (e.isPlayer) G.Game.big('NO BREACHABLE SURFACE', 'Hammer works on soft walls and barricades'); return false; }
        this.breach(h, dir, 1.1);
        G.Audio.swing(eye, e.isPlayer); G.Audio.breakWall(new V(h.x, h.y, h.z));
        if (e.isPlayer) { e.meleeT = 0.55; e.meleeDone = true; G.Game.shake(0.12); }
        else e.model.melee = 0.5;
      } else if (e.operator === 'ash') {
        const h = G.W.raycast(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, 45);
        if (!h) { if (e.isPlayer) G.Game.big('AIM AT A SURFACE', 'Breaching rounds detonate on impact'); return false; }
        const mesh = new THREE.Mesh(G.geo.sphLow, G.M.lightAmber); mesh.scale.setScalar(0.065); mesh.position.copy(eye); G.scene.add(mesh);
        this.rounds.push({ mesh, from: eye.clone(), to: new V(h.x, h.y, h.z), h, dir, owner: e, age: 0, duration: Math.max(0.12, h.t / 35) });
        G.Audio.shot('shotgun', eye, e.isPlayer);
      } else if (e.operator === 'doc') {
        let patient = e;
        if (!G.Game.hackerMode) {
          let nearest = 20;
          for (const mate of G.Game.entities) {
            if (mate === e || !mate.alive || mate.team !== e.team || mate.hp >= 100) continue;
            const d = mate.chestB.clone().sub(eye), len = d.length();
            if (len < nearest && d.normalize().dot(dir) > 0.96 && G.W.clear(eye.x, eye.y, eye.z, mate.chestB.x, mate.chestB.y, mate.chestB.z)) { patient = mate; nearest = len; }
          }
        }
        if (patient.hp >= 100) { if (e.isPlayer) G.Game.big('HEALTH FULL', 'Aim at an injured teammate to heal them'); return false; }
        if (patient.remote) G.Net.sendHeal(patient, 60); else patient.hp = Math.min(100, patient.hp + 60);
        G.Audio.beep(900, 0.15);
        if (e.isPlayer) G.Game.big('+60 STIM', patient === e ? 'SELF HEAL' : patient.name, 'atk');
      } else if (e.operator === 'pulse') {
        e.sensorT = 4; G.Audio.beep(440, 0.12);
      }
      e.abilityCharges--; e.abilityCd = spec.cooldown;
      return true;
    },
    breach(h, dir, radius) {
      if (h.s.type === 1) {
        if (h.s.kind === 'barricade') G.W.hitBarricade(h.s, 100, dir.x, dir.y, dir.z);
        else G.W.destroySphere(h.x, Math.min(h.y, 1.05), h.z, radius, ['soft'], dir.x, dir.y, dir.z);
      }
      G.Game.soundEvent(new V(h.x, h.y, h.z), 28, null, 'break');
    },
    update(dt) {
      for (const e of G.Game.entities) {
        e.abilityCd = Math.max(0, (e.abilityCd || 0) - dt);
        e.sensorT = Math.max(0, (e.sensorT || 0) - dt);
        if (!e.alive || G.Game.state !== 'live') continue;
        if (e.sensorT > 0) for (const other of G.Game.entities) {
          if (other.alive && G.Game.isEnemy(e, other) && e.pos.distanceTo(other.pos) <= 9) {
            if (e.isPlayer) this.mark(other, 0.6);
            else { e.alertPos.copy(other.pos); e.alertT = G.time; e.alertKind = 'sensor'; }
          }
        }
        if (e.isPlayer) { if (G.Input.pressed.KeyF) this.use(e); }
        else if (e.remote) continue; // other players' abilities are simulated on their own machine
        else {
          e.gadgetThink -= dt;
          if (e.gadgetThink > 0) continue;
          e.gadgetThink = G.rand(0.8, 1.5);
          if ((e.operator === 'doc' && e.hp < 55) || (e.operator === 'pulse' && e.target && e.pos.distanceTo(e.target.pos) < 9)) this.use(e);
          if (e.operator === 'sledge' || e.operator === 'ash') {
            const dir = G.dirFrom(e.aimYaw, e.aimPitch, new V());
            const h = G.W.raycast(e.eye.x, e.eye.y, e.eye.z, dir.x, dir.y, dir.z, e.operator === 'sledge' ? 2.3 : 14);
            if (h?.s.type === 1 && (e.breach || e.target)) this.use(e);
          }
        }
      }
      for (let i = this.rounds.length - 1; i >= 0; i--) {
        const r = this.rounds[i]; r.age += dt;
        r.mesh.position.lerpVectors(r.from, r.to, Math.min(1, r.age / r.duration));
        if (r.age < r.duration) continue;
        this.breach(r.h, r.dir, 1.4); G.FX.miniBlast(r.to); G.Audio.breakWall(r.to);
        for (const d of G.Recon.devices) if (d.alive && d.pos.distanceTo(r.to) < 2) G.Recon.damage(d, 100);
        r.mesh.removeFromParent(); this.rounds.splice(i, 1);
      }
    },
    draw(camera) {
      const box = document.getElementById('intelMarkers'); box.replaceChildren();
      for (const [e, mark] of this.marks) {
        if (!e.alive || G.time > mark.until || !['prep', 'live'].includes(G.Game.state)) { this.marks.delete(e); continue; }
        const p = mark.pos.clone().project(camera);
        if (p.z < -1 || p.z > 1 || Math.abs(p.x) > 1 || Math.abs(p.y) > 1) continue;
        const tag = document.createElement('div'); tag.className = 'intelPing';
        tag.style.left = `${(p.x + 1) * 50}%`; tag.style.top = `${(1 - p.y) * 50}%`;
        tag.textContent = `◇ ${Math.round(camera.position.distanceTo(mark.pos))}m`; box.appendChild(tag);
      }
      const p = G.Game.player, spec = this.roster[p.operator];
      if (!spec) return;
      document.getElementById('abilityStatus').textContent = `F · ${spec.ability} · ${p.abilityCharges === Infinity ? '∞' : p.abilityCharges} · ${G.Game.state !== 'live' ? 'ACTION PHASE ONLY' : p.sensorT > 0 ? 'SCANNING' : p.abilityCd > 0 ? Math.ceil(p.abilityCd) + 's' : 'READY'}`;
    },
  });
})();
