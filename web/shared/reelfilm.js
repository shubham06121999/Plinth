// Draws a reel: photographs moved through in depth, cut quickly, with captions that land on the words.
import { Film, readableOn } from './film.js';
import { reelPlan } from './reel.js';
import { SHOTS } from './shots.js';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const out = (x, p = 3) => 1 - (1 - clamp(x)) ** p;
const smooth = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };

const FRAG = `#version 300 es
precision highp float; in vec2 vp; out vec4 o;
uniform sampler2D img, dep; uniform vec2 cover, blur; uniform vec3 cam; uniform float zoom, flatly, grain, light;
float D(vec2 s){ return flatly > 0.5 ? 0.25 : texture(dep, s + 0.5).r; }
vec2 src(vec2 p, float d){ return p * (1.0 - cam.z * d) / zoom + cam.xy * (d - 0.22); }
vec2 march(vec2 p){
  const int N = 110; float prev = 1.0;
  for (int i = 0; i <= N; i++) {
    float d = 1.0 - float(i) / float(N);
    if (D(src(p, d)) >= d) { float a = d, b = prev; for (int k = 0; k < 5; k++) { float m = 0.5 * (a + b); if (D(src(p, m)) >= m) a = m; else b = m; } return src(p, a); }
    prev = d;
  }
  return src(p, 0.0);
}
float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec2 p = vp * 0.5 * cover; vec3 c = vec3(0.0); float n = 0.0;
  int K = dot(blur, blur) > 1e-7 ? 9 : 1;
  for (int i = 0; i < K; i++) { vec2 q = p + blur * ((float(i) + 0.5) / float(K) - 0.5); vec2 s = march(q) + 0.5; s = abs(s); s = 1.0 - abs(1.0 - s); c += texture(img, s).rgb; n += 1.0; }
  c /= n;
  c = mix(c, c * c * (3.0 - 2.0 * c), 0.16);                       // a little contrast
  float l = dot(c, vec3(0.299, 0.587, 0.114)); c = mix(vec3(l), c, 1.08);
  c += light * vec3(1.0, 0.78, 0.5) * pow(max(0.0, 1.0 - length(vp - vec2(0.9, 0.75)) * 0.62), 2.0) * 0.16;   // drifting sun
  c *= 1.0 - 0.2 * pow(length(vp * vec2(0.62, 0.66)), 3.0);
  c += (h(gl_FragCoord.xy + grain) - 0.5) * 0.014;
  o = vec4(c, 1.0);
}`;
const VERT = `#version 300 es
in vec2 a; out vec2 vp; void main(){ vp = vec2(a.x, -a.y); gl_Position = vec4(a, 0.0, 1.0); }`;

