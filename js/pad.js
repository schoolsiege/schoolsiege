'use strict';
// Gamepad support (standard mapping: Xbox / PlayStation / most USB & Bluetooth pads).
// Feeds the same G.Input fields the keyboard and touch controls use.
(function () {
  const G = window.G;
  const B = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, START: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
  const DEAD = 0.16;
  const PLAY = ['live', 'prep', 'roundEnd'];

  const dz = (v) => {
    const a = Math.abs(v);
    if (a < DEAD) return 0;
    const t = (a - DEAD) / (1 - DEAD);
    return Math.sign(v) * t * t * 0.55 + Math.sign(v) * t * 0.45; // soft response curve
  };

  const P = (G.Pad = {
    index: -1, active: false, lastUse: -1e9, prev: [], lean: 0, sprint: false, heldKeys: new Set(), wroteStick: false,
    focusIdx: 0, navCd: 0,

    init() {
      addEventListener('gamepadconnected', (e) => { this.index = e.gamepad.index; this.toast(`CONTROLLER CONNECTED — ${this.shortName(e.gamepad.id)}`); });
      addEventListener('gamepaddisconnected', (e) => {
        if (e.gamepad.index === this.index) { this.index = -1; this.active = false; this.releaseKeys(); this.toast('CONTROLLER DISCONNECTED'); }
      });
    },
    shortName(id) { return (id || 'GAMEPAD').replace(/\(.*?\)/g, '').trim().slice(0, 32).toUpperCase(); },
    get() {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      if (this.index >= 0 && pads[this.index]) return pads[this.index];
      for (const p of pads) if (p && p.connected) { this.index = p.index; return p; }
      return null;
    },

    toast(msg) {
      let el = document.getElementById('padToast');
      if (!el) { el = document.createElement('div'); el.id = 'padToast'; document.body.appendChild(el); }
      el.textContent = msg;
      el.classList.add('show');
      clearTimeout(this.toastT);
      this.toastT = setTimeout(() => el.classList.remove('show'), 2600);
    },

    rumble(dur, weak, strong) {
      const gp = this.get();
      if (!gp || !this.active || G.Game.settings.padRumble === false) return;
      const a = gp.vibrationActuator;
      if (a && a.playEffect) a.playEffect('dual-rumble', { duration: dur * 1000, weakMagnitude: weak, strongMagnitude: strong }).catch(() => {});
    },

    holdKey(code, down) {
      const I = G.Input;
      if (down) { if (!I.keys[code]) I.pressed[code] = true; I.keys[code] = true; this.heldKeys.add(code); }
      else if (this.heldKeys.has(code)) { I.keys[code] = false; this.heldKeys.delete(code); }
    },
    releaseKeys() {
      for (const k of this.heldKeys) G.Input.keys[k] = false;
      this.heldKeys.clear();
      const I = G.Input;
      if (this.wroteStick) { I.joyX = 0; I.joyY = 0; I.joySprint = false; this.wroteStick = false; }
      if (this.firing) { I.lmb = false; this.firing = false; }
      if (this.aiming) { I.rmb = false; this.aiming = false; }
      this.lean = 0; this.sprint = false;
    },

    poll(dt) {
      const gp = this.get();
      if (!gp) return;
      const btn = (i) => !!(gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.35));
      const now = [];
      for (let i = 0; i < 17; i++) now[i] = btn(i);
      const down = (i) => now[i] && !this.prev[i];
      const lx = dz(gp.axes[0] || 0), ly = dz(gp.axes[1] || 0), rx = dz(gp.axes[2] || 0), ry = dz(gp.axes[3] || 0);
      if (now.some(Boolean) || lx || ly || rx || ry) { this.lastUse = performance.now(); if (!this.active) { this.active = true; document.body.classList.add('pad'); } }

      const Gm = G.Game, I = G.Input;
      const overlay = this.overlay();
      if (!overlay && this.navOverlay) { this.clearFocus(); this.navOverlay = null; }
      if (overlay) {
        this.menuNav(overlay, now, down, lx, ly, dt);
      } else if (PLAY.includes(Gm.state) && !Gm.paused) {
        this.play(gp, now, down, lx, ly, rx, ry, dt);
      }
      if (!overlay && down(B.START)) {
        if (PLAY.includes(Gm.state)) Gm.openPause();
      }
      this.prev = now;
    },

    // ---------------------------------------------------------------- in-game
    play(gp, now, down, lx, ly, rx, ry, dt) {
      const I = G.Input, S = G.Game.settings, p = G.Game.player;
      const recon = G.Recon && G.Recon.active;
      // move
      if (lx || ly) { I.joyX = lx; I.joyY = -ly; this.wroteStick = true; }
      else if (this.wroteStick) { I.joyX = 0; I.joyY = 0; this.wroteStick = false; }
      // look (right stick) — converted to the same units as mouse movement
      const k = 1500 * (S.padSens || 1) * dt;
      I.mdx += rx * k;
      I.mdy += ry * k * (S.padInvert ? -1 : 1);
      // triggers
      const lt = now[B.LT], rt = now[B.RT];
      if (lt !== this.aiming) { I.rmb = lt; this.aiming = lt; }
      if (rt && !this.firing) I.pressed.mouse0 = true;
      if (rt !== this.firing) { I.lmb = rt; this.firing = rt; }
      if (rt) this.lastFire = performance.now();

      if (recon) {
        // cameras / drone: d-pad cycles cameras, A jumps drone, LS click boosts, B leaves
        if (down(B.LEFT)) I.pressed.KeyQ = true;
        if (down(B.RIGHT)) I.pressed.KeyE = true;
        this.holdKey('Space', now[B.A]);
        I.joySprint = now[B.LS] && this.wroteStick;
        if (down(B.B)) I.pressed.Digit1 = true;
        if (down(B.Y)) { if (G.Game.state === 'prep') I.pressed.Enter = true; else I.pressed.Digit1 = true; }
      } else {
        // lean: while aiming (LT held) click LS = lean left, RS = lean right; same side again = stand straight
        if (lt) {
          if (down(B.LS)) this.lean = this.lean === -1 ? 0 : -1;
          if (down(B.RS)) this.lean = this.lean === 1 ? 0 : 1;
        } else {
          this.lean = 0;
          // not aiming: LS = sprint toggle, RS = melee
          if (down(B.LS)) this.sprint = !this.sprint;
          if (down(B.RS)) I.pressed.KeyV = true;
        }
        if (Math.hypot(lx, ly) < 0.3 || -ly < 0.5 || lt) this.sprint = false;
        if (this.sprint) { I.joySprint = true; this.wroteStick = true; } else if (this.wroteStick && !G.Touch.enabled) I.joySprint = false;

        this.holdKey('Space', now[B.A]);
        if (down(B.B)) I.pressed.KeyC = true;
        if (down(B.X)) I.pressed.KeyR = true;
        if (down(B.Y)) { if (G.Game.state === 'prep') I.pressed.Enter = true; else I.wheel = 1; }
        if (down(B.RB)) I.pressed.KeyF = true;
        if (down(B.LB)) I.pressed.KeyG = true;
      }
      if (down(B.UP)) I.pressed.Digit5 = true;
      if (down(B.DOWN)) I.pressed.Digit6 = true;
      this.holdKey('Tab', now[B.VIEW]);
      // spectating: A or RT switches who you watch
      if (p && !p.alive && (down(B.A) || down(B.RT))) I.pressed.mouse0 = true;
    },

    // ---------------------------------------------------------------- menus
    overlay() {
      for (const id of ['mods', 'lobby', 'mp', 'pause', 'matchEnd', 'menu']) {
        const el = document.getElementById(id);
        if (el && getComputedStyle(el).display !== 'none') return el;
      }
      return null;
    },
    clearFocus() { for (const el of document.querySelectorAll('.padFocus')) el.classList.remove('padFocus'); },
    items(overlay) {
      return [...overlay.querySelectorAll('button, input[type=range]')].filter((el) => el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden');
    },
    menuNav(overlay, now, down, lx, ly, dt) {
      if (this.navOverlay !== overlay) { this.clearFocus(); this.navOverlay = overlay; this.focusIdx = 0; this.releaseKeys(); }
      const items = this.items(overlay);
      if (!items.length) return;
      this.focusIdx = G.clamp(this.focusIdx, 0, items.length - 1);
      this.navCd -= dt;
      let dy = (down(B.DOWN) ? 1 : 0) - (down(B.UP) ? 1 : 0), dx = (down(B.RIGHT) ? 1 : 0) - (down(B.LEFT) ? 1 : 0);
      if (!dy && !dx && this.navCd <= 0) {
        if (ly > 0.5) dy = 1; else if (ly < -0.5) dy = -1;
        else if (lx > 0.5) dx = 1; else if (lx < -0.5) dx = -1;
        if (dy || dx) this.navCd = 0.2;
      }
      if (!ly && !lx) this.navCd = Math.min(this.navCd, 0);
      const cur = items[this.focusIdx];
      if (dx && cur && cur.type === 'range') {
        const step = parseFloat(cur.step) || 0.05;
        cur.value = G.clamp(parseFloat(cur.value) + dx * step * 2, parseFloat(cur.min), parseFloat(cur.max));
        cur.dispatchEvent(new Event('input', { bubbles: true }));
      } else if (dx || dy) {
        this.focusIdx = this.moveFocus(items, this.focusIdx, dx, dy);
      }
      const f = items[this.focusIdx];
      for (const el of items) el.classList.toggle('padFocus', el === f && this.active);
      if (f && (dx || dy)) f.scrollIntoView({ block: 'nearest' });
      if (down(B.A) && f && f.type !== 'range') { G.Audio.init(); f.click(); }
      if (down(B.B)) {
        if (overlay.id === 'mods') G.Game.closeMods();
        else if (overlay.id === 'mp') G.Net.closeBrowser();
        else if (overlay.id === 'pause') G.Game.resume();
      }
      if (down(B.START)) {
        if (overlay.id === 'pause') G.Game.resume();
        else if (overlay.id === 'menu') { const d = document.getElementById('deployBtn'); if (d) { G.Audio.init(); d.click(); } }
      }
    },
    // move focus to the nearest item in the pressed direction (spatial navigation)
    moveFocus(items, idx, dx, dy) {
      const r0 = items[idx].getBoundingClientRect();
      const cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2;
      let best = idx, bestD = Infinity;
      items.forEach((el, i) => {
        if (i === idx) return;
        const r = el.getBoundingClientRect();
        const x = r.left + r.width / 2 - cx, y = r.top + r.height / 2 - cy;
        const along = dx ? x * dx : y * dy, across = dx ? Math.abs(y) : Math.abs(x);
        if (along <= 4) return;
        const d = along + across * 2.5;
        if (d < bestD) { bestD = d; best = i; }
      });
      return best;
    },
  });
  P.init();
})();
