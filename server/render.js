// Drives a headless Chrome that runs the same drawing code as the studio preview,
// and pipes the frames it draws into ffmpeg.
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import * as store from './store.js';
import * as audio from './audio.js';
import * as sound from './sound.js';
import * as footage from './footage.js';
import { reelPlan, shotsNeeded } from '../web/shared/reel.js';
import { SHOTS } from '../web/shared/shots.js';
import { plan as makePlan, autoScenes } from '../web/shared/story.js';
import { FORMATS } from '../web/shared/model.js';

const BROWSERS = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
];
export const findBrowser = () => BROWSERS.find((b) => b && fs.existsSync(b));

export const jobs = new Map();
const sinks = new Map(); // token -> async (buffer, query) => void
let chain = Promise.resolve();
let origin = '';
export const setOrigin = (o) => (origin = o);

export async function sink(token, buffer, query) {
  const fn = sinks.get(token);
  if (!fn) throw Object.assign(new Error('No such render'), { status: 404 });
  await fn(buffer, query);
}

export function enqueue(projectId, kind, opts) {
  const job = { id: store.newId(), projectId, kind, status: 'queued', step: 'Waiting for the render before it', progress: 0, outputs: [], createdAt: Date.now() };
  jobs.set(job.id, job);
  for (const [id, j] of jobs) if (Date.now() - j.createdAt > 6 * 3600e3) jobs.delete(id);
  chain = chain.then(async () => {
    if (job.status === 'cancelled') return;
    job.status = 'running';
    try {
      await (kind === 'film' ? film : kind === 'footage' ? shoot : stills)(job, opts);
      if (job.status === 'running') Object.assign(job, { status: 'done', progress: 1, step: 'Done' });
    } catch (e) {
      if (job.status !== 'cancelled') {
        console.error(`[${kind}]`, e);
        Object.assign(job, { status: 'failed', error: e.message });
      }
    }
  });
  return job;
}

export function cancel(id) {
  const j = jobs.get(id);
  if (!j || !['queued', 'running'].includes(j.status)) return;
  j.status = 'cancelled';
  j.stop?.(); j.kill?.();
}

async function withPage(job, params, fn) {
  const exe = findBrowser();
  if (!exe) throw new Error('Rendering needs Google Chrome, Edge, Brave or Chromium. Install one, or set CHROME_PATH in .env.');
  const browser = await puppeteer.launch({
    executablePath: exe, headless: true,
    args: ['--hide-scrollbars', '--mute-audio', '--ignore-gpu-blocklist', '--enable-gpu',
      ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])],
    protocolTimeout: 30 * 60e3,
  });
  const token = crypto.randomBytes(16).toString('hex');
  job.stop = () => browser.close().catch(() => {});
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(`${origin}/render.html?${new URLSearchParams({ ...params, token })}`, { waitUntil: 'load' });
    await page.waitForFunction('window.plinth && window.plinth.ready', { timeout: 60e3 })
      .catch(() => { throw new Error('The renderer did not start: ' + (errors[0] || 'timed out')); });
    return await fn(page, token);
  } finally {
    sinks.delete(token);
    await browser.close().catch(() => {});
  }
}

