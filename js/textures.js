'use strict';
// Procedural canvas textures + material library.
(function () {
  const G = window.G;
  const T = (G.T = {});
  const R = G.mulberry32(1337);

  function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function toTex(c, srgb = true, clamp = false) {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    t.encoding = srgb ? THREE.sRGBEncoding : THREE.LinearEncoding;
    t.anisotropy = G.maxAniso || 8;
    return t;
  }
  T.toTex = toTex;

  // tileable value-noise fbm, values ~[0,1]
  function fbm(S, oct, base, pers = 0.5) {
    const out = new Float32Array(S * S);
    let amp = 1, tot = 0;
    for (let o = 0; o < oct; o++) {
      const p = base << o;
      if (p > S) break;
      const g = new Float32Array(p * p);
      for (let i = 0; i < g.length; i++) g[i] = R();
      const sc = p / S;
      for (let y = 0; y < S; y++) {
        const fy = y * sc, yi = fy | 0, yf = fy - yi, v = yf * yf * (3 - 2 * yf);
        const y0 = (yi % p) * p, y1 = ((yi + 1) % p) * p;
        for (let x = 0; x < S; x++) {
          const fx = x * sc, xi = fx | 0, xf = fx - xi, u = xf * xf * (3 - 2 * xf);
          const x0 = xi % p, x1 = (xi + 1) % p;
          const a = g[y0 + x0], b = g[y0 + x1], c = g[y1 + x0], d = g[y1 + x1];
          const top = a + (b - a) * u, bot = c + (d - c) * u;
          out[y * S + x] += amp * (top + (bot - top) * v);
        }
      }
      tot += amp; amp *= pers;
    }
    // stretch contrast to ~0..1
    let mn = 1e9, mx = -1e9;
    for (let i = 0; i < out.length; i++) { out[i] /= tot; if (out[i] < mn) mn = out[i]; if (out[i] > mx) mx = out[i]; }
    const k = 1 / Math.max(1e-6, mx - mn);
    for (let i = 0; i < out.length; i++) out[i] = (out[i] - mn) * k;
    return out;
  }

  function paint(W, fn, H) {
    H = H || W;
    const c = canvas(W, H), ctx = c.getContext('2d');
    const img = ctx.createImageData(W, H), d = img.data, col = [0, 0, 0, 255];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        col[3] = 255;
        fn(x, y, col, y * W + x);
        const i = (y * W + x) * 4;
        d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = col[3];
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  T.build = function () {
    // ---------------- BRICK
    {
      const n = fbm(512, 4, 4), g = fbm(512, 3, 64, 0.6);
      const m = 3;
      const brickAt = (x, y) => {
        const row = y >> 5, xx = (x + ((row & 1) ? 32 : 0)) & 511;
        return [row, xx >> 6, xx & 63, y & 31];
      };
      T.brick = toTex(paint(512, (x, y, c, i) => {
        const [row, col, lx, ly] = brickAt(x, y);
        const gr = g[i], nn = n[i];
        if (lx < m || ly < m) { const v = 112 + gr * 46; c[0] = v; c[1] = v * 0.97; c[2] = v * 0.9; return; }
        const h = G.hash2(col, row);
        const e = Math.min(lx - m, ly - m, 63 - lx, 31 - ly);
        const ef = e < 2 ? 0.8 + e * 0.1 : 1;
        let f = (0.72 + gr * 0.45) * (0.8 + nn * 0.4) * ef;
        if (h > 0.9) f *= 0.7;
        if (R() < 0.02) f *= 0.8;
        c[0] = (122 + h * 58) * f; c[1] = (54 + h * 24) * f; c[2] = (40 + h * 16) * f;
      }));
      T.brickBump = toTex(paint(512, (x, y, c, i) => {
        const [, , lx, ly] = brickAt(x, y);
        const v = (lx < m || ly < m) ? 40 : 180 + g[i] * 70;
        c[0] = c[1] = c[2] = v;
      }), false);
    }
    // ---------------- CONCRETE
    const conc = (tone, lines) => {
      const n = fbm(256, 5, 4), f = fbm(256, 2, 64), st = fbm(256, 3, 2);
      return paint(256, (x, y, c, i) => {
        let v = tone * (0.8 + n[i] * 0.3) + (f[i] - 0.5) * 20 + (R() - 0.5) * 12;
        if (st[i] > 0.8) v -= (st[i] - 0.8) * 60;
        if (R() < 0.01) v -= 25;
        if (lines && ((x & 127) < 2 || (y & 127) < 2)) v *= 0.72;
        c[0] = v; c[1] = v * 0.99; c[2] = v * 0.97;
      });
    };
    T.concrete = toTex(conc(150));
    T.concreteDark = toTex(conc(96));
    T.sidewalk = toTex(conc(165, true));
    T.concreteBump = toTex(paint(256, (x, y, c) => { const v = 128 + (R() - 0.5) * 60; c[0] = c[1] = c[2] = v; }), false);

    // ---------------- PLASTER / DRYWALL
    {
      const n = fbm(256, 5, 4), f = fbm(256, 3, 32);
      T.plaster = toTex(paint(256, (x, y, c, i) => {
        const v = 208 + (n[i] - 0.5) * 26 + (f[i] - 0.5) * 16 + (R() - 0.5) * 8;
        c[0] = v; c[1] = v * 0.985; c[2] = v * 0.955;
      }));
      T.plasterBump = toTex(paint(256, (x, y, c, i) => { const v = 128 + (f[i] - 0.5) * 80 + (R() - 0.5) * 30; c[0] = c[1] = c[2] = v; }), false);
    }
    // ---------------- WOOD FLOOR
    {
      const n = fbm(512, 4, 4), f = fbm(512, 3, 16);
      T.woodFloor = toTex(paint(512, (x, y, c, i) => {
        const row = y >> 6, ly = y & 63;
        const off = (G.hash2(row, 7) * 512) | 0;
        const xx = (x + off) & 511, seg = xx >> 8, lx = xx & 255;
        const h = G.hash2(row, seg + 3);
        if (ly < 2 || lx < 2) { c[0] = 38; c[1] = 24; c[2] = 14; return; }
        const grain = Math.sin(y * 0.55 + n[i] * 26 + h * 40) * 0.5 + 0.5;
        const fine = Math.sin(y * 3.1 + f[i] * 16) * 0.5 + 0.5;
        const k = (0.7 + h * 0.36) * (0.84 + grain * 0.13 + fine * 0.05) * (0.92 + f[i] * 0.14);
        c[0] = 150 * k; c[1] = 98 * k; c[2] = 58 * k;
      }));
    }
    // ---------------- CARPET
    const carpet = (r, g, b) => {
      const n = fbm(256, 4, 8);
      return paint(256, (x, y, c, i) => {
        const k = 0.72 + n[i] * 0.3 + (R() - 0.5) * 0.24;
        const pat = (((x >> 4) + (y >> 4)) & 1) ? 1 : 0.93;
        c[0] = r * k * pat; c[1] = g * k * pat; c[2] = b * k * pat;
      });
    };
    T.carpetBlue = toTex(carpet(66, 78, 100));
    T.carpetRed = toTex(carpet(118, 46, 44));
    // ---------------- TILES
    const tiles = (n, base, grout, varr) => {
      const f = fbm(256, 3, 8), ts = 256 / n;
      return paint(256, (x, y, c, i) => {
        const lx = x % ts, ly = y % ts;
        if (lx < 2 || ly < 2) { c[0] = grout[0]; c[1] = grout[1]; c[2] = grout[2]; return; }
        const h = G.hash2((x / ts) | 0, (y / ts) | 0);
        const k = 1 - varr * h + (f[i] - 0.5) * 0.08 + (R() - 0.5) * 0.03;
        c[0] = base[0] * k; c[1] = base[1] * k; c[2] = base[2] * k;
      });
    };
    T.tile = toTex(tiles(4, [226, 226, 218], [140, 140, 134], 0.08));
    T.tileDark = toTex(tiles(2, [118, 122, 128], [52, 54, 58], 0.12));
    // ---------------- MARBLE
    {
      const n = fbm(256, 5, 4), m2 = fbm(256, 4, 8);
      T.marble = toTex(paint(256, (x, y, c, i) => {
        if ((x & 127) < 1 || (y & 127) < 1) { c[0] = 160; c[1] = 155; c[2] = 146; return; }
        const v = Math.abs(Math.sin((x + y) * 0.02 + n[i] * 12 + m2[i] * 5));
        const vein = v < 0.06 ? 0.7 + v * 5 : 1;
        const k = (0.9 + m2[i] * 0.1) * vein;
        c[0] = 232 * k; c[1] = 226 * k; c[2] = 214 * k;
      }));
    }
    // ---------------- BARRICADE PLANK
    {
      const n = fbm(256, 4, 4), f = fbm(256, 3, 32);
      const knots = [];
      for (let k = 0; k < 5; k++) knots.push([R() * 256, R() * 256, 4 + R() * 6]);
      T.plank = toTex(paint(256, (x, y, c, i) => {
        const g = Math.sin(y * 0.33 + n[i] * 16) * 0.5 + 0.5;
        let k = 0.7 + g * 0.18 + f[i] * 0.16;
        for (const kn of knots) {
          const dx = (x - kn[0]) * 0.5, dy = y - kn[1], d = Math.sqrt(dx * dx + dy * dy);
          if (d < kn[2]) k *= 0.5 + d / kn[2] * 0.4;
          else if (d < kn[2] * 2.2) k *= 0.93 + Math.sin(d * 1.3) * 0.05;
        }
        if ((x % 128) > 10 && (x % 128) < 14 && ((y % 64) > 28 && (y % 64) < 32)) k = 0.25; // nails
        c[0] = 158 * k; c[1] = 114 * k; c[2] = 70 * k;
      }));
    }
    // ---------------- GRASS / DIRT
    {
      const n = fbm(256, 5, 4), f = fbm(256, 3, 8);
      T.grass = toTex(paint(256, (x, y, c, i) => {
        let r = 64, g = 96, b = 40;
        const k = 0.62 + n[i] * 0.42 + (R() - 0.5) * 0.34;
        if (f[i] < 0.22) { r = 96; g = 84; b = 58; }
        c[0] = r * k; c[1] = g * k; c[2] = b * k;
      }));
      T.dirt = toTex(paint(256, (x, y, c, i) => {
        const k = 0.7 + n[i] * 0.35 + (R() - 0.5) * 0.2;
        c[0] = 112 * k; c[1] = 92 * k; c[2] = 68 * k;
      }));
    }
    // ---------------- ASPHALT / ROOF
    {
      const n = fbm(256, 4, 8);
      T.asphalt = toTex(paint(256, (x, y, c, i) => {
        let v = 50 + n[i] * 22 + (R() - 0.5) * 24;
        if (R() < 0.015) v += 40;
        c[0] = v; c[1] = v; c[2] = v * 1.04;
      }));
      T.roof = toTex(paint(256, (x, y, c, i) => {
        const v = 64 + n[i] * 30 + (R() - 0.5) * 50;
        c[0] = v; c[1] = v * 0.97; c[2] = v * 0.92;
      }));
    }
    // ---------------- METAL (reinforced wall plating)
    {
      const n = fbm(256, 4, 4);
      T.metal = toTex(paint(256, (x, y, c, i) => {
        const lx = x & 127, ly = y & 127;
        let k = 0.8 + n[i] * 0.22 + (G.hash2(y, 3) - 0.5) * 0.07;
        if (lx < 2 || ly < 2) k *= 0.45;
        else if (lx < 4 || ly < 4) k *= 1.15;
        const rx = Math.min(lx, 127 - lx) - 10, ry = Math.min(ly, 127 - ly) - 10, rd = rx * rx + ry * ry;
        if (rd < 10) k *= 1.35; else if (rd < 18) k *= 0.7;
        c[0] = 100 * k; c[1] = 106 * k; c[2] = 112 * k;
      }));
      T.brushed = toTex(paint(256, (x, y, c) => {
        const v = 170 + (G.hash2(y, 11) - 0.5) * 30 + (R() - 0.5) * 10;
        c[0] = v; c[1] = v; c[2] = v * 1.02;
      }));
    }
    // ---------------- CEILING
    T.ceiling = toTex(paint(256, (x, y, c) => {
      const lx = x & 127, ly = y & 127;
      if (lx < 3 || ly < 3) { c[0] = c[1] = c[2] = 186; return; }
      let v = 222 + (R() - 0.5) * 10;
      if (R() < 0.05) v -= 45;
      c[0] = v; c[1] = v; c[2] = v * 0.98;
    }));
    // ---------------- FABRIC / LEATHER
    const fabric = (r, g, b) => {
      const n = fbm(128, 3, 8);
      return paint(128, (x, y, c, i) => {
        const w = (((x & 3) < 2) !== ((y & 3) < 2)) ? 1 : 0.88;
        const k = w * (0.85 + n[i] * 0.22);
        c[0] = r * k; c[1] = g * k; c[2] = b * k;
      });
    };
    T.fabric = toTex(fabric(200, 200, 200));
    {
      const n = fbm(128, 4, 8);
      T.leather = toTex(paint(128, (x, y, c, i) => {
        const k = 0.8 + n[i] * 0.3 + (R() - 0.5) * 0.1;
        c[0] = 200 * k; c[1] = 200 * k; c[2] = 200 * k;
      }));
    }
    // ---------------- WOOD (furniture)
    const woodTex = (r, g, b) => {
      const n = fbm(256, 4, 4);
      return paint(256, (x, y, c, i) => {
        const gr = Math.sin(y * 0.28 + n[i] * 20) * 0.5 + 0.5;
        const k = 0.78 + gr * 0.2 + (R() - 0.5) * 0.04;
        c[0] = r * k; c[1] = g * k; c[2] = b * k;
      });
    };
    T.woodDark = toTex(woodTex(98, 62, 38));
    T.woodLight = toTex(woodTex(176, 132, 86));
    // crate
    {
      const n = fbm(128, 3, 4);
      T.crate = toTex(paint(128, (x, y, c, i) => {
        const b = (x < 8 || x > 119 || y < 8 || y > 119) ? 0.78 : 1;
        const diag = Math.abs(x - y) < 7 ? 0.84 : 1;
        const pl = (y % 32) < 2 ? 0.6 : 1;
        const k = b * diag * pl * (0.8 + n[i] * 0.25 + Math.sin(y * 0.4 + n[i] * 10) * 0.05);
        c[0] = 168 * k; c[1] = 128 * k; c[2] = 80 * k;
      }));
    }
    // cardboard
    T.cardboard = toTex(paint(128, (x, y, c) => {
      const k = 0.9 + (R() - 0.5) * 0.08 + ((x & 3) === 0 ? -0.04 : 0);
      const tape = Math.abs(y - 64) < 8 ? 0.85 : 1;
      c[0] = 176 * k * tape; c[1] = 136 * k * tape; c[2] = 92 * k * tape;
    }));
    // ---------------- CAMO / VEST
    const camo = (pal) => {
      const n = fbm(256, 4, 4), m = fbm(256, 3, 8);
      return paint(256, (x, y, c, i) => {
        const v = n[i] * 0.7 + m[i] * 0.3;
        const p = v < 0.38 ? pal[0] : v < 0.5 ? pal[1] : v < 0.62 ? pal[2] : pal[3];
        const w = ((x + y) & 1) ? 1 : 0.93;
        c[0] = p[0] * w; c[1] = p[1] * w; c[2] = p[2] * w;
      });
    };
    T.camoAtk = toTex(camo([[112, 102, 78], [140, 126, 96], [92, 86, 62], [66, 62, 48]]));
    T.camoDef = toTex(camo([[54, 58, 62], [74, 78, 82], [40, 42, 46], [90, 92, 94]]));
    const vest = (r, g, b) => paint(128, (x, y, c) => {
      const band = (y % 16) < 5 ? 0.76 : 1;
      const st = ((x % 24) < 2 && (y % 16) < 5) ? 0.6 : 1;
      const k = band * st * (0.9 + R() * 0.12);
      c[0] = r * k; c[1] = g * k; c[2] = b * k;
    });
    T.vestAtk = toTex(vest(118, 110, 82));
    T.vestDef = toTex(vest(46, 48, 50));

    // ---------------- SERVER RACK (front)
    {
      T.rack = toTex(paint(128, (x, y, c) => {
        const u = y % 24;
        let v;
        if (x < 6 || x > 121) v = 58;
        else if (u < 2) v = 18;
        else if (x > 16 && x < 96 && (x % 4 < 2) && (u % 4 < 2)) v = 16;
        else v = 40;
        c[0] = v; c[1] = v + 2; c[2] = v + 6;
      }, 256));
      const leds = [[60, 255, 120], [60, 160, 255], [255, 180, 40], [255, 60, 60]];
      const cols = [];
      for (let u = 0; u < 11; u++) for (let l = 0; l < 3; l++) cols.push(R() < 0.75 ? leds[(R() * (R() < 0.9 ? 2 : 4)) | 0] : null);
      T.rackEmis = toTex(paint(128, (x, y, c) => {
        c[0] = c[1] = c[2] = 0;
        const u = (y / 24) | 0, ly = y % 24;
        if (ly >= 9 && ly < 13) {
          for (let l = 0; l < 3; l++) {
            const lx0 = 100 + l * 6;
            if (x >= lx0 && x < lx0 + 3) {
              const cc = cols[u * 3 + l];
              if (cc) { c[0] = cc[0]; c[1] = cc[1]; c[2] = cc[2]; }
            }
          }
        }
      }, 256));
    }
    // ---------------- MONITOR SCREEN
    T.screen = toTex(paint(128, (x, y, c) => {
      let r = 18, g = 40, b = 70;
      if (y < 10) { r = 30; g = 60; b = 110; }
      if (x > 8 && x < 60 && y > 18 && y < 70) { r = 40; g = 90; b = 140; if ((y % 8) < 2) { r = 120; g = 180; b = 220; } }
      if (x > 68 && x < 120 && y > 18 && y < 100) { const h = Math.sin(x * 0.3) * 20 + 60; if (y > 100 - h * 0.8 && (x % 6) < 4) { r = 60; g = 200; b = 140; } }
      c[0] = r; c[1] = g; c[2] = b;
    }, 80));
    // ---------------- BUILDING FACADE (backdrop)
    const facade = (wall, lit) => {
      const n = fbm(256, 3, 4);
      const litMap = [];
      for (let i = 0; i < 16; i++) litMap.push(R() < lit);
      const main = paint(256, (x, y, c, i) => {
        const cx = x & 63, cy = y & 63, wi = (x >> 6) + (y >> 6) * 4;
        if (cx > 10 && cx < 54 && cy > 12 && cy < 50) {
          const refl = 0.6 + (1 - cy / 64) * 0.5;
          if (cx === 32) { c[0] = c[1] = c[2] = 40; return; }
          if (litMap[wi]) { c[0] = 190; c[1] = 170; c[2] = 120; } else { c[0] = 50 * refl; c[1] = 70 * refl; c[2] = 92 * refl; }
          return;
        }
        const k = 0.85 + n[i] * 0.25;
        c[0] = wall[0] * k; c[1] = wall[1] * k; c[2] = wall[2] * k;
      });
      return toTex(main);
    };
    T.facadeA = facade([150, 140, 125], 0.15);
    T.facadeB = facade([110, 80, 66], 0.1);
    T.facadeC = facade([170, 172, 170], 0.2);

    // ---------------- BULLET HOLE (alpha)
    T.hole = toTex(paint(64, (x, y, c) => {
      const dx = x - 31.5, dy = y - 31.5, r = Math.sqrt(dx * dx + dy * dy);
      const ang = Math.atan2(dy, dx);
      const crack = Math.pow(Math.abs(Math.sin(ang * 3 + 1.3)), 30);
      let a = 0, v = 20;
      if (r < 4) { a = 1; v = 6; }
      else if (r < 8) { a = 0.9; v = 30; }
      else if (r < 26) { a = Math.max(0, 0.45 - (r - 8) / 30) + crack * 0.6 * (1 - r / 26); v = 55; }
      c[0] = c[1] = c[2] = v; c[3] = Math.min(255, a * 255);
    }), true, true);
    // ---------------- MUZZLE FLASH
    {
      const c = canvas(128, 128), x = c.getContext('2d');
      const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, 'rgba(255,255,235,1)');
      gr.addColorStop(0.18, 'rgba(255,225,130,0.95)');
      gr.addColorStop(0.45, 'rgba(255,140,40,0.35)');
      gr.addColorStop(1, 'rgba(255,100,0,0)');
      x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
      x.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2 + R() * 0.4;
        x.save(); x.translate(64, 64); x.rotate(a);
        const g2 = x.createLinearGradient(0, 0, 62, 0);
        g2.addColorStop(0, 'rgba(255,240,190,0.9)'); g2.addColorStop(1, 'rgba(255,150,60,0)');
        x.fillStyle = g2; x.beginPath(); x.moveTo(0, -5); x.lineTo(62, 0); x.lineTo(0, 5); x.fill();
        x.restore();
      }
      T.flash = toTex(c, true, true);
    }
    // soft dot / smoke
    {
      const c = canvas(32, 32), x = c.getContext('2d');
      const gr = x.createRadialGradient(16, 16, 0, 16, 16, 16);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = gr; x.fillRect(0, 0, 32, 32);
      T.dot = toTex(c, true, true);
      const n = fbm(64, 3, 4);
      T.smoke = toTex(paint(64, (px, py, col, i) => {
        const dx = px - 31.5, dy = py - 31.5, r = Math.sqrt(dx * dx + dy * dy) / 32;
        const a = Math.max(0, 1 - r) * (0.55 + n[i] * 0.45);
        col[0] = col[1] = col[2] = 255; col[3] = a * a * 255;
      }), true, true);
    }
    // ---------------- SKY
    {
      const c = canvas(8, 256), x = c.getContext('2d');
      const g = x.createLinearGradient(0, 0, 0, 256);
      g.addColorStop(0, '#3f78c0'); g.addColorStop(0.35, '#7fb0e0'); g.addColorStop(0.5, '#d9e4ec'); g.addColorStop(0.52, '#c9c2b4'); g.addColorStop(1, '#6f6a60');
      x.fillStyle = g; x.fillRect(0, 0, 8, 256);
      T.sky = toTex(c, true, true);
    }
    // fence (chain link, alpha)
    T.fence = toTex(paint(64, (x, y, c) => {
      const a = ((x + y) & 15), b = ((x - y + 64) & 15);
      const on = a < 2 || b < 2;
      c[0] = c[1] = c[2] = 150; c[3] = on ? 255 : 0;
    }), true);
    // foliage / bark
    {
      const n = fbm(128, 4, 4);
      T.foliage = toTex(paint(128, (x, y, c, i) => {
        const k = 0.55 + n[i] * 0.5 + (R() - 0.5) * 0.3;
        c[0] = 58 * k; c[1] = 92 * k; c[2] = 38 * k;
      }));
      T.bark = toTex(paint(128, (x, y, c, i) => {
        const k = 0.6 + Math.abs(Math.sin(x * 0.4 + n[i] * 6)) * 0.4 + (R() - 0.5) * 0.1;
        c[0] = 92 * k; c[1] = 72 * k; c[2] = 54 * k;
      }));
    }
    // rubber / tire
    T.tire = toTex(paint(64, (x, y, c) => { const v = 34 + ((y & 7) < 3 ? 8 : 0) + (R() - 0.5) * 8; c[0] = c[1] = c[2] = v; }));

    // ---------------- SNOW
    {
      const n = fbm(256, 5, 4), f = fbm(256, 3, 32);
      T.snow = toTex(paint(256, (x, y, c, i) => {
        const v = 226 + (n[i] - 0.5) * 30 + (f[i] - 0.5) * 14 + (R() - 0.5) * 10;
        c[0] = v * 0.97; c[1] = v * 0.985; c[2] = Math.min(255, v * 1.02);
      }));
    }
    // ---------------- LOG WALL (horizontal logs)
    {
      const n = fbm(256, 4, 4);
      T.logs = toTex(paint(256, (x, y, c, i) => {
        const ly = y % 32, t = ly / 32;
        const round = Math.sin(t * Math.PI);
        const gap = ly < 2 || ly > 30;
        const h = G.hash2((y / 32) | 0, 5);
        const grain = 0.9 + Math.sin(y * 0.9 + n[i] * 14) * 0.06;
        let k = gap ? 0.35 : (0.55 + round * 0.5) * grain * (0.85 + h * 0.25);
        c[0] = 128 * k; c[1] = 86 * k; c[2] = 52 * k;
      }));
    }
    // ---------------- CORRUGATED METAL
    {
      const n = fbm(256, 4, 4);
      T.corrugated = toTex(paint(256, (x, y, c, i) => {
        const rib = 0.78 + Math.abs(Math.sin(x * Math.PI / 16)) * 0.3;
        let k = rib * (0.85 + n[i] * 0.25);
        if (n[i] > 0.78) k *= 0.8 + (1 - n[i]) * 0.9; // rust/stain blotches
        c[0] = 150 * k; c[1] = 156 * k; c[2] = 160 * k;
      }));
      T.container = toTex(paint(256, (x, y, c, i) => {
        const rib = (x % 32) < 16 ? 1.0 : 0.82;
        const edge = (y < 6 || y > 249) ? 0.6 : 1;
        const k = rib * edge * (0.88 + n[i] * 0.2) - ((R() < 0.004) ? 0.25 : 0);
        c[0] = c[1] = c[2] = 210 * k;
      }));
    }
    // ---------------- WATER
    {
      const n = fbm(256, 4, 8);
      T.water = toTex(paint(256, (x, y, c, i) => {
        const k = 0.8 + n[i] * 0.35;
        c[0] = 40 * k; c[1] = 70 * k; c[2] = 82 * k;
      }));
    }
    // pine foliage
    {
      const n = fbm(128, 4, 8);
      T.pine = toTex(paint(128, (x, y, c, i) => {
        const k = 0.55 + n[i] * 0.5 + (R() - 0.5) * 0.35;
        c[0] = 34 * k; c[1] = 62 * k; c[2] = 44 * k;
      }));
    }
  };

  // vertical sky gradient from 5 colour stops (zenith → horizon → ground)
  T.makeSky = function (stops) {
    const c = canvas(8, 256), x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 256);
    const pos = [0, 0.35, 0.5, 0.52, 1];
    stops.forEach((s, i) => g.addColorStop(pos[i], s));
    x.fillStyle = g; x.fillRect(0, 0, 8, 256);
    return toTex(c, true, true);
  };

  // text sign
  T.sign = function (text, w, h, bg, fg, size) {
    const c = canvas(w, h), x = c.getContext('2d');
    x.fillStyle = bg; x.fillRect(0, 0, w, h);
    x.fillStyle = fg; x.font = `bold ${size || h * 0.55}px Oswald, Arial, sans-serif`;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(text, w / 2, h / 2 + 2);
    return toTex(c, true, true);
  };

  // ============ MATERIALS ============
  // userData.s = metres per texture repeat (for world-scaled box UVs)
  G.PHYS = {};
  G.buildMaterials = function () {
    const M = (G.M = {});
    const std = (o, s, phys) => {
      const m = new THREE.MeshStandardMaterial(o);
      m.userData.s = s || 1;
      m.userData.phys = phys || 'concrete';
      return m;
    };
    M.brick = std({ map: T.brick, bumpMap: T.brickBump, bumpScale: 0.035, roughness: 0.92 }, 2.4, 'brick');
    M.plasterExt = std({ map: T.plaster, bumpMap: T.plasterBump, bumpScale: 0.004, color: 0xece6da, roughness: 0.95 }, 2, 'concrete');
    M.metalWall = std({ map: T.metal, roughness: 0.55, metalness: 0.55, color: 0xb8c0c8 }, 2, 'metal');
    M.concrete = std({ map: T.concrete, bumpMap: T.concreteBump, bumpScale: 0.004, roughness: 0.95 }, 3, 'concrete');
    M.concreteDark = std({ map: T.concreteDark, roughness: 0.9 }, 3, 'concrete');
    M.sidewalk = std({ map: T.sidewalk, roughness: 0.95 }, 2, 'concrete');
    M.tile = std({ map: T.tile, roughness: 0.35 }, 1.2, 'concrete');
    M.tileDark = std({ map: T.tileDark, roughness: 0.5, metalness: 0.1 }, 1.2, 'concrete');
    M.marble = std({ map: T.marble, roughness: 0.25 }, 2.4, 'concrete');
    M.woodFloor = std({ map: T.woodFloor, roughness: 0.55 }, 2.4, 'wood');
    M.carpetBlue = std({ map: T.carpetBlue, roughness: 1 }, 2, 'fabric');
    M.carpetRed = std({ map: T.carpetRed, roughness: 1 }, 2, 'fabric');
    M.grass = std({ map: T.grass, roughness: 1 }, 5, 'dirt');
    M.dirt = std({ map: T.dirt, roughness: 1 }, 4, 'dirt');
    M.asphalt = std({ map: T.asphalt, roughness: 0.92 }, 5, 'concrete');
    M.ceiling = std({ map: T.ceiling, roughness: 0.95 }, 1.2, 'concrete');
    M.roof = std({ map: T.roof, roughness: 1 }, 4, 'concrete');
    M.trim = std({ color: 0xe8e4dc, roughness: 0.6, map: T.plaster }, 1, 'wood');
    M.woodDark = std({ map: T.woodDark, roughness: 0.55 }, 1.2, 'wood');
    M.woodLight = std({ map: T.woodLight, roughness: 0.6 }, 1.2, 'wood');
    M.counterTop = std({ map: T.marble, color: 0x5a5a5e, roughness: 0.3 }, 1.2, 'concrete');
    M.cabinet = std({ map: T.plaster, color: 0xf2efe8, roughness: 0.5 }, 1, 'wood');
    M.cabinetGray = std({ map: T.plaster, color: 0x6f7880, roughness: 0.5 }, 1, 'wood');
    M.steel = std({ map: T.brushed, roughness: 0.35, metalness: 0.6, color: 0xd8dde2 }, 1, 'metal');
    M.metalShelf = std({ map: T.brushed, roughness: 0.5, metalness: 0.5, color: 0x8a939c }, 1, 'metal');
    M.darkMetal = std({ color: 0x2b2e33, roughness: 0.5, metalness: 0.5 }, 1, 'metal');
    M.fabricGray = std({ map: T.fabric, color: 0x6c717a, roughness: 1 }, 0.6, 'fabric');
    M.fabricBeige = std({ map: T.fabric, color: 0xb8a58a, roughness: 1 }, 0.6, 'fabric');
    M.fabricGreen = std({ map: T.fabric, color: 0x4e6650, roughness: 1 }, 0.6, 'fabric');
    M.leather = std({ map: T.leather, color: 0x4a2e22, roughness: 0.55 }, 0.6, 'fabric');
    M.crate = std({ map: T.crate, roughness: 0.85 }, 1, 'wood');
    M.cardboard = std({ map: T.cardboard, roughness: 0.95 }, 0.6, 'wood');
    M.jersey = std({ map: T.concrete, color: 0xd6d2c8, roughness: 0.95 }, 2, 'concrete');
    M.dumpster = std({ map: T.brushed, color: 0x2f5d3a, roughness: 0.6, metalness: 0.4 }, 1, 'metal');
    M.plasticBlack = std({ color: 0x1b1c1f, roughness: 0.6 }, 1, 'metal');
    M.plasticWhite = std({ color: 0xe8e8e6, roughness: 0.45 }, 1, 'metal');
    M.plasticGray = std({ color: 0x55595f, roughness: 0.55 }, 1, 'metal');
    M.glass = new THREE.MeshStandardMaterial({ color: 0x1c2630, roughness: 0.05, metalness: 0.8, transparent: true, opacity: 0.78 });
    M.glass.userData.s = 1; M.glass.userData.phys = 'glass';
    M.screen = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffffff, emissiveMap: T.screen, map: T.screen, roughness: 0.2 });
    M.screen.userData.s = 1;
    M.lightPanel = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d8, emissiveIntensity: 1.3, roughness: 0.4 });
    M.lightPanel.userData.s = 1;
    M.lightRed = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff2020, emissiveIntensity: 1.5 });
    M.lightWhite = new THREE.MeshStandardMaterial({ color: 0x888888, emissive: 0xfff6e0, emissiveIntensity: 1.2 });
    M.lightAmber = new THREE.MeshStandardMaterial({ color: 0x553300, emissive: 0xffa020, emissiveIntensity: 1.2 });
    M.glowBlue = new THREE.MeshStandardMaterial({ color: 0x0a2040, emissive: 0x3cc8ff, emissiveIntensity: 2.0, roughness: 0.2 });
    M.rack = [
      std({ color: 0x2a2d32, roughness: 0.5, metalness: 0.5 }), std({ color: 0x2a2d32, roughness: 0.5, metalness: 0.5 }),
      std({ color: 0x2a2d32, roughness: 0.5, metalness: 0.5 }), std({ color: 0x2a2d32, roughness: 0.5, metalness: 0.5 }),
      new THREE.MeshStandardMaterial({ map: T.rack, emissiveMap: T.rackEmis, emissive: 0xffffff, emissiveIntensity: 1.6, roughness: 0.45, metalness: 0.4 }),
      std({ color: 0x24272b, roughness: 0.5, metalness: 0.5 }),
    ];
    M.tire = std({ map: T.tire, roughness: 0.9 }, 1, 'fabric');
    M.rim = std({ color: 0xa8adb2, roughness: 0.3, metalness: 0.8 }, 1, 'metal');
    const carPaint = (c) => std({ color: c, roughness: 0.28, metalness: 0.45 }, 1, 'metal');
    M.carRed = carPaint(0x8e1b1b); M.carBlue = carPaint(0x1e3c6e); M.carWhite = carPaint(0xd9d9d6);
    M.carBlack = carPaint(0x1d1f22); M.carSilver = carPaint(0x8c9298); M.carGreen = carPaint(0x2d4a38);
    M.bark = std({ map: T.bark, roughness: 1 }, 1, 'wood');
    M.foliage = std({ map: T.foliage, roughness: 1, flatShading: true }, 1, 'fabric');
    M.hedge = std({ map: T.foliage, roughness: 1, color: 0x88aa77 }, 1.5, 'fabric');
    M.fence = new THREE.MeshStandardMaterial({ map: T.fence, alphaTest: 0.5, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.5 });
    M.fence.userData.s = 1.2; M.fence.userData.phys = 'metal';
    M.facadeA = std({ map: T.facadeA, roughness: 0.8 }, 6, 'concrete');
    M.facadeB = std({ map: T.facadeB, roughness: 0.8 }, 6, 'brick');
    M.facadeC = std({ map: T.facadeC, roughness: 0.8 }, 6, 'concrete');
    M.paintWhite = std({ color: 0xf2f2ee, roughness: 0.5 }, 1, 'concrete');
    M.paintYellow = std({ color: 0xe0b020, roughness: 0.6 }, 1, 'concrete');
    M.rug = std({ map: T.carpetRed, color: 0xd8c0a0, roughness: 1 }, 1.5, 'fabric');
    M.pot = std({ color: 0x8c5a3c, roughness: 0.8 }, 1, 'concrete');
    M.soil = std({ map: T.dirt, color: 0x5a4632, roughness: 1 }, 0.5, 'dirt');
    // new-map materials
    M.snow = std({ map: T.snow, roughness: 0.9 }, 5, 'dirt');
    M.logs = std({ map: T.logs, roughness: 0.85 }, 2.4, 'wood');
    M.woodCeiling = std({ map: T.woodLight, color: 0xd8c0a0, roughness: 0.7 }, 1.6, 'wood');
    M.corrugated = std({ map: T.corrugated, roughness: 0.55, metalness: 0.45 }, 2, 'metal');
    const cont = (col) => std({ map: T.container, color: col, roughness: 0.6, metalness: 0.3 }, 2.6, 'metal');
    M.contRed = cont(0x9a3324); M.contBlue = cont(0x2a5a8c); M.contGreen = cont(0x3f6b3a); M.contOrange = cont(0xc8742a); M.contGray = cont(0x8a9096);
    M.water = std({ map: T.water, roughness: 0.15, metalness: 0.35 }, 6, 'dirt');
    M.pine = std({ map: T.pine, roughness: 1, flatShading: true }, 1, 'fabric');
    M.stone = std({ map: T.concrete, color: 0x9a948a, bumpMap: T.concreteBump, bumpScale: 0.01, roughness: 0.95 }, 1.2, 'concrete');
    M.fire = new THREE.MeshStandardMaterial({ color: 0x401000, emissive: 0xff7a20, emissiveIntensity: 2.2 });
    M.gold = std({ color: 0xd4a640, roughness: 0.25, metalness: 0.9 }, 1, 'metal');
    M.sheets = std({ map: T.fabric, color: 0xe8e4dc, roughness: 1 }, 0.8, 'fabric');
    M.forklift = std({ color: 0xe0a818, roughness: 0.5, metalness: 0.3 }, 1, 'metal');

    // ---- characters
    M.uniAtk = std({ map: T.camoAtk, roughness: 0.9 }, 1);
    M.uniDef = std({ map: T.camoDef, roughness: 0.9 }, 1);
    M.vestAtk = std({ map: T.vestAtk, roughness: 0.85 }, 1);
    M.vestDef = std({ map: T.vestDef, roughness: 0.85 }, 1);
    M.helmAtk = std({ color: 0x7a6e54, roughness: 0.7 }, 1);
    M.helmDef = std({ color: 0x2c2f33, roughness: 0.6 }, 1);
    M.skin1 = std({ color: 0xc89878, roughness: 0.7 }, 1);
    M.skin2 = std({ color: 0x8d5d3f, roughness: 0.7 }, 1);
    M.skin3 = std({ color: 0xe0b89a, roughness: 0.7 }, 1);
    M.balaclava = std({ map: T.fabric, color: 0x26282b, roughness: 1 }, 1);
    M.glove = std({ map: T.leather, color: 0x2a2826, roughness: 0.75 }, 1);
    M.gloveTan = std({ map: T.leather, color: 0x8a7556, roughness: 0.75 }, 1);
    M.boot = std({ map: T.leather, color: 0x3a3026, roughness: 0.8 }, 1);
    M.lens = new THREE.MeshStandardMaterial({ color: 0x151a20, roughness: 0.05, metalness: 0.9 });
    M.bandAtk = new THREE.MeshStandardMaterial({ color: 0x1b5d99, emissive: 0x3fa7ff, emissiveIntensity: 0.6, roughness: 0.6 });
    M.bandDef = new THREE.MeshStandardMaterial({ color: 0x994a10, emissive: 0xff8a2a, emissiveIntensity: 0.6, roughness: 0.6 });

    // ---- guns
    M.gunMetal = new THREE.MeshStandardMaterial({ color: 0x2c2e32, roughness: 0.42, metalness: 0.65 });
    M.gunPoly = new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.72, metalness: 0.1 });
    M.gunTan = new THREE.MeshStandardMaterial({ color: 0x8a7658, roughness: 0.75, metalness: 0.05 });
    M.gunWood = new THREE.MeshStandardMaterial({ map: T.woodDark, roughness: 0.5 });
    M.gunDark = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.9 });
    M.gunBrass = new THREE.MeshStandardMaterial({ color: 0xc8a050, roughness: 0.3, metalness: 0.9 });
    M.shell = new THREE.MeshStandardMaterial({ color: 0xa02020, roughness: 0.5 });
    M.sightTube = new THREE.MeshStandardMaterial({ color: 0x17181b, roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide });
    M.sightGlass = new THREE.MeshBasicMaterial({ color: 0x88ccff, transparent: true, opacity: 0.1, depthWrite: false });
    M.redDot = new THREE.MeshBasicMaterial({ color: 0xff2a1a, toneMapped: false });
    M.grenade = new THREE.MeshStandardMaterial({ color: 0x4f5a34, roughness: 0.6, metalness: 0.2 });

    for (const k in M) if (M[k] && M[k].userData) G.PHYS[k] = M[k].userData.phys || 'concrete';
  };

  // World-space UVs for instanced destructible cells, with darkened broken edges.
  G.worldUVMaterial = function (mat, scale, sideTint) {
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uvS = { value: 1 / scale };
      sh.vertexShader = 'uniform float uvS;\nvarying float vSide;\n' + sh.vertexShader.replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
        {
          #ifdef USE_INSTANCING
            vec4 wpp = modelMatrix * instanceMatrix * vec4(position, 1.0);
            vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          #else
            vec4 wpp = modelMatrix * vec4(position, 1.0);
            vec3 sc = vec3(1.0);
          #endif
          vec3 an = abs(normal);
          vec2 wuv = an.x > 0.5 ? wpp.zy : (an.y > 0.5 ? wpp.xz : wpp.xy);
          #ifdef USE_UV
          vUv = wuv * uvS;
          #endif
          float thin = (sc.x < sc.y && sc.x < sc.z) ? 0.0 : (sc.z < sc.y ? 2.0 : 1.0);
          float ax = an.x > 0.5 ? 0.0 : (an.y > 0.5 ? 1.0 : 2.0);
          vSide = abs(ax - thin) < 0.1 ? 0.0 : 1.0;
        }`
      );
      sh.fragmentShader = 'varying float vSide;\n' + sh.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        diffuseColor.rgb *= mix(vec3(1.0), ${sideTint}, vSide);`
      );
    };
    mat.customProgramCacheKey = () => 'wuv' + scale + sideTint;
    return mat;
  };
})();
