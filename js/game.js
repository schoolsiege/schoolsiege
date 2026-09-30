'use strict';
// Game loop, rounds (Secure Area), input, HUD, menus.
(function () {
  const G = window.G;
  const V = THREE.Vector3;
  const $ = (id) => document.getElementById(id);

  // ------------------------------------------------------------- INPUT
  const I = (G.Input = { keys: {}, pressed: {}, mdx: 0, mdy: 0, lmb: false, rmb: false, wheel: 0, joyX: 0, joyY: 0, joySprint: false });
  addEventListener('keydown', (e) => {
    if (e.target && e.target.tagName === 'INPUT') return;
    if (['Tab', 'Space', 'KeyQ', 'KeyE', 'KeyC', 'KeyG', 'KeyV', 'KeyR'].includes(e.code) || e.code.startsWith('Digit')) e.preventDefault();
    if (!I.keys[e.code]) I.pressed[e.code] = true;
    I.keys[e.code] = true;
    if (e.code === 'ShiftRight') I.keys.ShiftLeft = true;
    if (e.code === 'KeyM' && !e.repeat) {
      const Gm = G.Game;
      if (Gm.modsOpen) Gm.closeMods();
      else if (['live', 'prep', 'roundEnd', 'menu'].includes(Gm.state)) Gm.openMods();
    }
  });
  addEventListener('keyup', (e) => { I.keys[e.code] = false; if (e.code === 'ShiftRight') I.keys.ShiftLeft = false; });
  addEventListener('blur', () => { I.keys = {}; I.lmb = I.rmb = false; });
  addEventListener('mousedown', (e) => {
    if (e.button === 0) { I.lmb = true; I.pressed.mouse0 = true; }
    if (e.button === 2) I.rmb = true;
  });
  addEventListener('mouseup', (e) => { if (e.button === 0) I.lmb = false; if (e.button === 2) I.rmb = false; });
  addEventListener('contextmenu', (e) => e.preventDefault());
  addEventListener('mousemove', (e) => {
    if (document.pointerLockElement) { I.mdx += e.movementX || 0; I.mdy += e.movementY || 0; }
  });
  addEventListener('wheel', (e) => { I.wheel = Math.sign(e.deltaY); }, { passive: true });

  const DEF_SETTINGS = { sens: 1.0, adsSens: 0.8, fov: 80, vol: 0.8, leanMode: 'hold', gfx: 'high', diff: 'regular', primary: 'ar', scope: 'std', map: 'harbor', mode: 'secure', operator: 'sledge', ff: false, controls: 'auto', touchSens: 1.0, padSens: 1.0, renderScale: 0, teamHL: true, killcam: true, mpName: '', mpMode: 'team', mpBots: true, mpPub: true };
  const PLAY_STATES = ['live', 'prep', 'roundEnd'];
  G.DUEL_SWAP = 2; // 1v1: sides switch every 2 rounds

  // ------------------------------------------------------------- GAME
  const Game = (G.Game = {
    state: 'boot', paused: false, entities: [], bots: [], events: [], evId: 0,
    score: { atk: 0, def: 0 }, round: 0, timer: 0, secure: 0, zoneAtk: 0, zoneDef: 0, shakeAmt: 0,
    noLock: /nolock/.test(location.search),
    modsOpen: false,
    get hackerMode() { return (this.activeMode || this.settings?.mode) === 'hacker'; },
    isEnemy(a, b) { return a !== b && (this.hackerMode || a.team !== b.team); },
    // touch devices never use pointer lock
    get lockless() { return this.noLock || G.Touch.enabled || (G.Pad && G.Pad.active); },
    pixelRatio() { return this.basePixelRatio() * (G.Perf ? G.Perf.scale : 1); },
    renderScale() { const r = this.settings.renderScale; return r > 0 ? r : (G.Touch.enabled ? 0.85 : 1); },
    basePixelRatio() {
      return this.devicePixelRatio() * this.renderScale();
    },
    devicePixelRatio() {
      const hi = this.settings.gfx === 'high';
      if (G.Touch.enabled) return Math.min(devicePixelRatio, hi ? 1.5 : 1);
      return Math.min(devicePixelRatio, hi ? 1.5 : 1);
    },

    init() {
      let saved = {};
      try { saved = JSON.parse(localStorage.getItem('breachpoint.settings') || '{}'); } catch (e) { saved = {}; }
      this.settings = Object.assign({}, DEF_SETTINGS, saved);
      if (!G.MAPS.some((m) => m.id === this.settings.map)) this.settings.map = 'harbor';
      if (!['secure', 'hacker', 'duel'].includes(this.settings.mode)) this.settings.mode = 'secure';
      if (!G.Operators.roster[this.settings.operator]) this.settings.operator = 'sledge';
      const touch = G.Touch.detect(this.settings.controls);
      if (touch && !('gfx' in saved)) this.settings.gfx = 'low';
      G.Touch.setEnabled(touch);
      G.Mods.load();
      const hi = this.settings.gfx === 'high';
      // Create the WebGL context ourselves: three.js always asks for a transparent canvas, which Safari then
      // has to blend with the page every frame. An opaque, low-latency context is cheaper and responds sooner.
      const canvas = document.createElement('canvas');
      const attrs = { alpha: false, depth: true, stencil: false, antialias: !touch, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance', desynchronized: true };
      const ctx = canvas.getContext('webgl2', attrs) || canvas.getContext('webgl', attrs);
      const r = (this.renderer = new THREE.WebGLRenderer(ctx ? { canvas, context: ctx, antialias: !touch } : { antialias: !touch, powerPreference: 'high-performance' }));
      r.setPixelRatio(this.pixelRatio());
      r.setSize(innerWidth, innerHeight);
      r.outputEncoding = THREE.sRGBEncoding;
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.toneMappingExposure = 1.0;
      r.shadowMap.enabled = true;
      r.shadowMap.type = THREE.PCFSoftShadowMap;
      r.autoClear = false;
      document.body.prepend(r.domElement);
      G.maxAniso = r.capabilities.getMaxAnisotropy();

      const scene = (G.scene = new THREE.Scene());
      scene.fog = new THREE.Fog(0xbcc9d6, 70, 280);
      scene.background = new THREE.Color(0x9fb8d0);
      this.camera = new THREE.PerspectiveCamera(this.settings.fov, innerWidth / innerHeight, 0.04, 600);
      scene.add(this.camera);

      const hemi = (this.hemi = new THREE.HemisphereLight(0xd2e2ff, 0x5c4c3c, 0.36));
      scene.add(hemi);
      scene.add(new THREE.AmbientLight(0x3c4450, 0.12));
      const sun = (this.sun = new THREE.DirectionalLight(0xfff0d8, 2.1));
      sun.position.set(32, 55, 24);
      sun.castShadow = true;
      const ms = hi ? (touch ? 2048 : 4096) : (touch ? 1024 : 2048);
      sun.shadow.mapSize.set(ms, ms);
      const sc = sun.shadow.camera;
      sc.left = -52; sc.right = 52; sc.top = 52; sc.bottom = -52; sc.near = 5; sc.far = 160;
      sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.035;
      scene.add(sun); scene.add(sun.target);

      G.initGeo();
      G.T.build();
      G.buildMaterials();
      G.FX.init(scene);
      G.Fort.init(scene);
      G.Perf.afterInit(r, sun, scene);
      G.buildMap(scene, this.settings.map);
      G.Perf.afterMap();
      this.applyMapEnvironment();
      G.Nav.build();
      G.VM.init();
      this.player = new G.Player();
      this.player.alive = false;
      this.player.hp = 100;

      addEventListener('resize', () => this.resize());
      document.addEventListener('pointerlockchange', () => this.onLockChange());
      G.Mods.initESP();
      G.Mods.buildUI();
      this.bindUI();
      this.showMenu();
      this.last = performance.now();
      requestAnimationFrame((t) => this.loop(t));
      $('loading').style.display = 'none';
      if (G.Net) G.Net.onGameReady();
    },

    resize() {
      this.renderer.setSize(innerWidth, innerHeight);
      this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
      G.VM.camera.aspect = innerWidth / innerHeight; G.VM.camera.updateProjectionMatrix();
    },
    saveSettings() { try { localStorage.setItem('breachpoint.settings', JSON.stringify(this.settings)); } catch (e) { /* storage unavailable */ } },
    applyMapEnvironment() {
      const e = G.MAP.env;
      this.sun.color.setHex(e.sun); this.sun.intensity = e.sunI;
      this.sun.position.set(...e.sunPos);
      this.hemi.color.setHex(e.hemiSky); this.hemi.groundColor.setHex(e.hemiGround); this.hemi.intensity = e.hemiI;
      G.scene.fog.color.setHex(e.fog); G.scene.fog.near = e.fogNear; G.scene.fog.far = e.fogFar;
      this.renderer.toneMappingExposure = e.exposure || 1;
    },
    selectMap(id) {
      const def = G.MAPS.find((m) => m.id === id) || G.MAPS[0];
      this.settings.map = def.id;
      if (G.MAP.id === def.id) return;
      G.FX.clear();
      G.buildMap(G.scene, def.id);
      G.Perf.afterMap();
      this.applyMapEnvironment();
      G.Nav.build();
    },

    // ------------------------------------------------------------- UI
    bindUI() {
      const S = this.settings;
      const sel = (wrap, attr, val) => { for (const b of $(wrap).children) b.classList.toggle('sel', b.dataset[attr] === val); };
      const group = (wrap, attr, key, cb) => {
        sel(wrap, attr, S[key]);
        $(wrap).addEventListener('click', (e) => {
          const b = e.target.closest('button'); if (!b) return;
          S[key] = b.dataset[attr]; sel(wrap, attr, S[key]); this.saveSettings(); G.Audio.click(); if (cb) cb();
        });
      };
      group('wChoices', 'w', 'primary');
      group('scopeChoices', 's', 'scope');
      group('dChoices', 'd', 'diff');
      group('mapChoices', 'map', 'map', () => this.selectMap(S.map));
      group('modeChoices', 'mode', 'mode', () => G.Mods.buildUI());
      group('operatorChoices', 'op', 'operator');
      group('leanChoices', 'l', 'leanMode');
      group('gfxChoices', 'g', 'gfx', () => {
        if ((S.gfx === 'low') !== G.Perf.low) { this.saveSettings(); $('loadMsg').textContent = 'Applying graphics settings…'; $('loading').style.display = 'flex'; setTimeout(() => location.reload(), 50); return; }
        const hi = S.gfx === 'high', t = G.Touch.enabled;
        this.renderer.setPixelRatio(this.pixelRatio());
        const ms = hi ? (t ? 2048 : 4096) : (t ? 1024 : 2048);
        this.sun.shadow.mapSize.set(ms, ms);
        if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
        this.resize();
      });
      group('ctrlChoices', 'c', 'controls', () => { G.Touch.setEnabled(G.Touch.detect(S.controls)); this.renderer.setPixelRatio(this.pixelRatio()); this.resize(); });
      // friendly fire
      const ffSel = () => { for (const b of $('ffChoices').children) b.classList.toggle('sel', b.dataset.f === (S.ff ? 'on' : 'off')); };
      ffSel();
      $('ffChoices').addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        S.ff = b.dataset.f === 'on'; ffSel(); this.saveSettings(); G.Audio.click(); G.Mods.buildUI();
      });
      const slider = (id, key, fmt) => {
        const el = $(id), lab = $(id + 'Val');
        el.value = S[key]; lab.textContent = fmt(S[key]);
        el.addEventListener('input', () => {
          S[key] = parseFloat(el.value); lab.textContent = fmt(S[key]); this.saveSettings();
          if (key === 'vol') G.Audio.setVolume(S.vol);
        });
      };
      slider('sens', 'sens', (v) => v.toFixed(2));
      slider('adsSens', 'adsSens', (v) => v.toFixed(2));
      slider('fov', 'fov', (v) => v + '°');
      slider('vol', 'vol', (v) => Math.round(v * 100) + '%');
      slider('touchSens', 'touchSens', (v) => v.toFixed(2));
      slider('padSens', 'padSens', (v) => v.toFixed(2));
      if (!(S.renderScale > 0)) { S.renderScale = this.renderScale(); }
      slider('renderScale', 'renderScale', (v) => Math.round(v * 100) + '%');
      $('renderScale').addEventListener('change', () => { this.renderer.setPixelRatio(this.pixelRatio()); this.resize(); });
      $('deployBtn').addEventListener('click', () => {
        G.Audio.init(); G.Audio.setVolume(S.vol);
        if (G.Touch.enabled) this.goFullscreen();
        this.startMatch();
      });
      $('resumeBtn').addEventListener('click', () => this.resume());
      $('prepStart').addEventListener('click', () => { I.pressed.Enter = true; });
      $('quitBtn').addEventListener('click', () => { if (this.mp) G.Net.leave(); else this.quitToMenu(); });
      $('againBtn').addEventListener('click', () => {
        $('matchEnd').style.display = 'none';
        if (this.mp) G.Net.returnToLobby(); else this.startMatch();
      });
      $('menuBtn').addEventListener('click', () => { $('matchEnd').style.display = 'none'; if (this.mp) G.Net.leave(); else this.quitToMenu(); });
      // teammate highlight
      const kcSel = () => { for (const b of $('kcChoices').children) b.classList.toggle('sel', b.dataset.k === (S.killcam !== false ? 'on' : 'off')); };
      kcSel();
      $('kcChoices').addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        S.killcam = b.dataset.k === 'on'; kcSel(); this.saveSettings(); G.Audio.click();
      });
      const hlSel = () => { for (const b of $('hlChoices').children) b.classList.toggle('sel', b.dataset.h === (S.teamHL !== false ? 'on' : 'off')); };
      hlSel();
      $('hlChoices').addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        S.teamHL = b.dataset.h === 'on'; hlSel(); this.saveSettings(); G.Audio.click();
      });
      $('modsBtn').addEventListener('click', () => { G.Audio.init(); this.openMods(); });
      $('pauseModsBtn').addEventListener('click', () => this.openMods());
      $('modsClose').addEventListener('click', () => this.closeMods());
      $('modsReset').addEventListener('click', () => { G.Mods.reset(); G.Audio.click(); });
      this.renderer.domElement.addEventListener('click', () => {
        if (PLAY_STATES.includes(this.state) && !this.paused && !document.pointerLockElement) this.lock();
      });
    },
    goFullscreen() {
      try {
        const d = document.documentElement, rq = d.requestFullscreen || d.webkitRequestFullscreen;
        if (rq && !document.fullscreenElement) {
          const p = rq.call(d);
          const lockO = () => { try { const q = screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape'); if (q && q.catch) q.catch(() => {}); } catch (e) { /* unsupported */ } };
          if (p && p.then) p.then(lockO).catch(() => {}); else lockO();
        }
      } catch (e) { /* fullscreen not available (e.g. iPhone Safari) */ }
    },
    lock() { if (this.lockless) return; try { const p = this.renderer.domElement.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ } },
    onLockChange() {
      if (document.pointerLockElement) { this.paused = false; $('pause').style.display = 'none'; G.Touch.show(true); }
      else if (PLAY_STATES.includes(this.state) && !this.lockless) {
        this.paused = true;
        if (!this.modsOpen) $('pause').style.display = 'flex';
        I.keys = {}; I.lmb = I.rmb = false;
      }
    },
    openPause() {
      if (!PLAY_STATES.includes(this.state)) return;
      this.paused = true;
      $('pause').style.display = 'flex';
      G.Touch.show(false);
      if (document.pointerLockElement) document.exitPointerLock();
    },
    resume() {
      $('pause').style.display = 'none';
      if (this.lockless) { this.paused = false; G.Touch.show(true); }
      else {
        this.lock();
        // if the browser refuses the lock, bring the pause screen back so the player isn't stuck
        setTimeout(() => { if (this.paused && !document.pointerLockElement && PLAY_STATES.includes(this.state) && !this.modsOpen) $('pause').style.display = 'flex'; }, 500);
      }
    },
    openMods() {
      this.modsOpen = true;
      G.Mods.buildUI();
      $('mods').style.display = 'flex';
      $('pause').style.display = 'none';
      G.Touch.show(false);
      if (PLAY_STATES.includes(this.state)) {
        this.paused = true;
        if (document.pointerLockElement) document.exitPointerLock();
      }
    },
    closeMods() {
      this.modsOpen = false;
      $('mods').style.display = 'none';
      G.Audio.click();
      if (PLAY_STATES.includes(this.state)) this.resume();
    },
    showMenu() {
      this.state = 'menu';
      this.activeMode = null;
      document.body.classList.remove('prep');
      G.Recon.clear(); G.Operators.clear();
      $('menu').style.display = 'flex'; $('hud').style.display = 'none'; $('pause').style.display = 'none';
      document.body.classList.remove('playing');
      document.body.classList.remove('mp');
      G.Touch.show(false);
      G.Highlight.clear();
      G.Fort.hideUI();
      for (const b of this.bots) b.model.root.visible = false;
      this.player.model.root.visible = false;
    },
    quitToMenu() {
      this.paused = false;
      if (document.pointerLockElement) document.exitPointerLock();
      G.Grenades.clear(); G.FX.clear(); G.W.resetPanels(); G.Nav.rebuildAll();
      G.KillCam.reset();
      this.showMenu();
    },

    // ------------------------------------------------------------- MATCH / ROUNDS
    startMatch() {
      const S = this.settings;
      this.activeMode = S.mode;
      I.keys = {}; I.pressed = {}; I.lmb = I.rmb = false;
      G.Touch.releaseAll();
      if (!this.botPool) {
        this.botPool = [
          new G.Bot('atk', 'RAVEN', 'ar'), new G.Bot('atk', 'DUNE', 'smg'),
          new G.Bot('def', 'BASTION', 'ar'), new G.Bot('def', 'KESTREL', 'smg'), new G.Bot('def', 'HOLLOW', 'sg'), new G.Bot('def', 'MARROW', 'smg'),
        ];
        this.botPool.forEach((b, i) => { b.nid = 'b' + i; b.baseName = b.name; });
      }
      for (const b of this.botPool) b.name = b.baseName;
      this.setPlayerTeam('atk');
      // 1v1 duel: you against a single bot; sides switch every few rounds
      this.bots = S.mode === 'duel' ? [this.botPool[2]] : this.botPool;
      for (const b of this.botPool) b.model.root.visible = this.bots.includes(b);
      this.winTarget = S.mode === 'duel' ? 5 : 3;
      this.entities = [this.player, ...this.bots];
      for (const e of this.entities) { e.kills = 0; e.deaths = 0; e.wins = 0; }
      this.score = { atk: 0, def: 0 };
      this.round = 0;
      $('menu').style.display = 'none';
      $('hud').style.display = 'block';
      document.body.classList.add('playing');
      G.Touch.show(true);
      this.paused = false;
      this.lock();
      this.startRound();
    },

    startRound() {
      const S = this.settings, MAP = G.MAP;
      this.round++;
      this.resetRoundWorld();
      let swapped = false;
      if (this.activeMode === 'duel') {
        this.timer = 120;
        const side = Math.floor((this.round - 1) / G.DUEL_SWAP) % 2 === 0 ? 'atk' : 'def';
        if (side !== this.player.team) { this.setDuelSide(side); swapped = true; }
      }
      // maps with several objective sites (one per floor): defenders get a random one each round
      if (MAP.sites) this.setSite((Math.random() * MAP.sites.length) | 0);
      // attackers
      const sp = G.pick(MAP.spawns);
      this.spawnName = sp.name;
      const ry = sp.yaw;
      const rx = Math.cos(ry), rz = -Math.sin(ry);
      if (this.player.team === 'def') {
        const a = G.pick(MAP.anchors);
        this.player.spawn(a[0], a[1], G.yawOf(a[2] - a[0], a[3] - a[1]), S.primary, a[4]);
      } else this.player.spawn(sp.x, sp.z, ry, S.primary, sp.y);
      const ents = MAP.entries.slice().sort((a, b) => Math.hypot(a.out[0] - sp.x, a.out[1] - sp.z) - Math.hypot(b.out[0] - sp.x, b.out[1] - sp.z));
      const secure = MAP.secure.slice().sort(() => Math.random() - 0.5);
      const atkBots = this.bots.filter((b) => b.team === 'atk');
      atkBots.forEach((b, i) => {
        const off = i === 0 ? -1.6 : 1.6;
        const entry = Math.random() < 0.6 ? ents[0] : ents[1 + ((Math.random() * 2) | 0)];
        b.spawn(sp.x + rx * off - Math.sin(ry) * -1.2, sp.z + rz * off - Math.cos(ry) * -1.2, ry, 'entry', { entry, secure: secure[i], y: sp.y });
      });
      // defenders
      const anchors = MAP.anchors.slice().sort(() => Math.random() - 0.5);
      const support = MAP.support.slice().sort(() => Math.random() - 0.5);
      const defBots = this.bots.filter((b) => b.team === 'def');
      const roles = ['anchor', 'anchor', 'support', 'roam'];
      defBots.forEach((b, i) => {
        const role = roles[i];
        const spot = role === 'anchor' ? anchors[i] : role === 'support' ? support[0] : G.pick(MAP.roam);
        b.spawn(spot[0], spot[1], G.yawOf(spot[2] - spot[0], spot[3] - spot[1]), role, { spot, y: spot[4], crouch: role === 'anchor' && Math.random() < 0.4 ? 1 : 0 });
      });
      if (this.hackerMode) {
        const spots = [...MAP.spawns.map((s) => [s.x, s.z, 0, 0, s.y || 0]), ...MAP.anchors.slice(0, 3)];
        this.entities.forEach((e, i) => {
          const [x, z] = spots[i], y = spots[i][4] || 0, yaw = G.yawOf(MAP.objective.x - x, MAP.objective.z - z);
          if (e.isPlayer) e.spawn(x, z, yaw, S.primary, y);
          else e.spawn(x, z, yaw, 'roam', { spot: [x, z, MAP.objective.x, MAP.objective.z, y], y, entry: MAP.entries[0], secure: MAP.secure[0] });
        });
      }
      this.state = 'prep'; this.prepT = 30;
      document.body.classList.add('prep');
      G.Operators.reset(); G.Recon.reset();
      G.Fort.startRound();
      const defending = this.player.team === 'def' && !this.hackerMode;
      if (!defending) G.Recon.enter('drone');
      this.buildIcons();
      const site = MAP.sites ? `${MAP.objName} (${MAP.siteFloor}) · ` : '';
      if (defending) this.big(swapped ? 'SIDES SWAPPED · DEFEND' : 'PREPARATION PHASE', `${site}${this.fortHint()} to reinforce walls & barricade doors · ENTER / START to begin early`, 'def');
      else this.big(swapped ? 'SIDES SWAPPED · ATTACK' : 'DRONING PHASE', `${site}Scout for 30s · ENTER / START to begin early`, 'atk');
      $('roundLabel').textContent = defending ? 'PREP PHASE' : 'DRONE PHASE';
      $('spectate').textContent = '';
      G.Audio.beep(660, 0.12);
    },

    // pick which objective site (floor) is in play this round
    setSite(i) {
      const MAP = G.MAP;
      if (!MAP.sites) return;
      this.siteIdx = G.clamp(i | 0, 0, MAP.sites.length - 1);
      MAP.setSite(this.siteIdx);
    },
    fortHint() { return G.Pad && G.Pad.active ? 'Hold X' : G.Touch.enabled ? 'Hold FORTIFY' : 'Hold T'; },
    setPlayerTeam(team) {
      const p = this.player;
      p.team = team;
      if (p.modelTeam !== team) {
        p.model.root.removeFromParent();
        p.model = G.buildCharacter(team, 'rifle', this.settings.scope);
        p.model.root.visible = false;
        G.scene.add(p.model.root);
        p.modelTeam = team;
      }
    },
    // 1v1 side switch: you change teams, the opponent (same name and stats) takes the other side
    setDuelSide(side) {
      const old = this.bots[0], nb = this.botPool[side === 'atk' ? 2 : 0];
      if (old && old !== nb) {
        nb.name = old.name; nb.kills = old.kills; nb.deaths = old.deaths;
        old.model.root.visible = false; old.alive = false;
      }
      this.setPlayerTeam(side);
      this.bots = [nb];
      this.entities = [this.player, nb];
      // round wins follow the people, not the side
      this.score = { atk: this.score.def, def: this.score.atk };
    },

    resetRoundWorld() {
      G.Grenades.clear(); G.FX.clear(); G.W.resetPanels(); G.Nav.rebuildAll();
      if (G.Operators) G.Operators.clear();
      G.KillCam.reset();
      G.Perf.shadowDirty = true;
      this.events = [];
      this.hc = {};
      this.secure = 0; this.timer = 180; this.spec = null; this.deathT = 0;
      $('killfeed').replaceChildren(); $('callouts').replaceChildren();
    },

    // ------------------------------------------------------------- MULTIPLAYER HOOKS (driven by G.Net)
    beginNetMatch(bots, remotes, mode) {
      this.mp = true;
      this.activeMode = mode === 'duel' ? 'duel' : 'secure';
      I.keys = {}; I.pressed = {}; I.lmb = I.rmb = false;
      G.Touch.releaseAll();
      this.bots = bots;
      this.entities = [this.player, ...remotes, ...bots];
      for (const e of this.entities) { e.kills = 0; e.deaths = 0; e.wins = 0; }
      this.score = { atk: 0, def: 0 };
      this.round = 0;
      this.winTarget = mode === 'duel' ? 5 : 3;
      $('menu').style.display = 'none';
      $('hud').style.display = 'block';
      document.body.classList.add('playing', 'mp');
      G.Touch.show(true);
      this.paused = false;
      this.lock();
    },
    endNetMatch() {
      this.mp = false;
      this.activeMode = null;
      this.bots = this.botPool || [];
      for (const b of this.bots) b.model.root.visible = false;
      this.entities = [this.player];
      document.body.classList.remove('mp');
      G.Highlight.clear();
    },
    netRoundStart(spawnName) {
      this.round++;
      this.resetRoundWorld();
      if (this.activeMode === 'duel') this.timer = 120;
      this.spawnName = spawnName;
      this.state = 'prep'; this.prepT = 15;
      document.body.classList.add('prep');
      $('roundLabel').textContent = `ROUND ${this.round}`;
      $('spectate').textContent = '';
    },
    netRoundBanner(swapped) {
      const def = this.player.team === 'def';
      const title = swapped ? `SIDES SWAPPED · ${def ? 'DEFEND' : 'ATTACK'}` : `ROUND ${this.round}`;
      const sub = def ? `${this.fortHint()} to reinforce walls & barricade doors` : `${this.activeMode === 'duel' ? '1V1 DUEL' : 'TEAM'} · ${String(this.spawnName || '').toUpperCase()} · Defenders are fortifying`;
      this.big(title, sub, this.player.team);
    },
    netRoundEnd(winner, reason) {
      this.state = 'roundEnd'; this.endT = 99;
      G.KillCam.roundEnded();
      const won = winner === this.player.team;
      this.big(won ? 'ROUND WON' : 'ROUND LOST', reason, won ? 'atk' : 'def');
      G.Audio.sting(won);
      this.buildIcons();
    },

    endRound(winner, reason) {
      if (this.state !== 'live') return;
      this.state = 'roundEnd'; this.endT = 5;
      G.Recon.exit();
      if (G.KillCam.roundEnded()) this.endT = 6.8; // everyone watches the final kill
      this.score[winner]++;
      const won = winner === this.player.team;
      this.big(won ? 'ROUND WON' : 'ROUND LOST', reason, won ? 'atk' : 'def');
      G.Audio.sting(won);
      if (this.mp) G.Net.hostEnd(winner, reason);
    },
    startLive() {
      this.state = 'live'; G.Recon.exit();
      document.body.classList.remove('prep');
      $('roundLabel').textContent = `${this.hackerMode ? 'HACKER' : 'ROUND'} ${this.round}`;
      const goal = `${this.player.team === 'def' ? 'DEFEND' : 'SECURE'} THE ${G.MAP.objName}`;
      const keys = this.mp ? (G.Touch.enabled ? 'TAP ABILITY' : 'F: ABILITY') : (G.Touch.enabled ? 'TAP ABILITY / CAMS / DRONE' : 'F: ABILITY · 5: CAMS · 6: DRONE');
      this.big(this.hackerMode ? 'HACKER ARENA' : 'ACTION PHASE', this.hackerMode ? 'Every operator for themselves · First to 3 wins · No god mode' : `${goal} · ${keys}`, 'atk');
      G.Audio.beep(990, 0.25);
    },
    finishHackerRound(winner) {
      if (this.state !== 'live') return;
      if (winner) winner.wins++;
      this.score.atk = this.player.wins;
      this.score.def = Math.max(...this.bots.map((b) => b.wins));
      this.state = 'roundEnd'; this.endT = 5; G.Recon.exit();
      if (G.KillCam.roundEnded()) this.endT = 6.8;
      this.big(winner ? `${winner.name} WINS` : 'DRAW', winner ? `${winner.wins} / 3 ROUND WINS` : 'No survivors', winner === this.player ? 'atk' : 'def');
      this.buildIcons();
    },

    // ------------------------------------------------------------- EVENTS
    soundEvent(pos, radius, team, kind) {
      this.events.push({ id: ++this.evId, pos: pos.clone(), radius, team, kind, t: G.time });
    },
    shake(a) { this.shakeAmt = Math.max(this.shakeAmt, a); },
    pushEntities(ent) {
      for (const e of this.entities) {
        if (e === ent || !e.alive) continue;
        const dx = ent.pos.x - e.pos.x, dz = ent.pos.z - e.pos.z, d = Math.hypot(dx, dz);
        if (d < 0.58 && d > 1e-4 && Math.abs(ent.pos.y - e.pos.y) < 1.5) {
          const p = (0.58 - d) * 0.5 / d;
          ent.pos.x += dx * p; ent.pos.z += dz * p;
        }
      }
    },
    onKill(killer, victim, head, fromNet) {
      if (this.mp && !fromNet) G.Net.onLocalKill(killer, victim, head);
      G.KillCam.noteKill(killer, victim, head);
      const tk = !!(killer && killer !== victim && !this.isEnemy(killer, victim));
      if (killer && killer !== victim) killer.kills += tk ? -1 : 1;
      const kname = killer ? killer.name : '';
      const w = killer ? (killer.isPlayer ? killer.w.def.name : killer.def ? killer.def.name : '') : '';
      const el = document.createElement('div');
      el.className = 'kf';
      el.innerHTML = killer && killer !== victim
        ? `<span class="${killer.team}">${kname}</span><span class="w">${w}</span>${tk ? '<span class="tk">TEAMKILL</span>' : ''}${head ? '<span class="hs">HEADSHOT</span>' : ''}<span class="${victim.team}">${victim.name}</span>`
        : `<span class="${victim.team}">${victim.name}</span><span class="w">DIED</span>`;
      if (tk && killer.isPlayer) this.callout(victim.name, 'Friendly fire!! Watch it!');
      $('killfeed').prepend(el);
      setTimeout(() => { el.style.opacity = '0'; }, 6000);
      setTimeout(() => el.remove(), 6600);
      if (victim.isPlayer) {
        this.deathT = 0;
        G.KillCam.onPlayerKilled(killer && killer !== victim ? killer : null, head);
        this.big('ELIMINATED', killer && killer !== victim ? `BY ${kname}${tk ? ' (TEAMKILL)' : ''}` : '', 'def');
      } else if (killer && killer.isPlayer) {
        G.Audio.hit(head, true);
        if (fromNet) this.hitMarker(head, true);
      }
      this.buildIcons();
    },
    onPlayerHurt(amt, attacker, dx, dz) {
      $('hurt').style.opacity = Math.min(0.9, 0.35 + amt / 80);
      clearTimeout(this.hurtTO);
      this.hurtTO = setTimeout(() => { $('hurt').style.opacity = 0; }, 180);
      if (attacker && attacker !== this.player) {
        const p = this.player;
        const yaw = G.yawOf(attacker.pos.x - p.pos.x, attacker.pos.z - p.pos.z);
        const rel = G.wrap(yaw - p.yaw);
        const el = document.createElement('div');
        el.className = 'dmgArc';
        el.style.transform = `rotate(${(-rel * 180) / Math.PI}deg)`;
        $('dmgInd').appendChild(el);
        el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 1400, easing: 'ease-in' });
        setTimeout(() => el.remove(), 1400);
      }
    },
    hitMarker(head, kill) {
      const h = $('hitmarker');
      h.classList.toggle('kill', !!kill);
      h.getAnimations().forEach((a) => a.cancel());
      h.animate([{ opacity: 1, transform: 'scale(1.25)' }, { opacity: 0, transform: 'scale(1)' }], { duration: kill ? 450 : 220 });
      if (!kill) G.Audio.hit(head, false);
    },
    callout(name, msg) {
      const el = document.createElement('div');
      el.className = 'co';
      const nb = document.createElement('b'); nb.textContent = name + ': ';
      el.append(nb, document.createTextNode(msg));
      const box = $('callouts');
      box.appendChild(el);
      while (box.children.length > 4) box.firstChild.remove();
      setTimeout(() => { el.style.opacity = '0'; }, 4000);
      setTimeout(() => el.remove(), 4700);
    },
    big(a, b, cls) {
      const m = $('bigMsg');
      m.textContent = a; m.className = cls || '';
      $('subMsg').textContent = b || '';
      m.getAnimations().forEach((x) => x.cancel());
      this.bigT = 3;
    },
    buildIcons() {
      const mk = (team, box) => {
        const el = $(box); el.innerHTML = '';
        for (const e of this.entities.filter((x) => this.hackerMode ? (team === 'atk' ? x.isPlayer : !x.isPlayer) : x.team === team)) {
          const d = document.createElement('div');
          d.className = 'op' + (e.alive ? '' : ' dead') + (e.isPlayer ? ' me' : '');
          d.textContent = e.name.slice(0, 3);
          el.appendChild(d);
        }
      };
      mk('atk', 'atkIcons'); mk('def', 'defIcons');
      $('scoreAtk').textContent = this.score.atk; $('scoreDef').textContent = this.score.def;
    },

    // ------------------------------------------------------------- LOOP
    loop(t) {
      requestAnimationFrame((tt) => this.loop(tt));
      const dt = Math.min(0.05, (t - this.last) / 1000);
      if (!(dt > 0)) return; // same or older timestamp: nothing to simulate
      this.last = t;
      if (G.Pad) G.Pad.poll(dt);
      // multiplayer keeps simulating while the pause menu is open (you just can't act)
      if (this.mp && this.paused) { I.keys = {}; I.pressed = {}; I.lmb = I.rmb = false; I.mdx = I.mdy = 0; }
      const running = (!this.paused || this.mp) && this.state !== 'menu' && this.state !== 'boot' && this.state !== 'matchEnd';
      if (running) this.update(this.mp ? dt : dt * G.Mods.c.timeScale);
      else if (this.state === 'menu') { G.time += dt; this.menuCam(dt); }
      this.render(dt);
      I.pressed = {}; I.mdx = 0; I.mdy = 0; I.wheel = 0;
    },

    update(dt) {
      G.time += dt;
      const p = this.player;
      const host = !this.mp || G.Net.isHost;
      const target = this.winTarget || 3;
      if (this.state === 'prep') {
        this.prepT -= dt;
        if (host && (this.prepT <= 0 || (!this.mp && I.pressed.Enter))) { this.startLive(); if (this.mp) G.Net.hostLive(); }
        else if (!host && this.prepT < -3) this.startLive(); // host message lost: don't get stuck
      } else if (this.state === 'live') {
        if (!G.Mods.c.noTimer || this.mp) this.timer -= dt;
      } else if (this.state === 'roundEnd') {
        this.endT -= dt;
        if (host && this.endT <= 0) {
          if (this.score.atk >= target || this.score.def >= target) { if (this.mp) G.Net.hostOver(); return this.matchOver(); }
          if (this.mp) G.Net.hostStartRound(); else this.startRound();
          return;
        }
      }
      // prune events
      while (this.events.length && G.time - this.events[0].t > 1.5) this.events.shift();

      if (!this.mp) G.Recon.update(dt);
      p.update(dt);
      G.Operators.update(dt);
      G.Fort.update(dt);
      for (const b of this.bots) b.update(dt);
      if (this.mp) G.Net.update(dt);
      G.Grenades.update(dt);
      G.Nav.flush();
      G.FX.update(dt);
      G.VM.update(dt);
      G.Mods.update();
      G.KillCam.update(dt);
      this.shakeAmt = G.damp(this.shakeAmt, 0, 6, dt);
      if (!p.alive) this.deathT += dt;

      if (this.hackerMode) {
        if (this.state === 'live') {
          const alive = this.entities.filter((e) => e.alive);
          if (alive.length <= 1 || this.timer <= 0) {
            alive.sort((a, b) => b.hp - a.hp || b.kills - a.kills);
            this.finishHackerRound(alive[0] || null);
          }
        }
        if (!p.alive && I.pressed.mouse0) this.nextSpec();
        return;
      }

      // secure area
      const z = G.MAP.zone;
      this.zoneAtk = 0; this.zoneDef = 0;
      for (const e of this.entities) {
        if (!e.alive) continue;
        if (e.pos.x > z.x0 && e.pos.x < z.x1 && e.pos.z > z.z0 && e.pos.z < z.z1 && (z.y0 === undefined || (e.pos.y > z.y0 - 0.6 && e.pos.y < z.y1))) { if (e.team === 'atk') this.zoneAtk++; else this.zoneDef++; }
      }
      if (this.state === 'live' && host) {
        if (this.zoneAtk > 0 && this.zoneDef === 0) this.secure += dt;
        else if (this.zoneAtk === 0) this.secure = Math.max(0, this.secure - dt * 0.5);
        const atkAlive = this.entities.some((e) => e.team === 'atk' && e.alive);
        const defAlive = this.entities.some((e) => e.team === 'def' && e.alive);
        if (!defAlive) this.endRound('atk', 'ENEMY TEAM ELIMINATED');
        else if (!atkAlive) this.endRound('def', 'ATTACKERS ELIMINATED');
        else if (this.secure >= 10) this.endRound('atk', 'AREA SECURED');
        else if (this.timer <= 0) this.endRound('def', 'TIME EXPIRED');
      }
      // spectate cycling
      if (!p.alive && I.pressed.mouse0 && !G.KillCam.active) this.nextSpec();
    },

    matchOver() {
      this.state = 'matchEnd';
      if (document.pointerLockElement) document.exitPointerLock();
      G.Touch.show(false);
      document.body.classList.remove('playing');
      const other = this.player.team === 'def' ? 'atk' : 'def';
      const won = this.score[this.player.team] > this.score[other];
      const champion = this.hackerMode ? this.entities.find((e) => e.wins >= 3) : null;
      $('matchResult').textContent = champion ? `${champion.name} WINS` : won ? 'VICTORY' : 'DEFEAT';
      $('matchResult').style.color = won ? 'var(--atk)' : 'var(--def)';
      $('matchScore').textContent = `${this.score.atk} - ${this.score.def}`;
      if (this.mp) {
        const w = this.score.atk > this.score.def ? 'atk' : 'def';
        $('matchResult').textContent = w === this.player.team ? 'VICTORY' : 'DEFEAT';
        $('matchResult').style.color = w === this.player.team ? 'var(--atk)' : 'var(--def)';
      }
      $('againBtn').textContent = this.mp ? 'BACK TO LOBBY' : 'PLAY AGAIN';
      $('menuBtn').textContent = this.mp ? 'LEAVE LOBBY' : 'MAIN MENU';
      $('matchEnd').style.display = 'flex';
    },

    nextSpec() {
      const mates = this.entities.filter((b) => b !== this.player && (this.hackerMode || b.team === this.player.team) && b.alive);
      if (!mates.length) { this.spec = null; return; }
      const i = mates.indexOf(this.spec);
      this.spec = mates[(i + 1) % mates.length];
    },

    menuCam(dt) {
      const a = G.time * 0.05, mc = G.MAP.menuCam;
      this.camera.position.set(Math.sin(a) * mc.r, mc.h + Math.sin(G.time * 0.1) * 2, Math.cos(a) * mc.r);
      this.camera.lookAt(0, 1.5, 0);
      this.camera.fov = 60; this.camera.updateProjectionMatrix();
    },

    render(dt) {
      const r = this.renderer, cam = this.camera, p = this.player;
      if (G.MAP.update) G.MAP.update(dt, cam);
      let showVM = false;
      if (this.state !== 'menu' && this.state !== 'boot') {
        for (const b of this.bots) b.model.root.visible = true;
        if (this.mp) for (const e of this.entities) if (e.isRemotePlayer) e.model.root.visible = true;
        p.model.root.visible = !p.alive || !!G.Recon.active;
        if (G.KillCam.apply(cam, dt)) { showVM = true; /* replay from the killer's eyes, with their gun */ }
        else if (p.alive && G.Recon.applyView(cam)) { /* remote view; body stays in the world */ }
        else if (p.alive) { p.updateView(cam, dt); showVM = true; }
        else if (this.deathT > 2.5) {
          if (!this.spec || !this.spec.alive) this.nextSpec();
          if (this.spec) {
            const s = this.spec;
            s.model.root.visible = false;
            cam.position.copy(s.eye);
            cam.rotation.set(s.aimPitch, s.aimYaw, -s.lean * 0.2, 'YXZ');
            if (cam.fov !== this.settings.fov) { cam.fov = this.settings.fov; cam.updateProjectionMatrix(); }
          } else p.updateView(cam, dt);
        } else p.updateView(cam, dt);
        this.updateHUD();
      }
      // audio listener
      if (G.Audio.ready) {
        const f = new V(0, 0, -1).applyQuaternion(cam.quaternion), u = new V(0, 1, 0).applyQuaternion(cam.quaternion);
        G.Audio.setListener(cam.position, f, u);
        G.Audio.setAmbience(!G.MAP.indoors(cam.position.x, cam.position.z, cam.position.y));
      }
      G.Perf.frame(dt, cam);
      r.clear();
      r.render(G.scene, cam);
      G.Mods.renderChams(r, G.scene, cam);
      if (showVM) { r.clearDepth(); r.render(G.VM.scene, G.VM.camera); }
      G.Mods.drawESP(cam);
      if (this.state !== 'menu' && this.state !== 'boot') G.Highlight.update(cam);
      if (['prep', 'live', 'roundEnd'].includes(this.state)) G.Operators.draw(cam);
      G.Touch.updateButtons(p);
    },

    // ------------------------------------------------------------- HUD
    updateHUD() {
      const p = this.player, cache = (this.hc = this.hc || {});
      const set = (id, v, prop = 'textContent') => { if (cache[id] !== v) { cache[id] = v; $(id)[prop] = v; } };
      // write styles/classes only when they change — every DOM write can force a layout pass on iPad
      const css = (id, prop, v) => { const k = id + '.' + prop; if (cache[k] !== v) { cache[k] = v; $(id).style[prop] = v; } };
      const cls = (id, c, on) => { const k = id + ':' + c; on = !!on; if (cache[k] !== on) { cache[k] = on; $(id).classList.toggle(c, on); } };
      const t = Math.max(0, this.state === 'prep' ? this.prepT : this.timer);
      const tc = this.state === 'prep' ? Math.ceil(t) : Math.floor(t);
      const tt = `${Math.floor(tc / 60)}:${String(tc % 60).padStart(2, '0')}`;
      set('timer', tt);
      cls('timer', 'low', this.state === 'live' && t < 30);
      if (p.alive) {
        const w = p.w;
        set('hpNum', String(Math.ceil(p.hp)));
        const hpf = Math.max(0, p.hp) + '%';
        if (cache.hpf !== hpf) { cache.hpf = hpf; $('hpFill').style.width = hpf; $('hpFill').classList.toggle('low', p.hp < 35); }
        set('mag', String(w.mag));
        cls('mag', 'low', w.mag <= Math.ceil(w.def.mag * 0.25));
        set('reserve', String(w.reserve));
        set('weaponName', w.def.name);
        set('gadgetCount', 'x' + p.grenades);
        // crosshair
        const hs = Math.hypot(p.vel.x, p.vel.z);
        const spread = w.def.hip + p.bloom + (hs / 5) * w.def.move + (p.grounded ? 0 : 0.05);
        const gap = Math.round(5 + spread * 260);
        const ch = $('crosshair');
        const hide = p.ads > 0.5 || p.sprint > 0.5 || p.busy;
        const op = hide ? '0' : '1';
        if (cache.cho !== op) { cache.cho = op; ch.style.opacity = op; }
        if (cache.gap !== gap) {
          cache.gap = gap;
          ch.children[0].style.top = -(gap + 9) + 'px'; ch.children[1].style.top = gap + 'px';
          ch.children[2].style.left = -(gap + 9) + 'px'; ch.children[3].style.left = gap + 'px';
        }
        css('leanL', 'opacity', p.lean < -0.3 ? '1' : '0');
        css('leanR', 'opacity', p.lean > 0.3 ? '1' : '0');
        const st = p.vault ? 'VAULTING' : p.crouch > 0.5 ? 'CROUCHED' : p.sprint > 0.5 ? 'SPRINTING' : '';
        set('stance', st);
        // contextual hint
        let hint = '';
        if (this.state === 'live' || this.state === 'prep') {
          const f = G.dirFrom(p.yaw, p.pitch, new V());
          const h = G.W.raycast(p.eye.x, p.eye.y, p.eye.z, f.x, f.y, f.z, 1.8);
          const tch = G.Touch.enabled;
          if (h && h.s.type === 1 && h.s.kind === 'barricade') hint = tch ? 'TAP MELEE TO BREAK BARRICADE' : '[V] MELEE TO BREAK BARRICADE';
          else if (w.mag === 0 && w.reserve > 0) hint = tch ? 'TAP R TO RELOAD' : '[R] RELOAD';
          else if (w.mag === 0 && w.reserve === 0 && p.cur === 0) hint = tch ? 'TAP SWAP FOR SIDEARM' : '[2] SWITCH TO SIDEARM';
        }
        set('hint', hint);
        set('spectate', '');
      } else {
        if (cache.cho !== '0') { $('crosshair').style.opacity = 0; cache.cho = '0'; }
        set('hint', '');
        set('hpNum', '0');
        set('spectate', this.spec && this.deathT > 2.5 ? `SPECTATING ${this.spec.name} · ${G.Touch.enabled ? 'TAP FIRE' : 'CLICK'} TO SWITCH` : '');
      }
      // objective marker
      const om = $('objMarker');
      const o = G.MAP.objective.clone().project(this.camera);
      if (!this.hackerMode && o.z < 1 && (this.state === 'live' || this.state === 'prep')) {
        const x = (o.x * 0.5 + 0.5) * innerWidth, y = (-o.y * 0.5 + 0.5) * innerHeight;
        css('objMarker', 'display', 'flex');
        css('objMarker', 'transform', `translate(${Math.round(G.clamp(x, 40, innerWidth - 40))}px, ${Math.round(G.clamp(y, 80, innerHeight - 60))}px) translate(-50%, -50%)`);
        // multi-floor maps: point up or down when the objective is on another floor
        const fy = G.MAP.objective.y - 1.3 - (this.camera.position.y - 1.6), arrow = fy > 1.7 ? ' ▲' : fy < -1.7 ? ' ▼' : '';
        set('objDist', `OBJECTIVE ${Math.round(this.camera.position.distanceTo(G.MAP.objective))}m${arrow}`);
        const ads = p.alive && p.ads > 0.5 && Math.hypot(x - innerWidth / 2, y - innerHeight / 2) < 120;
        css('objMarker', 'opacity', ads ? '0.25' : '1');
      } else css('objMarker', 'display', 'none');
      // secure bar
      const sb = $('secure');
      const showSecure = !this.hackerMode && this.state === 'live' && (this.zoneAtk > 0 || this.secure > 0);
      css('secure', 'display', showSecure ? 'block' : 'none');
      if (showSecure) {
        const contested = this.zoneAtk > 0 && this.zoneDef > 0;
        cls('secure', 'contested', contested);
        set('secureLabel', contested ? 'CONTESTED' : this.zoneAtk > 0 ? 'SECURING AREA' : 'AREA SECURE DECAYING');
        css('secureFill', 'width', Math.round(this.secure * 10) + '%');
      }
      // big message fade
      if (this.bigT > 0) {
        this.bigT -= 1 / 60;
        const op = String(Math.round(Math.min(1, this.bigT * 1.5) * 20) / 20);
        css('center', 'opacity', this.state === 'roundEnd' ? '1' : op);
      } else if (this.state !== 'roundEnd') css('center', 'opacity', '0');
      // scoreboard
      const sbd = $('scoreboard');
      if (I.keys.Tab) {
        css('scoreboard', 'display', 'block');
        $('sbBody').innerHTML = this.entities.map((e) => `<tr class="${e.team}${e.alive ? '' : ' dead'}"><td>${e.name}${this.hackerMode ? ' · ' + e.wins + ' W' : ''}</td><td>${e.kills}</td><td>${e.deaths}</td><td>${e.alive ? Math.ceil(e.hp) + ' HP' : 'DEAD'}</td></tr>`).join('');
      } else css('scoreboard', 'display', 'none');
      if (cache.score !== this.score.atk + '-' + this.score.def) { cache.score = this.score.atk + '-' + this.score.def; this.buildIcons(); }
    },
  });

  // boot
  addEventListener('load', () => {
    setTimeout(() => {
      try { Game.init(); }
      catch (e) { console.error(e); $('loadMsg').textContent = 'Failed to start: ' + e.message; }
    }, 30);
  });
})();