class Parallax {
  constructor() {
    this.canvas = document.createElement('canvas');
    const g = (this.g = this.canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false }));
    const sh = (t, s) => { const x = g.createShader(t); g.shaderSource(x, s); g.compileShader(x); if (!g.getShaderParameter(x, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(x)); return x; };
    const p = (this.p = g.createProgram());
    g.attachShader(p, sh(g.VERTEX_SHADER, VERT)); g.attachShader(p, sh(g.FRAGMENT_SHADER, FRAG)); g.linkProgram(p); g.useProgram(p);
    g.bindBuffer(g.ARRAY_BUFFER, g.createBuffer()); g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), g.STATIC_DRAW);
    const a = g.getAttribLocation(p, 'a'); g.enableVertexAttribArray(a); g.vertexAttribPointer(a, 2, g.FLOAT, false, 0, 0);
    this.u = {}; for (const n of ['img', 'dep', 'cover', 'blur', 'cam', 'zoom', 'flatly', 'grain', 'light']) this.u[n] = g.getUniformLocation(p, n);
    g.uniform1i(this.u.img, 0); g.uniform1i(this.u.dep, 1);
    this.tex = new Map();
  }
  texture(key, source, mip) {
    if (this.tex.has(key)) return this.tex.get(key);
    const g = this.g, t = g.createTexture();
    g.bindTexture(g.TEXTURE_2D, t); g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, source);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    if (mip) { g.generateMipmap(g.TEXTURE_2D); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR_MIPMAP_LINEAR); } else g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
    this.tex.set(key, t); return t;
  }
  drop(key) { const t = this.tex.get(key); if (t) { this.g.deleteTexture(t); this.tex.delete(key); } }
  draw(key, img, depth, w, h, { cam, zoom, blur = [0, 0], grain = 0, light = 0 }) {
    const g = this.g, c = this.canvas;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    g.viewport(0, 0, w, h);
    const ia = img.width / img.height, oa = w / h;
    g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, this.texture(key, img, true));
    g.activeTexture(g.TEXTURE1); g.bindTexture(g.TEXTURE_2D, depth ? this.texture(key + ':d', depth, false) : this.texture(key, img, true));
    g.uniform2f(this.u.cover, oa < ia ? oa / ia : 1, oa < ia ? 1 : ia / oa);
    g.uniform3f(this.u.cam, ...cam); g.uniform1f(this.u.zoom, zoom); g.uniform2f(this.u.blur, ...blur);
    g.uniform1f(this.u.flatly, depth ? 0 : 1); g.uniform1f(this.u.grain, grain); g.uniform1f(this.u.light, light);
    g.drawArrays(g.TRIANGLES, 0, 3);
    return c;
  }
}

// Camera at progress k of a shot. cam = sideways, vertical, forward.
function moveOf(name, k, flip, far) {
  // Views of the building are calmer: straight edges show any bend.
  const g = far ? 0.55 : 1, m = move(name, k, flip);
  return { cam: m.cam.map((v) => v * g), zoom: 1 + (m.zoom - 1) * (far ? 1.15 : 1) };
}
function move(name, k, flip) {
  const e = k * 0.8 + smooth(k) * 0.2, c = e - 0.5, s = flip ? -1 : 1;
  switch (name) {
    case 'push': return { cam: [0.02 * c * s, 0.012 * c, 0.03 + 0.22 * e], zoom: 1.05 + 0.05 * e };
    case 'pull': return { cam: [0.015 * c * s, 0, 0.24 - 0.2 * e], zoom: 1.13 - 0.07 * e };
    case 'left': return { cam: [0.085 * c * s, 0, 0.06 + 0.1 * e], zoom: 1.09 + 0.02 * e };
    case 'right': return { cam: [-0.085 * c * s, 0, 0.06 + 0.1 * e], zoom: 1.09 + 0.02 * e };
    case 'up': return { cam: [0.02 * c * s, -0.075 * c, 0.04 + 0.16 * e], zoom: 1.09 + 0.03 * e };
    default: return { cam: [0, 0, 0.1 * e], zoom: 1.06 };
  }
}

// Near things are grown a little and softened, so when the camera moves the background is
// stretched behind an edge instead of the edge itself tearing.
function soften(depth) {
  const w = Math.min(720, depth.width), h = Math.round((depth.height * w) / depth.width), mk = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const a = mk(), ca = a.getContext('2d'); ca.imageSmoothingQuality = 'high'; ca.drawImage(depth, 0, 0, w, h);
  const b = mk(), cb = b.getContext('2d'); cb.drawImage(a, 0, 0); cb.globalCompositeOperation = 'lighten';
  for (const r of [2, 4]) for (let k = 0; k < 12; k++) cb.drawImage(a, Math.round(Math.cos((k * Math.PI) / 6) * r), Math.round(Math.sin((k * Math.PI) / 6) * r));
  const d = mk(), cd = d.getContext('2d'); cd.filter = 'blur(2.2px)'; cd.drawImage(b, 0, 0, w, h);
  return d;
}

const load = (src) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = src; });

