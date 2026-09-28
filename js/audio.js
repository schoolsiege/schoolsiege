'use strict';
// Fully synthesized positional audio (Web Audio API). No audio files needed.
(function () {
  const G = window.G;

  const GUN = {
    rifle:   { crack: 0.9, crackHP: 1900, crackD: 0.05, body: 1.0, bodyLP: 2600, bodyD: 0.22, thump: 1.0, f0: 150, f1: 48, thD: 0.16, tail: 0.5, tailD: 0.75, gain: 1.0 },
    smg:     { crack: 0.8, crackHP: 2300, crackD: 0.04, body: 0.8, bodyLP: 3200, bodyD: 0.15, thump: 0.7, f0: 190, f1: 70, thD: 0.1, tail: 0.35, tailD: 0.55, gain: 0.85 },
    shotgun: { crack: 1.0, crackHP: 1200, crackD: 0.07, body: 1.35, bodyLP: 1500, bodyD: 0.4, thump: 1.4, f0: 110, f1: 30, thD: 0.3, tail: 0.65, tailD: 1.1, gain: 1.2 },
    pistol:  { crack: 1.0, crackHP: 2600, crackD: 0.04, body: 0.8, bodyLP: 3300, bodyD: 0.14, thump: 0.7, f0: 210, f1: 80, thD: 0.09, tail: 0.3, tailD: 0.5, gain: 0.8 },
  };

  const A = (G.Audio = {
    ctx: null, ready: false, vol: 0.8, lp: new THREE.Vector3(), active: 0,
    init() {
      if (this.ctx) { if (this.ctx.state !== 'running') this.ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const c = (this.ctx = new AC());
      this.master = c.createGain();
      this.master.gain.value = this.vol;
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 5; comp.attack.value = 0.002; comp.release.value = 0.25;
      this.master.connect(comp);
      comp.connect(c.destination);
      // reverb
      this.verb = c.createConvolver();
      this.verb.buffer = this.makeIR(1.7, 3.0);
      this.verbIn = c.createGain();
      const vOut = c.createGain(); vOut.gain.value = 0.4;
      this.verbIn.connect(this.verb); this.verb.connect(vOut); vOut.connect(this.master);
      // noise
      const len = c.sampleRate * 2;
      this.nb = c.createBuffer(1, len, c.sampleRate);
      const d = this.nb.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      // ambience
      this.amb = c.createGain(); this.amb.gain.value = 0.0;
      const an = c.createBufferSource(); an.buffer = this.nb; an.loop = true;
      const af = c.createBiquadFilter(); af.type = 'lowpass'; af.frequency.value = 320;
      an.connect(af); af.connect(this.amb); this.amb.connect(this.master); an.start();
      this.ready = true;
    },
    setVolume(v) { this.vol = v; if (this.master) this.master.gain.value = v; },
    makeIR(dur, decay) {
      const c = this.ctx, len = (c.sampleRate * dur) | 0, b = c.createBuffer(2, len, c.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = b.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay) * (i < 200 ? i / 200 : 1);
      }
      return b;
    },
    setAmbience(outdoor) { if (this.amb) this.amb.gain.setTargetAtTime(outdoor ? 0.045 : 0.015, this.ctx.currentTime, 0.5); },
    setListener(pos, fwd, up) {
      if (!this.ready) return;
      const L = this.ctx.listener;
      this.lp.copy(pos);
      if (L.positionX) {
        const t = this.ctx.currentTime;
        L.positionX.setValueAtTime(pos.x, t); L.positionY.setValueAtTime(pos.y, t); L.positionZ.setValueAtTime(pos.z, t);
        L.forwardX.setValueAtTime(fwd.x, t); L.forwardY.setValueAtTime(fwd.y, t); L.forwardZ.setValueAtTime(fwd.z, t);
        L.upX.setValueAtTime(up.x, t); L.upY.setValueAtTime(up.y, t); L.upZ.setValueAtTime(up.z, t);
      } else {
        L.setPosition(pos.x, pos.y, pos.z);
        L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
      }
    },
    occluded(pos) {
      if (!G.W) return false;
      const dx = pos.x - this.lp.x, dy = pos.y - this.lp.y, dz = pos.z - this.lp.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 0.5) return false;
      return !!G.W.raycast(this.lp.x, this.lp.y, this.lp.z, dx / d, dy / d, dz / d, d - 0.3);
    },

    // ---- node helpers
    _noise(t, dur) {
      const s = this.ctx.createBufferSource();
      s.buffer = this.nb;
      s.start(t, Math.random() * 1.5, dur + 0.05);
      this.active++;
      s.onended = () => { this.active--; };
      return s;
    },
    _filt(type, f, q) {
      const b = this.ctx.createBiquadFilter();
      b.type = type; b.frequency.value = f;
      if (q !== undefined) b.Q.value = q;
      return b;
    },
    _env(node, t, peak, a, d) {
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
      node.connect(g);
      return g;
    },
    _osc(type, t, f0, f1, dur) {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      o.start(t); o.stop(t + dur + 0.05);
      return o;
    },
    // destination with optional 3D panning, distance filter, occlusion and reverb send
    _dest(pos, o) {
      const c = this.ctx;
      const inp = c.createGain();
      inp.gain.value = o.gain === undefined ? 1 : o.gain;
      let node = inp;
      if (pos) {
        const d = pos.distanceTo(this.lp);
        let cut = 20000 * Math.exp(-d / (o.lpDist || 45));
        if (o.occl) cut = Math.min(cut, 650);
        if (cut < 15000) { const f = this._filt('lowpass', Math.max(250, cut)); node.connect(f); node = f; }
        const p = c.createPanner();
        p.panningModel = 'equalpower'; p.distanceModel = 'inverse';
        p.refDistance = o.ref || 3; p.rolloffFactor = o.roll || 1; p.maxDistance = 500;
        if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
        else p.setPosition(pos.x, pos.y, pos.z);
        node.connect(p); node = p;
        if (o.occl) { const og = c.createGain(); og.gain.value = 0.5; node.connect(og); node = og; }
      }
      node.connect(this.master);
      if (o.verb) { const s = c.createGain(); s.gain.value = o.verb; node.connect(s); s.connect(this.verbIn); }
      return inp;
    },

    // ---- gunshot
    shot(kind, pos, local) {
      if (!this.ready) return;
      const c = this.ctx, t = c.currentTime + 0.003, P = GUN[kind] || GUN.rifle;
      const d = pos ? pos.distanceTo(this.lp) : 0;
      if (!local && this.active > 90 && d > 15) return;
      const occl = !local && d > 2 && this.occluded(pos);
      const dest = this._dest(local ? null : pos, { gain: P.gain * (local ? 0.5 : 0.95), ref: 5, roll: 0.9, verb: local ? 0.3 : 0.35 + Math.min(0.6, d / 45), occl, lpDist: 60 });
      let n = this._noise(t, P.crackD + 0.02);
      let f = this._filt('highpass', P.crackHP * (0.9 + Math.random() * 0.2));
      n.connect(f); this._env(f, t, P.crack, 0.001, P.crackD).connect(dest);
      n = this._noise(t, P.bodyD + 0.05);
      f = this._filt('lowpass', P.bodyLP);
      f.frequency.setValueAtTime(P.bodyLP, t);
      f.frequency.exponentialRampToValueAtTime(P.bodyLP * 0.18, t + P.bodyD);
      n.connect(f); this._env(f, t, P.body, 0.002, P.bodyD).connect(dest);
      const o = this._osc('sine', t, P.f0 * (0.95 + Math.random() * 0.1), P.f1, P.thD);
      this._env(o, t, P.thump, 0.002, P.thD).connect(dest);
      n = this._noise(t, P.tailD + 0.05);
      f = this._filt('bandpass', 650, 0.6);
      n.connect(f); this._env(f, t + 0.01, P.tail * 0.45, 0.01, P.tailD).connect(dest);
      if (local) {
        const m = this._osc('square', t + 0.01, 2900, 2200, 0.02);
        const hp = this._filt('highpass', 1500); m.connect(hp);
        this._env(hp, t + 0.01, 0.06, 0.001, 0.025).connect(dest);
      }
    },

    // ---- impacts & destruction
    impact(phys, pos) {
      if (!this.ready || this.active > 110) return;
      const t = this.ctx.currentTime + 0.002;
      const dest = this._dest(pos, { gain: 0.5, ref: 2, roll: 1.4, verb: 0.15 });
      let n, f;
      switch (phys) {
        case 'wood':
          n = this._noise(t, 0.1); f = this._filt('bandpass', 1000 + Math.random() * 400, 1.4); n.connect(f); this._env(f, t, 0.9, 0.001, 0.07).connect(dest);
          this._env(this._osc('triangle', t, 260, 140, 0.08), t, 0.25, 0.001, 0.07).connect(dest);
          break;
        case 'metal':
          this._env(this._osc('sine', t, 2200 + Math.random() * 1400, 1800, 0.25), t, 0.18, 0.001, 0.25).connect(dest);
          n = this._noise(t, 0.04); f = this._filt('highpass', 3000); n.connect(f); this._env(f, t, 0.6, 0.001, 0.03).connect(dest);
          break;
        case 'flesh':
          n = this._noise(t, 0.1); f = this._filt('lowpass', 520); n.connect(f); this._env(f, t, 1.2, 0.001, 0.08).connect(dest);
          this._env(this._osc('sine', t, 110, 60, 0.07), t, 0.5, 0.001, 0.06).connect(dest);
          break;
        case 'fabric': case 'dirt':
          n = this._noise(t, 0.08); f = this._filt('lowpass', 1200); n.connect(f); this._env(f, t, 0.6, 0.001, 0.06).connect(dest);
          break;
        default: // brick / concrete / plaster
          n = this._noise(t, 0.1); f = this._filt('bandpass', 1700, 0.9); n.connect(f); this._env(f, t, 0.8, 0.001, 0.05).connect(dest);
          n = this._noise(t, 0.12); f = this._filt('lowpass', 500); n.connect(f); this._env(f, t, 0.5, 0.001, 0.08).connect(dest);
      }
    },
    breakWood(pos) {
      if (!this.ready) return;
      const t0 = this.ctx.currentTime;
      const dest = this._dest(pos, { gain: 0.9, ref: 4, roll: 1.1, verb: 0.3 });
      for (let i = 0; i < 4; i++) {
        const t = t0 + i * 0.035 + Math.random() * 0.03;
        const n = this._noise(t, 0.15), f = this._filt('bandpass', 700 + Math.random() * 900, 1.1);
        n.connect(f); this._env(f, t, 0.9, 0.001, 0.12).connect(dest);
      }
      const n = this._noise(t0, 0.3), f = this._filt('lowpass', 900); n.connect(f); this._env(f, t0, 0.7, 0.005, 0.25).connect(dest);
    },
    breakWall(pos) {
      if (!this.ready) return;
      const t = this.ctx.currentTime;
      const dest = this._dest(pos, { gain: 0.8, ref: 4, roll: 1.1, verb: 0.3 });
      const n = this._noise(t, 0.45), f = this._filt('lowpass', 1400);
      f.frequency.setValueAtTime(1800, t); f.frequency.exponentialRampToValueAtTime(300, t + 0.4);
      n.connect(f); this._env(f, t, 0.9, 0.004, 0.38).connect(dest);
      const n2 = this._noise(t, 0.2), f2 = this._filt('bandpass', 2500, 1.2); n2.connect(f2); this._env(f2, t, 0.3, 0.002, 0.15).connect(dest);
    },
    explosion(pos) {
      if (!this.ready) return;
      const t = this.ctx.currentTime;
      const d = pos.distanceTo(this.lp);
      const dest = this._dest(pos, { gain: 2.2, ref: 8, roll: 0.8, verb: 0.6, occl: this.occluded(pos), lpDist: 80 });
      let n = this._noise(t, 1.4), f = this._filt('lowpass', 1200);
      f.frequency.setValueAtTime(2400, t); f.frequency.exponentialRampToValueAtTime(120, t + 1.2);
      n.connect(f); this._env(f, t, 1.2, 0.003, 1.2).connect(dest);
      this._env(this._osc('sine', t, 70, 22, 0.9), t, 1.4, 0.004, 0.9).connect(dest);
      n = this._noise(t, 0.1); f = this._filt('highpass', 1500); n.connect(f); this._env(f, t, 0.9, 0.001, 0.08).connect(dest);
      if (d < 8) this.ring(1 - d / 8);
    },
    blast(pos) {
      if (!this.ready || this.active > 110) return;
      const t = this.ctx.currentTime;
      const dest = this._dest(pos, { gain: 1.0, ref: 5, roll: 1, verb: 0.4, lpDist: 70 });
      const n = this._noise(t, 0.5), f = this._filt('lowpass', 1500);
      f.frequency.setValueAtTime(2600, t); f.frequency.exponentialRampToValueAtTime(150, t + 0.4);
      n.connect(f); this._env(f, t, 1.0, 0.002, 0.4).connect(dest);
      this._env(this._osc('sine', t, 90, 30, 0.3), t, 0.9, 0.003, 0.3).connect(dest);
    },
    ring(k) {
      const t = this.ctx.currentTime;
      const dest = this._dest(null, { gain: 0.07 * k });
      this._env(this._osc('sine', t, 3800, 3700, 2.5), t, 1, 0.05, 2.4).connect(dest);
    },

    // ---- movement / handling
    step(pos, surface, loud, local) {
      if (!this.ready || this.active > 100) return;
      const t = this.ctx.currentTime + 0.002;
      const dest = this._dest(local ? null : pos, { gain: (local ? 0.16 : 0.5) * loud, ref: 2, roll: 1.6, verb: 0.08 });
      const base = surface === 'wood' ? 480 : surface === 'fabric' ? 300 : surface === 'dirt' ? 380 : surface === 'metal' ? 900 : 650;
      let n = this._noise(t, 0.09), f = this._filt('bandpass', base * (0.85 + Math.random() * 0.3), 0.9);
      n.connect(f); this._env(f, t, 0.9, 0.003, 0.07).connect(dest);
      if (surface !== 'fabric') { n = this._noise(t, 0.03); f = this._filt('highpass', 3500); n.connect(f); this._env(f, t + 0.01, 0.12, 0.001, 0.02).connect(dest); }
      this._env(this._osc('sine', t, 90, 55, 0.05), t, 0.4, 0.002, 0.05).connect(dest);
    },
    reload(stage, pos, local) {
      if (!this.ready) return;
      const t = this.ctx.currentTime + 0.002;
      const dest = this._dest(local ? null : pos, { gain: local ? 0.35 : 0.5, ref: 1.5, roll: 1.8, verb: 0.05 });
      const click = (tt, f, g, d) => { const n = this._noise(tt, d + 0.02), fl = this._filt('bandpass', f, 3); n.connect(fl); this._env(fl, tt, g, 0.001, d).connect(dest); };
      if (stage === 'out') { click(t, 1400, 0.8, 0.04); click(t + 0.06, 900, 0.5, 0.06); }
      else if (stage === 'in') { click(t, 1800, 0.7, 0.03); click(t + 0.05, 2600, 1.0, 0.03); }
      else if (stage === 'bolt') {
        const n = this._noise(t, 0.1), f = this._filt('bandpass', 2000, 2); f.frequency.setValueAtTime(1800, t); f.frequency.exponentialRampToValueAtTime(4200, t + 0.08);
        n.connect(f); this._env(f, t, 0.6, 0.002, 0.08).connect(dest); click(t + 0.12, 3000, 1.0, 0.03);
      } else if (stage === 'shell') { click(t, 1200, 0.6, 0.05); click(t + 0.05, 700, 0.4, 0.05); }
      else if (stage === 'pump') {
        const n = this._noise(t, 0.3), f = this._filt('bandpass', 900, 1.5);
        n.connect(f); this._env(f, t, 0.8, 0.005, 0.09).connect(dest); click(t + 0.16, 1300, 1.0, 0.05);
      } else if (stage === 'dry') { click(t, 3200, 0.5, 0.02); }
      else if (stage === 'draw') { const n = this._noise(t, 0.15), f = this._filt('bandpass', 1500, 1); n.connect(f); this._env(f, t, 0.3, 0.02, 0.1).connect(dest); click(t + 0.12, 2400, 0.5, 0.02); }
    },
    swing(pos, local) {
      if (!this.ready) return;
      const t = this.ctx.currentTime;
      const dest = this._dest(local ? null : pos, { gain: 0.35, ref: 2, roll: 1.5 });
      const n = this._noise(t, 0.2), f = this._filt('bandpass', 600, 1.2);
      f.frequency.setValueAtTime(500, t); f.frequency.exponentialRampToValueAtTime(2200, t + 0.15);
      n.connect(f); this._env(f, t, 0.8, 0.03, 0.13).connect(dest);
    },
    whiz(pan) {
      if (!this.ready) return;
      const c = this.ctx, t = c.currentTime;
      const dest = this._dest(null, { gain: 0.45 });
      const p = c.createStereoPanner ? c.createStereoPanner() : null;
      const n = this._noise(t, 0.2), f = this._filt('bandpass', 4000, 3);
      f.frequency.setValueAtTime(5000, t); f.frequency.exponentialRampToValueAtTime(900, t + 0.14);
      n.connect(f);
      const e = this._env(f, t, 0.9, 0.02, 0.12);
      if (p) { p.pan.value = G.clamp(pan, -1, 1); e.connect(p); p.connect(dest); } else e.connect(dest);
    },
    grenadeBounce(pos) {
      if (!this.ready) return;
      const t = this.ctx.currentTime;
      const dest = this._dest(pos, { gain: 0.4, ref: 2, roll: 1.4 });
      this._env(this._osc('triangle', t, 900, 600, 0.05), t, 0.4, 0.001, 0.05).connect(dest);
    },

    // ---- UI
    hit(head, kill) {
      if (!this.ready) return;
      const t = this.ctx.currentTime;
      const dest = this._dest(null, { gain: 0.22 });
      this._env(this._osc('square', t, 1900, 1700, 0.03), t, 0.3, 0.001, 0.03).connect(dest);
      if (head) this._env(this._osc('sine', t + 0.01, 3100, 3000, 0.18), t + 0.01, 0.9, 0.001, 0.18).connect(dest);
      if (kill) this._env(this._osc('sine', t + 0.05, 1300, 1250, 0.2), t + 0.05, 0.6, 0.001, 0.2).connect(dest);
    },
    hurt() {
      if (!this.ready) return;
      const t = this.ctx.currentTime;
      const dest = this._dest(null, { gain: 0.5 });
      const n = this._noise(t, 0.15), f = this._filt('lowpass', 380); n.connect(f); this._env(f, t, 1, 0.002, 0.12).connect(dest);
      this._env(this._osc('sine', t, 80, 45, 0.15), t, 0.8, 0.002, 0.14).connect(dest);
    },
    beep(freq, dur, gain) {
      if (!this.ready) return;
      const t = this.ctx.currentTime;
      const dest = this._dest(null, { gain: gain || 0.12 });
      this._env(this._osc('sine', t, freq, freq, dur), t, 1, 0.005, dur).connect(dest);
    },
    sting(win) {
      if (!this.ready) return;
      const t = this.ctx.currentTime;
      const dest = this._dest(null, { gain: 0.12, verb: 0.4 });
      const notes = win ? [392, 494, 587, 784] : [392, 370, 311, 233];
      notes.forEach((f, i) => {
        this._env(this._osc('triangle', t + i * 0.13, f, f, 0.5), t + i * 0.13, 1, 0.01, 0.5).connect(dest);
        this._env(this._osc('sine', t + i * 0.13, f / 2, f / 2, 0.5), t + i * 0.13, 0.6, 0.01, 0.5).connect(dest);
      });
    },
    click() { this.beep(1400, 0.04, 0.08); },
  });
})();
