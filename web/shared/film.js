// Draws any moment of the film onto a canvas. The studio preview and the MP4 use this same code.
import { World } from './world.js';
import { plan as makePlan, placeName } from './story.js';

const INK = '#101A20';
const ease = (x) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 4;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const BODY = '"Archivo Variable", "Kohinoor Devanagari", "Noto Sans Devanagari", system-ui, sans-serif';
export const FACES = {
  modern: { family: `"Archivo Variable", "Kohinoor Devanagari", system-ui, sans-serif`, weight: 600, stretch: 'expanded', size: 0.86, lh: 1.04, track: -0.018 },
  heritage: { family: `Marcellus, "Kohinoor Devanagari", Georgia, serif`, weight: 400, stretch: 'normal', size: 1, lh: 1.1, track: -0.005 },
  bold: { family: `"Big Shoulders Display Variable", "Kohinoor Devanagari", Impact, sans-serif`, weight: 800, stretch: 'normal', size: 1.22, lh: 0.96, track: -0.004 },
};

export async function loadFonts() {
  const probe = 'Aa0₹é';
  await Promise.all([
    document.fonts.load(`600 40px "Archivo Variable"`, probe), document.fonts.load(`400 40px "Archivo Variable"`, probe),
    document.fonts.load(`expanded 600 40px "Archivo Variable"`, probe),
    document.fonts.load('400 40px Marcellus', probe), document.fonts.load('800 40px "Big Shoulders Display Variable"', probe), document.fonts.load('900 40px "Big Shoulders Display Variable"', probe),
    document.fonts.load('400 40px "Great Vibes"', probe),
  ]);
}

const image = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });

export function readableOn(hex) {
  const n = parseInt(hex.slice(1), 16), f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const l = 0.2126 * f(n >> 16) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
  return l > 0.36 ? INK : '#ffffff';
}

