// The reel's sound: voice polish, music that steps back for the voice, effects, and a master
// at the loudness social apps expect.
import fs from 'node:fs';
import path from 'node:path';
import * as store from './store.js';
import { run, seconds, voices as macVoices } from './audio.js';
import { MODELS, voiceReady } from './footage.js';
import { beats, sayParts } from '../web/shared/reel.js';

export const KOKORO = { af_heart: 'Heart, American', af_bella: 'Bella, American', af_nicole: 'Nicole, soft American', bf_emma: 'Emma, British', af_kore: 'Kore, American', am_michael: 'Michael, American', am_fenrir: 'Fenrir, deep American', bm_george: 'George, British' };
export async function allVoices() {
  const k = voiceReady() ? Object.entries(KOKORO).map(([id, label]) => ({ id: 'kokoro:' + id, label })) : [];
  return [...k, ...(await macVoices()).map((v) => ({ id: v.id, label: `${v.id}, Mac voice (${v.lang})` }))];
}

export async function speak(p, dir) {
  const list = beats(p).filter((b) => b.on).map((b) => ({ key: b.key, parts: sayParts(b.say) })).filter((b) => b.parts.length);
  if (p.film.voice === 'none' || !list.length) return {};
  if (p.film.voice.startsWith('kokoro:') && voiceReady()) {
    const voice = p.film.voice.slice(7);
    if (!(voice in KOKORO)) throw new Error('That voice is not installed.');
    const jf = path.join(dir, 'voice.json'), out = path.join(dir, 'voice-out.json');
    fs.writeFileSync(jf, JSON.stringify({ models: MODELS, voice, dir, out, beats: list }));
    await run(process.execPath, [path.join(store.ROOT, 'server/voice-worker.js'), jf]);
    return JSON.parse(fs.readFileSync(out, 'utf8'));
  }
  if (!(await macVoices()).some((v) => v.id === p.film.voice)) return {};
  const res = {};
  for (const b of list) {
    const files = [], parts = []; let t = 0;
    for (const [i, s] of b.parts.entries()) {
      const txt = path.join(dir, `${b.key}-${i}.txt`), f = path.join(dir, `${b.key}-${i}.wav`);
      fs.writeFileSync(txt, s);
      await run('say', ['-v', p.film.voice, '-r', '172', '-f', txt, '-o', f, '--data-format=LEI16@24000']);
      t += await seconds(f); parts.push(t); files.push(f);
    }
    const file = path.join(dir, `${b.key}.wav`), cat = path.join(dir, `${b.key}.lst`);
    fs.writeFileSync(cat, files.map((f) => `file '${f}'`).join('\n'));
    await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', cat, '-c', 'copy', file]);
    res[b.key] = { file, dur: t, parts };
  }
  return res;
}

// What should be heard, read off the plan.
export function events(plan) {
  const ev = [{ t: 0.02, type: 'impact', v: 0.8 }];
  plan.scenes.forEach((s, i) => {
    if (i) ev.push({ t: s.start, type: 'whoosh', v: 0.75, dir: i % 2 ? 1 : -1 });
    if (s.key === 'intro') ev.push({ t: s.start, type: 'riser', d: Math.min(1.5, s.start), v: 0.8 }, { t: s.start, type: 'impact', v: 0.9 });
    if (s.key === 'end') ev.push({ t: s.start, type: 'riser', d: 1.2, v: 0.6 }, { t: s.start, type: 'impact', v: 0.9 }, { t: s.start + 0.9, type: 'chime', v: 0.8 });
    s.cuts.slice(1).forEach((c) => ev.push({ t: s.start + c.start, type: 'whoosh', v: 0.32, dir: c.seq % 2 ? 1 : -1 }));
    s.cards.forEach((c) => {
      const gold = c.lines.find((l) => l.kind === 'gold');
      if (!gold) return;
      const at = s.start + c.start + 0.3;
      if (/₹|\bCR\b|LAKH/i.test(gold.text)) ev.push({ t: at, type: 'chime', v: 1 });
      else if (/^\d[\d,]{2,}/.test(gold.text)) ev.push({ t: at, type: 'count' });
      else ev.push({ t: at, type: 'pop', v: 0.5 });
    });
  });
  return ev;
}

export async function compose(p, plan, dir) {
  const jf = path.join(dir, 'music.json'), music = path.join(dir, 'music.wav'), sfx = path.join(dir, 'sfx.wav');
  fs.writeFileSync(jf, JSON.stringify({ total: plan.total, mood: p.film.music, drop: plan.scenes.find((s) => s.key === 'intro')?.start ?? 0, events: p.film.effects === false ? [] : events(plan), music, sfx }));
  await run(process.execPath, [path.join(store.ROOT, 'server/music-worker.js'), jf]);
  const own = p.film.music === 'upload' && p.track ? path.join(store.dirOf(p.id), 'media', p.track) : null;
  return { music: own || (p.film.music === 'none' || p.film.music === 'upload' ? null : music), sfx };
}

