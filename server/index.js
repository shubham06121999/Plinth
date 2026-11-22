import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import * as store from './store.js';
import * as render from './render.js';
import * as audio from './audio.js';
import * as photoreal from './photoreal.js';
import * as sound from './sound.js';
import * as footage from './footage.js';
import { SHOTS } from '../web/shared/shots.js';
import { missing } from '../web/shared/model.js';

const PORT = Number(process.env.PORT || 4600);
const app = express();
app.disable('x-powered-by');

// Local tool: only this machine, only this origin.
app.use((req, res, next) => {
  const host = (req.headers.host || '').replace(/:\d+$/, '');
  if (!['localhost', '127.0.0.1'].includes(host)) return res.status(403).end();
  const o = req.headers.origin;
  if (o && o !== `http://${req.headers.host}`) return res.status(403).end();
  next();
});

const wrap = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (e) { next(e); } };
const raw = (limit) => express.raw({ type: () => true, limit });
const nm = (p) => path.join(store.ROOT, 'node_modules', p);

app.use('/vendor/three', express.static(nm('three')));
app.use('/vendor/fonts/archivo', express.static(nm('@fontsource-variable/archivo')));
app.use('/vendor/fonts/shoulders', express.static(nm('@fontsource-variable/big-shoulders-display')));
app.use('/vendor/fonts/marcellus', express.static(nm('@fontsource/marcellus')));
app.use('/vendor/fonts/vibes', express.static(nm('@fontsource/great-vibes')));
app.use(express.static(path.join(store.ROOT, 'web'), { setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));
app.get('/files/:id/:box/:name', wrap((req, res) => {
  const { id, box, name } = req.params;
  if (!['media', 'out'].includes(box) || name !== path.basename(name)) return res.status(404).end();
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.query.dl) res.attachment(name);
  res.sendFile(name, { root: path.join(store.dirOf(id), box) }, (e) => { if (e && !res.headersSent) res.status(404).end(); });
}));

app.use('/api', express.json({ limit: '2mb', type: 'application/json' }));

app.get('/api/status', wrap(async (req, res) => {
  const hasFfmpeg = await audio.run('ffmpeg', ['-version']).then(() => true, () => false);
  res.json({ browser: !!render.findBrowser(), ffmpeg: hasFfmpeg, voices: await sound.allVoices(), footage: footage.enabled(), photoreal: photoreal.enabled() });
}));
app.get('/api/projects', wrap((req, res) => res.json(store.list())));
app.post('/api/projects', wrap((req, res) => res.json(store.create(req.body || {}))));
app.get('/api/projects/:id', wrap((req, res) => res.json(store.get(req.params.id))));
app.put('/api/projects/:id', wrap((req, res) => res.json(store.update(req.params.id, (p) => store.apply(p, req.body || {})))));
app.delete('/api/projects/:id', wrap((req, res) => { store.remove(req.params.id); res.json({ ok: true }); }));

const IMG = /\.(jpe?g|png|webp|heic|heif|avif|tiff?)$/i;
async function saveImage(req, dir, { png = false } = {}) {
  const name = String(req.query.name || '');
  if (!IMG.test(name)) throw Object.assign(new Error(`${name || 'That file'} is not a photo we can read. Use JPG, PNG, WebP or HEIC.`), { status: 400 });
  const id = store.newId(), ext = path.extname(name).toLowerCase();
  const src = path.join(dir, `.${id}${ext}`), file = `${id}.${png ? 'png' : 'jpg'}`, out = path.join(dir, file);
  fs.writeFileSync(src, req.body);
  try {
    if (process.platform === 'darwin') await audio.run('sips', ['-s', 'format', png ? 'png' : 'jpeg', ...(png ? [] : ['-s', 'formatOptions', '90']), '--resampleHeightWidthMax', png ? '800' : '2400', src, '--out', out]);
    else await audio.run('ffmpeg', ['-y', '-i', src, '-frames:v', '1', '-q:v', '2', out]);
    if (!fs.existsSync(out)) throw new Error('no output');
  } catch {
    throw Object.assign(new Error(`${name} could not be read as an image.`), { status: 400 });
  } finally { fs.rmSync(src, { force: true }); }
  return { id, file };
}
const mediaDir = (id) => { store.get(id); return path.join(store.dirOf(id), 'media'); };