export class Film {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.world = opts.world || new World(opts);
    this.images = new Map();
  }

  async load(p) {
    this.p = p;
    const want = new Map(p.photos.map((x) => [x.id, `/files/${p.id}/media/${x.file}`]));
    if (p.logo) want.set('logo:' + p.logo, `/files/${p.id}/media/${p.logo}`);
    await Promise.all([...want].filter(([k]) => !this.images.has(k)).map(async ([k, src]) => this.images.set(k, await image(src))));
    this.world.build(p);
  }
  get logo() { return this.p.logo && this.images.get('logo:' + this.p.logo); }

  setPlan(opts) { this.plan = makePlan(this.p, opts); return this.plan; }

  // ---- text helpers -------------------------------------------------------
  font(face, px, weight) {
    const c = this.ctx;
    if (face === 'body') { c.font = `${weight || 500} ${px}px ${BODY}`; c.fontStretch = 'normal'; c.letterSpacing = '0px'; return; }
    const f = FACES[this.p.film.theme] || FACES.modern;
    c.font = `${weight || f.weight} ${px * f.size}px ${f.family}`;
    c.fontStretch = f.stretch;
    c.letterSpacing = `${px * f.size * f.track}px`;
  }
  wrapText(text, max) {
    const c = this.ctx, out = [];
    for (const para of String(text).split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/)) {
        const t = line ? line + ' ' + word : word;
        if (line && c.measureText(t).width > max) { out.push(line); line = word; } else line = t;
      }
      out.push(line);
    }
    return out;
  }
  // Largest size at which the headline fits its box.
  fitHead(text, max, size, lines = 3) {
    const f = FACES[this.p.film.theme] || FACES.modern;
    for (let px = size; ; px *= 0.94) {
      this.font('head', px);
      const l = this.wrapText(text, max);
      if ((l.length <= lines && l.every((x) => this.ctx.measureText(x).width <= max)) || px < size * 0.35) return { lines: l, px, lh: px * f.size * f.lh };
    }
  }
  // A line that slides up from behind its own baseline.
  line(text, x, y, h, k, color = '#fff') {
    const c = this.ctx;
    if (k <= 0 || !text) return;
    c.save();
    c.beginPath(); c.rect(x - 40, y - h * 1.02, this.W, h * 1.34); c.clip();
    c.globalAlpha *= clamp(k * 1.6);
    c.fillStyle = color;
    c.fillText(text, x, y + (1 - ease(k)) * h);
    c.restore();
  }
  scrim(x0, y0, x1, y1, stops) {
    const g = this.ctx.createLinearGradient(x0, y0, x1, y1);
    for (const [o, a] of stops) g.addColorStop(o, `rgba(12,19,24,${a})`);
    this.ctx.fillStyle = g; this.ctx.fillRect(0, 0, this.W, this.H);
  }
  // Darkens the picture only where the copy sits, starting a little above its first line.
  backdrop(top) {
    if (this.wide) return this.scrim(0, 0, this.W * 0.66, 0, [[0, 0.84], [0.62, 0.6], [1, 0]]);
    const y = Math.max(0, top - 250 * this.u), k = (this.H - top + 60 * this.u) / (this.H - y);
    this.scrim(0, this.H, 0, y, [[0, 0.9], [clamp(k, 0.05, 0.95), 0.62], [1, 0]]);
  }
  cover(img, k = 0, dir = 1) {
    const c = this.ctx, s0 = Math.max(this.W / img.width, this.H / img.height), s = s0 * (1.03 + 0.09 * k);
    const w = img.width * s, h = img.height * s;
    const spareX = w - this.W, spareY = h - this.H;
    const px = 0.5 + dir * (k - 0.5) * 0.3, py = 0.5 - dir * (k - 0.5) * 0.16;
    c.drawImage(img, -spareX * px, -spareY * py, w, h);
  }
  tag(text, alpha = 0.72) {
    const c = this.ctx, u = this.u;
    this.font('body', 21 * u, 500);
    c.fillStyle = `rgba(255,255,255,${alpha})`;
    c.textAlign = 'right';
    c.save(); c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = 8 * u;
    c.fillText(text, this.W - this.m, this.mTop + 14 * u);
    c.restore();
    c.textAlign = 'left';
  }

  // Margins keep text clear of the buttons Reels and Shorts put over a vertical video.
  frame(w, h) {
    this.W = w; this.H = h;
    this.u = Math.min(w, h) / 1080;
    const tall = h > w * 1.4, wide = w > h * 1.3;
    this.m = (wide ? 96 : 72) * this.u;
    this.mTop = (tall ? 150 : 64) * this.u;
    this.mBot = (tall ? 300 : 72) * this.u;
    this.tall = tall; this.wide = wide;
    this.textW = wide ? w * 0.42 : w - this.m * 2 - (tall ? 60 * this.u : 0);
  }

  drawScene(s, t) {
    const c = this.ctx, k = clamp(t / s.dur), p = this.p;
    if (s.photo) {
      const img = this.images.get(s.photo);
      c.fillStyle = INK; c.fillRect(0, 0, this.W, this.H);
      if (img) this.cover(img, k, s.key.charCodeAt(6) % 2 ? 1 : -1);
      if (p.photos.find((x) => x.id === s.photo)?.cgi) this.tag("Artist's impression");
    } else {
      const wd = this.world;
      wd.build(p);
      wd.setLight(s.light);
      wd.setGrowth(s.shot === 'rise' ? clamp((t - 0.1) / (s.dur - 1.3)) : 1);
      const heavy = (s.list?.length || 0) + (s.chips?.length ? 2 : 0);
      const lift = this.wide ? 0.02 : this.tall ? 0.07 + heavy * 0.008 : 0.1;
      wd.shoot(s.shot, k, this.W, this.H, s.shot === 'street' || s.shot === 'deck' || s.shot === 'close' ? lift * 0.55 : lift, this.wide ? 0.16 : 0);
      c.drawImage(wd.render(this.W, this.H), 0, 0, this.W, this.H);
      if (s.key !== 'end') this.tag("Artist's impression");
    }
    if (s.key === 'open' || s.key === 'end') this.drawLogo(t);
    if (s.key === 'end') this.drawEnd(s, t); else this.drawCopy(s, t);
  }

  drawLogo(t) {
    const img = this.logo;
    if (!img) return;
    const u = this.u, box = { w: 260 * u, h: 110 * u }, s = Math.min(box.w / img.width, box.h / img.height);
    this.ctx.save(); this.ctx.globalAlpha *= clamp((t - 0.2) / 0.5);
    this.ctx.drawImage(img, this.m, this.mTop - 20 * u, img.width * s, img.height * s);
    this.ctx.restore();
  }

  drawCopy(s, t) {
    const c = this.ctx, u = this.u, x = this.m, W = this.textW;
    c.textBaseline = 'alphabetic'; c.textAlign = 'left';
    const out = 1 - clamp((t - (s.dur - 0.3)) / 0.3);
    c.save(); c.globalAlpha *= out;
    const K = (d) => (t - 0.35 - d) / 0.7;

    const big = s.key === 'open' || s.key === 'price';
    const H = s.head ? this.fitHead(s.head, W, (s.photo ? 60 : big ? 124 : 92) * u, big ? 3 : 2) : { lines: [], lh: 0, px: 0 };
    this.font('body', 34 * u, 400);
    const sub = s.sub ? this.wrapText(s.sub, W) : [];
    const rowH = 66 * u;
    const rows = s.list || [];
    let chipLines = [];
    if (s.chips) {
      this.font('body', 31 * u, 500);
      let line = [], lw = 0;
      for (const ch of s.chips) { const w = c.measureText(ch).width + 44 * u; if (line.length && lw + w + 14 * u > W) { chipLines.push(line); line = []; lw = 0; } line.push([ch, w]); lw += w + 14 * u; }
      if (line.length) chipLines.push(line);
    }
    const below = sub.length ? sub.length * 46 * u + 10 * u : 0;
    const extra = (rows.length ? rows.length * rowH + 26 * u : 0) + (chipLines.length ? chipLines.length * 72 * u + 26 * u : 0) + (s.stats ? Math.ceil(s.stats.length / 2) * 168 * u : 0);
    const total = H.lines.length * H.lh + below + extra;
    let y = this.wide ? this.H / 2 - total / 2 + 30 * u : this.H - this.mBot - total;
    if (total) { c.save(); c.globalAlpha /= out || 1; this.backdrop(y); c.restore(); }

    if (s.kicker) {
      this.font('body', 28 * u, 600);
      const ky = y - 22 * u;
      c.fillStyle = p_brand(this.p);
      c.fillRect(x, ky - 9 * u, 46 * u * ease(K(0)), 4 * u);
      this.line(s.kicker, x + 62 * u, ky, 34 * u, K(0.05));
    }
    H.lines.forEach((l, i) => { this.font('head', H.px); this.line(l, x, y + H.lh * (i + 0.8), H.lh, K(0.14 + i * 0.1)); });
    y += H.lines.length * H.lh;
    if (sub.length) { y += 10 * u; sub.forEach((l, i) => { this.font('body', 34 * u, 400); this.line(l, x, y + 38 * u, 44 * u, K(0.4 + i * 0.1), 'rgba(255,255,255,.9)'); y += 46 * u; }); }

    if (s.stats) {
      const cw = W / 2;
      s.stats.forEach(([n, label], i) => {
        const k = K(0.2 + i * 0.14), num = parseFloat(n.replace(/,/g, '')), sy = y + Math.floor(i / 2) * 168 * u, sx = x + cw * (i % 2);
        const txt = Number.isFinite(num) && /^[\d.,]+$/.test(n) ? fmt(num * ease(k), n) : n;
        this.font('head', 108 * u); this.line(txt, sx, sy + 92 * u, 104 * u, k);
        this.font('body', 32 * u, 500); this.line(label, sx, sy + 136 * u, 38 * u, k - 0.15, 'rgba(255,255,255,.88)');
      });
    }
    if (rows.length) {
      y += 26 * u;
      rows.forEach(([a, b], i) => {
        const k = K(0.4 + i * 0.16), ry = y + rowH * i;
        if (k <= 0) return;
        c.fillStyle = 'rgba(255,255,255,.28)'; c.fillRect(x, ry, W * ease(k), Math.max(1, 1.5 * u));
        this.font('body', 34 * u, 600); this.line(a, x, ry + 46 * u, 40 * u, k);
        if (b) { this.font('body', 32 * u, 400); const w = c.measureText(b).width; this.line(b, x + W - w, ry + 46 * u, 40 * u, k - 0.1, 'rgba(255,255,255,.92)'); }
      });
    }
    if (chipLines.length) {
      y += 30 * u; let n = 0;
      for (const ln of chipLines) {
        let cx = x;
        for (const [txt, w] of ln) {
          const k = ease(K(0.35 + n++ * 0.11));
          c.save(); c.globalAlpha *= k; c.translate(0, (1 - k) * 18 * u);
          c.fillStyle = 'rgba(255,255,255,.14)'; c.strokeStyle = 'rgba(255,255,255,.5)'; c.lineWidth = 1.5 * u;
          c.beginPath(); c.rect(cx, y, w, 58 * u); c.fill(); c.stroke();
          this.font('body', 31 * u, 500); c.fillStyle = '#fff'; c.fillText(txt, cx + 22 * u, y + 40 * u);
          c.restore();
          cx += w + 14 * u;
        }
        y += 72 * u;
      }
    }
    c.restore();
  }

  drawEnd(s, t) { this.contactBlock(s, (d) => (t - 0.35 - d) / 0.7); }

  contactBlock(s, K) {
    const c = this.ctx, u = this.u, p = this.p, x = this.m, W = this.textW, brand = p_brand(p);
    c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    const H = this.fitHead(s.head, W, (this.wide ? 92 : 110) * u, 2);
    const contacts = [p.phone, p.website || p.email].map((v) => (v || '').trim()).filter(Boolean);
    const legal = [p.rera && `RERA ${p.rera}`, p.developer && `By ${p.developer}`].filter(Boolean).join('   |   ');
    this.font('body', 21 * u, 400);
    const fine = this.wrapText(`${p.address?.trim() ? `Site: ${p.address.trim()}. ` : ''}Images are artist's impressions.${/\*/.test(p.priceFrom + p.configs.map((x) => x.price)) ? ' *Terms and conditions apply.' : ''}`, W);
    const barH = 104 * u;
    const total = H.lines.length * H.lh + (s.sub ? 58 * u : 0) + (contacts.length ? barH + 34 * u : 0) + (legal ? 46 * u : 0) + fine.length * 30 * u + 20 * u;
    let y = this.wide ? this.H / 2 - total / 2 + 30 * u : this.H - this.mBot - total;
    this.backdrop(y);
    if (s.kicker) {
      this.font('body', 28 * u, 600);
      c.fillStyle = brand; c.fillRect(x, y - 31 * u, 46 * u * ease(K(0)), 4 * u);
      this.line(s.kicker, x + 62 * u, y - 22 * u, 34 * u, K(0.05));
    }
    H.lines.forEach((l, i) => { this.font('head', H.px); this.line(l, x, y + H.lh * (i + 0.8), H.lh, K(0.1 + i * 0.1)); });
    y += H.lines.length * H.lh;
    if (s.sub) { this.font('body', 36 * u, 400); this.line(s.sub, x, y + 42 * u, 44 * u, K(0.35), 'rgba(255,255,255,.92)'); y += 58 * u; }
    if (contacts.length) {
      y += 24 * u;
      const k = ease(K(0.5)), on = readableOn(brand);
      c.fillStyle = brand; c.fillRect(x, y, W * k, barH);
      if (k > 0.6) {
        const pad = 30 * u, a = clamp((k - 0.6) / 0.4);
        c.save(); c.globalAlpha *= a; c.fillStyle = on;
        let px = 44 * u; this.font('body', px, 700);
        const second = contacts[1], need = () => c.measureText(contacts[0]).width + (second ? c.measureText(second).width * 0.72 + pad : 0);
        while (need() > W - pad * 2 && px > 18 * u) { px *= 0.95; this.font('body', px, 700); }
        c.fillText(contacts[0], x + pad, y + barH / 2 + px * 0.35);
        if (second) { this.font('body', px * 0.72, 500); const w = c.measureText(second).width; c.fillText(second, x + W - pad - w, y + barH / 2 + px * 0.28); }
        c.restore();
      }
      y += barH + 10 * u;
    }
    if (legal) { let px = 27 * u; this.font('body', px, 500); while (c.measureText(legal).width > W && px > 14 * u) { px *= 0.95; this.font('body', px, 500); } this.line(legal, x, y + 36 * u, 36 * u, K(0.75), 'rgba(255,255,255,.95)'); y += 46 * u; }
    fine.forEach((l) => { this.font('body', 21 * u, 400); this.line(l, x, y + 26 * u, 28 * u, K(0.85), 'rgba(255,255,255,.78)'); y += 30 * u; });
  }

  // Draw the film at `time` seconds.
  draw(time, w = this.plan.w, h = this.plan.h) {
    const { scenes, total } = this.plan, c = this.ctx;
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.frame(w, h);
    const t = clamp(time, 0, total - 0.001);
    let i = scenes.findIndex((s) => t < s.start + s.dur);
    if (i < 0) i = scenes.length - 1;
    const s = scenes[i], FADE = 0.4;
    if (i > 0 && t - s.start < FADE) {
      const prev = scenes[i - 1];
      this.drawScene({ ...prev }, prev.dur - 0.001);
      c.save(); c.globalAlpha = (t - s.start) / FADE; this.drawSceneLayer(s, t - s.start); c.restore();
    } else this.drawScene(s, t - s.start);
    if (t < 0.35) { c.fillStyle = `rgba(12,19,24,${1 - t / 0.35})`; c.fillRect(0, 0, w, h); }
    if (total - t < 0.45) { c.fillStyle = `rgba(12,19,24,${1 - (total - t) / 0.45})`; c.fillRect(0, 0, w, h); }
    return i;
  }
  // The incoming scene is composed on its own layer so its scrim and text fade as one picture.
  drawSceneLayer(s, t) {
    this.layer ||= document.createElement('canvas');
    if (this.layer.width !== this.W || this.layer.height !== this.H) { this.layer.width = this.W; this.layer.height = this.H; }
    const main = this.ctx;
    this.ctx = this.layer.getContext('2d', { alpha: false });
    this.ctx.globalAlpha = 1;
    this.drawScene(s, t);
    const lay = this.layer; this.ctx = main;
    main.drawImage(lay, 0, 0);
  }

  // ---- stills ---------------------------------------------------------------
  view(shot, light, w, h, k = 0.5, tagged = true) {
    const c = this.ctx;
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.frame(w, h);
    this.world.build(this.p); this.world.setLight(light); this.world.setGrowth(1);
    this.world.shoot(shot, k, w, h, 0);
    c.drawImage(this.world.render(w, h), 0, 0, w, h);
    if (!tagged) return;
    this.mTop = 34 * this.u; this.m = 34 * this.u;
    this.tag("Artist's impression", 0.9);
  }

  poster(kind, w, h) {
    const p = this.p, c = this.ctx, pick = p.posterPhoto && this.images.get(p.posterPhoto);
    const light = { day: 0.1, golden: 1, dusk: 2, arc: kind === 'homes' ? 0.9 : kind === 'life' ? 1.1 : 2 }[p.film.light] ?? 2;
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.frame(w, h);
    if (h > w * 1.4) this.mBot = 220 * this.u;
    if (pick && kind === 'launch') this.cover(pick, 0);
    else {
      const shot = { launch: 'hero', homes: 'close', life: 'deck' }[kind];
      this.world.build(p); this.world.setLight(light); this.world.setGrowth(1);
      this.world.shoot(shot === 'deck' && this.world.L.villas ? 'street' : shot, 0.5, w, h, this.wide ? 0 : kind === 'launch' ? 0.13 : 0.06, this.wide ? 0.16 : 0);
      c.drawImage(this.world.render(w, h), 0, 0, w, h);
    }
    this.drawLogo(9);
    const done = () => 2, place = placeName(p);
    if (kind === 'launch') {
      this.contactBlock({ kicker: p.developer ? `${p.developer} presents` : '', head: p.name, sub: [place, p.priceFrom && `From ${p.priceFrom}`].filter(Boolean).join('  ·  ') }, done);
    } else {
      const scene = makePlan({ ...p, film: { ...p.film, scenes: { [kind]: { ...(p.film.scenes?.[kind] || {}), on: true } } } }).scenes.find((s) => s.key === kind);
      if (!scene) return false;
      this.drawCopy({ ...scene, dur: 99 }, 50);
      this.tag("Artist's impression");
      this.font('body', 21 * this.u, 500);
      c.fillStyle = 'rgba(255,255,255,.9)'; c.textAlign = 'left';
      const foot = [p.name, p.phone, p.rera && `RERA ${p.rera}`].filter(Boolean).join('   |   ');
      c.fillText(foot, this.m, h - (this.tall ? 150 : 36) * this.u);
    }
    return true;
  }
}

const p_brand = (p) => (/^#[0-9a-f]{6}$/i.test(p.brand) ? p.brand : '#E8552D');
function fmt(v, like) {
  const dec = (like.split('.')[1] || '').length;
  return v.toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: /,/.test(like) || v >= 10000 });
}

export const VIEWS = [
  ['Front at dusk', 'hero', 2, 1920, 1280], ['Front in daylight', 'hero', 0.1, 1920, 1280],
  ['From the air', 'aerial', 0.7, 1920, 1280], ['From the street', 'street', 1, 1280, 1600],
  ['Facade detail', 'close', 0.9, 1280, 1600], ['Garden deck', 'deck', 1.2, 1920, 1280],
];
export const POSTERS = [
  ['Launch poster', 'launch', 1080, 1350], ['Launch story', 'launch', 1080, 1920], ['Launch banner', 'launch', 1920, 1080],
  ['Homes and prices', 'homes', 1080, 1350], ['Amenities', 'life', 1080, 1350],
];
