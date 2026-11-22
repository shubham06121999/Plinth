// node music-worker.js job.json : composes the music bed and the sound effects for one reel.
// Everything is synthesised here, so there is no licence to clear.
import fs from 'node:fs';
const job = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const SR = 48000, TAU = Math.PI * 2, N = Math.ceil((job.total + 0.6) * SR);
const hz = (m) => 440 * 2 ** ((m - 69) / 12);
let seed = 11; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
const bus = () => [new Float32Array(N), new Float32Array(N)];
const dry = bus(), wet = bus(), sfx = bus(), drums = bus();
function put(b, t0, dur, pan, fn, send = 0) {
  const a = Math.max(0, Math.floor(t0 * SR)), e = Math.min(N, Math.floor((t0 + dur) * SR)), l = Math.cos((pan + 1) * Math.PI / 4), r = Math.sin((pan + 1) * Math.PI / 4);
  for (let i = a; i < e; i++) { const v = fn(Math.max(0, i / SR - t0)); b[0][i] += v * l; b[1][i] += v * r; if (send) { wet[0][i] += v * l * send; wet[1][i] += v * r * send; } }
}
// Trapezoidal state-variable band-pass: stable at any cutoff.
const noise = (fc, q) => {
  let z1 = 0, z2 = 0;
  return (f = fc) => {
    const g = Math.tan(Math.PI * Math.min(f, 18000) / SR), k = 1 / q, a1 = 1 / (1 + g * (g + k)), v3 = rnd() - z2;
    const v1 = a1 * z1 + g * a1 * v3, v2 = z2 + g * v1;
    z1 = 2 * v1 - z1; z2 = 2 * v2 - z2;
    return v1 * k;
  };
};
const A = (x, a) => Math.min(1, x / a);

const keys = (t, m, v, pan = 0, d = 2.6) => { // soft felt piano
  const f = hz(m), br = Math.min(1, v * 1.1), n = noise(1800, 1);
  put(dry, t, d, pan, (x) => {
    let s = 0;
    for (let k = 1; k <= 7; k++) { const fk = f * k * Math.sqrt(1 + 0.0004 * k * k); if (fk > 9000) break; s += Math.sin(TAU * fk * x + k) * Math.exp(-x * (1.1 + k * 0.75 + f / 900)) * (br ** (k - 1)) / k; }
    return (s + n() * Math.exp(-x * 90) * 0.1) * A(x, 0.003) * A(d - x, 0.2) * v * 0.2;
  }, 0.38);
};
const pluck = (t, m, v, pan) => { const f = hz(m); put(dry, t, 1.1, pan, (x) => (Math.sin(TAU * f * x + 1.8 * Math.exp(-x * 14) * Math.sin(TAU * f * 2 * x)) + 0.3 * Math.sin(TAU * f * 3 * x) * Math.exp(-x * 16)) * Math.exp(-x * 5.2) * A(x, 0.002) * v * 0.13, 0.5); };
const pad = (t, m, d, v, pan) => {
  const f = hz(m), det = [0.9965, 1, 1.0042];
  put(dry, t, d, pan, (x) => { let s = 0; for (const q of det) for (let k = 1; k <= 5; k++) s += Math.sin(TAU * f * q * k * x + q * 40 + k) / (k ** (1.7 - 0.25 * Math.sin(x * 0.9))); return s * A(x, 0.9) * A(d - x, 0.9) * v * 0.028; }, 0.45);
};
const bass = (t, m, d, v) => { const f = hz(m); put(dry, t, d, 0, (x) => Math.tanh(1.7 * (Math.sin(TAU * f * x) + 0.35 * Math.sin(TAU * 2 * f * x))) * A(x, 0.012) * A(d - x, 0.08) * Math.exp(-x * 0.7) * v * 0.2); };
const kickTimes = [];
const kick = (t, v) => { kickTimes.push(t); put(drums, t, 0.4, 0, (x) => (Math.sin(TAU * (46 * x + 7.2 * (1 - Math.exp(-x * 26)))) * Math.exp(-x * 8.5) + rnd() * Math.exp(-x * 320) * 0.25) * v * 0.62); };
const clap = (t, v) => { const n = noise(1700, 0.9); put(drums, t, 0.3, 0, (x) => n() * (Math.exp(-x * 24) + (x < 0.012 || (x > 0.016 && x < 0.026) ? 0.6 : 0)) * v * 0.34, 0.25); };
const hat = (t, v, open) => { const n = noise(9000, 0.7); put(drums, t, open ? 0.22 : 0.07, 0.25, (x) => n() * Math.exp(-x * (open ? 16 : 70)) * v * 0.16); };

