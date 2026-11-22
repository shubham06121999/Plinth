import { Film, loadFonts, VIEWS, POSTERS } from './shared/film.js';
import { Reel } from './shared/reelfilm.js';
import { SHOTS } from './shared/shots.js';

const q = new URLSearchParams(location.search), token = q.get('token');
const canvas = document.getElementById('c');
const blob = (quality) => new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
async function send(b, params = {}) {
  const r = await fetch(`/internal/sink/${token}?${new URLSearchParams(params)}`, { method: 'POST', body: b, headers: { 'content-type': 'application/octet-stream' } });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'frame refused');
}

const p = await (await fetch('/api/projects/' + q.get('project'))).json();
await loadFonts();
const reel = q.get('style') === 'reel';
const film = reel ? new Reel(canvas, { quality: 'high' }) : new Film(canvas, { quality: 'high' });
await film.load(p);

async function makeFilm() {
  const plan = film.setPlan({ format: q.get('format'), durations: JSON.parse(q.get('durations') || '{}'), timing: JSON.parse(q.get('timing') || '{}') });
  const total = Math.round(plan.total * plan.fps);
  let sending = Promise.resolve();
  for (let i = 0; i < total; i++) {
    if (film.prep) await film.prep(i / plan.fps);
    film.draw(i / plan.fps);
    const b = await blob(0.93);
    await sending;
    sending = send(b);
  }
  await sending;
}

async function makeStills(kind) {
  if (kind === 'photos') {
    const views = VIEWS.filter(([, shot]) => shot !== 'deck' || film.world.L.podium);
    for (const [label, shot, light, w, h] of views) {
      film.view(shot, light, w, h);
      await send(await blob(0.94), { label, w, h, of: views.length });
    }
  } else {
    const list = POSTERS.filter(([, k]) => k === 'launch' || (k === 'homes' ? p.configs.some((c) => c.type?.trim()) : p.amenities.length));
    for (const [label, k, w, h] of list) if (film.poster(k, w, h)) await send(await blob(0.95), { label, w, h, of: list.length });
  }
}

// Clean views of the model for the image model to work from.
async function makeRefs(keys, w, h) {
  for (const key of keys) {
    const [shot, light, k] = SHOTS[key].ref;
    film.view(shot, light, w, h, k, false);
    await send(await blob(0.95), { key });
  }
}

const gl = film.world.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
window.plinth = { ready: true, film: makeFilm, stills: makeStills, refs: makeRefs, gpu: ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL), film_: film };
