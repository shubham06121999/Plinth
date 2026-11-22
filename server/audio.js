import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { spoken } from '../web/shared/story.js';

export function run(cmd, args, { capture = false } = {}) {
  return new Promise((res, rej) => {
    const c = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    c.stdout.on('data', (d) => (out += d));
    c.stderr.on('data', (d) => (err += d));
    c.on('error', (e) => rej(e.code === 'ENOENT' ? new Error(`${cmd} is not installed`) : e));
    c.on('close', (code) => (code === 0 ? res(capture ? out : undefined) : rej(new Error(`${cmd} failed: ${err.trim().split('\n').slice(-3).join(' ')}`))));
  });
}

// The novelty voices macOS ships are no use in an ad, so this is a short list.
const GOOD = ['Rishi', 'Tara', 'Aman', 'Lekha', 'Daniel', 'Samantha', 'Karen', 'Moira', 'Veena', 'Isha', 'Neel', 'Kiyara'];
let voiceCache;
export async function voices() {
  if (voiceCache) return voiceCache;
  const out = await run('say', ['-v', '?'], { capture: true }).catch(() => '');
  voiceCache = out.split('\n').map((l) => l.match(/^(.+?)\s+([a-z]{2}_[A-Z0-9]{2,3})\s+#/)).filter(Boolean)
    .map((m) => ({ id: m[1].trim(), lang: m[2].replace('_', '-') }))
    .filter((v) => GOOD.includes(v.id.replace(/ \(.*$/, '')) || /\((Premium|Enhanced)\)/.test(v.id))
    .sort((a, b) => GOOD.indexOf(a.id) - GOOD.indexOf(b.id));
  return voiceCache;
}

export async function seconds(file) {
  return Number(await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { capture: true }));
}

// One narration file per scene; returns { key: {file, dur} }.
export async function narrate(scenes, voice, dir) {
  const known = (await voices()).some((v) => v.id === voice);
  const out = {};
  if (!known) return out;
  for (const s of scenes) {
    const text = spoken(s.say || '');
    if (!text) continue;
    const txt = path.join(dir, `${s.key}.txt`), file = path.join(dir, `${s.key}.aiff`);
    fs.writeFileSync(txt, text);
    await run('say', ['-v', voice, '-r', '168', '-f', txt, '-o', file]);
    out[s.key] = { file, dur: await seconds(file) };
  }
  return out;
}

// ---- Music, synthesised here so there is never a licence to worry about ----
const SR = 44100;
const hz = (m) => 440 * 2 ** ((m - 69) / 12);
const MOODS = {
  warm: { bpm: 84, bars: [[53, 57, 60, 64], [50, 57, 60, 65], [55, 58, 62, 65], [48, 55, 60, 64]], pluck: [0, 2, 1, 3, 2, 1, 3, 2], pad: 0.5, kick: 0, plk: 0.34 },
  uplift: { bpm: 108, bars: [[48, 55, 60, 64], [55, 59, 62, 67], [57, 60, 64, 69], [53, 57, 60, 65]], pluck: [0, 1, 2, 3, 2, 3, 1, 2], pad: 0.36, kick: 0.5, plk: 0.42 },
  cinematic: { bpm: 66, bars: [[45, 52, 57, 60], [41, 48, 57, 60], [48, 52, 55, 60], [43, 50, 55, 59]], pluck: [0, 3, 2, 3], pad: 0.62, kick: 0.22, plk: 0.2 },
};

export function music(mood, total, file) {
  const M = MOODS[mood] || MOODS.warm, n = Math.ceil((total + 0.5) * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  const beat = 60 / M.bpm, bar = beat * 4;
  const add = (t0, dur, pan, fn) => {
    const a = Math.floor(t0 * SR), b = Math.min(n, a + Math.floor(dur * SR));
    for (let i = Math.max(0, a); i < b; i++) {
      const v = fn((i - a) / SR);
      L[i] += v * (1 - pan); R[i] += v * (1 + pan);
    }
  };
  for (let t = 0, k = 0; t < total; t += bar, k++) {
    const ch = M.bars[k % M.bars.length];
    const grow = Math.min(1, 0.45 + (t / total) * 0.9);
    ch.forEach((note, j) => {
      const f = hz(note), det = 1.003;
      add(t, bar * 1.25, (j - 1.5) * 0.25, (x) => {
        const env = Math.min(1, x / 0.7) * Math.min(1, Math.max(0, (bar * 1.25 - x) / 0.9));
        const s = Math.sin(6.2832 * f * x) + 0.5 * Math.sin(6.2832 * f * det * x) + 0.22 * Math.sin(6.2832 * f * 2 * x + Math.sin(x * 2));
        return s * env * 0.05 * M.pad;
      });
    });
    add(t, bar, 0, (x) => Math.sin(6.2832 * hz(ch[0] - 12) * x) * Math.exp(-x * 0.8) * Math.min(1, x / 0.02) * 0.11);
    const step = bar / M.pluck.length;
    M.pluck.forEach((idx, j) => {
      if (t < bar * 0.9 && M.kick === 0.22) return;
      const f = hz(ch[idx] + 12);
      add(t + j * step, 1.1, j % 2 ? 0.35 : -0.35, (x) =>
        (Math.sin(6.2832 * f * x) + 0.35 * Math.sin(6.2832 * f * 2 * x) * Math.exp(-x * 9)) * Math.exp(-x * 4.2) * Math.min(1, x / 0.004) * 0.09 * M.plk * grow * 2);
    });
    if (M.kick && k > 0) for (let b = 0; b < 4; b++) {
      if (M.kick < 0.3 && b % 2) continue;
      add(t + b * beat, 0.3, 0, (x) => Math.sin(6.2832 * (48 * x + 5 * (1 - Math.exp(-x * 28)))) * Math.exp(-x * 13) * 0.3 * M.kick * grow);
    }
  }
  // A little room: two damped echoes.
  for (const [d, g] of [[0.23, 0.24], [0.41, 0.15]]) {
    const o = Math.floor(d * SR);
    for (let i = o; i < n; i++) { L[i] += R[i - o] * g; R[i] += L[i - o] * g; }
  }
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  let peak = 0.001;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round((L[i] / peak) * 26000), 44 + i * 4);
    buf.writeInt16LE(Math.round((R[i] / peak) * 26000), 46 + i * 4);
  }
  fs.writeFileSync(file, buf);
}

// Mix narration over music, ducking the music under the voice.
export async function mix({ plan, voice, musicFile, out }) {
  const inputs = [], f = [], T = plan.total.toFixed(3);
  const lines = plan.scenes.filter((s) => voice[s.key]);
  lines.forEach((s, i) => {
    inputs.push('-i', voice[s.key].file);
    const ms = Math.round((s.start + 0.45) * 1000);
    f.push(`[${i}:a]aresample=44100,aformat=channel_layouts=stereo,adelay=${ms}|${ms}[v${i}]`);
  });
  if (lines.length) f.push(`${lines.map((_, i) => `[v${i}]`).join('')}amix=inputs=${lines.length}:normalize=0,apad,atrim=0:${T},highpass=f=80,volume=1.5[voice]`);
  if (musicFile) {
    inputs.push('-stream_loop', '-1', '-i', musicFile);
    f.push(`[${lines.length}:a]aresample=44100,aformat=channel_layouts=stereo,atrim=0:${T},asetpts=PTS-STARTPTS,volume=${lines.length ? 0.42 : 0.8},afade=t=in:d=0.8,afade=t=out:st=${Math.max(0, plan.total - 2).toFixed(3)}:d=2[mus]`);
  }
  if (lines.length && musicFile) f.push('[voice]asplit[va][vb];[mus][vb]sidechaincompress=threshold=0.03:ratio=6:attack=30:release=500[duck];[va][duck]amix=inputs=2:normalize=0[m]');
  else if (lines.length) f.push('[voice]anull[m]');
  else if (musicFile) f.push('[mus]anull[m]');
  else return null;
  f.push('[m]loudnorm=I=-15:TP=-1.5:LRA=11,aresample=44100[out]');
  await run('ffmpeg', ['-y', ...inputs, '-filter_complex', f.join(';'), '-map', '[out]', '-t', T, '-c:a', 'aac', '-b:a', '192k', out]);
  return out;
}