const MOODS = {
  uplift: { bpm: 104, root: 62, chords: [[0, 4, 7, 11], [9, 12, 16, 19], [5, 9, 12, 16], [7, 11, 14, 17]], bassN: [0, 9, 5, 7], drive: 1 },
  warm: { bpm: 88, root: 60, chords: [[0, 4, 7, 14], [9, 12, 16, 19], [5, 9, 12, 16], [7, 12, 14, 17]], bassN: [0, 9, 5, 7], drive: 0.6 },
  cinematic: { bpm: 76, root: 57, chords: [[0, 3, 7, 12], [8, 12, 15, 20], [3, 7, 10, 15], [10, 14, 17, 22]], bassN: [0, 8, 3, 10], drive: 0.45 },
};
if (MOODS[job.mood]) {
  const M = MOODS[job.mood], beat = 60 / M.bpm, bar = beat * 4, drop = job.drop || 0;
  // Bars are placed so that a downbeat lands exactly where the project is introduced.
  let first = drop % bar; if (first > 0.02) first -= bar;
  const motif = [[0, 2], [1.5, 1], [2.5, 3], [4, 2], [5.5, 0], [6.5, 1]];
  for (let t = first, k = -Math.round((drop - first) / bar); t < job.total; t += bar, k++) {
    const c = M.chords[((k % 4) + 4) % 4], b = M.root - 24 + M.bassN[((k % 4) + 4) % 4], live = t >= drop - 0.05, last = t + bar > job.total - 2.4;
    const lift = Math.min(1, 0.7 + (t / job.total) * 0.4), big = k >= 4;
    c.forEach((n, j) => pad(t, M.root - 12 + n, bar + 0.8, live ? 0.75 : 1, (j - 1.5) * 0.4));
    if (last) { c.forEach((n, j) => keys(t + j * 0.04, M.root - 12 + n, 0.7, (j - 1.5) * 0.2, 4)); bass(t, b, bar * 1.2, 0.8); continue; }
    c.forEach((n, j) => keys(t + j * 0.012, M.root - 12 + n, 0.55 * lift, (j - 1.5) * 0.25));
    if (big || !live) keys(t + beat * 2, M.root - 12 + c[2], 0.34, 0.2);
    for (const [e, i] of motif) if (live) pluck(t + (e * beat) / 2, M.root + c[i % 4] + (big && e > 3 ? 12 : 0), 0.62 * lift, e % 2 ? 0.45 : -0.4);
    if (!live) continue;
    for (const [q, d, v] of [[0, 1.4, 1], [1.5, 0.5, 0.7], [2, 1.4, 0.9], [3.5, 0.5, 0.7]]) bass(t + q * beat, b + (q === 3.5 ? 12 : 0), d * beat, v * 0.85);
    for (let q = 0; q < 4; q++) {
      if (M.drive > 0.5 || q % 2 === 0) kick(t + q * beat, M.drive * (q % 2 ? 0.75 : 1));
      if (q % 2 && big) clap(t + q * beat, M.drive * 0.8);
      for (let e = 0; e < 4; e++) hat(t + (q + e / 4) * beat, M.drive * [0.35, 0.2, 0.8, 0.25][e] * (big ? 1 : 0.6), e === 2 && q === 3 && big);
    }
  }
  // Music breathes with the kick.
  for (const kt of kickTimes) { const a = Math.max(0, Math.floor(kt * SR)), e = Math.min(N, a + Math.floor(0.26 * SR)); for (let i = a; i < e; i++) { const g = 1 - 0.3 * M.drive * (1 - (i - a) / (e - a)) ** 1.5; dry[0][i] *= g; dry[1][i] *= g; } }
}
// ---- effects -----------------------------------------------------------------
const whoosh = (t, v, dir) => { for (const s of [-1, 1]) { const n = noise(600, 1.1), d = 0.62; put(sfx, t - 0.34, d, s * 0.5, (x) => { const k = x / d, e = Math.sin(Math.PI * k ** 0.8) ** 2, bal = 0.5 + 0.5 * s * dir * (k * 2 - 1); return n(350 + 4200 * Math.sin(Math.PI * k) ** 2) * e * bal * v * 0.5; }, 0.2); } };
const impact = (t, v) => { const n = noise(300, 0.8); put(sfx, t, 1.5, 0, (x) => (Math.sin(TAU * (34 * x + 5 * (1 - Math.exp(-x * 9)))) * Math.exp(-x * 2.8) + n() * Math.exp(-x * 15) * 0.5) * A(x, 0.002) * v * 0.62, 0.3); };
const riser = (t, d, v) => { const n = noise(500, 1.4); put(sfx, t, d, 0, (x) => { const k = x / d; return (n(400 + 7000 * k * k) * 0.5 + Math.sin(TAU * (180 * x + (260 * x * x) / d)) * 0.1) * k * k * A(d - x, 0.02) * v * 0.32; }, 0.3); };
const chime = (t, v, root = 86) => [0, 4, 7, 12, 16].forEach((n, i) => { const f = hz(root + n); put(sfx, t + i * 0.05, 1.9, (i - 2) * 0.3, (x) => (Math.sin(TAU * f * x) + 0.45 * Math.sin(TAU * f * 2.76 * x) * Math.exp(-x * 7)) * Math.exp(-x * 3.2) * A(x, 0.002) * v * 0.07, 0.7); });
const tick = (t, v) => { const n = noise(5200, 3); put(sfx, t, 0.03, 0.1, (x) => n() * Math.exp(-x * 220) * v * 0.3); };
const pop = (t, v) => put(sfx, t, 0.14, 0, (x) => Math.sin(TAU * (420 * x + 6 * (1 - Math.exp(-x * 40)))) * Math.exp(-x * 34) * A(x, 0.002) * v * 0.22, 0.12);
for (const e of job.events || []) ({ whoosh: () => whoosh(e.t, e.v ?? 1, e.dir ?? 1), impact: () => impact(e.t, e.v ?? 1), riser: () => riser(e.t - (e.d ?? 1.4), e.d ?? 1.4, e.v ?? 1), chime: () => chime(e.t, e.v ?? 1), pop: () => pop(e.t, e.v ?? 1), count: () => { for (let i = 0; i < 14; i++) tick(e.t + 0.72 * (1 - (1 - i / 14) ** 2.2), 0.5); } }[e.type])?.();