export class Reel extends Film {
  constructor(canvas, opts) { super(canvas, opts); this.par = new Parallax(); this.pics = new Map(); this.bitmaps = new Map(); }

  async load(p) {
    await super.load(p);
    const live = new Set();
    await Promise.all(Object.entries(p.footage || {}).map(async ([key, f]) => {
      const id = f.file || f.clip; live.add(id);
      if (this.pics.has(id)) return;
      if (f.frames) { this.pics.set(id, { clip: f }); return; }
      const [img, depth] = await Promise.all([load(`/files/${p.id}/media/${f.file}`), f.depth ? load(`/files/${p.id}/media/${f.depth}`) : null]);
      if (img) this.pics.set(id, { img, depth: depth && soften(depth) });
    }));
    for (const id of this.pics.keys()) if (!live.has(id)) { this.pics.delete(id); this.par.drop(id); this.par.drop(id + ':d'); }
  }
  setPlan(opts) { this.plan = reelPlan(this.p, opts); return this.plan; }

  sceneAt(time) {
    const t = clamp(time, 0, this.plan.total - 0.001), i = this.plan.scenes.findIndex((s) => t < s.start + s.dur);
    const k = i < 0 ? this.plan.scenes.length - 1 : i, s = this.plan.scenes[k], local = t - s.start;
    const ci = Math.max(0, s.cuts.findLastIndex((c) => local >= c.start));
    return { i: k, s, local, ci, cut: s.cuts[ci], ct: local - s.cuts[ci].start };
  }
  frameOf(cut, ct) { const f = this.p.footage?.[cut.shot]; return f?.frames ? { url: `/files/${this.p.id}/media/${f.clip}-${String(Math.min(f.frames, 1 + Math.floor(ct * 30))).padStart(4, '0')}.jpg` } : null; }
  // Video clips are read frame by frame, so drawing has to wait for the frame.
  async prep(time) {
    const { cut, ct } = this.sceneAt(time), f = this.frameOf(cut, ct);
    if (!f || this.bitmaps.has(f.url)) return;
    const img = await load(f.url);
    if (img) { this.bitmaps.set(f.url, img); if (this.bitmaps.size > 10) this.bitmaps.delete(this.bitmaps.keys().next().value); }
  }

  picture(cut, ct, blur, extraZoom) {
    const c = this.ctx, W = this.W, H = this.H, f = this.p.footage?.[cut.shot], shot = SHOTS[cut.shot], k = clamp(ct / cut.dur);
    const pic = f && this.pics.get(f.file || f.clip);
    if (pic?.clip) {
      const fr = this.frameOf(cut, ct), img = this.bitmaps.get(fr.url) || [...this.bitmaps.values()].pop();
      c.fillStyle = '#101A20'; c.fillRect(0, 0, W, H);
      if (img) { const s = Math.max(W / img.width, H / img.height) * extraZoom; c.drawImage(img, (W - img.width * s) / 2, (H - img.height * s) / 2, img.width * s, img.height * s); }
      return true;
    }
    if (pic) {
      const m = moveOf(shot?.move, k, cut.seq % 2, cut.shot.startsWith('ext') || cut.shot === 'balcony');
      c.drawImage(this.par.draw(f.file, pic.img, pic.depth, W, H, { cam: m.cam, zoom: m.zoom * extraZoom, blur, grain: (cut.seq * 13.7 + Math.floor(ct * 30)) % 97, light: cut.shot.startsWith('ext') ? 0.6 + 0.4 * Math.sin(ct * 0.9) : 0.35 + 0.25 * Math.sin(ct * 0.7) }), 0, 0, W, H);
      return true;
    }
    // No footage yet: stand in with the 3D model, or say what will be here.
    if (shot?.ref) {
      this.world.build(this.p); this.world.setLight(shot.ref[1]); this.world.setGrowth(1);
      this.world.shoot(shot.ref[0], 0.3 + k * 0.4, W, H, 0.04);
      c.drawImage(this.world.render(W, H), 0, 0, W, H);
    } else {
      c.fillStyle = '#1d2a31'; c.fillRect(0, 0, W, H);
      this.font('body', 36 * this.u, 500); c.textAlign = 'center'; c.fillStyle = 'rgba(255,255,255,.55)';
      c.fillText(shot?.label || '', W / 2, H * 0.4); this.font('body', 26 * this.u, 400); c.fillText('Make footage to see this', W / 2, H * 0.4 + 44 * this.u);
      c.textAlign = 'left';
    }
    return !!shot?.ref;
  }