app.post('/api/projects/:id/photos', raw('40mb'), wrap(async (req, res) => {
  const { id, file } = await saveImage(req, mediaDir(req.params.id));
  res.json(store.update(req.params.id, (p) => p.photos.push({ id, file, caption: '', inFilm: p.photos.filter((x) => x.inFilm).length < 8 })));
}));
app.delete('/api/projects/:id/photos/:photo', wrap((req, res) => {
  const dir = mediaDir(req.params.id);
  res.json(store.update(req.params.id, (p) => {
    const ph = p.photos.find((x) => x.id === req.params.photo);
    if (ph) fs.rmSync(path.join(dir, ph.file), { force: true });
    p.photos = p.photos.filter((x) => x !== ph);
    if (p.posterPhoto === req.params.photo) p.posterPhoto = '';
  }));
}));
app.post('/api/projects/:id/logo', raw('15mb'), wrap(async (req, res) => {
  const dir = mediaDir(req.params.id), { file } = await saveImage(req, dir, { png: true });
  res.json(store.update(req.params.id, (p) => { if (p.logo) fs.rmSync(path.join(dir, p.logo), { force: true }); p.logo = file; }));
}));
app.delete('/api/projects/:id/logo', wrap((req, res) => {
  const dir = mediaDir(req.params.id);
  res.json(store.update(req.params.id, (p) => { if (p.logo) fs.rmSync(path.join(dir, p.logo), { force: true }); p.logo = null; }));
}));
app.post('/api/projects/:id/track', raw('40mb'), wrap(async (req, res) => {
  const ext = path.extname(String(req.query.name || '')).toLowerCase();
  if (!['.mp3', '.m4a', '.wav', '.aac', '.ogg', '.flac'].includes(ext)) throw Object.assign(new Error('Use an MP3, M4A, WAV, AAC, OGG or FLAC file.'), { status: 400 });
  const dir = mediaDir(req.params.id), file = store.newId() + ext, full = path.join(dir, file);
  fs.writeFileSync(full, req.body);
  const dur = await audio.seconds(full).catch(() => 0);
  if (!(dur > 0)) { fs.rmSync(full); throw Object.assign(new Error('That file has no audio we can read.'), { status: 400 }); }
  res.json(store.update(req.params.id, (p) => { if (p.track) fs.rmSync(path.join(dir, p.track), { force: true }); p.track = file; p.film = { ...p.film, music: 'upload' }; }));
}));

app.post('/api/projects/:id/jobs', wrap((req, res) => {
  const p = store.get(req.params.id), kind = req.body?.kind;
  if (!['film', 'photos', 'posters', 'footage'].includes(kind)) return res.status(400).json({ error: 'Unknown kind' });
  const gaps = missing(p);
  if (gaps.length) return res.status(400).json({ error: `Add the ${gaps.map((g) => g.label).join(' and ')} first.`, fields: gaps.map((g) => g.field) });
  if ([...render.jobs.values()].some((j) => j.projectId === p.id && j.kind === kind && ['queued', 'running'].includes(j.status)))
    return res.status(409).json({ error: 'That is already being made.' });
  res.json(render.enqueue(p.id, kind, { format: req.body.format, keys: Array.isArray(req.body.keys) ? req.body.keys.filter((k) => SHOTS[k]) : undefined, again: !!req.body.again }));
}));
app.get('/api/jobs', wrap((req, res) => res.json([...render.jobs.values()].filter((j) => j.projectId === req.query.project).map(({ stop, ...j }) => j))));
app.post('/api/jobs/:id/cancel', wrap((req, res) => { render.cancel(req.params.id); res.json({ ok: true }); }));