// Plate-style reverb for everything sent to `wet`.
function reverb(inp, offs) {
  const out = new Float32Array(N), combs = [1557, 1617, 1491, 1422, 1277, 1356, 1188, 1116].map((d) => ({ b: new Float32Array(Math.round((d + offs) * SR / 44100)), i: 0, f: 0 }));
  for (const c of combs) for (let n = 0; n < N; n++) { const y = c.b[c.i]; c.f = y * 0.72 + c.f * 0.28; c.b[c.i] = inp[n] + c.f * 0.86; if (++c.i >= c.b.length) c.i = 0; out[n] += y * 0.125; }
  for (const d of [225, 556, 441, 341]) { const b = new Float32Array(Math.round((d + offs) * SR / 44100)); let i = 0; for (let n = 0; n < N; n++) { const y = b[i], x = out[n]; b[i] = x + y * 0.5; out[n] = y - x * 0.5; if (++i >= b.length) i = 0; } }
  return out;
}
const rv = [reverb(wet[0], 0), reverb(wet[1], 23)];
// Dip everything low out of the reverb so it never muddies the voice.
for (const ch of rv) { let lp = 0; const k = 1 - Math.exp(-TAU * 260 / SR); for (let i = 0; i < N; i++) { lp += k * (ch[i] - lp); ch[i] -= lp; } }
function save(file, chans) {
  let pk = 0.001; for (const c of chans) for (let i = 0; i < N; i++) pk = Math.max(pk, Math.abs(c[i]));
  const g = Math.min(0.8 / pk, 4), b = Buffer.alloc(44 + N * 4);
  b.write('RIFF', 0); b.writeUInt32LE(36 + N * 4, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22); b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(N * 4, 40);
  for (let i = 0; i < N; i++) { b.writeInt16LE(chans[0][i] * g * 32767, 44 + i * 4); b.writeInt16LE(chans[1][i] * g * 32767, 46 + i * 4); }
  fs.writeFileSync(file, b);
}
save(job.music, [0, 1].map((c) => { const o = new Float32Array(N); for (let i = 0; i < N; i++) o[i] = Math.tanh((dry[c][i] + drums[c][i] * 0.9) * 1.15) + rv[c][i] * 0.55; return o; }));
save(job.sfx, [0, 1].map((c) => { const o = new Float32Array(N); for (let i = 0; i < N; i++) o[i] = Math.tanh(sfx[c][i] * 1.1); return o; }));
