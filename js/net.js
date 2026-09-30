'use strict';
// Online multiplayer with lobbies — no game server of our own required.
// All traffic goes through a free public MQTT message broker over a secure WebSocket (the same kind of
// connection as a normal website), so it works on mobile data, home Wi-Fi and most school/work networks.
// Lobbies are listed as retained broker messages, which makes the lobby browser instant and live.
// Topology: the lobby host is the hub. Everyone simulates their own operator; the host runs bots,
// round timing and win conditions. Damage is applied by whoever owns the victim.
(function () {
  const G = window.G;
  const V = THREE.Vector3;
  const $ = (id) => document.getElementById(id);

  const VERSION = 'bp-mp-3';
  const TOPIC = 'breachpoint-fps/v2/';
  // tried in order; everyone normally lands on the first one
  const BROKERS = ['wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081'];
  const MQTT_JS = 'https://cdn.jsdelivr.net/npm/mqtt@5.10.1/dist/mqtt.min.js';
  const LISTING_TTL = 90000;
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const TICK = 1 / 15;
  const BOT_NAMES = { atk: ['RAVEN', 'DUNE', 'GALE', 'FLINT', 'ORCA'], def: ['BASTION', 'KESTREL', 'HOLLOW', 'MARROW', 'SPUR'] };
  const WEAPON_KEYS = ['ar', 'smg', 'sg'];
  const r2 = (v) => Math.round(v * 100) / 100;
  const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
  const cleanName = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9 _-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 14) || 'OPERATOR';
  const cleanChat = (s) => String(s || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 120);
  const validW = (w) => (WEAPON_KEYS.includes(w) ? w : 'ar');
  const validSc = (s) => (s === '1.5' ? '1.5' : 'std');
  const validOp = (o) => (G.Operators && G.Operators.roster[o] ? o : 'sledge');
  const maxPlayers = (L) => (L.mode === 'duel' ? 2 : 10);
  const randCode = () => Array.from({ length: 5 }, () => CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0]).join('');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let mqttLib = null;
  function loadMqtt() {
    if (mqttLib) return mqttLib;
    mqttLib = new Promise((res, rej) => {
      if (window.mqtt) return res(window.mqtt);
      const s = document.createElement('script');
      s.src = MQTT_JS; s.async = true;
      s.onload = () => (window.mqtt ? res(window.mqtt) : rej(new Error('Networking library failed to start.')));
      s.onerror = () => { mqttLib = null; rej(new Error('Could not load the networking library. Check your internet connection.')); };
      document.head.appendChild(s);
    });
    return mqttLib;
  }

  // ================================================================ MESSAGE BUS
  // One connection per public broker, opened on demand. A lobby lives on one broker (recorded in its
  // code); the lobby browser listens on all of them so a flaky broker never hides a lobby.
  const Bus = {
    id: 'bp' + Math.random().toString(36).slice(2, 12),
    clients: [], pending: [], handlers: BROKERS.map(() => ({ subs: new Map(), pre: new Map() })),
    up(b) { const c = this.clients[b]; return !!(c && c.connected); },
    ensure(b) {
      if (this.up(b)) return Promise.resolve(b);
      if (this.pending[b]) return this.pending[b];
      this.pending[b] = (async () => {
        const lib = await loadMqtt();
        for (let attempt = 0; attempt < 3; attempt++) {
          const c = await new Promise((res) => {
            const cl = lib.connect(BROKERS[b], {
              clientId: this.id + '-' + b + '-' + attempt, clean: true, connectTimeout: 7000, reconnectPeriod: 2500, keepalive: 20,
              will: { topic: TOPIC + 'gone/' + this.id, payload: '1', qos: 0, retain: false },
            });
            const to = setTimeout(() => { cl.end(true); res(null); }, 4500);
            cl.once('connect', () => { clearTimeout(to); res(cl); });
          });
          if (c) {
            if (this.clients[b]) this.clients[b].end(true);
            this.clients[b] = c;
            c.on('message', (topic, buf) => this.dispatch(b, topic, buf));
            const h = this.handlers[b];
            for (const t of h.subs.keys()) c.subscribe(t);
            for (const pre of h.pre.keys()) c.subscribe(pre + '+');
            return b;
          }
        }
        throw new Error('Could not reach the online service. Check your internet connection and try again.');
      })().finally(() => { this.pending[b] = null; });
      return this.pending[b];
    },
    // first broker that answers, in preference order
    async any() {
      const tries = BROKERS.map((u, b) => this.ensure(b));
      tries.forEach((t) => t.catch(() => {}));
      try { return await Promise.race([tries[0], sleep(3000).then(() => { throw new Error('slow'); })]); } catch (e) { /* fall through */ }
      try { return await Promise.any(tries); }
      catch (e) { throw new Error('Could not reach the online service. Check your internet connection and try again.'); }
    },
    dispatch(b, topic, buf) {
      const raw = buf.toString();
      let d = null;
      if (raw) { try { d = JSON.parse(raw); } catch (e) { return; } }
      const h = this.handlers[b];
      const fn = h.subs.get(topic);
      if (fn) { try { fn(d, topic, b); } catch (e) { console.warn('[net]', e); } return; }
      for (const [pre, f] of h.pre) if (topic.startsWith(pre)) { try { f(d, topic, b); } catch (e) { console.warn('[net]', e); } return; }
    },
    sub(b, topic, fn) { this.handlers[b].subs.set(topic, fn); if (this.up(b)) this.clients[b].subscribe(topic); },
    subPrefix(b, pre, fn) { this.handlers[b].pre.set(pre, fn); if (this.up(b)) this.clients[b].subscribe(pre + '+'); },
    unsub(b, topic) { if (b == null) return; if (this.handlers[b].subs.delete(topic) && this.up(b)) this.clients[b].unsubscribe(topic); },
    unsubPrefix(b, pre) { if (this.handlers[b].pre.delete(pre) && this.up(b)) this.clients[b].unsubscribe(pre + '+'); },
    pub(b, topic, obj, retain) { if (b != null && this.up(b)) this.clients[b].publish(topic, obj == null ? '' : JSON.stringify(obj), { qos: 0, retain: !!retain }); },
  };
  // the lobby code's first letter records which broker the lobby lives on
  const codeBroker = (code) => CODE_CHARS.indexOf(code[0]) % BROKERS.length;
  const codeFor = (b) => { let c; do { c = randCode(); } while (codeBroker(c) !== b); return c; };
  G.Bus = Bus;
  const errText = (e) => (e && e.message) || 'Connection error.';

  // ================================================================ REMOTE PLAYER
  // Another human in the match, animated from their network updates.
  class RemotePlayer {
    constructor(nid, name, team, wkey, op, scope) {
      this.nid = nid; this.name = name; this.team = team; this.opId = op; this.scope = validSc(scope); this.ads = 0;
      this.remote = true; this.isRemotePlayer = true;
      this.def = G.WEAPONS[wkey] || G.WEAPONS.ar;
      this.pos = new V(); this.vel = new V(); this.yaw = 0; this.pitch = 0; this.lean = 0; this.crouch = 0;
      this.head = new V(); this.eye = new V(); this.chestA = new V(); this.chestB = new V(); this.legA = new V(); this.legB = new V();
      this.hp = 100; this.alive = false; this.kills = 0; this.deaths = 0; this.wins = 0;
      this.fallDir = new V(); this.deadT = 0;
      this.tgt = { x: 0, y: 0, z: 0, vx: 0, vz: 0, yaw: 0, pitch: 0, lean: 0, crouch: 0 };
      this.tRecv = 0; this.last = null;
      this.model = G.buildCharacter(team, this.def.model, this.scope);
      G.scene.add(this.model.root);
    }
    setTeam(team) {
      if (team === this.team) return;
      this.team = team;
      const vis = this.model.root.visible;
      this.model.root.removeFromParent();
      this.model = G.buildCharacter(team, this.def.model, this.scope);
      this.model.root.visible = vis;
      G.scene.add(this.model.root);
    }
    get aimYaw() { return this.yaw; }
    get aimPitch() { return this.pitch; }
    spawnAt(x, z, yaw) {
      this.pos.set(x, 0.02, z); this.vel.set(0, 0, 0); this.yaw = yaw; this.pitch = 0; this.lean = 0; this.crouch = 0;
      Object.assign(this.tgt, { x, y: 0.02, z, vx: 0, vz: 0, yaw, pitch: 0, lean: 0, crouch: 0 });
      this.tRecv = G.time; this.hp = 100; this.alive = true; this.deadT = 0;
      this.model.root.visible = true;
      G.updateHitShapes(this);
    }
    netState(a) {
      if (!Array.isArray(a) || a.length < 12) return;
      const t = this.tgt;
      t.x = num(a[1], t.x); t.y = num(a[2], t.y); t.z = num(a[3], t.z); t.vx = num(a[4]); t.vz = num(a[5]);
      t.yaw = num(a[6], t.yaw); t.pitch = num(a[7]); t.lean = G.clamp(num(a[8]), -1, 1); t.crouch = G.clamp(num(a[9]), 0, 1);
      this.ads = G.clamp(num(a[12]), 0, 1);
      if (this.alive) this.hp = G.clamp(num(a[10], this.hp), 0, 100);
      if (G.WEAPONS[a[11]]) this.def = G.WEAPONS[a[11]];
      this.tRecv = G.time; this.last = a;
    }
    netDie() {
      this.alive = false; this.hp = 0; this.deadT = 0; this.deaths++;
      this.fallDir.set(Math.random() < 0.6 ? 1 : -1, 0, G.rand(-0.3, 0.3));
    }
    takeDamage(amt, attacker, part, dx, dz) {
      if (this.alive) G.Net.sendHit(this, amt, attacker, part, dx, dz);
    }
    update(dt) {
      const m = this.model;
      if (!this.alive) {
        this.deadT += dt;
        G.animateCharacter(m, { pos: this.pos, yaw: this.yaw, dead: true, deadT: this.deadT, fallDir: this.fallDir, lean: 0, crouch: 0, speed: 0, pitch: 0 }, dt);
        return;
      }
      const t = this.tgt, age = Math.min(0.25, G.time - this.tRecv);
      const tx = t.x + t.vx * age, tz = t.z + t.vz * age;
      if (Math.hypot(tx - this.pos.x, tz - this.pos.z) > 4) { this.pos.x = tx; this.pos.z = tz; }
      this.pos.x = G.damp(this.pos.x, tx, 14, dt); this.pos.z = G.damp(this.pos.z, tz, 14, dt);
      this.pos.y = G.damp(this.pos.y, t.y, 16, dt);
      this.vel.set(t.vx, 0, t.vz);
      this.yaw = G.dampAngle(this.yaw, t.yaw, 18, dt);
      this.pitch = G.damp(this.pitch, t.pitch, 18, dt);
      this.lean = G.damp(this.lean, t.lean, 14, dt);
      this.crouch = G.damp(this.crouch, t.crouch, 12, dt);
      G.updateHitShapes(this);
      const fwd = t.vx * -Math.sin(this.yaw) + t.vz * -Math.cos(this.yaw);
      G.animateCharacter(m, { pos: this.pos, yaw: this.yaw, speed: Math.hypot(t.vx, t.vz), fwd, crouch: this.crouch, lean: this.lean, pitch: this.pitch, dead: false }, dt);
    }
    dispose() { this.model.root.removeFromParent(); }
  }
  G.RemotePlayer = RemotePlayer;

  // ================================================================ NET
  const N = (G.Net = {
    room: null, isHost: false, hostConn: null, conns: new Map(), byClient: new Map(), myNid: null, lobby: null, listings: new Map(),
    inGame: false, applying: false, cellQ: [], barQ: [], tickT: 0, nextNid: 1, lastHostMsg: 0, chatLog: [],

    // ---------------------------------------------------------------- helpers
    settings() { return G.Game.settings; },
    myName() { return cleanName(this.settings().mpName); },
    status(msg, err) { const el = $('mpStatus'); if (el) { el.textContent = msg || ''; el.classList.toggle('err', !!err); } },
    byNid(nid) { if (nid == null) return null; for (const e of G.Game.entities) if (e.nid === nid) return e; return null; },
    owns(e) { return !!e && (e === G.Game.player || (this.isHost && e.isBot && !e.puppet)); },
    // ---------------------------------------------------------------- UI
    init() {
      const S = () => this.settings();
      $('mpBtn').addEventListener('click', () => { G.Audio.init(); this.openBrowser(); });
      $('mpBack').addEventListener('click', () => this.closeBrowser());
      $('mpHost').addEventListener('click', () => { this.saveName(); this.host(); });
      $('mpJoin').addEventListener('click', () => { this.saveName(); this.join($('mpCode').value); });
      $('mpCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('mpJoin').click(); });
      $('mpRefresh').addEventListener('click', () => this.browse());
      $('mpName').addEventListener('change', () => this.saveName());
      const pick = (id, key, attr) => {
        const wrap = $(id);
        const sel = () => { for (const b of wrap.children) b.classList.toggle('sel', b.dataset[attr] === String(S()[key])); };
        wrap.addEventListener('click', (e) => {
          const b = e.target.closest('button'); if (!b) return;
          const v = b.dataset[attr];
          S()[key] = v === 'true' ? true : v === 'false' ? false : v;
          sel(); G.Game.saveSettings(); G.Audio.click();
        });
        return sel;
      };
      this.selMode = pick('mpMode', 'mpMode', 'v');
      this.selBots = pick('mpBots', 'mpBots', 'v');
      this.selPub = pick('mpPub', 'mpPub', 'v');
      // lobby room
      $('lbLeave').addEventListener('click', () => { this.leave(); });
      $('lbCopy').addEventListener('click', () => this.copyInvite());
      $('lbSwitch').addEventListener('click', () => this.switchTeam());
      $('lbStart').addEventListener('click', () => this.startMatch());
      $('lbChatIn').addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const text = cleanChat(e.target.value); e.target.value = '';
        if (text) this.chat(text);
      });
      $('lbHostCtl').addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b || !this.isHost || !this.lobby) return;
        const L = this.lobby, k = b.dataset.k, v = b.dataset.v;
        if (k === 'map') L.map = v;
        if (k === 'mode') { L.mode = v; if (v === 'duel') this.balanceDuel(); }
        if (k === 'bots') L.bots = v === 'true';
        if (k === 'ff') L.ff = v === 'true';
        if (k === 'pub') L.pub = v === 'true';
        G.Audio.click();
        this.broadcastLobby();
      });
      addEventListener('beforeunload', () => this.leave(true));
      // invite links: ?join=CODE
      const m = /[?&]join=([A-Za-z0-9]{5})/.exec(location.search);
      if (m) this.pendingJoin = m[1].toUpperCase();
    },
    onGameReady() {
      if (!this.pendingJoin) return;
      const code = this.pendingJoin; this.pendingJoin = null;
      this.openBrowser(code);
      if (this.settings().mpName) this.join(code);
      else this.status('Enter your name, then press JOIN.');
    },
    saveName() {
      const v = cleanName($('mpName').value);
      $('mpName').value = v;
      this.settings().mpName = v; G.Game.saveSettings();
    },
    openBrowser(code) {
      const S = this.settings();
      if (!S.mpName) S.mpName = 'OPERATOR' + ((Math.random() * 900 + 100) | 0);
      $('mpName').value = S.mpName;
      if (code) $('mpCode').value = code;
      this.selMode(); this.selBots(); this.selPub();
      $('mp').style.display = 'flex';
      this.status('');
      if (!code) this.browse();
    },
    closeBrowser() { $('mp').style.display = 'none'; BROKERS.forEach((u, b) => Bus.unsubPrefix(b, TOPIC + 'lobbies/')); },

    // ---------------------------------------------------------------- lobby browsing (retained broker messages)
    // Live lobby list: every public lobby keeps a retained message on the broker, so subscribing
    // returns all of them at once and later changes arrive automatically.
    async browse() {
      const list = $('mpList');
      list.textContent = 'Searching for public lobbies…';
      this.listings.clear();
      const onListing = (d, topic, b) => {
        const code = topic.slice((TOPIC + 'lobbies/').length);
        if (!d) { if (this.listings.get(code) && this.listings.get(code).b === b) this.listings.delete(code); }
        else if (d.v === VERSION && typeof d.ts === 'number') {
          // clean up long-dead listings left behind by crashed hosts
          if (Date.now() - d.ts > 10 * 60000) Bus.pub(b, topic, null, true);
          else { d.b = b; this.listings.set(code, d); }
        }
        clearTimeout(this.listT);
        this.listT = setTimeout(() => this.renderList(), 150);
      };
      let reached = 0;
      await Promise.all(BROKERS.map((u, b) => Bus.ensure(b).then(() => {
        reached++;
        Bus.unsubPrefix(b, TOPIC + 'lobbies/');
        Bus.subPrefix(b, TOPIC + 'lobbies/', onListing);
      }, () => {})));
      if (!reached) { list.textContent = 'Could not reach the online service. Check your internet connection and press REFRESH.'; return; }
      setTimeout(() => { if (list.textContent.startsWith('Searching')) this.renderList(); }, 2500);
      clearInterval(this.listRefresh);
      this.listRefresh = setInterval(() => { if ($('mp').style.display !== 'none') this.renderList(); else clearInterval(this.listRefresh); }, 5000);
    },
    renderList() {
      const list = $('mpList');
      const now = Date.now();
      const found = [...this.listings.values()].filter((d) => now - d.ts < LISTING_TTL && d.code !== (this.lobby && this.lobby.code));
      list.replaceChildren();
      if (!found.length) { list.textContent = 'No public lobbies right now. Host one, or join a friend with their code.'; return; }
      for (const d of found) {
        const row = document.createElement('div'); row.className = 'mprow';
        const info = document.createElement('div');
        const nm = document.createElement('b'); nm.textContent = cleanName(d.name);
        const sub = document.createElement('small');
        const mapName = (G.MAPS.find((m) => m.id === d.map) || G.MAPS[0]).name;
        sub.textContent = `${d.mode === 'duel' ? '1V1 DUEL' : 'TEAM SECURE AREA'} · ${mapName} · ${num(d.n)}/${num(d.max)}${d.started ? ' · IN GAME' : ''}`;
        info.append(nm, sub);
        const b = document.createElement('button'); b.textContent = 'JOIN';
        b.disabled = !!d.started || num(d.n) >= num(d.max);
        b.addEventListener('click', () => { this.saveName(); this.join(String(d.code || '')); });
        row.append(info, b);
        list.appendChild(row);
      }
    },

    // ---------------------------------------------------------------- hosting
    roomTopic(code, part) { return TOPIC + 'room/' + code + '/' + part; },
    async host() {
      this.leave(true);
      const S = this.settings();
      this.status('Creating lobby…');
      let rb;
      try { rb = await Bus.any(); } catch (e) { this.status(errText(e), true); return; }
      const code = codeFor(rb);
      this.rb = rb; this.room = code; this.isHost = true; this.myNid = 'u0'; this.nextNid = 1; this.chatLog = [];
      this.lobby = {
        code, name: `${this.myName()}'S LOBBY`, mode: S.mpMode === 'duel' ? 'duel' : 'team', map: S.map,
        bots: S.mpBots !== false, ff: !!S.ff, pub: S.mpPub !== false, started: false,
        players: [{ nid: 'u0', name: this.myName(), team: 'atk', w: validW(S.primary), op: validOp(S.operator), sc: validSc(S.scope) }],
      };
      Bus.sub(rb, this.roomTopic(code, 'h'), (d) => this.onHostInbox(d));
      this.startHeartbeat();
      this.showLobby();
      this.sysChat('Lobby created. Share the code or invite link with friends.');
      this.publishListing();
    },
    // public lobbies are retained messages; refreshed while hosting and cleared on leave
    publishListing() {
      if (!this.isHost || !this.lobby) return;
      const topic = TOPIC + 'lobbies/' + this.lobby.code;
      if (this.lobby.pub) Bus.pub(this.rb, topic, this.publicInfo(), true);
      else if (this.listed) Bus.pub(this.rb, topic, null, true);
      this.listed = this.lobby.pub;
    },
    releaseListing() {
      if (this.listed && this.lobby) Bus.pub(this.rb, TOPIC + 'lobbies/' + this.lobby.code, null, true);
      this.listed = false;
    },
    publicInfo() {
      const L = this.lobby;
      return { v: VERSION, ts: Date.now(), code: L.code, name: L.name, mode: L.mode, map: L.map, n: L.players.length, max: maxPlayers(L), started: L.started };
    },
    onHostInbox(d) {
      if (!d || typeof d !== 'object' || typeof d.f !== 'string') return;
      let c = this.byClient.get(d.f);
      if (!c) {
        if (d.t !== 'hello') return;
        const code = this.room, id = d.f;
        c = { id, nid: null, open: true, lastHeard: performance.now(),
          send: (m) => { if (c.open) Bus.pub(this.rb, this.roomTopic(code, 'p/' + id), m); },
          close: () => { c.open = false; } };
        this.byClient.set(id, c);
        Bus.sub(this.rb, TOPIC + 'gone/' + id, () => this.dropClient(c));
      }
      this.onClientMsg(c, d);
    },
    admit(c, d) {
      const L = this.lobby;
      const deny = (r) => { c.send({ t: 'deny', r }); setTimeout(() => c.close(), 600); };
      if (c.nid) { c.send({ t: 'welcome', nid: c.nid, hid: Bus.id, chat: [] }); return; } // repeated hello
      if (!L) return deny('Lobby closed.');
      if (d.v !== VERSION) return deny('Different game version. Both players should refresh the page.');
      if (L.started) return deny('That lobby is already in a match. Try again when it ends.');
      if (L.players.length >= maxPlayers(L)) return deny('That lobby is full.');
      let name = cleanName(d.name);
      while (L.players.some((p) => p.name === name)) name = cleanName(name.slice(0, 11) + ((Math.random() * 90 + 10) | 0));
      const nid = 'u' + this.nextNid++;
      const atk = L.players.filter((p) => p.team === 'atk').length, def = L.players.length - atk;
      L.players.push({ nid, name, team: atk <= def ? 'atk' : 'def', w: validW(d.w), op: validOp(d.op), sc: validSc(d.sc) });
      if (L.mode === 'duel') this.balanceDuel();
      c.nid = nid; this.conns.set(nid, c);
      c.send({ t: 'welcome', nid, hid: Bus.id, chat: this.chatLog.slice(-20) });
      this.sysChat(`${name} joined.`);
      this.broadcastLobby();
    },
    balanceDuel() {
      const L = this.lobby;
      if (L.players[0]) L.players[0].team = 'atk';
      if (L.players[1]) L.players[1].team = 'def';
    },
    dropClient(c) {
      this.byClient.delete(c.id);
      Bus.unsub(this.rb, TOPIC + 'gone/' + c.id);
      c.open = false;
      const nid = c.nid;
      if (!nid || !this.conns.has(nid)) return;
      this.conns.delete(nid);
      const L = this.lobby;
      if (!L) return;
      const p = L.players.find((x) => x.nid === nid);
      L.players = L.players.filter((x) => x.nid !== nid);
      if (p) this.sysChat(`${p.name} left.`);
      if (this.inGame) {
        this.removeEntity(nid);
        this.broadcast({ t: 'left', id: nid });
      }
      this.broadcastLobby();
    },
    broadcast(msg, except) {
      if (!this.room || !this.isHost) return;
      if (except && except.nid) msg._x = except.nid;
      Bus.pub(this.rb, this.roomTopic(this.room, 'a'), msg);
    },
    sendTo(nid, msg) { const c = this.conns.get(nid); if (c && c.open) { try { c.send(msg); } catch (e) { /* closed */ } } },
    broadcastLobby() {
      if (!this.isHost || !this.lobby) return;
      this.broadcast({ t: 'lobby', lobby: this.lobby });
      this.renderLobby();
      this.publishListing();
    },
    onClientMsg(c, d) {
      if (!d || typeof d !== 'object') return;
      c.lastHeard = performance.now();
      if (d.t === 'hello') return this.admit(c, d);
      const nid = c.nid, L = this.lobby;
      if (!nid || !L) return;
      const me = L.players.find((p) => p.nid === nid);
      switch (d.t) {
        case 'team':
          if (me && !L.started) {
            if (L.mode === 'duel') { for (const p of L.players) p.team = p.team === 'atk' ? 'def' : 'atk'; }
            else { const to = me.team === 'atk' ? 'def' : 'atk'; if (L.players.filter((p) => p.team === to).length < 5) me.team = to; }
            this.broadcastLobby();
          }
          break;
        case 'load':
          if (me) { me.w = validW(d.w); me.op = validOp(d.op); this.broadcastLobby(); }
          break;
        case 'chat': {
          const msg = { t: 'chat', from: me ? me.name : '?', text: cleanChat(d.text) };
          if (msg.text) { this.handle(msg); this.broadcast(msg); }
          break;
        }
        case 's': { const e = this.byNid(nid); if (e && e.isRemotePlayer) e.netState(d.s); break; }
        case 'hit': case 'heal':
          if (d.t === 'hit') d.by = nid;
          if (d.to === 'u0' || /^b\d+$/.test(String(d.to))) this.handle(d);
          else this.sendTo(d.to, d);
          break;
        case 'shot': case 'nade': case 'dead':
          d.id = nid;
          this.handle(d); this.broadcast(d, c);
          break;
        case 'cells': case 'bar': case 'fort':
          this.handle(d); this.broadcast(d, c);
          break;
        case 'bye': this.dropClient(c); break;
      }
    },

    // ---------------------------------------------------------------- joining
    async join(code) {
      code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
      if (code.length !== 5) { this.status('Enter the 5-character lobby code.', true); return; }
      this.leave(true);
      this.status('Connecting to lobby ' + code + '…');
      const b = codeBroker(code);
      if (b < 0) { this.status('That is not a valid lobby code.', true); return; }
      try { await Bus.ensure(b); } catch (e) { this.status(errText(e), true); return; }
      if (await this.tryJoin(code, b)) return;
      if (this.joinDenied) return;
      this.leave(true);
      this.status(`No lobby with code ${code} answered. Check the code, and make sure the host still has the game open.`, true);
    },
    async tryJoin(code, b) {
      this.rb = b; this.room = code; this.isHost = false; this.myNid = null; this.chatLog = []; this.joinDenied = false;
      const hostTopic = this.roomTopic(code, 'h');
      this.hostConn = { open: true, send: (m) => { m.f = Bus.id; Bus.pub(b, hostTopic, m); }, close() { this.open = false; } };
      const onMsg = (d) => { if (d && typeof d === 'object' && d._x !== this.myNid) { try { this.onHostMsg(d); } catch (e) { console.warn('[net] bad message', e); } } };
      Bus.sub(b, this.roomTopic(code, 'a'), onMsg);
      Bus.sub(b, this.roomTopic(code, 'p/' + Bus.id), onMsg);
      await sleep(250); // let the subscriptions settle before saying hello
      const S = this.settings();
      for (let i = 0; i < 3 && !this.myNid && !this.joinDenied; i++) {
        this.hostConn.send({ t: 'hello', v: VERSION, name: this.myName(), w: validW(S.primary), op: validOp(S.operator), sc: validSc(S.scope) });
        for (let k = 0; k < 20 && !this.myNid && !this.joinDenied; k++) await sleep(100);
      }
      if (this.myNid) return true;
      if (!this.joinDenied) { Bus.unsub(b, this.roomTopic(code, 'a')); Bus.unsub(b, this.roomTopic(code, 'p/' + Bus.id)); this.room = null; this.hostConn = null; }
      return false;
    },
    onHostMsg(d) {
      if (!d || typeof d !== 'object') return;
      this.lastHostMsg = performance.now();
      switch (d.t) {
        case 'deny': this.joinDenied = true; this.leave(true); this.status(String(d.r || 'Could not join.'), true); break;
        case 'welcome':
          if (this.myNid) break;
          this.myNid = String(d.nid);
          if (typeof d.hid === 'string') { this.hostId = d.hid; Bus.sub(this.rb, TOPIC + 'gone/' + d.hid, () => this.hostLost()); }
          if (Array.isArray(d.chat)) for (const m of d.chat) this.addChat(m.from, m.text);
          this.startHeartbeat();
          break;
        case 'lobby':
          this.lobby = d.lobby;
          if (!this.inGame) this.showLobby();
          this.renderLobby();
          break;
        case 'start': this.beginMatch(d); break;
        case 'round': this.applyRound(d); break;
        case 'live': if (this.inGame && G.Game.state === 'prep') G.Game.startLive(); break;
        case 'end': this.applyEnd(d); break;
        case 'over': this.applyOver(d); break;
        case 'ss': this.applySnapshot(d); break;
        case 'left': this.removeEntity(d.id); break;
        case 'bye': this.hostLost('The host closed the lobby.'); break;
        default: this.handle(d);
      }
    },
    hostLost(msg) {
      if (!this.room && !this.inGame) return;
      const wasIn = this.inGame;
      this.leave(true);
      if (wasIn) G.Game.quitToMenu();
      this.openBrowser();
      this.status(msg || 'Lost connection to the host.', true);
    },
    startHeartbeat() {
      clearInterval(this.hb);
      this.lastHostMsg = performance.now();
      this.hb = setInterval(() => {
        const now = performance.now();
        if (this.isHost) {
          if (this.lobby && this.lobby.pub && (this.hbN = (this.hbN || 0) + 1) % 3 === 0) this.publishListing();
          for (const c of [...this.conns.values()]) {
            if (now - (c.lastHeard || now) > 15000) { try { c.close(); } catch (e) { /* ignore */ } this.dropClient(c); }
            else if (c.open) c.send({ t: 'ping' });
          }
        } else if (this.hostConn) {
          if (this.hostConn.open) this.hostConn.send({ t: 'ping' });
          if (this.myNid && now - this.lastHostMsg > 15000) this.hostLost();
        }
      }, 3000);
    },

    // ---------------------------------------------------------------- leaving
    leave(silent) {
      clearInterval(this.hb);
      if (this.isHost) { this.broadcast({ t: 'bye' }); this.releaseListing(); }
      else if (this.hostConn && this.hostConn.open && this.myNid) { try { this.hostConn.send({ t: 'bye' }); } catch (e) { /* ignore */ } }
      for (const c of this.byClient.values()) Bus.unsub(this.rb, TOPIC + 'gone/' + c.id);
      this.conns.clear(); this.byClient.clear();
      if (this.hostId) { Bus.unsub(this.rb, TOPIC + 'gone/' + this.hostId); this.hostId = null; }
      if (this.room) for (const part of ['h', 'a', 'p/' + Bus.id]) Bus.unsub(this.rb, this.roomTopic(this.room, part));
      this.hostConn = null; this.room = null;
      const wasIn = this.inGame;
      if (wasIn) this.endMatch();
      this.isHost = false; this.myNid = null; this.lobby = null;
      $('lobby').style.display = 'none';
      if (!silent) { if (wasIn) G.Game.quitToMenu(); this.openBrowser(); }
    },

    // ---------------------------------------------------------------- lobby room UI
    showLobby() {
      $('mp').style.display = 'none';
      $('lobby').style.display = 'flex';
      this.renderLobby();
    },
    renderLobby() {
      const L = this.lobby;
      if (!L) return;
      $('lbCode').textContent = L.code;
      const mapName = (G.MAPS.find((m) => m.id === L.map) || G.MAPS[0]).name;
      $('lbInfo').textContent = `${L.mode === 'duel' ? '1V1 DUEL · FIRST TO 5' : 'TEAM SECURE AREA · FIRST TO 3'} · ${mapName}` +
        `${L.mode === 'team' ? (L.bots ? ' · BOTS FILL EMPTY SPOTS' : ' · NO BOTS') : ''} · FRIENDLY FIRE ${L.ff ? 'ON' : 'OFF'} · ${L.pub ? 'PUBLIC' : 'PRIVATE'}`;
      for (const team of ['atk', 'def']) {
        const box = $(team === 'atk' ? 'lbAtk' : 'lbDef');
        box.replaceChildren();
        for (const p of L.players.filter((x) => x.team === team)) {
          const row = document.createElement('div'); row.className = 'lbp' + (p.nid === this.myNid ? ' me' : '');
          const n = document.createElement('b'); n.textContent = p.name;
          const s = document.createElement('small');
          const op = G.Operators.roster[p.op];
          s.textContent = `${p.nid === 'u0' ? 'HOST · ' : ''}${op ? op.name : ''} · ${(G.WEAPONS[p.w] || G.WEAPONS.ar).name}`;
          row.append(n, s);
          box.appendChild(row);
        }
        if (!box.children.length) { const e = document.createElement('div'); e.className = 'lbp empty'; e.textContent = L.mode === 'team' && L.bots ? 'Bots will fill this side' : 'Empty'; box.appendChild(e); }
      }
      const host = this.isHost;
      $('lbHostCtl').style.display = host ? '' : 'none';
      if (host) for (const b of $('lbHostCtl').querySelectorAll('button')) {
        const cur = { map: L.map, mode: L.mode, bots: String(L.bots), ff: String(L.ff), pub: String(L.pub) }[b.dataset.k];
        b.classList.toggle('sel', cur === b.dataset.v);
        if (b.dataset.k === 'bots') b.disabled = L.mode === 'duel';
      }
      const why = this.startProblem();
      $('lbStart').style.display = host ? '' : 'none';
      $('lbStart').disabled = !!why;
      $('lbWait').textContent = host ? (why || 'Ready when you are.') : 'Waiting for the host to start the match…';
      $('lbSwitch').textContent = L.mode === 'duel' ? 'SWAP SIDES' : 'SWITCH TEAM';
    },
    startProblem() {
      const L = this.lobby;
      if (!L) return 'No lobby';
      const atk = L.players.filter((p) => p.team === 'atk').length, def = L.players.length - atk;
      if (L.mode === 'duel') {
        if (L.players.length < 2) return 'Waiting for an opponent to join…';
        if (atk !== 1 || def !== 1) return 'Duel needs one attacker and one defender.';
      } else if (!L.bots && (!atk || !def)) return 'Both teams need a player (or turn bots on).';
      return '';
    },
    switchTeam() {
      if (!this.lobby || this.lobby.started) return;
      if (this.isHost) this.onClientMsg({ nid: 'u0', lastHeard: 0 }, { t: 'team' });
      else if (this.hostConn) this.hostConn.send({ t: 'team' });
    },
    copyInvite() {
      if (!this.lobby) return;
      const url = location.origin + location.pathname + '?join=' + this.lobby.code;
      const done = () => { $('lbCopy').textContent = 'LINK COPIED!'; setTimeout(() => { $('lbCopy').textContent = 'COPY INVITE LINK'; }, 1800); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, () => prompt('Copy this invite link:', url));
      else prompt('Copy this invite link:', url);
    },
    chat(text) {
      if (this.isHost) { const msg = { t: 'chat', from: this.myName(), text }; this.handle(msg); this.broadcast(msg); }
      else if (this.hostConn) this.hostConn.send({ t: 'chat', text });
    },
    sysChat(text) {
      const msg = { t: 'chat', from: '', text };
      this.handle(msg);
      if (this.isHost) this.broadcast(msg);
    },
    addChat(from, text) {
      from = from ? cleanName(from) : ''; text = cleanChat(text);
      if (!text) return;
      this.chatLog.push({ from, text });
      if (this.chatLog.length > 60) this.chatLog.shift();
      const box = $('lbMsgs');
      const row = document.createElement('div');
      if (from) { const b = document.createElement('b'); b.textContent = from + ': '; row.appendChild(b); } else row.className = 'sys';
      row.appendChild(document.createTextNode(text));
      box.appendChild(row);
      while (box.children.length > 60) box.firstChild.remove();
      box.scrollTop = box.scrollHeight;
      if (this.inGame && from) G.Game.callout(from, text);
    },

    // ---------------------------------------------------------------- match setup
    startMatch() {
      if (!this.isHost || !this.lobby || this.startProblem()) return;
      const L = this.lobby;
      L.started = true;
      const bots = [];
      if (L.mode === 'team' && L.bots) {
        const atk = L.players.filter((p) => p.team === 'atk').length, def = L.players.length - atk;
        const size = G.clamp(Math.max(atk, def, 4), 1, 5);
        let i = 0;
        for (const team of ['atk', 'def']) {
          const have = team === 'atk' ? atk : def;
          for (let k = 0; k < size - have; k++) bots.push({ nid: 'b' + i++, name: BOT_NAMES[team][k], team, w: WEAPON_KEYS[(k + (team === 'def' ? 1 : 0)) % 3] });
        }
      }
      const cfg = { t: 'start', map: L.map, mode: L.mode, ff: L.ff, diff: this.settings().diff, players: L.players, bots };
      this.broadcast(cfg);
      this.broadcastLobby();
      this.beginMatch(cfg);
    },
    beginMatch(cfg) {
      const Gm = G.Game, S = Gm.settings;
      if (this.inGame) this.endMatch();
      $('lobby').style.display = 'none'; $('mp').style.display = 'none'; $('matchEnd').style.display = 'none';
      G.Audio.init(); G.Audio.setVolume(S.vol);
      if (G.Touch.enabled) Gm.goFullscreen();
      Gm.selectMap(G.MAPS.some((m) => m.id === cfg.map) ? cfg.map : 'harbor');
      this.inGame = true; this.cellQ = []; this.barQ = []; this.tickT = 0;
      this.mode = cfg.mode === 'duel' ? 'duel' : 'team';
      this.savedFF = S.ff; S.ff = !!cfg.ff;
      this.savedDiff = S.diff; if (G.DIFF[cfg.diff]) S.diff = cfg.diff;
      const players = Array.isArray(cfg.players) ? cfg.players : [];
      const mine = players.find((p) => p.nid === this.myNid) || { team: 'atk' };
      // local operator
      const p = Gm.player;
      p.nid = this.myNid;
      this.setPlayerTeam(mine.team === 'def' ? 'def' : 'atk');
      // other humans
      this.remotes = players.filter((x) => x.nid !== this.myNid).map((x) => new RemotePlayer(String(x.nid), cleanName(x.name), x.team === 'def' ? 'def' : 'atk', validW(x.w), validOp(x.op), x.sc));
      // bots: real on the host, puppets on clients
      this.netBots = (Array.isArray(cfg.bots) ? cfg.bots : []).map((b) => {
        const bot = new G.Bot(b.team === 'def' ? 'def' : 'atk', cleanName(b.name), validW(b.w));
        bot.nid = String(b.nid);
        if (!this.isHost) { bot.puppet = true; bot.remote = true; }
        bot.model.root.visible = false;
        return bot;
      });
      for (const b of Gm.botPool || []) b.model.root.visible = false;
      Gm.beginNetMatch(this.netBots, this.remotes, this.mode);
      if (this.isHost) this.hostStartRound();
    },
    setPlayerTeam(team) { G.Game.setPlayerTeam(team); },
    removeEntity(nid) {
      const Gm = G.Game, e = this.byNid(nid);
      if (!e || e === Gm.player) return;
      if (e.dispose) e.dispose(); else e.model.root.removeFromParent();
      Gm.entities = Gm.entities.filter((x) => x !== e);
      this.remotes = (this.remotes || []).filter((x) => x !== e);
      Gm.buildIcons();
    },
    endMatch() {
      const Gm = G.Game, S = Gm.settings;
      this.inGame = false;
      for (const r of this.remotes || []) r.dispose();
      for (const b of this.netBots || []) b.model.root.removeFromParent();
      this.remotes = []; this.netBots = [];
      if (this.savedFF !== undefined) { S.ff = this.savedFF; this.savedFF = undefined; }
      if (this.savedDiff !== undefined) { S.diff = this.savedDiff; this.savedDiff = undefined; }
      this.setPlayerTeam('atk');
      G.Game.player.nid = undefined;
      Gm.endNetMatch();
    },
    returnToLobby() {
      const Gm = G.Game;
      if (this.inGame) this.endMatch();
      Gm.showMenu();
      $('matchEnd').style.display = 'none';
      if (this.lobby) {
        if (this.isHost) { this.lobby.started = false; this.broadcastLobby(); }
        this.showLobby();
      }
    },

    // ---------------------------------------------------------------- rounds (host decides, everyone applies)
    hostStartRound() {
      const Gm = G.Game, MAP = G.MAP;
      const ents = Gm.entities, n = Gm.round + 1;
      // 1v1: switch sides every few rounds; round wins follow the players
      let T = null, sc = Gm.score;
      if (this.mode === 'duel' && n > 1 && (n - 1) % G.DUEL_SWAP === 0) {
        T = {};
        for (const e of ents) T[e.nid] = e.team === 'atk' ? 'def' : 'atk';
        sc = { atk: Gm.score.def, def: Gm.score.atk };
      }
      const teamOf = (e) => (T ? T[e.nid] : e.team);
      const atk = ents.filter((e) => teamOf(e) === 'atk'), def = ents.filter((e) => teamOf(e) === 'def');
      const sp = G.pick(MAP.spawns);
      const rx = Math.cos(sp.yaw), rz = -Math.sin(sp.yaw), bx = Math.sin(sp.yaw), bz = Math.cos(sp.yaw);
      const A = {};
      atk.forEach((e, i) => {
        const side = ((i + 1) >> 1) * (i % 2 ? 1 : -1) * 1.5, back = i > 2 ? 1.6 : 0;
        A[e.nid] = [r2(sp.x + rx * side + bx * back), r2(sp.z + rz * side + bz * back), r2(sp.yaw)];
      });
      const spots = [...MAP.anchors.slice().sort(() => Math.random() - 0.5), ...MAP.support.slice().sort(() => Math.random() - 0.5), ...MAP.roam];
      // humans take the anchor spots first, bots get the rest
      const defOrder = [...def.filter((e) => !e.isBot), ...def.filter((e) => e.isBot)];
      defOrder.forEach((e, i) => {
        const s = spots[i % spots.length];
        A[e.nid] = [s[0], s[1], r2(G.yawOf(s[2] - s[0], s[3] - s[1])), i];
      });
      const msg = { t: 'round', n, sp: sp.name, A, sc };
      if (T) msg.T = T;
      this.broadcast(msg);
      this.applyRound(msg, true);
    },
    applyRound(d, local) {
      const Gm = G.Game, MAP = G.MAP;
      if (!this.inGame || !d || typeof d.A !== 'object') return;
      Gm.round = num(d.n, Gm.round + 1) - 1;
      let swapped = false;
      if (d.T && typeof d.T === 'object') {
        for (const e of Gm.entities) {
          const t = d.T[e.nid];
          if (t !== 'atk' && t !== 'def' || t === e.team) continue;
          swapped = true;
          if (e === Gm.player) Gm.setPlayerTeam(t); else if (e.setTeam) e.setTeam(t); else e.team = t;
        }
      }
      if (d.sc) Gm.score = { atk: num(d.sc.atk), def: num(d.sc.def) };
      Gm.netRoundStart(String(d.sp || ''));
      const S = Gm.settings;
      const entries = MAP.entries.slice();
      const secure = MAP.secure.slice().sort(() => Math.random() - 0.5);
      let atkBotI = 0;
      const roles = ['anchor', 'anchor', 'support', 'roam', 'roam'];
      for (const e of Gm.entities) {
        const a = d.A[e.nid];
        if (!Array.isArray(a)) { e.alive = false; if (e.model) e.model.root.visible = false; continue; }
        const x = num(a[0]), z = num(a[1]), yaw = num(a[2]);
        if (e === Gm.player) e.spawn(x, z, yaw, S.primary);
        else if (e.isRemotePlayer) e.spawnAt(x, z, yaw);
        else if (e.isBot) {
          if (e.puppet) { e.spawn(x, z, yaw, 'puppet', {}); e.netTarget = null; }
          else if (e.team === 'atk') {
            const entry = entries.sort((p, q) => Math.hypot(p.out[0] - x, p.out[1] - z) - Math.hypot(q.out[0] - x, q.out[1] - z))[Math.random() < 0.6 ? 0 : Math.min(entries.length - 1, 1 + (atkBotI % 2))];
            e.spawn(x, z, yaw, 'entry', { entry, secure: secure[atkBotI++ % secure.length] });
          } else {
            const s = [x, z, x - Math.sin(yaw) * 5, z - Math.cos(yaw) * 5];
            const role = roles[num(a[3]) % roles.length];
            e.spawn(x, z, yaw, role, { spot: s, crouch: role === 'anchor' && Math.random() < 0.4 ? 1 : 0 });
          }
          e.model.root.visible = true;
        }
      }
      G.Operators.reset();
      G.Fort.startRound();
      Gm.netRoundBanner(swapped);
      Gm.buildIcons();
      if (!local) G.Audio.beep(660, 0.12);
    },
    hostLive() { this.broadcast({ t: 'live' }); },
    hostEnd(winner, reason) { this.broadcast({ t: 'end', w: winner, r: reason, sc: G.Game.score }); },
    hostOver() { this.broadcast({ t: 'over', sc: G.Game.score }); },
    applyEnd(d) {
      const Gm = G.Game;
      if (!this.inGame) return;
      if (d.sc) Gm.score = { atk: num(d.sc.atk), def: num(d.sc.def) };
      Gm.netRoundEnd(d.w === 'def' ? 'def' : 'atk', String(d.r || ''));
    },
    applyOver(d) {
      const Gm = G.Game;
      if (!this.inGame) return;
      if (d.sc) Gm.score = { atk: num(d.sc.atk), def: num(d.sc.def) };
      Gm.matchOver();
    },

    // ---------------------------------------------------------------- per-frame sync
    update(dt) {
      if (!this.inGame) return;
      for (const r of this.remotes || []) r.update(dt);
      this.tickT += dt;
      if (this.tickT >= TICK) { this.tickT = 0; this.sendTick(); }
    },
    playerState(p) {
      return [p.nid, r2(p.pos.x), r2(p.pos.y), r2(p.pos.z), r2(p.vel.x), r2(p.vel.z), r2(p.yaw), r2(p.pitch), r2(p.lean), r2(p.crouch), Math.ceil(p.hp), p.w ? p.w.def.key : 'ar', r2(p.ads || 0)];
    },
    sendTick() {
      const Gm = G.Game, rn = Gm.round;
      if (this.cellQ.length) { this.emit({ t: 'cells', rn, c: this.cellQ }); this.cellQ = []; }
      if (this.barQ.length) { this.emit({ t: 'bar', rn, b: this.barQ }); this.barQ = []; }
      const me = this.playerState(Gm.player);
      if (this.isHost) {
        const P = [me];
        for (const r of this.remotes || []) if (r.last) P.push(r.last);
        const B = (this.netBots || []).map((b) => [b.nid, r2(b.pos.x), r2(b.pos.z), r2(b.vel.x), r2(b.vel.z), r2(b.aimYaw), r2(b.aimPitch), r2(b.lean), r2(b.crouch), Math.ceil(b.hp)]);
        this.broadcast({ t: 'ss', tm: r2(Gm.timer), sec: r2(Gm.secure), P, B });
      } else if (this.hostConn && this.hostConn.open) {
        this.hostConn.send({ t: 's', s: me });
      }
    },
    applySnapshot(d) {
      const Gm = G.Game;
      if (!this.inGame) return;
      Gm.timer = num(d.tm, Gm.timer); Gm.secure = num(d.sec, Gm.secure);
      if (Array.isArray(d.P)) for (const a of d.P) {
        if (!Array.isArray(a) || a[0] === this.myNid) continue;
        const e = this.byNid(a[0]);
        if (e && e.isRemotePlayer) e.netState(a);
      }
      if (Array.isArray(d.B)) for (const a of d.B) {
        const b = Array.isArray(a) ? this.byNid(a[0]) : null;
        if (b && b.puppet) b.netState(a);
      }
    },

    // ---------------------------------------------------------------- outgoing events
    emit(msg) {
      if (!this.inGame) return;
      if (this.isHost) {
        if (msg.t === 'hit' || msg.t === 'heal') this.sendTo(msg.to, msg);
        else this.broadcast(msg);
      } else if (this.hostConn && this.hostConn.open) this.hostConn.send(msg);
    },
    sendShot(ent, end, wkey) {
      if (!this.inGame || !this.owns(ent)) return;
      this.emit({ t: 'shot', id: ent.nid, e: [r2(end.x), r2(end.y), r2(end.z)], w: wkey });
    },
    sendHit(victim, amt, attacker, part, dx, dz) {
      if (!this.inGame) return;
      this.emit({ t: 'hit', rn: G.Game.round, to: victim.nid, by: attacker ? attacker.nid : null, dmg: r2(amt), part: String(part || 'chest'), dx: r2(dx || 0), dz: r2(dz || 0) });
    },
    sendHeal(target, amt) { this.emit({ t: 'heal', rn: G.Game.round, to: target.nid, amt }); },
    sendNade(owner, pos, vel) {
      if (!this.inGame || !this.owns(owner)) return;
      this.emit({ t: 'nade', rn: G.Game.round, id: owner.nid, p: [r2(pos.x), r2(pos.y), r2(pos.z)], v: [r2(vel.x), r2(vel.y), r2(vel.z)] });
    },
    onLocalKill(killer, victim, head) {
      if (!this.inGame || !this.owns(victim)) return;
      this.emit({ t: 'dead', rn: G.Game.round, id: victim.nid, by: killer ? killer.nid : null, hs: !!head });
    },
    queueCell(pid, ci) { if (this.inGame && !this.applying) this.cellQ.push(pid, ci); },
    queueBar(pid, amt) { if (this.inGame && !this.applying) this.barQ.push(pid, r2(amt)); },

    // ---------------------------------------------------------------- incoming events
    handle(d) {
      const Gm = G.Game;
      if (d.t === 'chat') { this.addChat(d.from, d.text); return; }
      if (d.t === 'ping' || !this.inGame) return;
      if (d.rn !== undefined && d.rn !== Gm.round) return; // stale event from the previous round
      switch (d.t) {
        case 'shot': { const e = this.byNid(d.id); if (e && e !== Gm.player && Array.isArray(d.e)) this.remoteShot(e, d); break; }
        case 'hit': {
          const v = this.byNid(d.to), a = this.byNid(d.by);
          if (!v || !v.alive || !this.owns(v)) return;
          v.takeDamage(G.clamp(num(d.dmg), 0, 999), a, String(d.part), num(d.dx), num(d.dz));
          if (v === Gm.player && !v.alive) { /* death broadcast happens in onKill */ }
          break;
        }
        case 'heal': { const v = this.byNid(d.to); if (v && v.alive && this.owns(v)) v.hp = Math.min(100, v.hp + G.clamp(num(d.amt), 0, 100)); break; }
        case 'dead': {
          const v = this.byNid(d.id);
          if (!v || v === Gm.player || !v.alive || this.owns(v)) return;
          v.netDie();
          Gm.onKill(this.byNid(d.by), v, !!d.hs, true);
          break;
        }
        case 'cells': this.applyCells(d.c); break;
        case 'bar': this.applyBars(d.b); break;
        case 'fort': this.applying = true; G.Fort.applyNet(d); this.applying = false; break;
        case 'nade': {
          const e = this.byNid(d.id);
          if (!e || e === Gm.player || !Array.isArray(d.p) || !Array.isArray(d.v)) return;
          G.Grenades.throw(e, new V(num(d.p[0]), num(d.p[1]), num(d.p[2])), new V(num(d.v[0]), num(d.v[1]), num(d.v[2])), true);
          break;
        }
      }
    },
    applyCells(c) {
      if (!Array.isArray(c)) return;
      this.applying = true;
      let fx = 0;
      for (let i = 0; i + 1 < c.length; i += 2) {
        const p = G.W.panels[c[i]], ci = c[i + 1];
        if (p && Number.isInteger(ci) && ci >= 0 && ci < p.cells.length && p.cells[ci]) G.W.destroyCell(p, ci, 0, 0, 0, fx++ < 24);
      }
      this.applying = false;
    },
    applyBars(b) {
      if (!Array.isArray(b)) return;
      this.applying = true;
      for (let i = 0; i + 1 < b.length; i += 2) {
        const p = G.W.panels[b[i]];
        if (p) G.W.hitBarricade(p, G.clamp(num(b[i + 1]), 0, 200), 0, 0, 0);
      }
      this.applying = false;
    },
    remoteShot(e, d) {
      const end = new V(num(d.e[0]), num(d.e[1]), num(d.e[2]));
      e.model.root.updateMatrixWorld(true);
      const mz = e.model.muzzle.getWorldPosition(new V());
      const dir = end.clone().sub(mz).normalize();
      G.FX.muzzle3P(mz, dir);
      G.FX.tracer(mz.x, mz.y, mz.z, end.x, end.y, end.z);
      for (let i = 0; i < 4; i++) G.FX.dust.emit(end.x, end.y, end.z, G.randn() * 0.8, Math.random() * 1.2, G.randn() * 0.8, 0.4, 0.75, 0.72, 0.68, 0.9, 9, 1.5);
      const def = G.WEAPONS[d.w] || G.WEAPONS.ar;
      G.Audio.shot(def.sound, mz, false);
      G.KillCam.shot(e, end);
      if (this.isHost) G.Game.soundEvent(e.pos, def.sound === 'shotgun' ? 55 : 45, e.team, 'shot');
      const pl = G.Game.player;
      if (pl.alive && G.Game.isEnemy(e, pl)) {
        const hp = pl.head, dd = G.segPointDist(mz.x, mz.y, mz.z, end.x, end.y, end.z, hp.x, hp.y, hp.z);
        if (dd < 1.3 && dd > 0.15) G.Audio.whiz(Math.sign((hp.x - mz.x) * (end.z - mz.z) - (hp.z - mz.z) * (end.x - mz.x)) * -0.8);
      }
    },
  });

  addEventListener('load', () => setTimeout(() => { try { N.init(); } catch (e) { console.error(e); } }, 10));
})();
