'use strict';
// LOW graphics preset for iPad / phones / weak PCs, aimed at a steady 60 fps.
//  - cheaper surface shading (Lambert instead of physically based) — same textures, same bump detail
//  - only the 2 room lights nearest the camera are live (instead of ~10 lights per pixel)
//  - sun shadows are rendered once and only refreshed when walls get destroyed
//  - resolution adapts automatically if the frame rate drops
// Must load before textures.js so materials are created with the cheap shader.
(function () {
  const G = window.G;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('breachpoint.settings') || '{}'); } catch (e) { saved = {}; }
  const touch = saved.controls === 'touch' || (saved.controls !== 'keyboard' &&
    (navigator.maxTouchPoints > 0 || 'ontouchstart' in window) && matchMedia('(pointer: coarse)').matches);
  const low = saved.gfx ? saved.gfx === 'low' : touch;

  const P = (G.Perf = {
    low, touch, shadowDirty: true, lastShadow: -1, scale: 1, acc: 0, n: 0, slowT: 0, fastT: 0, pool: [], cands: [], poolT: 0,

    // ------------------------------------------------------------ renderer / lights
    afterInit(renderer, sun, scene) {
      this.r = renderer;
      if (!low) return;
      renderer.shadowMap.type = THREE.PCFShadowMap;
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = true;
      sun.shadow.mapSize.set(1024, 1024);
      // two pooled point lights that follow the nearest room lights
      for (let i = 0; i < 2; i++) {
        const l = new THREE.PointLight(0xffffff, 0, 10, 1.3);
        scene.add(l);
        this.pool.push(l);
      }
      if (G.FX && G.FX.light) G.FX.light.visible = false; // muzzle-flash light: sprite flash is kept
    },
    afterMap() {
      if (!low || !G.mapGroup) return;
      this.cands = [];
      G.mapGroup.traverse((o) => { if (o.isPointLight) { o.visible = false; this.cands.push(o); } });
      this.shadowDirty = true;
      this.poolT = 0;
    },

    // ------------------------------------------------------------ per frame
    frame(dt, cam) {
      if (!this.r) return;
      if (low) {
        // shadows: refresh after destruction / new round, at most twice a second
        if (this.shadowDirty && G.time - this.lastShadow > 0.5) {
          this.r.shadowMap.needsUpdate = true;
          this.shadowDirty = false; this.lastShadow = G.time;
        }
        // light pool: pick the 2 room lights nearest the camera
        this.poolT -= dt;
        if (this.poolT <= 0 && this.cands.length) {
          this.poolT = 0.25;
          this.pick = this.cands
            .map((l) => ({ l, d: l.position.distanceToSquared(cam.position) }))
            .sort((a, b) => a.d - b.d).slice(0, this.pool.length).map((x) => x.l);
        }
        if (this.pick) this.pool.forEach((pl, i) => {
          const src = this.pick[i];
          if (!src) { pl.intensity = 0; return; }
          pl.position.copy(src.position); pl.color.copy(src.color);
          pl.intensity = src.intensity; pl.distance = src.distance; pl.decay = src.decay;
        });
      }
      if (low || touch) this.adapt(dt);
    },
    // dynamic resolution: drop render scale when frames run long, raise it again when there is headroom
    adapt(dt) {
      if (!(dt > 0) || dt > 0.25) return;
      this.acc += dt; this.n++;
      if (this.acc < 1) return;
      const avg = this.acc / this.n * 1000;
      this.acc = 0; this.n = 0;
      let s = this.scale;
      if (avg > 19) { this.slowT++; this.fastT = 0; } else if (avg < 17.3) { this.fastT++; this.slowT = 0; } else { this.slowT = 0; this.fastT = 0; }
      if (this.slowT >= 1 && s > 0.62) { s = Math.max(0.6, s - 0.1); this.slowT = 0; }
      else if (this.fastT >= 4 && s < 1) { s = Math.min(1, s + 0.05); this.fastT = 0; }
      if (s !== this.scale) { this.scale = s; this.applyScale(); }
    },
    applyScale() {
      const Gm = G.Game;
      if (!this.r || !Gm) return;
      this.r.setPixelRatio(Gm.basePixelRatio() * this.scale);
      this.r.setSize(innerWidth, innerHeight);
    },
  });

  if (low) {
    // Swap the physically based material for Lambert everywhere (textures, bump maps, emissive all kept).
    const Lambert = THREE.MeshLambertMaterial;
    const probe = new Lambert();
    const DROP = ['roughness', 'metalness', 'roughnessMap', 'metalnessMap', 'envMapIntensity', 'normalMap', 'normalScale', 'flatShading']
      .filter((k) => !(k in probe) || k === 'roughness' || k === 'metalness');
    class LowStandardMaterial extends Lambert {
      constructor(params) {
        const q = Object.assign({}, params), extra = {};
        for (const k of DROP) if (k in q) { extra[k] = q[k]; delete q[k]; }
        super(q);
        Object.assign(this, extra);
      }
    }
    THREE.MeshStandardMaterial = LowStandardMaterial;
    // frozen shadow maps can't follow moving characters, so they don't cast in LOW
    const noCast = (root) => { root.traverse((o) => { if (o.isMesh) o.castShadow = false; }); return root; };
    addEventListener('DOMContentLoaded', () => {
      const bc = G.buildCharacter, bg = G.buildGrenade;
      if (bc) G.buildCharacter = function () { const ch = bc.apply(this, arguments); noCast(ch.root); return ch; };
      if (bg) G.buildGrenade = function () { return noCast(bg.apply(this, arguments)); };
    });
  }
})();