  draw(time, w = this.plan.w, h = this.plan.h) {
    const c = this.ctx;
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.frame(w, h);
    const { i, s, local, ci, cut, ct } = this.sceneAt(time);
    // Section changes whip across; pictures within a section punch in softly.
    const IN = 0.2, big = i > 0 && ci === 0, next = local > s.dur - 0.12 && i < this.plan.scenes.length - 1;
    let blur = [0, 0], z = 1;
    if (big && ct < IN) { const q = 1 - out(ct / IN, 2); blur = [0.34 * q * (i % 2 ? 1 : -1), 0]; z = 1 + 0.1 * q; }
    else if (ci > 0 && ct < IN) z = 1 + 0.07 * (1 - out(ct / IN));
    if (next) { const q = ((local - (s.dur - 0.12)) / 0.12) ** 2; blur = [0.2 * q * ((i + 1) % 2 ? 1 : -1), 0]; z = 1 + 0.06 * q; }
    this.picture(cut, ct, blur, z);
    if (s.key !== 'end') this.tag("Artist's impression", 0.85);
    if (s.key === 'end') {
      const a = out((local - 0.25) / 0.5);
      c.save(); c.globalAlpha = a; this.backdrop(h * 0.5); c.restore();
      this.drawLogo(local);
      this.contactBlock({ kicker: '', head: this.p.name.replace(/[\p{Extended_Pictographic}️]/gu, '').trim(), sub: [this.p.locality, this.p.city].filter(Boolean).join(', ') }, (d) => (local - 0.35 - d) / 0.6);
    } else {
      if (s.key === 'intro') this.drawLogo(local);
      for (const card of s.cards) if (local >= card.start && local < card.end) this.caption(card, local - card.start, card.end - card.start);
    }
    const total = this.plan.total;
    if (big && ct < 0.1 && (s.key === 'intro' || s.key === 'end')) { c.fillStyle = `rgba(255,244,225,${0.75 * (1 - ct / 0.1)})`; c.fillRect(0, 0, w, h); }
    if (total - time < 0.4) { c.fillStyle = `rgba(8,12,15,${clamp(1 - (total - time) / 0.4)})`; c.fillRect(0, 0, w, h); }
    return i;
  }

