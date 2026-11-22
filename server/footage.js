// Photoreal pictures made on this Mac: the 3D model's own views (so the building stays the
// same building) and rooms described in words, turned into photographs by an open image model.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import * as store from './store.js';
import { SHOTS } from '../web/shared/shots.js';
import { run } from './audio.js';

export const MODELS = path.join(store.ROOT, 'models');
const SNAP = path.join(MODELS, 'hf/hub/models--Runpod--FLUX.2-klein-4B-mflux-4bit/snapshots');
const BIN = path.join(store.ROOT, 'ai/bin');
export const modelDir = () => { try { const d = fs.readdirSync(SNAP).find((x) => !x.startsWith('.')); return d && path.join(SNAP, d); } catch { return null; } };
export const enabled = () => !!modelDir() && fs.existsSync(path.join(BIN, 'mflux-generate-flux2'));
export const depthReady = () => fs.existsSync(path.join(MODELS, 'onnx-community/depth-anything-v2-small/onnx/model.onnx'));
export const voiceReady = () => fs.existsSync(path.join(MODELS, 'onnx-community/Kokoro-82M-v1.0-ONNX/onnx/model.onnx'));

const DIMS = { '9:16': [1088, 1920], '1:1': [1280, 1280], '16:9': [1920, 1088] };
export const dims = (p) => DIMS[p.film.format] || DIMS['9:16'];

export function image(p, key, seed, ref, out, job) {
  const [w, h] = dims(p), edit = !!ref;
  const args = ['--model', modelDir(), '--base-model', 'flux2-klein-4b', '--prompt', SHOTS[key].prompt(p), '--width', w, '--height', h, '--steps', 4, '--guidance', '1.0', '--seed', seed, '--vae-tiling', '--no-exif', '--output', out, ...(edit ? ['--image-paths', ref] : [])].map(String);
  return new Promise((res, rej) => {
    const c = spawn(path.join(BIN, edit ? 'mflux-generate-flux2-edit' : 'mflux-generate-flux2'), args, { env: { ...process.env, HF_HOME: path.join(MODELS, 'hf'), HF_HUB_OFFLINE: '1' } });
    let log = '';
    job.kill = () => c.kill();
    c.stderr.on('data', (d) => { log = (log + d).slice(-2000); const m = [...String(d).matchAll(/(\d)\/4 /g)].pop(); if (m) job.sub = m[1] / 4; });
    c.stdout.on('data', (d) => (log = (log + d).slice(-2000)));
    c.on('error', rej);
    c.on('close', (code) => (code === 0 && fs.existsSync(out) ? res() : rej(new Error('The image model stopped: ' + (log.trim().split('\n').pop() || code)))));
  });
}

export async function depth(pairs) {
  if (!depthReady() || !pairs.length) return false;
  await run(process.execPath, [path.join(store.ROOT, 'server/depth-worker.js'), MODELS, ...pairs.flat()]);
  return true;
}

export function dropFiles(p, f) {
  if (!f) return;
  const dir = path.join(store.dirOf(p.id), 'media');
  for (const x of [f.file, f.depth]) if (x) fs.rmSync(path.join(dir, x), { force: true });
  if (f.frames) for (let i = 1; i <= f.frames; i++) fs.rmSync(path.join(dir, `${f.clip}-${String(i).padStart(4, '0')}.jpg`), { force: true });
}