app.delete('/api/projects/:id/outputs/:out', wrap((req, res) => {
  const dir = path.join(store.dirOf(req.params.id), 'out');
  res.json(store.update(req.params.id, (p) => {
    const o = p.outputs.find((x) => x.id === req.params.out);
    if (o) for (const f of [o.file, o.thumb]) if (f) fs.rmSync(path.join(dir, f), { force: true });
    p.outputs = p.outputs.filter((x) => x !== o);
  }));
}));
app.post('/api/projects/:id/outputs/:out/photoreal', wrap(async (req, res) => {
  if (!photoreal.enabled()) return res.status(400).json({ error: 'Add OPENAI_API_KEY to .env and restart.' });
  res.json(await photoreal.make(req.params.id, req.params.out));
}));
app.post('/api/projects/:id/outputs/:out/use', wrap((req, res) => {
  const id = req.params.id;
  res.json(store.update(id, (p) => {
    const o = p.outputs.find((x) => x.id === req.params.out && x.kind === 'photo');
    if (!o) throw Object.assign(new Error('That image no longer exists'), { status: 404 });
    const ph = { id: store.newId(), caption: '', inFilm: true };
    ph.file = ph.id + path.extname(o.file);
    fs.copyFileSync(path.join(store.dirOf(id), 'out', o.file), path.join(store.dirOf(id), 'media', ph.file));
    // Views carry their own label; a photoreal version may have lost it.
    p.photos.push({ ...ph, cgi: !!o.photoreal });
  }));
}));

// Your own picture or clip in place of a generated one.
app.post('/api/projects/:id/footage/:key', raw('300mb'), wrap(async (req, res) => {
  const { id, key } = req.params;
  if (!SHOTS[key]) return res.status(400).json({ error: 'Unknown shot' });
  const dir = mediaDir(id), name = String(req.query.name || '');
  fs.mkdirSync(dir, { recursive: true });
  let rec;
  if (/\.(mp4|mov|m4v|webm)$/i.test(name)) {
    const clip = store.newId(), src = path.join(dir, `.${clip}${path.extname(name).toLowerCase()}`), p = store.get(id), [w, h] = { '9:16': [1080, 1920], '1:1': [1080, 1080], '16:9': [1920, 1080] }[p.film.format] || [1080, 1920];
    fs.writeFileSync(src, req.body);
    try {
      await audio.run('ffmpeg', ['-y', '-i', src, '-t', '8', '-vf', `fps=30,scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h}`, '-q:v', '3', path.join(dir, `${clip}-%04d.jpg`)]);
    } catch { throw Object.assign(new Error(`${name} could not be read as a video.`), { status: 400 }); } finally { fs.rmSync(src, { force: true }); }
    const frames = fs.readdirSync(dir).filter((f) => f.startsWith(clip + '-')).length;
    if (!frames) throw Object.assign(new Error(`${name} has no picture we can read.`), { status: 400 });
    rec = { clip, frames, thumb: `${clip}-0001.jpg` };
  } else {
    const { id: pic, file } = await saveImage(req, dir);
    const dep = `${pic}-depth.png`, ok = await footage.depth([[path.join(dir, file), path.join(dir, dep)]]).catch(() => false);
    rec = { file, depth: ok ? dep : null };
  }
  res.json(store.update(id, (p) => { p.footage ||= {}; footage.dropFiles(p, p.footage[key]); p.footage[key] = rec; }));
}));
app.delete('/api/projects/:id/footage/:key', wrap((req, res) => res.json(store.update(req.params.id, (p) => { footage.dropFiles(p, p.footage?.[req.params.key]); if (p.footage) delete p.footage[req.params.key]; }))));

app.post('/internal/sink/:token', raw('60mb'), wrap(async (req, res) => { await render.sink(req.params.token, req.body, req.query); res.end(); }));

app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status === 413 ? 'That file is too large.' : err.message });
});

const server = app.listen(PORT, '127.0.0.1', (e) => {
  if (e) { console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is in use. Set PORT in .env.` : e.message); process.exit(1); }
  render.setOrigin(`http://127.0.0.1:${PORT}`);
  console.log(`Plinth is running at http://localhost:${PORT}`);
});
server.requestTimeout = 0;
