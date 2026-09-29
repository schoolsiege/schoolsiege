'use strict';
// Kill cam: records the last few seconds of every operator (position, aim, lean, stance, shots) and,
// after you die, replays them from your killer's eyes.
(function () {
  const G = window.G;
  const V = THREE.Vector3;
  const $ = (id) => document.getElementById(id);
  const F = 14;            // floats per entity per frame
  const RATE = 1 / 30;     // record at 30 Hz
  const KEEP = 6;          // seconds of history
  const BEFORE = 4.0;      // replay starts this long before the kill
  const AFTER = 0.5;       // ...and runs this long after it
  const _p = new V(), _m = new V(), _f = new V();

  const K = (G.KillCam = {
    frames: [], shots: [], recT: 0, active: false,

    enabled() { return G.Game.settings.killcam !== false; },
    reset() { this.frames = []; this.shots = []; this.recT = 0; this.stop(); },

    // ---------------------------------------------------------------- recording
    record(dt) {
      this.recT -= dt;
      if (this.recT > 0) return;
      this.recT = RATE;
      const ents = G.Game.entities, s = new Float32Array(ents.length * F);
      ents.forEach((e, i) => {
        const o = i * F;
        const yaw = e.isBot ? e.aimYaw : e.yaw, pitch = e.isBot ? e.aimPitch : e.pitch;
        const vx = e.vel ? e.vel.x : 0, vz = e.vel ? e.vel.z : 0;
        s[o] = e.pos.x; s[o + 1] = e.pos.y; s[o + 2] = e.pos.z;
        s[o + 3] = yaw; s[o + 4] = pitch; s[o + 5] = e.lean || 0; s[o + 6] = e.crouch || 0;
        s[o + 7] = Math.hypot(vx, vz); s[o + 8] = vx * -Math.sin(yaw) + vz * -Math.cos(yaw);
        s[o + 9] = e.alive ? 1 : 0; s[o + 10] = e.deadT || 0;
        s[o + 11] = e.eye.x; s[o + 12] = e.eye.y; s[o + 13] = e.eye.z;
      });
      this.frames.push({ t: G.time, ents, s });
      while (this.frames.length && G.time - this.frames[0].t > KEEP) this.frames.shift();
      while (this.shots.length && G.time - this.shots[0].t > KEEP) this.shots.shift();
    },
    shot(shooter, end) {
      if (!this.active && shooter && end) this.shots.push({ t: G.time, e: shooter, end: end.clone(), w: shooter.def || (shooter.w && shooter.w.def) });
    },

    // ---------------------------------------------------------------- playback
    onPlayerKilled(killer, head) {
      const p = G.Game.player;
      if (!this.enabled() || !killer || killer === p || this.frames.length < 10) return;
      const wname = killer.isPlayer ? '' : killer.def ? killer.def.name : killer.w ? killer.w.def.name : '';
      this.pending = { killer, head, tKill: G.time, delay: 1.3, hp: Math.max(1, Math.ceil(killer.hp)), wname };
    },
    start() {
      const d = this.pending; this.pending = null;
      const t0 = Math.max(this.frames[0].t, d.tKill - BEFORE);
      this.active = true;
      this.killer = d.killer;
      this.t = t0; this.tEnd = d.tKill + AFTER; this.tKill = d.tKill;
      this.shotIdx = this.shots.findIndex((s) => s.t >= t0);
      if (this.shotIdx < 0) this.shotIdx = this.shots.length;
      $('kcName').textContent = d.killer.name;
      $('kcInfo').textContent = `${d.wname ? d.wname + ' · ' : ''}${d.head ? 'HEADSHOT · ' : ''}${d.hp} HP LEFT`;
      $('killcam').style.display = 'block';
      G.Audio.beep(520, 0.1);
    },
    stop() {
      if (!this.active && !this.pending) return;
      this.active = false; this.pending = null; this.killer = null;
      const el = $('killcam'); if (el) el.style.display = 'none';
    },
    update(dt) {
      const Gm = G.Game, I = G.Input, p = Gm.player;
      if (p.alive) { this.stop(); }
      if (['live', 'prep'].includes(Gm.state) && !this.active) this.record(dt);
      if (this.pending) {
        this.pending.delay -= dt;
        if (this.pending.delay <= 0) this.start();
        return;
      }
      if (!this.active) return;
      // slow motion for the final moment
      const slow = this.t > this.tKill - 0.35 && this.t < this.tKill + 0.25;
      this.t += dt * (slow ? 0.4 : 1);
      if (I.pressed.mouse0 || I.pressed.Space || I.pressed.Enter || this.t >= this.tEnd) {
        this.stop();
        Gm.deathT = Math.max(Gm.deathT, 2.6); // straight to spectating
        I.pressed.mouse0 = false;
      }
    },
    // find the recorded frames around time t
    sample(t) {
      const fr = this.frames;
      let i = fr.length - 1;
      while (i > 0 && fr[i].t > t) i--;
      const a = fr[i], b = fr[Math.min(fr.length - 1, i + 1)];
      const k = b === a ? 0 : G.clamp((t - a.t) / (b.t - a.t), 0, 1);
      return { a, b, k };
    },
    // Called from render: pose every operator from the recording and put the camera in the killer's eyes.
    apply(cam, dt) {
      if (!this.active) return false;
      const { a, b, k } = this.sample(this.t);
      const lerp = (i, o) => G.lerp(a.s[i + o], b.ents === a.ents ? b.s[i + o] : a.s[i + o], k);
      a.ents.forEach((e, idx) => {
        if (!e.model) return;
        const i = idx * F;
        const alive = a.s[i + 9] > 0.5;
        _p.set(lerp(i, 0), lerp(i, 1), lerp(i, 2));
        let yaw = a.s[i + 3];
        if (b.ents === a.ents) yaw += G.wrap(b.s[i + 3] - yaw) * k;
        e.model.root.visible = e !== this.killer;
        G.animateCharacter(e.model, {
          pos: _p, yaw, pitch: lerp(i, 4), lean: lerp(i, 5), crouch: lerp(i, 6), speed: lerp(i, 7), fwd: lerp(i, 8),
          dead: !alive, deadT: a.s[i + 10], fallDir: e.fallDir || _f.set(1, 0, 0),
        }, dt);
        if (e === this.killer) {
          cam.position.set(lerp(i, 11), lerp(i, 12), lerp(i, 13));
          cam.rotation.set(lerp(i, 4), yaw, -lerp(i, 5) * 0.2, 'YXZ');
        }
      });
      const S = G.Game.settings;
      if (cam.fov !== S.fov) { cam.fov = S.fov; cam.updateProjectionMatrix(); }
      // replay gunfire that happened during the window
      while (this.shotIdx < this.shots.length && this.shots[this.shotIdx].t <= this.t) {
        const s = this.shots[this.shotIdx++];
        if (!s.e.model) continue;
        s.e.model.root.updateMatrixWorld(true);
        s.e.model.muzzle.getWorldPosition(_m);
        if (s.e === this.killer) _m.copy(cam.position).addScaledVector(G.dirFrom(cam.rotation.y, cam.rotation.x, _f), 0.6).y -= 0.12;
        G.FX.muzzle3P(_m, _f.subVectors(s.end, _m).normalize());
        G.FX.tracer(_m.x, _m.y, _m.z, s.end.x, s.end.y, s.end.z);
        G.Audio.shot((s.w && s.w.sound) || 'rifle', _m, false);
      }
      return true;
    },
  });
})();
