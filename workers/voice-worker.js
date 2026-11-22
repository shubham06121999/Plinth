// node voice-worker.js job.json : speaks each beat with the offline Kokoro voice and
// measures where each part of the line ends. Runs in its own process so the app stays responsive.
import fs from 'node:fs';
import path from 'node:path';
import { env } from '@huggingface/transformers';
import { KokoroTTS } from 'kokoro-js';

const job = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
env.cacheDir = job.models; env.localModelPath = job.models; env.allowRemoteModels = false;
const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'fp32', device: 'cpu' });

export function wav(file, data, rate) {
  const n = data.length, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.max(-1, Math.min(1, data[i])) * 32767, 44 + i * 2);
  fs.writeFileSync(file, b);
}

const result = {};
for (const b of job.beats) {
  // Every part is spoken separately when it is a full sentence, so its timing is exact.
  let pieces = [], ends = [], t = 0;
  const runs = [];
  for (const part of b.parts) (runs.length && !/[.!?]$/.test(runs.at(-1).at(-1)) ? runs.at(-1).push(part) : runs.push([part]));
  const R = 24000;
  for (const run of runs) {
    let a = (await tts.generate(run.join(' '), { voice: job.voice, speed: job.speed || 1 })).audio;
    let i0 = a.findIndex((x) => Math.abs(x) > 0.012), i1 = a.length - 1;
    while (i1 > 0 && Math.abs(a[i1]) < 0.008) i1--;
    a = a.slice(Math.max(0, i0 - 480), Math.min(a.length, i1 + 1600));
    // Inside one sentence, share the time by length, then snap to the quietest moment nearby.
    const len = run.map((x) => x.length + 4), sum = len.reduce((q, x) => q + x, 0);
    let acc = 0;
    run.forEach((_, i) => {
      acc += len[i];
      let at = a.length * (acc / sum);
      if (i < run.length - 1) {
        let best = at, low = Infinity;
        for (let k = -0.3; k <= 0.3; k += 0.02) {
          const c = Math.round(at + k * R); if (c < 600 || c > a.length - 600) continue;
          let e = 0; for (let j = c - 500; j < c + 500; j++) e += a[j] * a[j];
          if (e < low) { low = e; best = c; }
        }
        at = best;
      }
      ends.push(t + at / R);
    });
    pieces.push(a); t += a.length / R;
    const gap = new Float32Array(Math.round(0.14 * R)); pieces.push(gap); t += 0.14;
  }
  const all = new Float32Array(pieces.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of pieces) { all.set(p, o); o += p.length; }
  const file = path.join(job.dir, `${b.key}.wav`);
  wav(file, all, R);
  result[b.key] = { file, dur: all.length / R, parts: ends };
}
fs.writeFileSync(job.out, JSON.stringify(result));
