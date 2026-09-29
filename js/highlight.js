'use strict';
// Teammate highlighting: blue outline on friendly operators plus name tags that stay visible through walls.
(function () {
  const G = window.G;
  const V = THREE.Vector3;
  const _p = new V();

  const outlineMat = new THREE.MeshBasicMaterial({ color: 0x3fa7ff, side: THREE.BackSide, fog: false });
  // push the back faces out along their normals to form a rim around the silhouette
  outlineMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed += normal * 0.022;');
  };
  outlineMat.customProgramCacheKey = () => 'teamOutline';

  const H = (G.Highlight = {
    tags: new Map(),

    enabled() { return G.Game.settings.teamHL !== false; },
    isMate(e) {
      const Gm = G.Game, p = Gm.player;
      return e !== p && !Gm.hackerMode && e.team === p.team;
    },

    outlines(model) {
      if (model.outlines) return model.outlines;
      const meshes = [];
      model.root.traverse((o) => { if (o.isMesh && !o.userData.outline && !(o.material && o.material.transparent)) meshes.push(o); });
      model.outlines = meshes.map((m) => {
        const o = new THREE.Mesh(m.geometry, outlineMat);
        o.userData.outline = true;
        o.position.copy(m.position); o.quaternion.copy(m.quaternion); o.scale.copy(m.scale);
        o.castShadow = false; o.receiveShadow = false; o.visible = false;
        m.parent.add(o);
        return o;
      });
      return model.outlines;
    },
    setOutline(model, on) {
      if (!on && !model.outlines) return;
      const list = this.outlines(model);
      if (model.outlineOn === on) return;
      model.outlineOn = on;
      for (const o of list) o.visible = on;
    },

    tag(e) {
      let t = this.tags.get(e);
      if (!t) {
        t = document.createElement('div');
        t.className = 'ttag';
        const d = document.createElement('i'); const n = document.createElement('span');
        t.append(d, n);
        t._name = n;
        document.getElementById('teamTags').appendChild(t);
        this.tags.set(e, t);
      }
      return t;
    },
    clear() {
      for (const t of this.tags.values()) t.remove();
      this.tags.clear();
    },

    // called every frame while a match is running
    update(cam) {
      const Gm = G.Game, on = this.enabled();
      const inPlay = ['prep', 'live', 'roundEnd'].includes(Gm.state);
      const seen = new Set();
      for (const e of Gm.entities) {
        if (e === Gm.player || !e.model) continue;
        const mate = on && inPlay && this.isMate(e) && e.alive;
        this.setOutline(e.model, mate);
        if (!mate || e === Gm.spec) continue;
        _p.set(e.pos.x, e.head.y + 0.42, e.pos.z).project(cam);
        if (_p.z > 1 || _p.z < -1) continue;
        seen.add(e);
        const t = this.tag(e);
        const x = (_p.x * 0.5 + 0.5) * innerWidth, y = (-_p.y * 0.5 + 0.5) * innerHeight;
        const vis = G.W.clear(cam.position.x, cam.position.y, cam.position.z, e.head.x, e.head.y, e.head.z);
        const d = Math.round(cam.position.distanceTo(e.pos));
        const label = vis ? e.name : `${e.name} · ${d}m`;
        if (t._label !== label) { t._label = label; t._name.textContent = label; }
        const cls = 'ttag' + (vis ? '' : ' occ') + (e.hp < 35 ? ' low' : '');
        if (t.className !== cls) t.className = cls;
        t.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
        t.style.display = '';
      }
      for (const [e, t] of this.tags) {
        if (!seen.has(e)) t.style.display = 'none';
        if (!Gm.entities.includes(e)) { t.remove(); this.tags.delete(e); }
      }
    },
  });
})();