  caption(card, t, dur) {
    const c = this.ctx, u = this.u, W = this.W, H = this.H, max = W - (this.tall ? 190 : 140) * u;
    const gold = /^#[0-9a-f]{6}$/i.test(this.p.film.gold || '') ? this.p.film.gold : '#FFD21F';
    const spec = {
      plain: { font: (s) => `800 ${s}px "Big Shoulders Display Variable", "Kohinoor Devanagari", Impact, sans-serif`, size: 66, gap: 0.96, ls: 0.01 },
      gold: { font: (s) => `900 ${s}px "Big Shoulders Display Variable", "Kohinoor Devanagari", Impact, sans-serif`, size: 104, gap: 0.96, ls: 0.005 },
      script: { font: (s) => `400 ${s}px "Great Vibes", cursive`, size: 112, gap: 0.84, ls: 0 },
      small: { font: (s) => `500 ${s}px "Archivo Variable", system-ui, sans-serif`, size: 40, gap: 1.25, ls: 0 },
    };
    const set = (k, px) => { c.fontStretch = 'normal'; c.font = spec[k].font(px); c.letterSpacing = `${px * spec[k].ls}px`; };
    const rows = [];
    for (const l of card.lines) {
      let px = spec[l.kind].size * u, text = l.text;
      set(l.kind, px);
      // Long lines shrink first, then wrap to two.
      while (c.measureText(text).width > max && px > spec[l.kind].size * u * 0.74) { px *= 0.96; set(l.kind, px); }
      const parts = c.measureText(text).width > max ? this.wrapText(text, max) : [text];
      for (const part of parts) rows.push({ ...l, text: part, px, lh: px * spec[l.kind].gap });
    }
    const total = rows.reduce((a, r) => a + r.lh, 0);
    let y = H * (this.tall ? 0.655 : this.wide ? 0.74 : 0.72) - total / 2;
    const chars = rows.reduce((a, r) => a + r.text.length + 3, 0);
    let before = 0;
    const gone = out((t - (dur - 0.16)) / 0.16, 2);
    c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    rows.forEach((r, i) => {
      const at = (before / chars) * Math.min(card.speak, dur) * 0.92; before += r.text.length + 3;
      const k = clamp((t - at) / 0.34);
      const base = y + r.lh * 0.82; y += r.lh;
      if (k <= 0) return;
      let text = r.text;
      // Plain figures count up to their value.
      const m = r.kind === 'gold' && text.match(/^(\d[\d,]{2,})(\b.*)$/);
      if (m && Number(m[1].replace(/,/g, '')) >= 100) { const v = Number(m[1].replace(/,/g, '')); text = Math.round(v * out((t - at) / 0.75, 3)).toLocaleString('en-IN', { useGrouping: m[1].includes(',') || v > 999 }) + m[2]; }
      const e = out(k, 4), pop = r.kind === 'gold' ? 1 + 0.16 * (1 - e) - 0.03 * Math.sin(Math.PI * k) : 1;
      c.save();
      c.globalAlpha = clamp(k * 2) * (1 - gone);
      c.translate(W / 2, base + (1 - e) * 26 * u - gone * 10 * u); c.scale(pop, pop); if (r.kind === 'script') c.rotate(-0.035);
      set(r.kind, r.px);
      c.lineJoin = 'round';
      c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = 20 * u; c.shadowOffsetY = 5 * u;
      if (r.kind === 'script') { c.lineWidth = r.px * 0.06; c.strokeStyle = 'rgba(15,12,6,.6)'; c.strokeText(text, 0, 0); } else { c.lineWidth = r.px * 0.075; c.strokeStyle = 'rgba(15,12,6,.72)'; c.strokeText(text, 0, 0); }
      c.shadowBlur = r.kind === 'script' ? 16 * u : 0; c.shadowOffsetY = r.kind === 'script' ? 3 * u : 0;
      if (r.kind === 'gold' || r.kind === 'script') {
        const g = c.createLinearGradient(0, -r.px * 0.8, 0, r.px * 0.1);
        g.addColorStop(0, tint(gold, 0.55)); g.addColorStop(0.45, gold); g.addColorStop(1, tint(gold, -0.14)); c.fillStyle = g;
      } else c.fillStyle = '#fff';
      c.fillText(text, 0, 0);
      // A glint runs across the highlighted line once.
      const gl = (t - at - 0.3) / 0.6;
      if (r.kind === 'gold' && gl > 0 && gl < 1) {
        const ww = c.measureText(text).width, x = -ww * 0.7 + ww * 1.4 * gl, g = c.createLinearGradient(x - r.px * 0.5, 0, x + r.px * 0.5, r.px * 0.2);
        g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,.85)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g; c.fillText(text, 0, 0);
      }
      c.restore();
    });
    c.textAlign = 'left'; c.letterSpacing = '0px';
  }
}
function tint(hex, k) { const n = parseInt(hex.slice(1), 16), f = (v) => Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k)); return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`; }
