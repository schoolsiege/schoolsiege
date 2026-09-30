'use strict';
// Touch controls: floating move stick, drag-to-look anywhere on the right, and a fire button
// that keeps steering the camera while it is held.
(function () {
  const G = window.G;

  const T = (G.Touch = {
    enabled: false,
    touches: new Map(),
    fireCount: 0,

    detect(mode) {
      if (mode === 'touch') return true;
      if (mode === 'keyboard') return false;
      const hasTouch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
      return hasTouch && matchMedia('(pointer: coarse)').matches;
    },

    init() {
      if (this.ready) return;
      this.ready = true;
      this.el = document.getElementById('touch');
      this.base = document.getElementById('joyBase');
      this.knob = document.getElementById('joyKnob');
      const opts = { passive: false };
      this.el.addEventListener('touchstart', (e) => this.start(e), opts);
      this.el.addEventListener('touchmove', (e) => this.move(e), opts);
      this.el.addEventListener('touchend', (e) => this.end(e), opts);
      this.el.addEventListener('touchcancel', (e) => this.end(e), opts);
      addEventListener('resize', () => this.layout());
      this.layout();
    },

    setEnabled(on) {
      this.enabled = on;
      document.body.classList.toggle('touch', on);
      if (on) this.init();
      this.releaseAll();
    },

    show(on) {
      if (!this.ready) return;
      this.el.style.display = on && this.enabled ? 'block' : 'none';
      if (!on) this.releaseAll();
    },

    layout() {
      const s = G.clamp(Math.min(innerHeight / 400, innerWidth / 760), 0.72, 1.35);
      document.documentElement.style.setProperty('--ts', s);
    },

    releaseAll() {
      const I = G.Input;
      this.touches.clear();
      this.fireCount = 0;
      I.lmb = false; I.rmb = false; I.joyX = 0; I.joyY = 0; I.joySprint = false;
      I.keys.Tab = false; I.keys.Space = false; I.keys.ShiftLeft = false; I.keys.KeyT = false;
      if (this.base) this.base.style.display = 'none';
      if (this.el) for (const b of this.el.querySelectorAll('.tb.held')) b.classList.remove('held');
    },

    start(e) {
      e.preventDefault();
      const I = G.Input, Gm = G.Game;
      for (const t of e.changedTouches) {
        const btn = t.target && t.target.closest ? t.target.closest('[data-act]') : null;
        const info = { x: t.clientX, y: t.clientY, role: 'look', btn };
        const act = btn ? btn.dataset.act : null;
        if (btn) { btn.classList.add('held'); }
        switch (act) {
          case 'cams': I.pressed.Digit5 = true; info.role = 'none'; break;
          case 'drone': I.pressed.Digit6 = true; info.role = 'none'; break;
          case 'ability': I.pressed.KeyF = true; info.role = 'none'; break;
          case 'fort': I.keys.KeyT = true; info.role = 'fort'; break;
          case 'scan': I.pressed.KeyX = true; info.role = 'none'; break;
          case 'prevCam': I.pressed.KeyQ = true; info.role = 'none'; break;
          case 'nextCam': I.pressed.KeyE = true; info.role = 'none'; break;
          case 'exitRecon': I.pressed.Digit1 = true; info.role = 'none'; break;
          case 'boost': I.keys.ShiftLeft = true; info.role = 'boost'; break;
          case 'fire':
            info.role = 'fire'; this.fireCount++;
            I.lmb = true; I.pressed.mouse0 = true;
            break;
          case 'ads': I.rmb = !I.rmb; break;
          case 'leanL': I.pressed.KeyQ = true; break;
          case 'leanR': I.pressed.KeyE = true; break;
          case 'crouch': I.pressed.KeyC = true; break;
          case 'jump': I.pressed.Space = true; I.keys.Space = true; info.role = 'jump'; break;
          case 'reload': I.pressed.KeyR = true; break;
          case 'melee': I.pressed.KeyV = true; break;
          case 'nade': I.pressed.KeyG = true; break;
          case 'swap': I.wheel = 1; break;
          case 'score': I.keys.Tab = true; info.role = 'score'; break;
          case 'pause': Gm.openPause(); info.role = 'none'; break;
          case 'mods': Gm.openMods(); info.role = 'none'; break;
          default:
            if (!btn && t.clientX < innerWidth * 0.42) {
              info.role = 'joy';
              const r = this.radius();
              info.cx = G.clamp(t.clientX, r + 8, innerWidth * 0.42);
              info.cy = G.clamp(t.clientY, r + 60, innerHeight - r - 8);
              this.base.style.display = 'block';
              this.base.style.left = info.cx + 'px';
              this.base.style.top = info.cy + 'px';
              this.setKnob(info, t.clientX, t.clientY);
            }
        }
        this.touches.set(t.identifier, info);
      }
    },

    radius() { return 58 * parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ts') || 1); },

    setKnob(info, x, y) {
      const I = G.Input, r = this.radius();
      let dx = x - info.cx, dy = y - info.cy;
      const d = Math.hypot(dx, dy);
      I.joySprint = d > r * 1.2 && -dy / Math.max(d, 1) > 0.7;
      if (d > r) { dx *= r / d; dy *= r / d; }
      I.joyX = dx / r; I.joyY = -dy / r;
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.base.classList.toggle('sprint', I.joySprint);
    },

    move(e) {
      e.preventDefault();
      const I = G.Input, S = G.Game.settings;
      const k = 2.4 * (S.touchSens || 1);
      for (const t of e.changedTouches) {
        const info = this.touches.get(t.identifier);
        if (!info) continue;
        if (info.role === 'joy') { this.setKnob(info, t.clientX, t.clientY); continue; }
        if (info.role === 'look' || info.role === 'fire') {
          I.mdx += (t.clientX - info.x) * k;
          I.mdy += (t.clientY - info.y) * k;
        }
        info.x = t.clientX; info.y = t.clientY;
      }
    },

    end(e) {
      e.preventDefault();
      const I = G.Input;
      for (const t of e.changedTouches) {
        const info = this.touches.get(t.identifier);
        if (!info) continue;
        this.touches.delete(t.identifier);
        if (info.btn) info.btn.classList.remove('held');
        if (info.role === 'fire') { this.fireCount = Math.max(0, this.fireCount - 1); if (!this.fireCount) I.lmb = false; }
        else if (info.role === 'joy') { I.joyX = 0; I.joyY = 0; I.joySprint = false; this.base.style.display = 'none'; }
        else if (info.role === 'score') I.keys.Tab = false;
        else if (info.role === 'jump') I.keys.Space = false;
        else if (info.role === 'boost') I.keys.ShiftLeft = false;
        else if (info.role === 'fort') I.keys.KeyT = false;
      }
    },

    // reflect toggle states on the buttons
    updateButtons(p) {
      if (!this.enabled || !this.ready) return;
      const I = G.Input;
      const set = (id, on) => { const b = document.getElementById(id); if (b && b._on !== on) { b._on = on; b.classList.toggle('on', on); } };
      set('tAds', !!I.rmb);
      set('tLeanL', p.leanToggle === -1);
      set('tLeanR', p.leanToggle === 1);
      set('tCrouch', !!p.crouchOn);
      const n = G.Mods.c.infNades ? '∞' : String(p.grenades || 0);
      if (this._nades !== n) { this._nades = n; document.getElementById('tNadeN').textContent = n; }
    },
  });
})();