export async function master({ plan, voice, music, sfx, dir }) {
  const T = plan.total.toFixed(3), inputs = [], f = [], lines = plan.scenes.filter((s) => voice[s.key]);
  lines.forEach((s, i) => {
    inputs.push('-i', voice[s.key].file);
    f.push(`[${i}:a]aresample=48000:resampler=soxr,aformat=channel_layouts=mono,adelay=${Math.round((s.start + s.lead) * 1000)}[v${i}]`);
  });
  let n = lines.length;
  if (lines.length) f.push(`${lines.map((_, i) => `[v${i}]`).join('')}amix=inputs=${n}:normalize=0,apad,atrim=0:${T},` +
    'highpass=f=85,equalizer=f=260:t=q:w=1.1:g=-2.5,equalizer=f=3200:t=q:w=1:g=2.5,treble=g=1.5:f=8000,aexciter=amount=1.1:drive=5:freq=7200:ceil=15000,' +
    'acompressor=threshold=-20dB:ratio=3.2:attack=6:release=110:makeup=5dB,aformat=channel_layouts=stereo,asplit=3[va][vb][vc]');
  // A short, quiet room around the voice keeps it from sounding pasted on.
  if (lines.length) f.push('[vc]highpass=f=400,aecho=0.8:0.5:23|41|67:0.16|0.11|0.07,volume=0.35[room]', '[va][room]amix=inputs=2:normalize=0[vox]');
  const mixIn = lines.length ? ['[vox]'] : [];
  if (music) {
    inputs.push('-stream_loop', '-1', '-i', music);
    f.push(`[${n++}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${T},asetpts=PTS-STARTPTS,${lines.length ? 'equalizer=f=2600:t=q:w=0.8:g=-3,' : ''}volume=${lines.length ? 0.36 : 0.9},afade=t=in:d=0.25,afade=t=out:st=${Math.max(0, plan.total - 1.6).toFixed(3)}:d=1.6[m0]`);
    if (lines.length) f.push('[m0][vb]sidechaincompress=threshold=0.02:ratio=5:attack=25:release=380:makeup=1[mus]');
    mixIn.push(lines.length ? '[mus]' : '[m0]');
  } else if (lines.length) f.push('[vb]anullsink');
  inputs.push('-i', sfx);
  f.push(`[${n}:a]atrim=0:${T},volume=0.38[fx]`); mixIn.push('[fx]');
  f.push(`${mixIn.join('')}amix=inputs=${mixIn.length}:normalize=0,acompressor=threshold=-9dB:ratio=1.6:attack=20:release=160[out]`);
  const raw = path.join(dir, 'raw.wav'), out = path.join(dir, 'mix.m4a');
  await run('ffmpeg', ['-y', ...inputs, '-filter_complex', f.join(';'), '-map', '[out]', '-t', T, '-c:a', 'pcm_f32le', '-ar', '48000', raw]);
  // Measure once, then set the level with plain gain and a limiter: no pumping.
  const { spawn } = await import('node:child_process');
  const log = await new Promise((res) => { const c = spawn('ffmpeg', ['-hide_banner', '-i', raw, '-af', 'ebur128', '-f', 'null', '-']); let e = ''; c.stderr.on('data', (d) => (e += d)); c.on('close', () => res(e)); });
  const I = Number([...log.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].pop()?.[1] ?? -18);
  await run('ffmpeg', ['-y', '-i', raw, '-af', `volume=${(-13.5 - I).toFixed(2)}dB,aresample=192000,alimiter=limit=0.76:attack=4:release=60:level=disabled,aresample=48000`, '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', out]);
  return out;
}

// Narration for the 3D model film, one file per scene.
export async function speakScenes(scenes, voice, dir) {
  const list = scenes.map((s) => ({ key: s.key, parts: sayParts(s.say || '') })).filter((s) => s.parts.length);
  if (!voiceReady() || !(voice.slice(7) in KOKORO)) return {};
  const jf = path.join(dir, 'voice.json'), out = path.join(dir, 'voice-out.json');
  fs.writeFileSync(jf, JSON.stringify({ models: MODELS, voice: voice.slice(7), dir, out, beats: list }));
  await run(process.execPath, [path.join(store.ROOT, 'server/voice-worker.js'), jf]);
  return JSON.parse(fs.readFileSync(out, 'utf8'));
}