const slug = (s) => (s || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'project';

const isReel = (p) => (p.film.style || 'reel') === 'reel';

// Makes the pictures a reel needs. `keys` limits it to some; otherwise whatever is missing.
async function shoot(job, { keys, again } = {}, share = 1) {
  let p = store.get(job.projectId);
  const want = (keys || shotsNeeded(p)).filter((k) => SHOTS[k] && (again || !p.footage?.[k]));
  if (!want.length) return;
  if (!footage.enabled()) throw new Error('The photoreal image model is not installed. Run "npm run setup-ai" in the plinth folder, or add your own pictures and clips.');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plinth-'));
  try {
    const [w, h] = footage.dims(p), refs = {};
    const withRef = want.filter((k) => SHOTS[k].ref);
    if (withRef.length) {
      job.step = 'Setting up the camera angles';
      await withPage(job, { project: p.id }, async (page, token) => {
        sinks.set(token, async (buf, q) => { if (withRef.includes(q.key)) { refs[q.key] = path.join(tmp, q.key + '.jpg'); fs.writeFileSync(refs[q.key], buf); } });
        await page.evaluate((k, a, b) => window.plinth.refs(k, a, b), withRef, w / 2, h / 2);
      });
    }
    for (const [i, key] of want.entries()) {
      if (job.status === 'cancelled') return;
      job.step = `Photographing ${SHOTS[key].label.toLowerCase()}, ${i + 1} of ${want.length}`;
      const tick = setInterval(() => (job.progress = share * ((i + (job.sub || 0) * 0.9) / want.length)), 500);
      const id = store.newId(), png = path.join(tmp, key + '.png'), media = path.join(store.dirOf(p.id), 'media');
      fs.mkdirSync(media, { recursive: true });
      try {
        job.sub = 0;
        await footage.image(p, key, parseInt(id.slice(0, 6), 16) % 100000, refs[key], png, job);
        const file = `${id}.jpg`, dep = `${id}-depth.png`;
        await audio.run('ffmpeg', ['-y', '-i', png, '-q:v', '2', path.join(media, file)]);
        const hasDepth = await footage.depth([[png, path.join(media, dep)]]).catch((e) => (console.error('[depth]', e.message), false));
        store.update(p.id, (x) => { x.footage ||= {}; footage.dropFiles(x, x.footage[key]); x.footage[key] = { file, depth: hasDepth ? dep : null, made: true }; });
      } finally { clearInterval(tick); }
      job.progress = share * ((i + 1) / want.length);
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

async function film(job, { format }) {
  let p = store.get(job.projectId);
  if (!FORMATS[format]) format = p.film.format;
  const reel = isReel(p);
  if (reel && footage.enabled()) { await shoot(job, {}); if (job.status === 'cancelled') return; p = store.get(job.projectId); job.progress = 0; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plinth-'));
  try {
    let voice = {}, plan, track, durations = {}, timing = {};
    if (reel) {
      job.step = 'Recording the narration';
      voice = await sound.speak(p, tmp);
      timing = Object.fromEntries(Object.entries(voice).map(([k, v]) => [k, { dur: v.dur, parts: v.parts }]));
      plan = reelPlan(p, { format, timing });
      if (!plan.scenes.length) throw new Error('Every scene is switched off. Turn at least one on.');
      job.step = 'Composing and mixing the sound';
      track = await sound.master({ plan, voice, ...(await sound.compose(p, plan, tmp)), dir: tmp });
    } else {
    if (p.film.voice !== 'none') {
      job.step = 'Recording the narration';
      const say = makePlan(p, { format }).scenes;
      voice = p.film.voice.startsWith('kokoro:') ? await sound.speakScenes(say, p.film.voice, tmp) : await audio.narrate(say, p.film.voice, tmp);
    }
    durations = Object.fromEntries(autoScenes(p).map((s) => [s.key, voice[s.key]?.dur ?? 0]));
    plan = makePlan(p, { format, durations });
    if (!plan.scenes.length) throw new Error('Every scene is switched off. Turn at least one on.');

    let musicFile = null;
    if (p.film.music === 'upload' && p.track) musicFile = path.join(store.dirOf(p.id), 'media', p.track);
    else if (p.film.music !== 'none' && p.film.music !== 'upload') {
      job.step = 'Composing the music';
      musicFile = path.join(tmp, 'music.wav');
      audio.music(p.film.music, plan.total, musicFile);
    }
    track = await audio.mix({ plan, voice, musicFile, out: path.join(tmp, 'mix.m4a') });
    }
    if (job.status === 'cancelled') return;

    const id = store.newId();
    const file = `${slug(p.name)}-${format.replace(':', 'x')}-${id.slice(0, 4)}.mp4`;
    const out = path.join(tmp, 'film.mp4');
    const total = Math.round(plan.total * plan.fps);
    job.step = 'Filming';
    let poster = null;

    await withPage(job, { project: p.id, format, style: reel ? 'reel' : 'model', durations: JSON.stringify(durations), timing: JSON.stringify(timing) }, async (page, token) => {
      const ff = spawn('ffmpeg', ['-y', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(plan.fps), '-i', 'pipe:0',
        ...(track ? ['-i', track] : []),
        '-map', '0:v', ...(track ? ['-map', '1:a', '-c:a', 'copy'] : []),
        '-vf', 'scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-maxrate', '10M', '-bufsize', '20M', '-profile:v', 'high',
        '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
        '-movflags', '+faststart', '-r', String(plan.fps), out], { stdio: ['pipe', 'ignore', 'pipe'] });
      let err = '';
      ff.stderr.on('data', (d) => (err = (err + d).slice(-2000)));
      ff.stdin.on('error', () => {});
      const closed = new Promise((res, rej) => { ff.on('error', rej); ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg failed: ' + err.trim().split('\n').slice(-2).join(' '))))); });
      closed.catch(() => {});
      let n = 0;
      const posterAt = Math.round((plan.scenes[0].start + plan.scenes[0].dur - 0.8) * plan.fps);
      sinks.set(token, async (buf) => {
        if (ff.exitCode !== null) throw new Error('ffmpeg stopped early: ' + err.trim().split('\n').pop());
        if (n === posterAt) poster = buf;
        n++;
        job.progress = n / total;
        if (!ff.stdin.write(buf)) await new Promise((r) => { ff.stdin.once('drain', r); ff.once('close', r); });
      });
      try {
        await page.evaluate(() => window.plinth.film());
      } catch (e) {
        ff.kill();
        throw job.status === 'cancelled' ? e : new Error('Filming stopped: ' + e.message.split('\n')[0]);
      }
      ff.stdin.end();
      job.step = 'Finishing the file';
      await closed;
    });

    const dir = path.join(store.dirOf(p.id), 'out');
    fs.copyFileSync(out, path.join(dir, file));
    const thumb = file.replace('.mp4', '.jpg');
    if (poster) fs.writeFileSync(path.join(dir, thumb), poster);
    const rec = { id, kind: 'film', label: `${FORMATS[format].label} ${reel ? 'reel' : 'film'}`, file, thumb: poster ? thumb : null, w: plan.w, h: plan.h, format, seconds: Math.round(plan.total), bytes: fs.statSync(path.join(dir, file)).size, createdAt: new Date().toISOString() };
    store.update(p.id, (x) => x.outputs.unshift(rec));
    job.outputs.push(id);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// kind 'photos' (views of the building) or 'posters' (views with the details set on them).
async function stills(job) {
  const p = store.get(job.projectId);
  job.step = job.kind === 'photos' ? 'Photographing the model' : 'Setting the posters';
  await withPage(job, { project: p.id }, async (page, token) => {
    const dir = path.join(store.dirOf(p.id), 'out');
    const made = [];
    sinks.set(token, async (buf, q) => {
      const id = store.newId();
      const file = `${slug(p.name)}-${slug(q.label)}-${id.slice(0, 4)}.jpg`;
      fs.writeFileSync(path.join(dir, file), buf);
      made.push({ id, kind: job.kind === 'photos' ? 'photo' : 'poster', label: String(q.label), file, thumb: file, w: +q.w, h: +q.h, bytes: buf.length, createdAt: new Date().toISOString() });
      job.progress = made.length / +q.of;
    });
    await page.evaluate((k) => window.plinth.stills(k), job.kind);
    store.update(p.id, (x) => x.outputs.unshift(...made));
    job.outputs.push(...made.map((m) => m.id));
  });
}
